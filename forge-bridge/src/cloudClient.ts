/**
 * @module cloudClient
 * @description
 * Fase 3 — Conexión Remota Saliente desde el Puente Local hacia el Backend de Forge (Google AI Studio / Cloud Run).
 *
 * Características:
 * - Cero puertos de entrada abiertos en Windows o en el router.
 * - Handshake autenticado con HMAC-SHA256 y obtención de `sessionId` + `sessionToken` con expiración (`expiresAt`).
 * - Renovación automática de sesión antes de la expiración.
 * - Canal persistente WebSocket (`wss://` / `ws://`) si está disponible, con fallback automático a HTTPS Heartbeat/Polling.
 * - Reconexión automática con backoff exponencial y jitter.
 * - Confirmación explícita de recepción (ACK) y entrega de resultados con reintentos controlados.
 * - Validación criptográfica HMAC de cada mensaje entrante (nunca confía únicamente en la conexión abierta).
 */

import crypto from 'crypto';
import WebSocket from 'ws';
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeMessageEnvelope,
  BridgeResponseEnvelope,
  SessionCredentials,
  SignedEnvelopeReplayGuard,
  validateBridgeMessageEnvelope,
  buildBridgeResponseEnvelope,
} from './protocol.js';
import { LocalRojoManager } from './rojoHandler.js';
import { TaskExecutionCoordinator } from './studioQueue.js';

export interface CloudConnectionStatus {
  connected: boolean;
  transport: 'websocket' | 'https_polling' | 'disconnected';
  cloudUrl: string;
  sessionId: string | null;
  sessionExpiresAt: string | null;
  lastHeartbeatAt: string | null;
  reconnectAttempts: number;
  lastError: string | null;
}

export class ForgeCloudOutboundClient {
  private readonly cloudUrl: string;
  private readonly sharedSecret: string;
  private readonly bridgeVersion: string;
  private readonly heartbeatIntervalMs: number;
  private readonly maxRetries: number;
  private readonly rojoManager: LocalRojoManager;
  private readonly coordinator: TaskExecutionCoordinator;
  private readonly onLog: (level: 'info' | 'warn' | 'error', msg: string) => void;

  private session: SessionCredentials | null = null;
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private running = false;
  private reconnectAttempts = 0;
  private transport: 'websocket' | 'https_polling' | 'disconnected' = 'disconnected';
  private lastHeartbeatAt: string | null = null;
  private lastError: string | null = null;
  private readonly replayGuard = new SignedEnvelopeReplayGuard();

  private isSessionExpiringSoon(): boolean {
    if (!this.session) return true;
    const ttl = Math.max(0, this.session.expiresAt - this.session.issuedAt);
    const renewLeadMs = Math.min(60_000, Math.floor(ttl * 0.25));
    return Date.now() >= this.session.expiresAt - renewLeadMs;
  }

  constructor(options: {
    cloudUrl: string;
    sharedSecret: string;
    bridgeVersion?: string;
    heartbeatIntervalMs?: number;
    maxRetries?: number;
    rojoManager: LocalRojoManager;
    coordinator: TaskExecutionCoordinator;
    onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  }) {
    this.cloudUrl = options.cloudUrl.replace(/\/+$/, '');
    this.sharedSecret = options.sharedSecret;
    this.bridgeVersion = options.bridgeVersion || '2.3.0';
    this.heartbeatIntervalMs = Math.max(1000, options.heartbeatIntervalMs ?? 2500);
    this.maxRetries = Math.max(1, options.maxRetries ?? 3);
    this.rojoManager = options.rojoManager;
    this.coordinator = options.coordinator;
    this.onLog = options.onLog || ((lvl, m) => console.log(`[ForgeBridge:${lvl.toUpperCase()}] ${m}`));
  }

