/**
 * @module bridgeCoordinatorEngine
 * @description
 * Fase 3, 5, 6, 7 y 8 — Coordinador en Nube para el Puente Local (`Forge Local Bridge`).
 *
 * Responsabilidades en el servidor remoto (Google AI Studio / Cloud Run):
 * 1. Autenticar sesiones de puentes locales mediante HMAC-SHA256 y emitir tokens de sesión con expiración.
 * 2. Recibir heartbeats periódicos con el estado real de Rojo y Roblox Studio desde el PC Windows,
 *    sin almacenar ni exponer jamás rutas absolutas de Windows.
 * 3. Encolar tareas firmadas bajo el Contrato de Mensajes v1.0 (`protocolVersion`, `taskId`, `sessionId`,
 *    `operation`, `payload`, `timestamp`, `correlationId`, `signature`).
 * 4. Recibir confirmaciones de recepción (`task-ack`) y resultados de ejecución (`task-result`) con resolución
 *    asíncrona para que cualquier operación de Forge pueda esperar la respuesta del puente local.
 */

import crypto from 'crypto';

export const BRIDGE_PROTOCOL_VERSION = '1.0';

export interface RemoteBridgeTaskEnvelope {
  protocolVersion: string;
  taskId: string;
  sessionId: string;
  operation: string;
  payload: Record<string, any>;
  timestamp: string;
  correlationId: string;
  signature?: string;
}

export const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'forge-local-dev-token-2026',
  'reemplazar-con-secreto-aleatorio-de-32-bytes',
  'tu-secreto-compartido-de-32-bytes-aqui',
  'changeme',
  'default',
]);

