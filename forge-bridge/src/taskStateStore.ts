/**
 * @module taskStateStore
 * @description
 * Adaptadores de almacenamiento persistente, validación de integridad de registros y
 * recuperación ante fallos para la cola de tareas del Local Bridge (`TaskExecutionCoordinator`).
 *
 * Implementa:
 * - Escritura atómica a disco (`.tmp` + `rename` + `fsync`) para evitar corrupción en cortes o cierres abruptos.
 * - Validación exhaustiva de esquemas JSON con rechazo de registros incompletos o manipulados.
 * - Diagnósticos en tiempo real de operaciones de persistencia (`saveCount`, `loadErrorCount`, etc.).
 * - Adaptador en memoria para entornos de prueba deterministas.
 */

import fs from 'fs';
import path from 'path';
import {
  BridgeResponseEnvelope,
  BridgeTaskStatus,
} from './protocol.js';

export interface PersistedAwaitingConfirmationRecord {
  taskId: string;
  operationId: string;
  sessionId: string;
  correlationId: string;
  modelName: string;
  partIdsToDelete: string[];
  expectedModelHash: string;
  createdAt: number;
  expiresAt: number;
  status: 'awaiting_confirmation' | 'confirmed' | 'cancelled' | 'expired';
  resolvedAt?: number;
  latestResponse: BridgeResponseEnvelope;
}

export interface TaskResultHistoryEntry {
  taskId: string;
  operationId: string;
  modelName: string;
  status: BridgeTaskStatus;
  timestamp: number;
}

export interface TaskStateStoreSnapshot {
  completedTasks: Record<string, BridgeResponseEnvelope>;
  awaitingConfirmations: Record<string, PersistedAwaitingConfirmationRecord>;
  resultHistory: TaskResultHistoryEntry[];
}

export interface PersistenceDiagnostics {
  filePath: string | null;
  saveCount: number;
  saveErrorCount: number;
  lastSaveError: string | null;
  loadErrorCount: number;
  lastLoadError: string | null;
  corruptedFileDetected: boolean;
  invalidRecordsRejected: number;
  recoveredCompletedTasksCount: number;
  recoveredAwaitingConfirmationsCount: number;
}

export interface TaskStateStoreAdapter {
  loadState(): TaskStateStoreSnapshot;
  saveState(snapshot: TaskStateStoreSnapshot): void;
  getDiagnostics?(): Partial<PersistenceDiagnostics>;
}

export const VALID_TASK_STATUSES: ReadonlySet<BridgeTaskStatus> = new Set<BridgeTaskStatus>([
  'queued',
  'running',
  'awaiting_studio_confirmation',
  'awaiting_confirmation',
  'partially_applied',
  'completed',
  'failed',
  'timeout',
  'rejected_duplicate',
]);

export function isValidBridgeResponseEnvelopeRecord(
  expectedTaskId: string,
  value: unknown
): value is BridgeResponseEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.protocolVersion !== 'string' || obj.protocolVersion.trim().length === 0) {
    return false;
  }
  if (typeof obj.taskId !== 'string' || obj.taskId.trim() !== expectedTaskId) {
    return false;
  }
  if (typeof obj.sessionId !== 'string' || obj.sessionId.trim().length === 0) {
    return false;
  }
  if (typeof obj.correlationId !== 'string' || obj.correlationId.trim().length === 0) {
    return false;
  }
  if (typeof obj.status !== 'string' || !VALID_TASK_STATUSES.has(obj.status as BridgeTaskStatus)) {
    return false;
  }
  if (
    typeof obj.executionTime !== 'number' ||
    !Number.isFinite(obj.executionTime) ||
    obj.executionTime < 0
  ) {
    return false;
  }
  if (obj.signature !== undefined && typeof obj.signature !== 'string') {
    return false;
  }
  if (!('result' in obj) || !('error' in obj)) {
    return false;
  }
  return true;
}

