/**
 * @module studioQueue
 * @description
 * Fase 2, 3 y 6 — Cola de Tareas, Control de Concurrencia, Prevención de Ejecución Duplicada
 * y Despacho al Plugin de Roblox Studio.
 *
 * Responsabilidades:
 * 1. Mantener un registro de `taskId` ya procesados (con caché LRU de hasta 5,000 IDs) para impedir ejecuciones duplicadas.
 * 2. Limitar la concurrencia máxima de tareas en curso (`maxConcurrency`).
 * 3. Gestionar el estado en tiempo real del Plugin de Roblox Studio (`connected`, `selectedModel`, `lastHeartbeatAt`).
 * 4. Encolar tareas `studio.*` para que el plugin de Roblox Studio las recoja vía `127.0.0.1` y devuelva sus resultados con timeout controlado.
 */

import {
  BridgeMessageEnvelope,
  BridgeResponseEnvelope,
  buildBridgeResponseEnvelope,
} from './protocol.js';

export interface StudioLiveState {
  connected: boolean;
  lastSeenAt: string | null;
  pluginVersion: string | null;
  placeName: string | null;
  selectedModelName: string | null;
  selectedPartCount: number;
  pendingDestructiveConfirmations: number;
}

interface PendingStudioTask {
  envelope: BridgeMessageEnvelope;
  enqueuedAt: number;
  dispatchedToPlugin: boolean;
  resolve: (resp: BridgeResponseEnvelope) => void;
  timeoutHandle: NodeJS.Timeout;
}

export class TaskExecutionCoordinator {
  private readonly maxConcurrency: number;
  private readonly defaultTimeoutMs: number;
  private readonly completedTaskCache: Map<string, BridgeResponseEnvelope> = new Map();
  private readonly inFlightTaskIds: Set<string> = new Set();
  private readonly studioPendingQueue: Map<string, PendingStudioTask> = new Map();
  private activeWorkers = 0;
  private readonly waitQueue: Array<() => void> = [];

  private studioState: StudioLiveState = {
    connected: false,
    lastSeenAt: null,
    pluginVersion: null,
    placeName: null,
    selectedModelName: null,
    selectedPartCount: 0,
    pendingDestructiveConfirmations: 0,
  };

  constructor(options?: { maxConcurrency?: number; defaultTimeoutMs?: number }) {
    this.maxConcurrency = Math.max(1, options?.maxConcurrency ?? 2);
    this.defaultTimeoutMs = Math.max(1000, options?.defaultTimeoutMs ?? 30000);
  }

  public recordStudioHeartbeat(payload: Partial<StudioLiveState>): StudioLiveState {
    this.studioState = {
      connected: true,
      lastSeenAt: new Date().toISOString(),
      pluginVersion: payload.pluginVersion ?? this.studioState.pluginVersion ?? '2.2.0',
      placeName: payload.placeName ?? this.studioState.placeName ?? 'Roblox Studio',
      selectedModelName:
        payload.selectedModelName !== undefined
          ? payload.selectedModelName
          : this.studioState.selectedModelName,
      selectedPartCount:
        typeof payload.selectedPartCount === 'number'
          ? payload.selectedPartCount
          : this.studioState.selectedPartCount,
      pendingDestructiveConfirmations:
        typeof payload.pendingDestructiveConfirmations === 'number'
          ? payload.pendingDestructiveConfirmations
          : this.studioState.pendingDestructiveConfirmations,
    };
    return this.getStudioState();
  }

  public getStudioState(): StudioLiveState {
    if (this.studioState.lastSeenAt) {
      const elapsed = Date.now() - Date.parse(this.studioState.lastSeenAt);
      if (elapsed > 15000) {
        this.studioState.connected = false;
      }
    }
    return { ...this.studioState };
  }

  public hasProcessedTask(taskId: string): boolean {
    return this.completedTaskCache.has(taskId);
  }

  public getCachedTaskResult(taskId: string): BridgeResponseEnvelope | undefined {
    return this.completedTaskCache.get(taskId);
  }

  public isTaskInFlight(taskId: string): boolean {
    return this.inFlightTaskIds.has(taskId);
  }

  public getQueueMetrics(): {
    activeWorkers: number;
    queuedTasksCount: number;
    studioPendingCount: number;
    completedTasksCount: number;
  } {
    return {
      activeWorkers: this.activeWorkers,
      queuedTasksCount: this.waitQueue.length + this.inFlightTaskIds.size,
      studioPendingCount: this.studioPendingQueue.size,
      completedTasksCount: this.completedTaskCache.size,
    };
  }

