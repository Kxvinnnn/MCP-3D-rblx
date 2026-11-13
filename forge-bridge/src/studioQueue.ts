/**
 * @module studioQueue
 * @description
 * Fase 2, 3, 4 y 6 — Cola de Tareas, Control de Concurrencia, Prevención de Ejecución Duplicada,
 * Confirmación de Operaciones Destructivas y Persistencia/Recuperación de Estado (`TaskStateStoreAdapter`).
 *
 * Responsabilidades:
 * 1. Mantener un registro de `taskId` ya procesados (con caché LRU de hasta 5,000 IDs) para impedir ejecuciones duplicadas.
 * 2. Limitar la concurrencia máxima de tareas en curso (`maxConcurrency`).
 * 3. Gestionar el estado en tiempo real del Plugin de Roblox Studio (`connected`, `selectedModel`, `lastHeartbeatAt`).
 * 4. Encolar tareas `studio.*` para que el plugin de Roblox Studio las recoja vía `127.0.0.1` y devuelva sus resultados con timeout controlado.
 * 5. Vincular confirmaciones destructivas a `taskId`, `operationId`, `modelName` y `partIdsToDelete`, evitando confirmaciones duplicadas,
 *    tardías/expiradas o cruzadas entre tareas, y persistiendo/recuperando el estado mediante `TaskStateStoreAdapter`.
 */

import path from 'path';
import {
  BridgeMessageEnvelope,
  BridgeResponseEnvelope,
  BridgeTaskStatus,
  buildBridgeResponseEnvelope,
} from './protocol.js';
import {
  type PersistedAwaitingConfirmationRecord,
  type TaskResultHistoryEntry,
  type TaskStateStoreSnapshot,
  type PersistenceDiagnostics,
  type TaskStateStoreAdapter,
  VALID_TASK_STATUSES,
  isValidBridgeResponseEnvelopeRecord,
  isValidPersistedAwaitingConfirmationRecord,
  isValidTaskResultHistoryEntry,
  InMemoryTaskStateStoreAdapter,
  type JsonFileTaskStateStoreOptions,
  JsonFileTaskStateStoreAdapter,
} from './taskStateStore.js';