export function isValidPersistedAwaitingConfirmationRecord(
  expectedTaskId: string,
  value: unknown
): value is PersistedAwaitingConfirmationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.taskId !== 'string' || obj.taskId.trim() !== expectedTaskId) {
    return false;
  }
  if (typeof obj.operationId !== 'string' || obj.operationId.trim() !== expectedTaskId) {
    return false;
  }
  if (typeof obj.sessionId !== 'string' || obj.sessionId.trim().length === 0) {
    return false;
  }
  if (typeof obj.correlationId !== 'string' || obj.correlationId.trim().length === 0) {
    return false;
  }
  if (typeof obj.modelName !== 'string' || obj.modelName.trim().length === 0) {
    return false;
  }
  if (
    !Array.isArray(obj.partIdsToDelete) ||
    obj.partIdsToDelete.length === 0 ||
    !obj.partIdsToDelete.every((id) => typeof id === 'string' && id.trim().length > 0)
  ) {
    return false;
  }
  if (typeof obj.expectedModelHash !== 'string') {
    return false;
  }
  if (typeof obj.createdAt !== 'number' || !Number.isFinite(obj.createdAt) || obj.createdAt <= 0) {
    return false;
  }
  if (
    typeof obj.expiresAt !== 'number' ||
    !Number.isFinite(obj.expiresAt) ||
    obj.expiresAt < obj.createdAt
  ) {
    return false;
  }
  if (
    obj.status !== 'awaiting_confirmation' &&
    obj.status !== 'confirmed' &&
    obj.status !== 'cancelled' &&
    obj.status !== 'expired'
  ) {
    return false;
  }
  if (!isValidBridgeResponseEnvelopeRecord(expectedTaskId, obj.latestResponse)) {
    return false;
  }
  return true;
}

export function isValidTaskResultHistoryEntry(value: unknown): value is TaskResultHistoryEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.taskId === 'string' &&
    obj.taskId.trim().length > 0 &&
    typeof obj.operationId === 'string' &&
    obj.operationId.trim().length > 0 &&
    typeof obj.modelName === 'string' &&
    typeof obj.status === 'string' &&
    VALID_TASK_STATUSES.has(obj.status as BridgeTaskStatus) &&
    typeof obj.timestamp === 'number' &&
    Number.isFinite(obj.timestamp) &&
    obj.timestamp > 0
  );
}

/**
 * Adaptador de almacenamiento en memoria compartible entre instancias de `TaskExecutionCoordinator`
 * para pruebas deterministas de reinicio y recuperación sin efectos secundarios en disco.
 */
export class InMemoryTaskStateStoreAdapter implements TaskStateStoreAdapter {
  private snapshot: TaskStateStoreSnapshot = {
    completedTasks: {},
    awaitingConfirmations: {},
    resultHistory: [],
  };

  public loadState(): TaskStateStoreSnapshot {
    return JSON.parse(JSON.stringify(this.snapshot));
  }

  public saveState(snapshot: TaskStateStoreSnapshot): void {
    this.snapshot = JSON.parse(JSON.stringify(snapshot));
  }
}

export interface JsonFileTaskStateStoreOptions {
  beforeRenameHook?: (tmpFilePath: string) => void;
}

/**
 * Adaptador de almacenamiento persistente en archivo JSON local con escritura atómica (`tmp` + `rename`)
 * y validación estricta de esquema al recuperar estado tras un reinicio del proceso Local Bridge.
 */
export class JsonFileTaskStateStoreAdapter implements TaskStateStoreAdapter {
  private readonly filePath: string;
  private beforeRenameHook?: (tmpFilePath: string) => void;
  private readonly diagnostics: PersistenceDiagnostics;

  constructor(filePath: string, options?: JsonFileTaskStateStoreOptions) {
    this.filePath = path.resolve(filePath);
    this.beforeRenameHook = options?.beforeRenameHook;
    this.diagnostics = {
      filePath: this.filePath,
      saveCount: 0,
      saveErrorCount: 0,
      lastSaveError: null,
      loadErrorCount: 0,
      lastLoadError: null,
      corruptedFileDetected: false,
      invalidRecordsRejected: 0,
      recoveredCompletedTasksCount: 0,
      recoveredAwaitingConfirmationsCount: 0,
    };
  }