  private rememberCompletedTask(taskId: string, response: BridgeResponseEnvelope): void {
    if (this.completedTaskCache.size >= 5000) {
      const oldestKey = this.completedTaskCache.keys().next().value;
      if (oldestKey) {
        this.completedTaskCache.delete(oldestKey);
      }
    }
    this.completedTaskCache.set(taskId, response);
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeWorkers < this.maxConcurrency) {
      this.activeWorkers += 1;
      return;
    }
    return new Promise((resolve) => {
      this.waitQueue.push(() => {
        this.activeWorkers += 1;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.activeWorkers = Math.max(0, this.activeWorkers - 1);
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }

  /**
   * Ejecuta una tarea garantizando:
   * - Prevención de duplicados (`taskId` idempotente).
   * - Control de concurrencia.
   * - Timeout automático.
   */
  public async executeDeduplicated(
    envelope: BridgeMessageEnvelope,
    handler: (env: BridgeMessageEnvelope) => Promise<unknown>,
    sharedSecret?: string,
    customTimeoutMs?: number
  ): Promise<BridgeResponseEnvelope> {
    const existing = this.completedTaskCache.get(envelope.taskId);
    if (existing) {
      return {
        ...existing,
        status: 'rejected_duplicate',
        error: `Tarea duplicada ignorada: taskId '${envelope.taskId}' ya fue ejecutada previamente.`,
      };
    }

    if (this.inFlightTaskIds.has(envelope.taskId)) {
      return buildBridgeResponseEnvelope({
        taskId: envelope.taskId,
        sessionId: envelope.sessionId,
        correlationId: envelope.correlationId,
        status: 'rejected_duplicate',
        result: null,
        error: `Tarea '${envelope.taskId}' ya se encuentra en ejecución.`,
        executionTime: 0,
        sharedSecret,
      });
    }

    this.inFlightTaskIds.add(envelope.taskId);
    await this.acquireSlot();
    const startMs = Date.now();
    const timeoutMs = customTimeoutMs ?? this.defaultTimeoutMs;

    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`TIMEOUT: La tarea '${envelope.taskId}' excedió ${timeoutMs} ms.`));
        }, timeoutMs);

        handler(envelope)
          .then((res) => {
            clearTimeout(timer);
            resolve(res);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });

      const derivedStatus: BridgeTaskStatus = (() => {
        if (result && typeof result === 'object') {
          const rStatus = (result as Record<string, unknown>).status;
          if (
            rStatus === 'awaiting_studio_confirmation' ||
            rStatus === 'awaiting_confirmation' ||
            rStatus === 'partially_applied' ||
            rStatus === 'failed'
          ) {
            return rStatus;
          }
        }
        return 'completed';
      })();

      const derivedError: string | null = (() => {
        if (derivedStatus === 'failed' && result && typeof result === 'object') {
          const errs = (result as Record<string, unknown>).errors;
          if (Array.isArray(errs) && errs.length > 0) {
            return errs.map((e) => String(e)).join('; ');
          }
          const errStr = (result as Record<string, unknown>).error;
          if (typeof errStr === 'string' && errStr.trim().length > 0) {
            return errStr.trim();
          }
        }
        return null;
      })();