  public getStatus(): CloudConnectionStatus {
    return {
      connected: this.transport !== 'disconnected' && this.session !== null,
      transport: this.transport,
      cloudUrl: this.cloudUrl,
      sessionId: this.session?.sessionId || null,
      sessionExpiresAt: this.session ? new Date(this.session.expiresAt).toISOString() : null,
      lastHeartbeatAt: this.lastHeartbeatAt,
      reconnectAttempts: this.reconnectAttempts,
      lastError: this.lastError,
    };
  }

  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.connectAndAuthenticate();
  }

  public async forceReconnect(): Promise<CloudConnectionStatus> {
    this.cleanupTimersAndSocket();
    this.session = null;
    this.reconnectAttempts = 0;
    if (this.running) {
      await this.connectAndAuthenticate();
    }
    return this.getStatus();
  }

  public stop(): void {
    this.running = false;
    this.cleanupTimersAndSocket();
    this.session = null;
    this.transport = 'disconnected';
  }

  private cleanupTimersAndSocket(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    this.transport = 'disconnected';
    this.reconnectAttempts += 1;
    const baseDelay = Math.min(30000, 1000 * Math.pow(1.8, Math.min(8, this.reconnectAttempts)));
    const jitter = Math.floor(Math.random() * 400);
    const delay = baseDelay + jitter;

    this.onLog('warn', `Reintentando conexión con Forge Cloud en ${delay} ms (intento #${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.running) {
        await this.connectAndAuthenticate();
      }
    }, delay);
  }

  /**
   * Realiza el handshake inicial firmado con HMAC-SHA256 para obtener credenciales de sesión con expiración.
   */
  public async connectAndAuthenticate(): Promise<boolean> {
    try {
      if (!this.sharedSecret || !this.sharedSecret.trim()) {
        throw new Error('Seguridad: sharedSecret ausente para autenticar handshake con Forge Cloud.');
      }
      const timestamp = new Date().toISOString();
      const nonce = crypto.randomUUID();
      const rojoStatus = await this.rojoManager.getStatus();
      const studioState = this.coordinator.getStudioState();

      const canonicalAuth = `${this.bridgeVersion}|${BRIDGE_PROTOCOL_VERSION}|${timestamp}|${nonce}`;
      const signature = crypto
        .createHmac('sha256', this.sharedSecret)
        .update(canonicalAuth, 'utf-8')
        .digest('hex');

      const res = await fetch(`${this.cloudUrl}/api/v1/bridge/auth/handshake`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forge-Token': this.sharedSecret,
        },
        body: JSON.stringify({
          bridgeVersion: this.bridgeVersion,
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          timestamp,
          nonce,
          signature,
          rojoStatus,
          studioState,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Handshake rechazado (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as {
        sessionId: string;
        sessionToken: string;
        expiresAt: number;
        wsSupported?: boolean;
      };

      this.session = {
        sessionId: data.sessionId,
        sessionToken: data.sessionToken,
        issuedAt: Date.now(),
        expiresAt: data.expiresAt || Date.now() + 3600 * 1000,
      };
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.transport = 'https_polling';
      this.lastHeartbeatAt = new Date().toISOString();

      this.onLog(
        'info',
        `Sesión autenticada con Forge Cloud (${this.session.sessionId}, proyecto Rojo: '${rojoStatus.projectName}')`
      );

      // Si el servidor soporta WebSocket, abrir canal persistente; mantener heartbeat HTTPS periódico
      if (data.wsSupported) {
        this.openOptionalWebSocket();
      }
      this.startHeartbeatLoop();
      return true;
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      this.onLog('error', `Error autenticando con Forge Cloud: ${this.lastError}`);
      this.scheduleReconnect();
      return false;
    }
  }

  private openOptionalWebSocket(): void {
    if (!this.session) return;
    try {
      const wsUrl =
        this.cloudUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:') +
        `/api/v1/bridge/ws?sessionId=${encodeURIComponent(this.session.sessionId)}`;

      const socket = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${this.session.sessionToken}`,
          ...(this.sharedSecret ? { 'X-Forge-Token': this.sharedSecret } : {}),
        },
      });

      socket.on('open', () => {
        this.transport = 'websocket';
        this.onLog('info', 'Canal WebSocket persistente establecido con Forge Cloud.');
      });

      socket.on('message', async (rawData) => {
        try {
          const parsed = JSON.parse(rawData.toString());
          if (parsed && parsed.type === 'bridge_task' && parsed.envelope) {
            await this.handleIncomingTaskEnvelope(parsed.envelope);
          }
        } catch (err: any) {
          this.onLog('warn', `Mensaje WS inválido ignorado: ${err.message}`);
        }
      });

      socket.on('close', () => {
        if (this.transport === 'websocket') {
          this.transport = this.session ? 'https_polling' : 'disconnected';
        }
      });

      socket.on('error', () => {
        // Fallback silencioso a HTTPS polling
        if (this.transport === 'websocket') {
          this.transport = this.session ? 'https_polling' : 'disconnected';
        }
      });

      this.ws = socket;
    } catch {
      this.transport = 'https_polling';
    }
  }

  private startHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.heartbeatTimer = setInterval(async () => {
      await this.sendHeartbeatAndPollTasks();
    }, this.heartbeatIntervalMs);
  }

  public async sendHeartbeatAndPollTasks(): Promise<void> {
    if (!this.running) return;

    // Verificar expiración de credenciales de sesión
    if (!this.session || this.isSessionExpiringSoon()) {
      this.onLog('info', 'Credenciales de sesión próximas a expirar; renovando handshake...');
      await this.connectAndAuthenticate();
      return;
    }

    try {
      const [rojoStatus, changes] = await Promise.all([
        this.rojoManager.getStatus(),
        Promise.resolve(this.rojoManager.detectChanges(false)),
      ]);
      const studioState = this.coordinator.getStudioState();
      const queueMetrics = this.coordinator.getQueueMetrics();

      const res = await fetch(`${this.cloudUrl}/api/v1/bridge/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.session.sessionToken}`,
          'X-Bridge-Session': this.session.sessionId,
          ...(this.sharedSecret ? { 'X-Forge-Token': this.sharedSecret } : {}),
        },
        body: JSON.stringify({
          sessionId: this.session.sessionId,
          bridgeVersion: this.bridgeVersion,
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          timestamp: new Date().toISOString(),
          rojoStatus,
          rojoChangesSummary: {
            changed: changes.changed,
            addedCount: changes.added.length,
            modifiedCount: changes.modified.length,
            deletedCount: changes.deleted.length,
          },
          studioState,
          queueMetrics,
        }),
      });

      if (res.status === 401 || res.status === 403) {
        this.session = null;
        await this.connectAndAuthenticate();
        return;
      }

      if (!res.ok) {
        throw new Error(`Heartbeat HTTP ${res.status}`);
      }

      this.lastHeartbeatAt = new Date().toISOString();
      this.lastError = null;
      if (this.transport === 'disconnected') {
        this.transport = 'https_polling';
      }

      const data = (await res.json()) as {
        pendingTasks?: unknown[];
      };

      if (Array.isArray(data.pendingTasks) && data.pendingTasks.length > 0) {
        for (const rawTask of data.pendingTasks) {
          void this.handleIncomingTaskEnvelope(rawTask);
        }
      }
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      this.scheduleReconnect();
    }
  }

  /**
   * Procesa un mensaje entrante desde la nube:
   * 1. Valida esquema y firma HMAC-SHA256.
   * 2. Envía confirmación de recepción (ACK) a la nube.
   * 3. Ejecuta la operación autorizada con protección contra duplicados y timeout.
   * 4. Envía el resultado con reintentos controlados.
   */
  public async handleIncomingTaskEnvelope(rawEnvelope: unknown): Promise<BridgeResponseEnvelope> {
    const validation = validateBridgeMessageEnvelope(rawEnvelope, {
      expectedSessionId: this.session?.sessionId,
      sharedSecret: this.sharedSecret,
      replayGuard: this.replayGuard,
    });

    if (!validation.valid || !validation.envelope) {
      const rawObj = (rawEnvelope && typeof rawEnvelope === 'object' ? rawEnvelope : {}) as Record<string, unknown>;
      const rejected = buildBridgeResponseEnvelope({
        taskId: String(rawObj.taskId || 'invalid-task'),
        sessionId: String(rawObj.sessionId || this.session?.sessionId || 'unknown'),
        correlationId: String(rawObj.correlationId || 'invalid-corr'),
        status: 'failed',
        result: null,
        error: validation.error || 'Contrato de mensaje inválido.',
        executionTime: 0,
        sharedSecret: this.sharedSecret,
      });
      await this.reportTaskResultWithRetry(rejected);
      return rejected;
    }

    const envelope = validation.envelope;

    // Confirmación inmediata de recepción (ACK)
    void this.sendTaskAck(envelope.taskId, envelope.correlationId);

    const response = await this.coordinator.executeDeduplicated(
      envelope,
      async (env) => this.dispatchAllowedOperation(env),
      this.sharedSecret
    );

    await this.reportTaskResultWithRetry(response);
    return response;
  }

  public async dispatchAllowedOperation(envelope: BridgeMessageEnvelope): Promise<unknown> {
    const op = envelope.operation;
    const p = envelope.payload || {};

    switch (op) {
      case 'rojo.status':
        return await this.rojoManager.getStatus();

      case 'rojo.get_project_config':
        return this.rojoManager.getProjectConfig();

      case 'rojo.read_file':
        return this.rojoManager.readFile(String(p.relativePath || p.path || ''));

      case 'rojo.write_file':
        return this.rojoManager.writeFile({
          relativePath: String(p.relativePath || p.path || ''),
          content: String(p.content ?? ''),
          encoding: p.encoding === 'base64' ? 'base64' : 'utf-8',
        });

      case 'rojo.write_package':
        return this.rojoManager.writePackage(
          Array.isArray(p.files) ? (p.files as Array<{ relativePath: string; content: string; encoding?: 'utf-8' | 'base64' }>) : []
        );

      case 'rojo.detect_changes':
        return this.rojoManager.detectChanges(Boolean(p.updateBaseline));

      case 'rojo.request_sync': {
        const changes = this.rojoManager.detectChanges(true);
        const status = await this.rojoManager.getStatus();
        return {
          synced: true,
          rojoStatus: status,
          changes,
        };
      }

      case 'rojo.check_build':
        return await this.rojoManager.checkBuild();

      // Operaciones delegadas al Plugin de Roblox Studio (Fase 6)
      case 'studio.ping':
      case 'studio.get_selection':
      case 'studio.read_datamodel':
      case 'studio.serialize_parts':
      case 'studio.apply_modifications':
      case 'studio.reconstruct_model':
      case 'studio.compare_geometry':
      case 'studio.detect_errors': {
        if (op === 'studio.ping') {
          const st = this.coordinator.getStudioState();
          if (st.connected) {
            return st;
          }
        }
        const studioResp = await this.coordinator.enqueueForStudioPlugin(
          envelope,
          this.sharedSecret
        );
        if (studioResp.status === 'failed' || studioResp.status === 'timeout') {
          if (
            studioResp.status === 'failed' &&
            studioResp.result &&
            typeof studioResp.result === 'object'
          ) {
            return {
              ...(studioResp.result as Record<string, unknown>),
              status: 'failed',
            };
          }
          throw new Error(studioResp.error || `Error en operación ${op}`);
        }
        if (
          (studioResp.status === 'awaiting_studio_confirmation' ||
            studioResp.status === 'awaiting_confirmation' ||
            studioResp.status === 'partially_applied') &&
          studioResp.result &&
          typeof studioResp.result === 'object'
        ) {
          const resObj = studioResp.result as Record<string, unknown>;
          return {
            ...resObj,
            status:
              typeof resObj.status === 'string' &&
              (resObj.status === 'awaiting_confirmation' ||
                resObj.status === 'awaiting_studio_confirmation' ||
                resObj.status === 'partially_applied')
                ? resObj.status
                : studioResp.status,
          };
        }
        return studioResp.result;
      }

      default:
        throw new Error(`Operación no soportada: ${String(op)}`);
    }
  }

  private async sendTaskAck(taskId: string, correlationId: string): Promise<void> {
    if (!this.session) return;
    try {
      await fetch(`${this.cloudUrl}/api/v1/bridge/task-ack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.session.sessionToken}`,
          'X-Bridge-Session': this.session.sessionId,
          ...(this.sharedSecret ? { 'X-Forge-Token': this.sharedSecret } : {}),
        },
        body: JSON.stringify({
          taskId,
          sessionId: this.session.sessionId,
          correlationId,
          receivedAt: new Date().toISOString(),
        }),
      });
    } catch {
      // ACK es informativo; la entrega final tiene reintentos garantizados
    }
  }

  public async reportFollowUpTaskResult(response: BridgeResponseEnvelope): Promise<void> {
    await this.reportTaskResultWithRetry(response);
  }

  private async reportTaskResultWithRetry(response: BridgeResponseEnvelope): Promise<void> {
    if (!this.session) return;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(`${this.cloudUrl}/api/v1/bridge/task-result`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.session.sessionToken}`,
            'X-Bridge-Session': this.session.sessionId,
            ...(this.sharedSecret ? { 'X-Forge-Token': this.sharedSecret } : {}),
          },
          body: JSON.stringify(response),
        });
        if (res.ok) {
          return;
        }
      } catch {
        // Reintentar con backoff
      }
      if (attempt < this.maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 600));
      }
    }
  }

  /**
   * Reenvía una petición originada en el Plugin de Roblox Studio (`127.0.0.1:48720`)
   * hacia el backend de Forge en la nube (`FORGE_CLOUD_URL`) usando la sesión autenticada del puente.
   */
  public async forwardToCloudApi(
    apiPath: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>
  ): Promise<{ ok: boolean; status: number; data: any }> {
    if (!this.session || this.isSessionExpiringSoon()) {
      await this.connectAndAuthenticate();
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.session) {
      headers.Authorization = `Bearer ${this.session.sessionToken}`;
      headers['X-Bridge-Session'] = this.session.sessionId;
    }
    if (this.sharedSecret) {
      headers['X-Forge-Token'] = this.sharedSecret;
    }

    const res = await fetch(`${this.cloudUrl}${apiPath}`, {
      method,
      headers,
      body: method === 'POST' && body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    return {
      ok: res.ok,
      status: res.status,
      data: parsed,
    };
  }
}