export function verifyTokenConstantTime(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided), 'utf-8');
  const b = Buffer.from(String(expected), 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isPlaceholderSecretInProduction(secret: string): boolean {
  if (!secret) return false;
  return (
    process.env.NODE_ENV === 'production' &&
    KNOWN_PLACEHOLDER_SECRETS.has(secret.trim().toLowerCase())
  );
}

export interface RemoteBridgeTaskResult {
  protocolVersion: string;
  taskId: string;
  sessionId: string;
  correlationId: string;
  status:
    | 'queued'
    | 'running'
    | 'awaiting_studio_confirmation'
    | 'awaiting_confirmation'
    | 'partially_applied'
    | 'completed'
    | 'failed'
    | 'rejected_duplicate'
    | 'timeout';
  result: any;
  error: string | null;
  executionTime: number;
  timestamp: string;
  signature?: string;
}

interface PendingTaskWaiter {
  envelope: RemoteBridgeTaskEnvelope;
  status: 'queued' | 'acked' | 'completed' | 'failed' | 'timeout';
  enqueuedAt: number;
  ackedAt?: string;
  result?: RemoteBridgeTaskResult;
  resolve?: (res: RemoteBridgeTaskResult) => void;
  timeoutHandle?: NodeJS.Timeout;
}

export class CloudBridgeCoordinator {
  private sessionId: string | null = null;
  private sessionToken: string | null = null;
  private sessionExpiresAt = 0;
  private bridgeVersion = '1.0.0';
  private lastHeartbeatAt: number = 0;
  private reconnectRequested = false;

  private rojoRemoteStatus: Record<string, any> | null = null;
  private studioRemoteState: Record<string, any> | null = null;
  private queueMetrics: Record<string, any> = {
    activeWorkers: 0,
    queuedTasksCount: 0,
    studioPendingCount: 0,
    completedTasksCount: 0,
  };

  private readonly pendingQueue: Map<string, PendingTaskWaiter> = new Map();
  private readonly recentResults: RemoteBridgeTaskResult[] = [];
  private readonly recentErrors: Array<{ taskId: string; operation: string; error: string; timestamp: string }> = [];
  private readonly usedHandshakeNonces: Map<string, number> = new Map();
  private readonly maxClockSkewMs = 5 * 60 * 1000;

  private getSharedSecret(): string {
    const raw = String(
      process.env.FORGE_BRIDGE_SHARED_SECRET ||
        process.env.FORGE_SECURITY_TOKEN ||
        process.env.FORGE_LOCAL_TOKEN ||
        ''
    ).trim();
    if (isPlaceholderSecretInProduction(raw)) {
      throw new Error(
        'Seguridad: No se permite usar secretos o tokens de ejemplo por defecto en modo producción.'
      );
    }
    return raw;
  }

  public computeEnvelopeSignature(envelope: Omit<RemoteBridgeTaskEnvelope, 'signature'>): string {
    const secret = this.getSharedSecret();
    if (!secret) return '';
    const signingString = [
      envelope.protocolVersion,
      envelope.taskId,
      envelope.sessionId,
      envelope.operation,
      envelope.timestamp,
      envelope.correlationId,
      JSON.stringify(envelope.payload ?? {}),
    ].join('|');
    return crypto.createHmac('sha256', secret).update(signingString, 'utf-8').digest('hex');
  }

  public computeTaskResultSignature(result: Omit<RemoteBridgeTaskResult, 'signature'>): string {
    const secret = this.getSharedSecret();
    if (!secret) return '';
    const sigPayload = [
      result.protocolVersion,
      result.taskId,
      result.sessionId,
      result.correlationId,
      result.status,
      String(result.executionTime),
      result.timestamp,
      JSON.stringify(result.result ?? null),
      result.error || '',
    ].join('|');
    return crypto.createHmac('sha256', secret).update(sigPayload, 'utf-8').digest('hex');
  }

  private pruneExpiredNonces(nowMs: number): void {
    for (const [nonceKey, ts] of this.usedHandshakeNonces.entries()) {
      if (nowMs - ts > this.maxClockSkewMs * 2) {
        this.usedHandshakeNonces.delete(nonceKey);
      }
    }
  }

  public handleHandshake(body: Record<string, any>, providedHeaderToken?: string): {
    accepted: boolean;
    error?: string;
    sessionId?: string;
    sessionToken?: string;
    expiresAt?: number;
    wsSupported?: boolean;
  } {
    let secret = '';
    try {
      secret = this.getSharedSecret();
    } catch (err: any) {
      return { accepted: false, error: err?.message || 'Configuración de secreto inválida.' };
    }

    const bridgeVersion = String(body.bridgeVersion || '1.0.0').trim();
    const protocolVersion = String(body.protocolVersion || '1.0').trim();
    const timestamp = String(body.timestamp || '').trim();
    const nonce = String(body.nonce || '').trim();
    const signature = String(body.signature || '').trim();

    if (secret) {
      const parsedTime = Date.parse(timestamp);
      const nowMs = Date.now();
      if (!timestamp || Number.isNaN(parsedTime) || Math.abs(nowMs - parsedTime) > this.maxClockSkewMs) {
        return {
          accepted: false,
          error: 'Timestamp de handshake ausente, inválido o fuera de la ventana de tolerancia.',
        };
      }
      if (!nonce || nonce.length < 8) {
        return {
          accepted: false,
          error: 'Nonce criptográfico obligatorio ausente o inválido en handshake.',
        };
      }
      this.pruneExpiredNonces(nowMs);
      if (this.usedHandshakeNonces.has(nonce)) {
        return {
          accepted: false,
          error: 'Nonce de handshake repetido (ataque de repetición bloqueado).',
        };
      }

      const canonical = `${bridgeVersion}|${protocolVersion}|${timestamp}|${nonce}`;
      const expectedSig = crypto.createHmac('sha256', secret).update(canonical, 'utf-8').digest('hex');
      const sigMatches = verifyTokenConstantTime(signature, expectedSig);
      if (!sigMatches) {
        return { accepted: false, error: 'Firma HMAC-SHA256 inválida o ausente en handshake.' };
      }
      if (providedHeaderToken && !verifyTokenConstantTime(providedHeaderToken, secret)) {
        return { accepted: false, error: 'Cabecera X-Forge-Token inválida en handshake.' };
      }
      this.usedHandshakeNonces.set(nonce, nowMs);
    }

    this.sessionId = `sess_${crypto.randomBytes(12).toString('hex')}`;
    this.sessionToken = crypto.randomBytes(24).toString('hex');
    this.sessionExpiresAt = Date.now() + 3600 * 1000;
    this.bridgeVersion = bridgeVersion;
    this.lastHeartbeatAt = Date.now();
    this.reconnectRequested = false;

    if (body.rojoStatus && typeof body.rojoStatus === 'object') {
      this.rojoRemoteStatus = this.sanitizeRemoteRojoStatus(body.rojoStatus);
    }
    if (body.studioState && typeof body.studioState === 'object') {
      this.studioRemoteState = body.studioState;
    }

    return {
      accepted: true,
      sessionId: this.sessionId,
      sessionToken: this.sessionToken,
      expiresAt: this.sessionExpiresAt,
      wsSupported: false,
    };
  }

  private sanitizeRemoteRojoStatus(raw: Record<string, any>): Record<string, any> {
    return {
      projectName: String(raw.projectName || 'RojoProject'),
      projectConnected: Boolean(raw.projectConnected),
      defaultProjectJsonFound: Boolean(raw.defaultProjectJsonFound),
      rojoCliInstalled: Boolean(raw.rojoCliInstalled),
      rojoVersion: raw.rojoVersion ? String(raw.rojoVersion) : null,
      rojoServePort: Number(raw.rojoServePort || 34872),
      rojoServerListening: Boolean(raw.rojoServerListening),
      syncedFilesCount: Number(raw.syncedFilesCount || 0),
      lastChangeDetectedAt: raw.lastChangeDetectedAt || null,
    };
  }

  public verifySessionRequest(authHeader?: string, sessionHeader?: string, forgeTokenHeader?: string): boolean {
    if (!this.sessionId || Date.now() > this.sessionExpiresAt) {
      return false;
    }
    if (this.reconnectRequested) {
      return false;
    }
    const bearer = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (bearer && this.sessionToken && verifyTokenConstantTime(bearer, this.sessionToken)) {
      return true;
    }
    let secret = '';
    try {
      secret = this.getSharedSecret();
    } catch {
      return false;
    }
    if (
      secret &&
      forgeTokenHeader &&
      verifyTokenConstantTime(forgeTokenHeader, secret) &&
      (!sessionHeader || sessionHeader === this.sessionId)
    ) {
      return true;
    }
    return !secret && Boolean(this.sessionId);
  }

  public handleHeartbeat(body: Record<string, any>): {
    pendingTasks: RemoteBridgeTaskEnvelope[];
  } {
    this.lastHeartbeatAt = Date.now();
    if (body.bridgeVersion) {
      this.bridgeVersion = String(body.bridgeVersion);
    }
    if (body.rojoStatus && typeof body.rojoStatus === 'object') {
      this.rojoRemoteStatus = this.sanitizeRemoteRojoStatus(body.rojoStatus);
    }
    if (body.studioState && typeof body.studioState === 'object') {
      this.studioRemoteState = body.studioState;
    }
    if (body.queueMetrics && typeof body.queueMetrics === 'object') {
      this.queueMetrics = body.queueMetrics;
    }

    const tasksToDispatch: RemoteBridgeTaskEnvelope[] = [];
    for (const item of this.pendingQueue.values()) {
      if (item.status === 'queued') {
        tasksToDispatch.push({
          ...item.envelope,
          sessionId: this.sessionId || item.envelope.sessionId,
          signature: this.computeEnvelopeSignature({
            ...item.envelope,
            sessionId: this.sessionId || item.envelope.sessionId,
          }),
        });
      }
    }
    return { pendingTasks: tasksToDispatch };
  }

  public handleTaskAck(taskId: string): boolean {
    const item = this.pendingQueue.get(taskId);
    if (!item) return false;
    item.status = 'acked';
    item.ackedAt = new Date().toISOString();
    return true;
  }

  public handleTaskResult(result: RemoteBridgeTaskResult): boolean {
    if (!result || typeof result !== 'object' || !result.taskId) {
      return false;
    }
    let secret = '';
    try {
      secret = this.getSharedSecret();
    } catch {
      return false;
    }
    if (secret) {
      const expectedSig = this.computeTaskResultSignature(result);
      if (!result.signature || !verifyTokenConstantTime(String(result.signature), expectedSig)) {
        this.recentErrors.push({
          taskId: String(result.taskId || 'unknown'),
          operation: 'signature_verification',
          error: 'Firma HMAC-SHA256 inválida o ausente en task-result.',
          timestamp: new Date().toISOString(),
        });
        if (this.recentErrors.length > 30) {
          this.recentErrors.shift();
        }
        return false;
      }
    }

    const item = this.pendingQueue.get(result.taskId);
    if (item) {
      if (item.timeoutHandle) {
        clearTimeout(item.timeoutHandle);
      }
      this.pendingQueue.delete(result.taskId);
      if (item.resolve) {
        item.resolve(result);
      }
    }

    const existingIdx = this.recentResults.findIndex((r) => r.taskId === result.taskId);
    let updatedExistingAwaiting = false;
    if (existingIdx >= 0) {
      const prev = this.recentResults[existingIdx];
      if (
        prev.status === 'awaiting_studio_confirmation' ||
        prev.status === 'awaiting_confirmation'
      ) {
        this.recentResults[existingIdx] = result;
        updatedExistingAwaiting = true;
      }
    }

    if (!updatedExistingAwaiting) {
      this.recentResults.push(result);
      if (this.recentResults.length > 50) {
        this.recentResults.shift();
      }
    }

    if (result.status === 'failed' || result.status === 'timeout') {
      this.recentErrors.push({
        taskId: result.taskId,
        operation: item?.envelope.operation || 'unknown',
        error: result.error || 'Error desconocido en tarea del puente',
        timestamp: result.timestamp || new Date().toISOString(),
      });
      if (this.recentErrors.length > 30) {
        this.recentErrors.shift();
      }
    }

    return Boolean(item) || updatedExistingAwaiting;
  }

  public getTaskResult(taskId: string): RemoteBridgeTaskResult | null {
    for (let i = this.recentResults.length - 1; i >= 0; i--) {
      if (this.recentResults[i].taskId === taskId) {
        return this.recentResults[i];
      }
    }
    return null;
  }

  public isBridgeConnected(): boolean {
    if (!this.sessionId || Date.now() > this.sessionExpiresAt || this.reconnectRequested) {
      return false;
    }
    return Date.now() - this.lastHeartbeatAt < 12_000;
  }

  public requestReconnect(): void {
    this.reconnectRequested = true;
    this.sessionExpiresAt = 0;
  }

  public enqueueTask(
    operation: string,
    payload: Record<string, any> = {},
    waitForCompletion = false,
    timeoutMs = 20000
  ): Promise<RemoteBridgeTaskResult | { queued: true; taskId: string; correlationId: string }> {
    const taskId = `task_${crypto.randomUUID()}`;
    const correlationId = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const sessionId = this.sessionId || 'pending_session';
    const timestamp = new Date().toISOString();

    const baseEnvelope = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      taskId,
      sessionId,
      operation,
      payload,
      timestamp,
      correlationId,
    };

    const envelope: RemoteBridgeTaskEnvelope = {
      ...baseEnvelope,
      signature: this.computeEnvelopeSignature(baseEnvelope),
    };

    if (!waitForCompletion) {
      this.pendingQueue.set(taskId, {
        envelope,
        status: 'queued',
        enqueuedAt: Date.now(),
      });
      return Promise.resolve({ queued: true, taskId, correlationId });
    }

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingQueue.delete(taskId);
        const timeoutRes: RemoteBridgeTaskResult = {
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          taskId,
          sessionId,
          correlationId,
          status: 'timeout',
          result: null,
          error: `Timeout esperando respuesta del puente local (${timeoutMs} ms).`,
          executionTime: timeoutMs,
          timestamp: new Date().toISOString(),
        };
        resolve(timeoutRes);
      }, timeoutMs);

      this.pendingQueue.set(taskId, {
        envelope,
        status: 'queued',
        enqueuedAt: Date.now(),
        resolve,
        timeoutHandle,
      });
    });
  }

  public getPublicBridgeStatus() {
    const connected = this.isBridgeConnected();
    const pendingTasks = Array.from(this.pendingQueue.values()).map((p) => ({
      taskId: p.envelope.taskId,
      operation: p.envelope.operation,
      status: p.status,
      correlationId: p.envelope.correlationId,
      timestamp: p.envelope.timestamp,
    }));

    return {
      bridgeConnected: connected,
      bridgeVersion: this.bridgeVersion,
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      sessionActive: Boolean(this.sessionId && Date.now() < this.sessionExpiresAt),
      lastHeartbeatAt: this.lastHeartbeatAt ? new Date(this.lastHeartbeatAt).toISOString() : null,
      activeProject: this.rojoRemoteStatus?.projectName || null,
      rojo: this.rojoRemoteStatus || {
        projectName: null,
        projectConnected: false,
        defaultProjectJsonFound: false,
        rojoCliInstalled: false,
        rojoVersion: null,
        rojoServePort: 34872,
        rojoServerListening: false,
        syncedFilesCount: 0,
      },
      robloxStudio: this.studioRemoteState || {
        connected: false,
        lastSeenAt: null,
        pluginVersion: null,
        placeName: null,
        selectedModelName: null,
        selectedPartCount: 0,
        pendingDestructiveConfirmations: 0,
      },
      pendingTasksCount: pendingTasks.length,
      pendingTasks,
      recentResults: this.recentResults.slice(-10),
      recentErrors: this.recentErrors.slice(-10),
      queueMetrics: this.queueMetrics,
    };
  }
}

export const cloudBridgeCoordinator = new CloudBridgeCoordinator();