  public setBeforeRenameHook(hook?: (tmpFilePath: string) => void): void {
    this.beforeRenameHook = hook;
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public getDiagnostics(): PersistenceDiagnostics {
    return { ...this.diagnostics };
  }

  public loadState(): TaskStateStoreSnapshot {
    this.diagnostics.corruptedFileDetected = false;
    this.diagnostics.lastLoadError = null;
    this.diagnostics.invalidRecordsRejected = 0;

    if (!fs.existsSync(this.filePath)) {
      return { completedTasks: {}, awaitingConfirmations: {}, resultHistory: [] };
    }

    let parsed: unknown;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      if (raw.trim().length === 0) {
        throw new Error('El archivo de estado persistente está vacío.');
      }
      parsed = JSON.parse(raw);
    } catch (err: any) {
      const errMsg = String(err?.message || err || 'JSON corrupto o ilegible');
      this.diagnostics.corruptedFileDetected = true;
      this.diagnostics.loadErrorCount += 1;
      this.diagnostics.lastLoadError = errMsg;
      console.error(
        `[ForgeBridge:Persistence] Archivo de estado corrupto en '${this.filePath}': ${errMsg}`
      );
      return { completedTasks: {}, awaitingConfirmations: {}, resultHistory: [] };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const errMsg = 'La raíz del JSON persistido no es un objeto válido.';
      this.diagnostics.corruptedFileDetected = true;
      this.diagnostics.loadErrorCount += 1;
      this.diagnostics.lastLoadError = errMsg;
      console.error(`[ForgeBridge:Persistence] ${errMsg} ('${this.filePath}')`);
      return { completedTasks: {}, awaitingConfirmations: {}, resultHistory: [] };
    }

    const root = parsed as Record<string, unknown>;
    if (
      (root.completedTasks !== undefined &&
        (!root.completedTasks ||
          typeof root.completedTasks !== 'object' ||
          Array.isArray(root.completedTasks))) ||
      (root.awaitingConfirmations !== undefined &&
        (!root.awaitingConfirmations ||
          typeof root.awaitingConfirmations !== 'object' ||
          Array.isArray(root.awaitingConfirmations))) ||
      (root.resultHistory !== undefined && !Array.isArray(root.resultHistory))
    ) {
      const errMsg =
        'Estructura de secciones inválida en el archivo de estado (completedTasks/awaitingConfirmations/resultHistory).';
      this.diagnostics.corruptedFileDetected = true;
      this.diagnostics.loadErrorCount += 1;
      this.diagnostics.lastLoadError = errMsg;
      console.error(`[ForgeBridge:Persistence] ${errMsg} ('${this.filePath}')`);
      return { completedTasks: {}, awaitingConfirmations: {}, resultHistory: [] };
    }

    const validAwaitingConfirmations: Record<string, PersistedAwaitingConfirmationRecord> = {};
    const rawAwaiting = (root.awaitingConfirmations as Record<string, unknown>) || {};
    for (const [taskId, rawRec] of Object.entries(rawAwaiting)) {
      const trimmedKey = taskId.trim();
      if (
        trimmedKey.length > 0 &&
        isValidPersistedAwaitingConfirmationRecord(trimmedKey, rawRec)
      ) {
        validAwaitingConfirmations[trimmedKey] = rawRec;
      } else {
        this.diagnostics.invalidRecordsRejected += 1;
      }
    }

    const validCompletedTasks: Record<string, BridgeResponseEnvelope> = {};
    const rawCompleted = (root.completedTasks as Record<string, unknown>) || {};
    for (const [taskId, rawResp] of Object.entries(rawCompleted)) {
      const trimmedKey = taskId.trim();
      if (trimmedKey.length === 0 || !isValidBridgeResponseEnvelopeRecord(trimmedKey, rawResp)) {
        this.diagnostics.invalidRecordsRejected += 1;
        continue;
      }
      // Si una respuesta indica que estaba esperando confirmación, debe existir su registro íntegro en awaitingConfirmations
      if (
        (rawResp.status === 'awaiting_studio_confirmation' ||
          rawResp.status === 'awaiting_confirmation') &&
        !validAwaitingConfirmations[trimmedKey]
      ) {
        this.diagnostics.invalidRecordsRejected += 1;
        continue;
      }
      validCompletedTasks[trimmedKey] = rawResp;
    }

    const validHistory: TaskResultHistoryEntry[] = [];
    const rawHistory = Array.isArray(root.resultHistory) ? root.resultHistory : [];
    for (const entry of rawHistory) {
      if (isValidTaskResultHistoryEntry(entry)) {
        validHistory.push(entry);
      } else {
        this.diagnostics.invalidRecordsRejected += 1;
      }
    }

    return {
      completedTasks: validCompletedTasks,
      awaitingConfirmations: validAwaitingConfirmations,
      resultHistory: validHistory,
    };
  }

  public saveState(snapshot: TaskStateStoreSnapshot): void {
    const dir = path.dirname(this.filePath);
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}.tmp`;
    let fd: number | null = null;
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const serialized = JSON.stringify(snapshot, null, 2);
      fd = fs.openSync(tmpPath, 'w', 0o600);
      fs.writeFileSync(fd, serialized, 'utf-8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = null;

      if (this.beforeRenameHook) {
        this.beforeRenameHook(tmpPath);
      }

      fs.renameSync(tmpPath, this.filePath);
      this.diagnostics.saveCount += 1;
      this.diagnostics.lastSaveError = null;
    } catch (err: any) {
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // ignore close error on recovery path
        }
      }
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // ignore temp unlink error on recovery path
      }
      const errMsg = String(err?.message || err || 'Error desconocido al guardar estado');
      this.diagnostics.saveErrorCount += 1;
      this.diagnostics.lastSaveError = errMsg;
      console.error(
        `[ForgeBridge:Persistence] Error de escritura atómica en '${this.filePath}': ${errMsg}`
      );
      throw new Error(`Fallo al persistir estado de Bridge en '${this.filePath}': ${errMsg}`);
    }
  }
}