      const response = buildBridgeResponseEnvelope({
        taskId: envelope.taskId,
        sessionId: envelope.sessionId,
        correlationId: envelope.correlationId,
        status: derivedStatus,
        result,
        error: derivedError,
        executionTime: Date.now() - startMs,
        sharedSecret,
      });
      this.rememberCompletedTask(envelope.taskId, response);
      return response;
    } catch (err: any) {
      const msg = String(err?.message || err || 'Error desconocido ejecutando tarea');
      const isTimeout = msg.startsWith('TIMEOUT:');
      const response = buildBridgeResponseEnvelope({
        taskId: envelope.taskId,
        sessionId: envelope.sessionId,
        correlationId: envelope.correlationId,
        status: isTimeout ? 'timeout' : 'failed',
        result: null,
        error: msg,
        executionTime: Date.now() - startMs,
        sharedSecret,
      });
      this.rememberCompletedTask(envelope.taskId, response);
      return response;
    } finally {
      this.inFlightTaskIds.delete(envelope.taskId);
      this.releaseSlot();
    }
  }

  /**
   * Encola una tarea destinada al Plugin de Roblox Studio y espera su respuesta.
   */
  public enqueueForStudioPlugin(
    envelope: BridgeMessageEnvelope,
    sharedSecret?: string,
    timeoutMs?: number
  ): Promise<BridgeResponseEnvelope> {
    const existing = this.completedTaskCache.get(envelope.taskId);
    if (existing) {
      return Promise.resolve({
        ...existing,
        status: 'rejected_duplicate',
        error: `Tarea de Studio duplicada ignorada: '${envelope.taskId}'.`,
      });
    }

    const startMs = Date.now();
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.studioPendingQueue.delete(envelope.taskId);
        const resp = buildBridgeResponseEnvelope({
          taskId: envelope.taskId,
          sessionId: envelope.sessionId,
          correlationId: envelope.correlationId,
          status: 'timeout',
          result: null,
          error: `Roblox Studio Plugin no respondió dentro de ${effectiveTimeout} ms.`,
          executionTime: Date.now() - startMs,
          sharedSecret,
        });
        this.rememberCompletedTask(envelope.taskId, resp);
        resolve(resp);
      }, effectiveTimeout);

      this.studioPendingQueue.set(envelope.taskId, {
        envelope,
        enqueuedAt: startMs,
        dispatchedToPlugin: false,
        resolve: (resp) => {
          clearTimeout(timeoutHandle);
          this.rememberCompletedTask(envelope.taskId, resp);
          resolve(resp);
        },
        timeoutHandle,
      });
    });
  }

  /**
   * Llamado por el Plugin de Roblox Studio (`GET /local/plugin/poll`) para retirar tareas pendientes.
   */
  public dequeueNextForStudioPlugin(): BridgeMessageEnvelope[] {
    const batch: BridgeMessageEnvelope[] = [];
    for (const item of this.studioPendingQueue.values()) {
      if (!item.dispatchedToPlugin) {
        item.dispatchedToPlugin = true;
        batch.push(item.envelope);
      }
    }
    return batch;
  }

  /**
   * Llamado por el Plugin de Roblox Studio (`POST /local/plugin/result`) cuando completa o pide confirmación de una tarea,
   * o cuando el usuario confirma/cancela una operación destructiva que estaba en `awaiting_studio_confirmation`.
   */
  public submitStudioPluginResult(
    params: {
      taskId: string;
      status:
        | 'completed'
        | 'failed'
        | 'awaiting_studio_confirmation'
        | 'awaiting_confirmation'
        | 'partially_applied';
      result?: unknown;
      error?: string | null;
    },
    sharedSecret?: string
  ): boolean {
    const pending = this.studioPendingQueue.get(params.taskId);
    if (pending) {
      this.studioPendingQueue.delete(params.taskId);
      const resp = buildBridgeResponseEnvelope({
        taskId: pending.envelope.taskId,
        sessionId: pending.envelope.sessionId,
        correlationId: pending.envelope.correlationId,
        status: params.status,
        result: params.result ?? null,
        error: params.error ?? null,
        executionTime: Date.now() - pending.enqueuedAt,
        sharedSecret,
      });
      pending.resolve(resp);
      return true;
    }

    // Permitir actualización post-confirmación o post-cancelación únicamente para tareas que estaban en espera de confirmación
    const existing = this.completedTaskCache.get(params.taskId);
    if (
      existing &&
      (existing.status === 'awaiting_studio_confirmation' ||
        existing.status === 'awaiting_confirmation')
    ) {
      const updated = buildBridgeResponseEnvelope({
        taskId: existing.taskId,
        sessionId: existing.sessionId,
        correlationId: existing.correlationId,
        status: params.status,
        result: params.result ?? null,
        error: params.error ?? null,
        executionTime: existing.executionTime,
        sharedSecret,
      });
      this.rememberCompletedTask(params.taskId, updated);
      return true;
    }

    return false;
  }

  public getCompletedTaskResult(taskId: string): BridgeResponseEnvelope | null {
    return this.completedTaskCache.get(taskId) ?? null;
  }

  public shutdown(): void {
    for (const pending of this.studioPendingQueue.values()) {
      clearTimeout(pending.timeoutHandle);
    }
    this.studioPendingQueue.clear();
  }
}
