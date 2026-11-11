/**
 * @module protocol
 * @description
 * Fase 7 — Contrato de Mensajes Versionado, Autenticación de Sesiones y Validación de Esquemas.
 *
 * Implementa:
 * - Esquema de mensajes v1.0 (`protocolVersion`, `taskId`, `sessionId`, `operation`, `payload`, `timestamp`, `correlationId`).
 * - Esquema de respuestas (`taskId`, `status`, `result`, `error`, `executionTime`).
 * - Lista explícita de operaciones permitidas (`ALLOWED_BRIDGE_OPERATIONS`).
 * - Firma y verificación criptográfica HMAC-SHA256 para evitar suplantación en conexiones abiertas.
 */

import crypto from 'crypto';

export const BRIDGE_PROTOCOL_VERSION = '1.0';
export const SUPPORTED_PROTOCOL_VERSIONS = new Set(['1.0', '1.1']);

export const ALLOWED_BRIDGE_OPERATIONS = [
  // Operaciones Rojo (Fase 5)
  'rojo.status',
  'rojo.get_project_config',
  'rojo.read_file',
  'rojo.write_file',
  'rojo.write_package',
  'rojo.detect_changes',
  'rojo.request_sync',
  'rojo.check_build',
  // Operaciones Roblox Studio (Fase 6)
  'studio.ping',
  'studio.get_selection',
  'studio.read_datamodel',
  'studio.serialize_parts',
  'studio.apply_modifications',
  'studio.reconstruct_model',
  'studio.compare_geometry',
  'studio.detect_errors',
] as const;

export type BridgeOperation = (typeof ALLOWED_BRIDGE_OPERATIONS)[number];

const ALLOWED_OPERATIONS_SET = new Set<string>(ALLOWED_BRIDGE_OPERATIONS);

export type BridgeTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_studio_confirmation'
  | 'completed'
  | 'failed'
  | 'rejected_duplicate'
  | 'timeout';

export interface BridgeMessageEnvelope<TPayload = Record<string, unknown>> {
  protocolVersion: string;
  taskId: string;
  sessionId: string;
  operation: BridgeOperation;
  payload: TPayload;
  timestamp: string;
  correlationId: string;
  signature?: string;
}

export interface BridgeResponseEnvelope<TResult = unknown> {
  protocolVersion: string;
  taskId: string;
  sessionId: string;
  correlationId: string;
  status: BridgeTaskStatus;
  result: TResult | null;
  error: string | null;
  executionTime: number;
  timestamp: string;
  signature?: string;
}

export interface SessionCredentials {
  sessionId: string;
  sessionToken: string;
  issuedAt: number;
  expiresAt: number;
}

export function isAllowedBridgeOperation(op: unknown): op is BridgeOperation {
  return typeof op === 'string' && ALLOWED_OPERATIONS_SET.has(op);
}

export function isCompatibleProtocolVersion(version: unknown): boolean {
  if (typeof version !== 'string') return false;
  return SUPPORTED_PROTOCOL_VERSIONS.has(version.trim());
}

/**
 * Calcula una firma HMAC-SHA256 canónica sobre los campos críticos del mensaje
 * para garantizar autenticidad e integridad en cada tarea, sin confiar únicamente en la sesión abierta.
 */
export function computeEnvelopeHmac(
  envelope: Pick<
    BridgeMessageEnvelope,
    'protocolVersion' | 'taskId' | 'sessionId' | 'operation' | 'timestamp' | 'correlationId' | 'payload'
  >,
  sharedSecret: string
): string {
  const canonicalPayload = JSON.stringify(envelope.payload ?? {});
  const signingString = [
    envelope.protocolVersion,
    envelope.taskId,
    envelope.sessionId,
    envelope.operation,
    envelope.timestamp,
    envelope.correlationId,
    canonicalPayload,
  ].join('|');

  return crypto.createHmac('sha256', sharedSecret).update(signingString, 'utf-8').digest('hex');
}