export {
  type PersistedAwaitingConfirmationRecord,
  type TaskResultHistoryEntry,
  type TaskStateStoreSnapshot,
  type PersistenceDiagnostics,
  type TaskStateStoreAdapter,
  VALID_TASK_STATUSES,
  isValidBridgeResponseEnvelopeRecord,
  isValidPersistedAwaitingConfirmationRecord,
  isValidTaskResultHistoryEntry,
  InMemoryTaskStateStoreAdapter,
  type JsonFileTaskStateStoreOptions,
  JsonFileTaskStateStoreAdapter,
};

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
  private readonly confirmationExpirationMs: number;
  private readonly stateStore: TaskStateStoreAdapter;
  private readonly stateFilePath: string | null;
  private readonly completedTaskCache: Map<string, BridgeResponseEnvelope> = new Map();
  private readonly awaitingConfirmationRegistry: Map<string, PersistedAwaitingConfirmationRecord> = new Map();
  private readonly resultHistory: TaskResultHistoryEntry[] = [];
  private readonly inFlightTaskIds: Set<string> = new Set();
  private readonly studioPendingQueue: Map<string, PendingStudioTask> = new Map();
  private activeWorkers = 0;
  private readonly waitQueue: Array<() => void> = [];
  private invalidRecordsRejectedOnRecovery = 0;
  private recoveredCompletedTasksCount = 0;
  private recoveredAwaitingConfirmationsCount = 0;
  private lastPersistenceError: string | null = null;

  private studioState: StudioLiveState = {
    connected: false,
    lastSeenAt: null,
    pluginVersion: null,
    placeName: null,
    selectedModelName: null,
    selectedPartCount: 0,
    pendingDestructiveConfirmations: 0,
  };

  constructor(options?: {
    maxConcurrency?: number;
    defaultTimeoutMs?: number;
    confirmationExpirationMs?: number;
    stateStore?: TaskStateStoreAdapter;
    stateFilePath?: string;
  }) {
    this.maxConcurrency = Math.max(1, options?.maxConcurrency ?? 2);
    this.defaultTimeoutMs = Math.max(1000, options?.defaultTimeoutMs ?? 30000);
    this.confirmationExpirationMs = Math.max(500, options?.confirmationExpirationMs ?? 5 * 60 * 1000);
    if (options?.stateStore) {
      this.stateStore = options.stateStore;
      this.stateFilePath = options?.stateFilePath ? path.resolve(options.stateFilePath) : null;
    } else if (options?.stateFilePath) {
      const resolvedPath = path.resolve(options.stateFilePath);
      this.stateStore = new JsonFileTaskStateStoreAdapter(resolvedPath);
      this.stateFilePath = resolvedPath;
    } else {
      this.stateStore = new InMemoryTaskStateStoreAdapter();
      this.stateFilePath = null;
    }
    this.recoverPersistedState();
  }

  public getStateStore(): TaskStateStoreAdapter {
    return this.stateStore;
  }

  public getPersistenceDiagnostics(): PersistenceDiagnostics {
    const storeDiag = this.stateStore.getDiagnostics ? this.stateStore.getDiagnostics() : {};
    return {
      filePath: storeDiag.filePath ?? this.stateFilePath,
      saveCount: storeDiag.saveCount ?? 0,
      saveErrorCount: storeDiag.saveErrorCount ?? (this.lastPersistenceError ? 1 : 0),
      lastSaveError: storeDiag.lastSaveError ?? this.lastPersistenceError,
      loadErrorCount: storeDiag.loadErrorCount ?? 0,
      lastLoadError: storeDiag.lastLoadError ?? null,
      corruptedFileDetected: storeDiag.corruptedFileDetected ?? false,
      invalidRecordsRejected:
        (storeDiag.invalidRecordsRejected ?? 0) + this.invalidRecordsRejectedOnRecovery,
      recoveredCompletedTasksCount: this.recoveredCompletedTasksCount,
      recoveredAwaitingConfirmationsCount: this.recoveredAwaitingConfirmationsCount,
    };
  }

  /**
   * Recupera las tareas completadas, confirmaciones pendientes e historial desde `stateStore` al iniciar o reiniciar el Bridge,
   * validando cada registro para rechazar datos corruptos o incompletos sin marcarlos como recuperados.
   */
  public recoverPersistedState(): void {
    this.completedTaskCache.clear();
    this.awaitingConfirmationRegistry.clear();
    this.resultHistory.splice(0, this.resultHistory.length);
    this.invalidRecordsRejectedOnRecovery = 0;
    this.recoveredCompletedTasksCount = 0;
    this.recoveredAwaitingConfirmationsCount = 0;

    const snap = this.stateStore.loadState();
    if (!snap || typeof snap !== 'object') {
      return;
    }
    const now = Date.now();

    for (const [taskId, record] of Object.entries(snap.awaitingConfirmations || {})) {
      const trimmedId = taskId.trim();
      if (!trimmedId || !isValidPersistedAwaitingConfirmationRecord(trimmedId, record)) {
        this.invalidRecordsRejectedOnRecovery += 1;
        continue;
      }
      const clonedRecord: PersistedAwaitingConfirmationRecord = {
        ...record,
        partIdsToDelete: [...record.partIdsToDelete],
      };
      if (clonedRecord.status === 'awaiting_confirmation' && now > clonedRecord.expiresAt) {
        clonedRecord.status = 'expired';
      }
      this.awaitingConfirmationRegistry.set(trimmedId, clonedRecord);
      this.recoveredAwaitingConfirmationsCount += 1;
    }

    for (const [taskId, resp] of Object.entries(snap.completedTasks || {})) {
      const trimmedId = taskId.trim();
      if (!trimmedId || !isValidBridgeResponseEnvelopeRecord(trimmedId, resp)) {
        this.invalidRecordsRejectedOnRecovery += 1;
        continue;
      }
      if (
        (resp.status === 'awaiting_studio_confirmation' ||
          resp.status === 'awaiting_confirmation') &&
        !this.awaitingConfirmationRegistry.has(trimmedId)
      ) {
        this.invalidRecordsRejectedOnRecovery += 1;
        continue;
      }
      this.completedTaskCache.set(trimmedId, resp);
      this.recoveredCompletedTasksCount += 1;
    }

    for (const [taskId, record] of this.awaitingConfirmationRegistry.entries()) {
      if (!this.completedTaskCache.has(taskId) && record.latestResponse) {
        this.completedTaskCache.set(taskId, record.latestResponse);
        this.recoveredCompletedTasksCount += 1;
      }
    }

    if (Array.isArray(snap.resultHistory)) {
      const validEntries: TaskResultHistoryEntry[] = [];
      for (const item of snap.resultHistory) {
        if (isValidTaskResultHistoryEntry(item)) {
          validEntries.push(item);
        } else {
          this.invalidRecordsRejectedOnRecovery += 1;
        }
      }
      this.resultHistory.splice(0, this.resultHistory.length, ...validEntries.slice(-500));
    }
  }

  private persistCurrentState(): void {
    const completedTasks: Record<string, BridgeResponseEnvelope> = {};
    for (const [k, v] of this.completedTaskCache.entries()) {
      completedTasks[k] = v;
    }
    const awaitingConfirmations: Record<string, PersistedAwaitingConfirmationRecord> = {};
    for (const [k, v] of this.awaitingConfirmationRegistry.entries()) {
      awaitingConfirmations[k] = v;
    }
    try {
      this.stateStore.saveState({
        completedTasks,
        awaitingConfirmations,
        resultHistory: this.resultHistory.slice(-500),
      });
      this.lastPersistenceError = null;
    } catch (err: any) {
      this.lastPersistenceError = String(err?.message || err || 'Error de persistencia');
      throw err;
    }
  }

  private appendResultHistory(
    taskId: string,
    operationId: string,
    modelName: string,
    status: BridgeTaskStatus
  ): void {
    this.resultHistory.push({
      taskId,
      operationId,
      modelName,
      status,
      timestamp: Date.now(),
    });
    if (this.resultHistory.length > 500) {
      this.resultHistory.shift();
    }
  }

  private registerAwaitingConfirmationIfPresent(
    envelope: Pick<BridgeMessageEnvelope, 'taskId' | 'sessionId' | 'correlationId' | 'payload'>,
    response: BridgeResponseEnvelope
  ): void {
    const isAwaitingStatus =
      response.status === 'awaiting_studio_confirmation' ||
      response.status === 'awaiting_confirmation';
    const resObj =
      response.result && typeof response.result === 'object' && !Array.isArray(response.result)
        ? (response.result as Record<string, unknown>)
        : {};
    const rawPendingIds = Array.isArray(resObj.pendingDeletionPartIds)
      ? resObj.pendingDeletionPartIds.map((x) => String(x || '').trim()).filter(Boolean)
      : [];

    if (!isAwaitingStatus && rawPendingIds.length === 0) {
      return;
    }

    const payloadObj =
      envelope.payload && typeof envelope.payload === 'object'
        ? (envelope.payload as Record<string, unknown>)
        : {};
    const assetObj =
      payloadObj.asset && typeof payloadObj.asset === 'object'
        ? (payloadObj.asset as Record<string, unknown>)
        : {};

    const operationId = String(resObj.operationId || resObj.taskId || response.taskId).trim();
    const modelName = String(
      resObj.modelName ||
        payloadObj.model_name ||
        payloadObj.modelName ||
        payloadObj.name ||
        assetObj.name ||
        ''
    ).trim();
    const expectedModelHash = String(
      resObj.expectedModelHash || payloadObj.model_hash || payloadObj.modelHash || ''
    ).trim();

    const now = Date.now();
    const record: PersistedAwaitingConfirmationRecord = {
      taskId: response.taskId,
      operationId,
      sessionId: response.sessionId,
      correlationId: response.correlationId,
      modelName,
      partIdsToDelete: rawPendingIds,
      expectedModelHash,
      createdAt: now,
      expiresAt: now + this.confirmationExpirationMs,
      status: 'awaiting_confirmation',
      latestResponse: response,
    };
    this.awaitingConfirmationRegistry.set(response.taskId, record);
    this.appendResultHistory(response.taskId, operationId, modelName, response.status);
  }

  public getAwaitingConfirmationRecord(taskId: string): PersistedAwaitingConfirmationRecord | null {
    const rec = this.awaitingConfirmationRegistry.get(taskId);
    if (!rec) return null;
    if (rec.status === 'awaiting_confirmation' && Date.now() > rec.expiresAt) {
      rec.status = 'expired';
      this.persistCurrentState();
    }
    return { ...rec, partIdsToDelete: [...rec.partIdsToDelete] };
  }

  public getAllAwaitingConfirmations(): PersistedAwaitingConfirmationRecord[] {
    const now = Date.now();
    let changed = false;
    const list: PersistedAwaitingConfirmationRecord[] = [];
    for (const rec of this.awaitingConfirmationRegistry.values()) {
      if (rec.status === 'awaiting_confirmation' && now > rec.expiresAt) {
        rec.status = 'expired';
        changed = true;
      }
      if (rec.status === 'awaiting_confirmation') {
        list.push({ ...rec, partIdsToDelete: [...rec.partIdsToDelete] });
      }
    }
    if (changed) {
      this.persistCurrentState();
    }
    return list;
  }

  public getTaskResultHistory(): TaskResultHistoryEntry[] {
    return [...this.resultHistory];
  }

  public recordStudioHeartbeat(payload: Partial<StudioLiveState>): StudioLiveState {
    this.studioState = {
      connected: true,
      lastSeenAt: new Date().toISOString(),
      pluginVersion: payload.pluginVersion ?? this.studioState.pluginVersion ?? '2.3.0',
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
    awaitingConfirmationsCount: number;
  } {
    return {
      activeWorkers: this.activeWorkers,
      queuedTasksCount: this.waitQueue.length + this.inFlightTaskIds.size,
      studioPendingCount: this.studioPendingQueue.size,
      completedTasksCount: this.completedTaskCache.size,
      awaitingConfirmationsCount: this.getAllAwaitingConfirmations().length,
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
    this.persistCurrentState();
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
      this.registerAwaitingConfirmationIfPresent(envelope, response);
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
          this.registerAwaitingConfirmationIfPresent(envelope, resp);
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
   *
   * Fase 3 y Fase 4:
   * - Vincula la resolución post-confirmación estrictamente a `taskId`, `operationId`, `modelName` y `partIdsToDelete`.
   * - Rechaza respuestas tardías/expiradas (`Date.now() > record.expiresAt`).
   * - Rechaza respuestas duplicadas o intentos de confirmar después de cancelar.
   * - Rechaza respuestas cuyo `result.taskId`, `result.operationId` o `result.modelName` pertenezcan a otra tarea.
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
      // Validate that if result has taskId or operationId, it does not contradict params.taskId
      if (params.result && typeof params.result === 'object' && !Array.isArray(params.result)) {
        const resObj = params.result as Record<string, unknown>;
        if (
          typeof resObj.taskId === 'string' &&
          resObj.taskId.trim().length > 0 &&
          resObj.taskId.trim() !== params.taskId
        ) {
          return false;
        }
        if (
          typeof resObj.operationId === 'string' &&
          resObj.operationId.trim().length > 0 &&
          resObj.operationId.trim() !== params.taskId
        ) {
          return false;
        }
      }

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

    // Resolución post-confirmación o post-cancelación para tareas en espera de confirmación destructiva
    const awaitingRecord = this.awaitingConfirmationRegistry.get(params.taskId);
    const existing = this.completedTaskCache.get(params.taskId);

    if (awaitingRecord) {
      // 1. Impedir doble confirmación o confirmar tras cancelar
      if (awaitingRecord.status !== 'awaiting_confirmation') {
        return false;
      }

      // 2. Rechazar confirmaciones tardías/expiradas
      const now = Date.now();
      if (now > awaitingRecord.expiresAt) {
        awaitingRecord.status = 'expired';
        this.persistCurrentState();
        return false;
      }

      // 3. No permitir volver a poner en awaiting_confirmation una tarea ya registrada
      if (
        params.status === 'awaiting_studio_confirmation' ||
        params.status === 'awaiting_confirmation'
      ) {
        return false;
      }

      // 4. Validar recibo vinculado (taskId, operationId, modelName, partIdsToDelete)
      if (!params.result || typeof params.result !== 'object' || Array.isArray(params.result)) {
        return false;
      }
      const resObj = params.result as Record<string, unknown>;
      const resTaskId = typeof resObj.taskId === 'string' ? resObj.taskId.trim() : '';
      const resOpId = typeof resObj.operationId === 'string' ? resObj.operationId.trim() : '';
      const resModelName = typeof resObj.modelName === 'string' ? resObj.modelName.trim() : '';

      if (resTaskId !== awaitingRecord.taskId || resOpId !== awaitingRecord.operationId) {
        return false;
      }
      if (awaitingRecord.modelName && resModelName !== awaitingRecord.modelName) {
        return false;
      }

      const resPendingDel = Array.isArray(resObj.pendingDeletionPartIds)
        ? resObj.pendingDeletionPartIds.map((x) => String(x || '').trim()).filter(Boolean)
        : null;
      if (!resPendingDel || resPendingDel.length !== 0) {
        return false;
      }

      if (params.status === 'completed' && awaitingRecord.partIdsToDelete.length > 0) {
        const removedIds = Array.isArray(resObj.removedPartIds)
          ? resObj.removedPartIds.map((x) => String(x || '').trim()).filter(Boolean)
          : [];
        const removedSet = new Set(removedIds);
        for (const reqDelId of awaitingRecord.partIdsToDelete) {
          if (!removedSet.has(reqDelId)) {
            return false;
          }
        }
      } else if (params.status === 'partially_applied' && awaitingRecord.partIdsToDelete.length > 0) {
        const failedIds = Array.isArray(resObj.failedPartIds)
          ? resObj.failedPartIds.map((x) => String(x || '').trim()).filter(Boolean)
          : [];
        const failedSet = new Set(failedIds);
        for (const reqDelId of awaitingRecord.partIdsToDelete) {
          if (!failedSet.has(reqDelId)) {
            return false;
          }
        }
      }

      const baseEnvelope = existing ?? awaitingRecord.latestResponse;
      const updated = buildBridgeResponseEnvelope({
        taskId: awaitingRecord.taskId,
        sessionId: awaitingRecord.sessionId,
        correlationId: awaitingRecord.correlationId,
        status: params.status,
        result: params.result,
        error: params.error ?? null,
        executionTime: baseEnvelope.executionTime,
        sharedSecret,
      });

      awaitingRecord.status = params.status === 'completed' ? 'confirmed' : 'cancelled';
      awaitingRecord.resolvedAt = now;
      awaitingRecord.latestResponse = updated;
      this.appendResultHistory(
        awaitingRecord.taskId,
        awaitingRecord.operationId,
        awaitingRecord.modelName,
        params.status
      );
      this.rememberCompletedTask(params.taskId, updated);
      return true;
    }

    return false;
  }

  public getCompletedTaskResult(taskId: string): BridgeResponseEnvelope | null {
    const cached = this.completedTaskCache.get(taskId);
    if (cached) return cached;
    const awaiting = this.awaitingConfirmationRegistry.get(taskId);
    if (awaiting) return awaiting.latestResponse;
    return null;
  }

  public shutdown(): void {
    for (const pending of this.studioPendingQueue.values()) {
      clearTimeout(pending.timeoutHandle);
    }
    this.studioPendingQueue.clear();
    this.persistCurrentState();
  }
}