export function verifyEnvelopeHmac(
  envelope: BridgeMessageEnvelope,
  sharedSecret: string
): boolean {
  if (!sharedSecret) return true;
  if (!envelope.signature || typeof envelope.signature !== 'string') {
    return false;
  }
  const expected = computeEnvelopeHmac(envelope, sharedSecret);
  const a = Buffer.from(envelope.signature, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface EnvelopeValidationResult {
  valid: boolean;
  error?: string;
  envelope?: BridgeMessageEnvelope;
}

/**
 * Valida estrictamente el contrato de mensajes (Fase 7).
 */
export function validateBridgeMessageEnvelope(
  raw: unknown,
  options?: {
    expectedSessionId?: string;
    sharedSecret?: string;
    maxClockSkewMs?: number;
  }
): EnvelopeValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'El mensaje debe ser un objeto JSON válido.' };
  }

  const candidate = raw as Record<string, unknown>;
  const protocolVersion = String(candidate.protocolVersion ?? '').trim();
  if (!isCompatibleProtocolVersion(protocolVersion)) {
    return {
      valid: false,
      error: `Versión de protocolo incompatible: '${protocolVersion}'. Se esperaba '${BRIDGE_PROTOCOL_VERSION}'.`,
    };
  }

  const taskId = String(candidate.taskId ?? '').trim();
  if (!taskId || taskId.length < 4 || taskId.length > 128) {
    return { valid: false, error: 'Campo obligatorio taskId ausente o inválido.' };
  }

  const sessionId = String(candidate.sessionId ?? '').trim();
  if (!sessionId || sessionId.length < 4) {
    return { valid: false, error: 'Campo obligatorio sessionId ausente o inválido.' };
  }

  if (options?.expectedSessionId && sessionId !== options.expectedSessionId) {
    return {
      valid: false,
      error: `sessionId no coincide con la sesión activa autenticada.`,
    };
  }

  const operation = candidate.operation;
  if (!isAllowedBridgeOperation(operation)) {
    return {
      valid: false,
      error: `Operación '${String(operation)}' no permitida en la lista blanca del puente.`,
    };
  }

  const correlationId = String(candidate.correlationId ?? '').trim();
  if (!correlationId) {
    return { valid: false, error: 'Campo obligatorio correlationId ausente.' };
  }

  const timestamp = String(candidate.timestamp ?? '').trim();
  const parsedTime = Date.parse(timestamp);
  if (!timestamp || Number.isNaN(parsedTime)) {
    return { valid: false, error: 'Campo obligatorio timestamp ausente o no es ISO-8601 válido.' };
  }

  const maxSkew = options?.maxClockSkewMs ?? 5 * 60 * 1000;
  if (Math.abs(Date.now() - parsedTime) > maxSkew) {
    return {
      valid: false,
      error: 'El timestamp del mensaje excede la ventana máxima de tolerancia (posible ataque de repetición).',
    };
  }

  const payload =
    candidate.payload && typeof candidate.payload === 'object' && !Array.isArray(candidate.payload)
      ? (candidate.payload as Record<string, unknown>)
      : {};

  const envelope: BridgeMessageEnvelope = {
    protocolVersion,
    taskId,
    sessionId,
    operation,
    payload,
    timestamp,
    correlationId,
    signature: typeof candidate.signature === 'string' ? candidate.signature : undefined,
  };

  if (options?.sharedSecret) {
    if (!verifyEnvelopeHmac(envelope, options.sharedSecret)) {
      return {
        valid: false,
        error: 'Firma criptográfica HMAC-SHA256 inválida o ausente en el mensaje.',
      };
    }
  }

  return { valid: true, envelope };
}

export function buildBridgeResponseEnvelope<TResult = unknown>(params: {
  taskId: string;
  sessionId: string;
  correlationId: string;
  status: BridgeTaskStatus;
  result?: TResult | null;
  error?: string | null;
  executionTime: number;
  sharedSecret?: string;
}): BridgeResponseEnvelope<TResult> {
  const response: BridgeResponseEnvelope<TResult> = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    taskId: params.taskId,
    sessionId: params.sessionId,
    correlationId: params.correlationId,
    status: params.status,
    result: params.result ?? null,
    error: params.error ?? null,
    executionTime: Math.max(0, Math.round(params.executionTime)),
    timestamp: new Date().toISOString(),
  };

  if (params.sharedSecret) {
    const sigPayload = [
      response.protocolVersion,
      response.taskId,
      response.sessionId,
      response.correlationId,
      response.status,
      String(response.executionTime),
      response.timestamp,
      JSON.stringify(response.result),
      response.error || '',
    ].join('|');
    response.signature = crypto
      .createHmac('sha256', params.sharedSecret)
      .update(sigPayload, 'utf-8')
      .digest('hex');
  }

  return response;
}
