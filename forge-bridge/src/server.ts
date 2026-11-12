/**
 * @module server
 * @description
 * Fase 2 y 4 — Servicio Local Independiente de Forge Bridge para Windows.
 *
 * - Escucha EXCLUSIVAMENTE en `127.0.0.1` (`BRIDGE_HOST="127.0.0.1"` forzado).
 * - Rechaza conexiones provenientes de interfaces no loopback.
 * - Protege los endpoints del Plugin de Roblox Studio con `X-Plugin-Token` / `X-Forge-Token` y validación anti-CSRF / Origin.
 * - Mantiene un registro de actividad circular (`activityLog`) sin exponer jamás secretos ni rutas personales de Windows.
 * - Soporta inicio y cierre limpios (`SIGINT`, `SIGTERM`).
 */

import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeMessageEnvelope,
  validateBridgeMessageEnvelope,
} from './protocol.js';
import { verifyTokenConstantTime } from './security.js';
import { LocalRojoManager } from './rojoHandler.js';
import { TaskExecutionCoordinator } from './studioQueue.js';
import { ForgeCloudOutboundClient } from './cloudClient.js';

dotenv.config();

export interface BridgeServerOptions {
  port?: number;
  rojoProjectPath?: string;
  rojoPort?: number;
  cloudUrl?: string;
  sharedSecret?: string;
  pluginLocalToken?: string;
  heartbeatIntervalMs?: number;
  taskTimeoutMs?: number;
  maxConcurrency?: number;
  maxFileSizeBytes?: number;
  autoConnectCloud?: boolean;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export function createForgeLocalBridgeApp(options?: BridgeServerOptions) {
  const bindHost = '127.0.0.1'; // Innegociable Fase 4: exclusivamente loopback
  const bindPort = Number(options?.port ?? process.env.BRIDGE_PORT ?? 48720);
  const resolveDefaultRojoPath = (): string => {
    const rawPath = options?.rojoProjectPath ?? process.env.ROJO_PROJECT_PATH ?? '../';
    const resolved = path.resolve(process.cwd(), rawPath);
    if (fs.existsSync(path.join(resolved, 'default.project.json'))) {
      return resolved;
    }
    const subWorkspace = path.join(resolved, 'rojo_workspace');
    if (fs.existsSync(path.join(subWorkspace, 'default.project.json'))) {
      return subWorkspace;
    }
    const siblingWorkspace = path.resolve(process.cwd(), '../rojo_workspace');
    if (fs.existsSync(path.join(siblingWorkspace, 'default.project.json'))) {
      return siblingWorkspace;
    }
    return resolved;
  };
  const rojoProjectPath = resolveDefaultRojoPath();
  const rojoPort = Number(options?.rojoPort ?? process.env.ROJO_PORT ?? 34872);
  const cloudUrl = String(options?.cloudUrl ?? process.env.FORGE_CLOUD_URL ?? 'http://127.0.0.1:3000').trim();
  const sharedSecret = String(
    options?.sharedSecret ??
      process.env.FORGE_BRIDGE_SHARED_SECRET ??
      process.env.FORGE_LOCAL_TOKEN ??
      ''
  ).trim();
  const pluginLocalToken = String(
    options?.pluginLocalToken ??
      process.env.FORGE_PLUGIN_LOCAL_TOKEN ??
      process.env.FORGE_LOCAL_TOKEN ??
      ''
  ).trim();
  const heartbeatIntervalMs = Number(
    options?.heartbeatIntervalMs ?? process.env.BRIDGE_HEARTBEAT_INTERVAL_MS ?? 2500
  );
  const taskTimeoutMs = Number(
    options?.taskTimeoutMs ?? process.env.BRIDGE_TASK_TIMEOUT_MS ?? 30000
  );
  const maxConcurrency = Number(
    options?.maxConcurrency ?? process.env.BRIDGE_MAX_CONCURRENCY ?? 2
  );
  const maxFileSizeBytes = Number(
    options?.maxFileSizeBytes ?? process.env.BRIDGE_MAX_FILE_SIZE_BYTES ?? 15 * 1024 * 1024
  );

  const activityLogs: ActivityLogEntry[] = [];
  const logActivity = (level: 'info' | 'warn' | 'error', message: string) => {
    const entry: ActivityLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    activityLogs.push(entry);
    if (activityLogs.length > 250) {
      activityLogs.shift();
    }
  };

  const rojoManager = new LocalRojoManager({
    projectRootPath: rojoProjectPath,
    rojoPort,
    maxFileSizeBytes,
  });
  rojoManager.startWatching();

  const coordinator = new TaskExecutionCoordinator({
    maxConcurrency,
    defaultTimeoutMs: taskTimeoutMs,
  });

  const cloudClient = new ForgeCloudOutboundClient({
    cloudUrl,
    sharedSecret,
    bridgeVersion: '1.0.0',
    heartbeatIntervalMs,
    rojoManager,
    coordinator,
    onLog: logActivity,
  });

  const app = express();
  app.use(express.json({ limit: '16mb' }));

  // Middleware de seguridad loopback + bloqueo de navegadores externos no autorizados
  app.use((req, res, next) => {
    const remoteAddr = req.socket.remoteAddress || '';
    const isLoopback =
      remoteAddr === '127.0.0.1' ||
      remoteAddr === '::1' ||
      remoteAddr === '::ffff:127.0.0.1';
    if (!isLoopback) {
      logActivity('warn', `Bloqueado intento de conexión no-loopback desde ${remoteAddr}`);
      return res.status(403).json({ error: 'Acceso permitido exclusivamente desde 127.0.0.1.' });
    }

    // Bloquear orígenes web arbitrarios (DNS rebinding / CSRF desde sitios externos)
    const origin = req.headers.origin;
    if (origin) {
      const allowedOrigin =
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.endsWith('.run.app');
      if (!allowedOrigin) {
        logActivity('warn', `Bloqueado Origin no autorizado: ${origin}`);
        return res.status(403).json({ error: 'Origin no autorizado por política local.' });
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Forge-Token, X-Plugin-Token, Authorization'
    );
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Validación de token para rutas del plugin y mutaciones locales
  const requireLocalAuth: express.RequestHandler = (req, res, next) => {
    if (!pluginLocalToken) {
      return next();
    }
    const provided = String(
      req.headers['x-plugin-token'] || req.headers['x-forge-token'] || ''
    ).trim();
    if (!verifyTokenConstantTime(provided, pluginLocalToken)) {
      logActivity('warn', `Intento no autorizado en ${req.path}: Token de plugin inválido.`);
      return res.status(401).json({
        error: 'No autorizado: Cabecera X-Plugin-Token o X-Forge-Token inválida.',
      });
    }
    next();
  };

  // 1. Estado consolidado del puente local (sin exponer secretos ni rutas absolutas de Windows)
  app.get('/local/status', async (_req, res) => {
    const rojoStatus = await rojoManager.getStatus();
    const studioState = coordinator.getStudioState();
    const cloudStatus = cloudClient.getStatus();
    const queueMetrics = coordinator.getQueueMetrics();

    res.json({
      bridgeVersion: '1.0.0',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      bindAddress: `${bindHost}:${bindPort}`,
      cloudConnection: cloudStatus,
      rojo: rojoStatus,
      robloxStudio: studioState,
      queue: queueMetrics,
      recentLogs: activityLogs.slice(-25),
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Forzar reconexión hacia Forge Cloud
  app.post('/local/reconnect', requireLocalAuth, async (_req, res) => {
    logActivity('info', 'Reconexión manual solicitada.');
    const status = await cloudClient.forceReconnect();
    res.json({ reconnected: status.connected, cloudConnection: status });
  });

  // 3. Ejecución directa de una tarea validada bajo el Contrato de Mensajes v1.0
  app.post('/local/execute', requireLocalAuth, async (req, res) => {
    const validation = validateBridgeMessageEnvelope(req.body, {
      sharedSecret: sharedSecret || undefined,
    });
    if (!validation.valid || !validation.envelope) {
      return res.status(400).json({
        status: 'failed',
        error: validation.error,
      });
    }

    const envelope: BridgeMessageEnvelope = validation.envelope;
    logActivity('info', `Ejecutando operación '${envelope.operation}' (taskId=${envelope.taskId})`);
    const response = await coordinator.executeDeduplicated(
      envelope,
      async (env) => cloudClient.dispatchAllowedOperation(env),
      sharedSecret || undefined
    );
    res.json(response);
  });

  // 4. Endpoints exclusivos para el Plugin de Roblox Studio (en 127.0.0.1)
  app.post('/local/plugin/heartbeat', requireLocalAuth, async (req, res) => {
    const {
      pluginVersion,
      placeName,
      selectedModelName,
      selectedPartCount,
      pendingDestructiveConfirmations,
    } = req.body || {};

    const updatedStudio = coordinator.recordStudioHeartbeat({
      pluginVersion,
      placeName,
      selectedModelName,
      selectedPartCount,
      pendingDestructiveConfirmations,
    });
    const pendingTasks = coordinator.dequeueNextForStudioPlugin();
    const rojoStatus = await rojoManager.getStatus();

    res.json({
      ok: true,
      bridgeVersion: '1.0.0',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      studioState: updatedStudio,
      rojoStatus,
      cloudConnected: cloudClient.getStatus().connected,
      pendingTasks,
    });
  });

  app.get('/local/plugin/poll', requireLocalAuth, (_req, res) => {
    coordinator.recordStudioHeartbeat({});
    const pendingTasks = coordinator.dequeueNextForStudioPlugin();
    res.json({
      ok: true,
      pendingTasks,
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/local/plugin/result', requireLocalAuth, (req, res) => {
    const { taskId, status, result, error } = req.body || {};
    if (!taskId || typeof taskId !== 'string') {
      return res.status(400).json({ error: 'Se requiere taskId.' });
    }
    const validStatus =
      status === 'completed' ||
      status === 'failed' ||
      status === 'awaiting_studio_confirmation' ||
      status === 'awaiting_confirmation' ||
      status === 'partially_applied'
        ? status
        : 'completed';

    const priorCompleted = coordinator.getCompletedTaskResult(taskId);
    const wasAwaitingConfirmation =
      priorCompleted !== null &&
      (priorCompleted.status === 'awaiting_studio_confirmation' ||
        priorCompleted.status === 'awaiting_confirmation');

    const accepted = coordinator.submitStudioPluginResult(
      {
        taskId,
        status: validStatus,
        result,
        error: error ? String(error) : null,
      },
      sharedSecret || undefined
    );

    if (accepted && wasAwaitingConfirmation) {
      const updatedEnvelope = coordinator.getCompletedTaskResult(taskId);
      if (updatedEnvelope) {
        void cloudClient.reportFollowUpTaskResult(updatedEnvelope);
      }
    }

    logActivity(
      validStatus === 'failed' ? 'error' : 'info',
      `Plugin Studio reportó resultado para ${taskId}: ${validStatus}`
    );
    res.json({ accepted, taskId, status: validStatus });
  });

  app.get('/local/task/:taskId', requireLocalAuth, (req, res) => {
    const taskRes = coordinator.getCompletedTaskResult(String(req.params.taskId || ''));
    if (!taskRes) {
      return res.status(404).json({ error: 'Tarea no encontrada o aún en ejecución.' });
    }
    return res.json(taskRes);
  });

  // 5. Endpoints de Sincronización 3D Bidireccional (Studio <-> Bridge Local <-> Cloud <-> Rojo)
  app.get('/local/plugin/rojo-manifest', requireLocalAuth, (_req, res) => {
    const cfg = rojoManager.getProjectConfig();
    const files = cfg.files.map((f) => ({
      name: f.name,
      relative_path: f.relativePath,
      sha256: f.sha256,
      content_fnv32: f.contentFnv32,
      datamodel_target: f.datamodelTarget,
    }));
    res.json({
      projectName: cfg.projectName,
      files,
      timestamp: cfg.timestamp,
    });
  });

  app.post('/local/plugin/compare-datamodel', requireLocalAuth, async (req, res) => {
    try {
      const upstream = await cloudClient.forwardToCloudApi(
        '/api/v1/assets/compare-datamodel',
        'POST',
        req.body || {}
      );
      return res.status(upstream.status).json(upstream.data);
    } catch (err: any) {
      logActivity('error', `Error en compare-datamodel vía Cloud: ${err.message}`);
      return res.status(502).json({ error: err.message });
    }
  });

  app.post('/local/plugin/studio-push', requireLocalAuth, async (req, res) => {
    try {
      const upstream = await cloudClient.forwardToCloudApi(
        '/api/v1/assets/studio-push',
        'POST',
        req.body || {}
      );
      const data = upstream.data;
      if (upstream.ok && data && data.success) {
        const assetObj = data.asset || {};
        const rawName = String(assetObj.name || req.body?.model_name || 'StudioModel');
        const safeName = rawName.replace(/[^a-zA-Z0-9_]/g, '') || 'StudioModel';
        const targetFolder = String(assetObj.rojo_target_folder || 'src/shared/Assets3D').replace(
          /^[/\\]+/,
          ''
        );
        const luauContent = String(data.luau_code || assetObj.luau_code || '');
        const rbxmxContent = String(data.rbxmx_content || '');

        const filesToWrite: Array<{ relativePath: string; content: string; encoding?: 'utf-8' | 'base64' }> = [];
        if (luauContent.trim().length > 0) {
          filesToWrite.push({
            relativePath: `${targetFolder}/${safeName}.luau`,
            content: luauContent,
            encoding: 'utf-8',
          });
        }
        if (rbxmxContent.trim().length > 0) {
          filesToWrite.push({
            relativePath: `${targetFolder}/${safeName}.rbxmx`,
            content: rbxmxContent,
            encoding: 'utf-8',
          });
        }
        if (filesToWrite.length > 0) {
          rojoManager.writePackage(filesToWrite);
          logActivity(
            'info',
            `Studio Push sincronizó ${filesToWrite.length} archivo(s) en Rojo local para '${safeName}'.`
          );
        }
      }
      return res.status(upstream.status).json(data);
    } catch (err: any) {
      logActivity('error', `Error en studio-push vía Cloud: ${err.message}`);
      return res.status(502).json({ error: err.message });
    }
  });

  let httpServer: http.Server | null = null;

  const start = async (): Promise<http.Server> => {
    return new Promise((resolve, reject) => {
      const srv = app.listen(bindPort, bindHost, async () => {
        httpServer = srv;
        logActivity(
          'info',
          `Forge Local Bridge v1.0.0 escuchando exclusivamente en http://${bindHost}:${bindPort}`
        );
        if (options?.autoConnectCloud !== false) {
          await cloudClient.start();
        }
        resolve(srv);
      });
      srv.on('error', reject);
    });
  };

  const stop = async (): Promise<void> => {
    logActivity('info', 'Deteniendo Forge Local Bridge de forma controlada...');
    cloudClient.stop();
    rojoManager.stopWatching();
    coordinator.shutdown();
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer!.close(() => resolve());
      });
      httpServer = null;
    }
  };

  return {
    app,
    rojoManager,
    coordinator,
    cloudClient,
    start,
    stop,
    getBindPort: () => bindPort,
  };
}

// Ejecución directa cuando se inicia como proceso principal
const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]).replace(/\\/g, '/').endsWith('/src/server.ts');

if (isMainModule) {
  const bridge = createForgeLocalBridgeApp();
  bridge.start().catch((err) => {
    console.error('[ForgeBridge:FATAL]', err);
    process.exit(1);
  });

  const handleSignal = async (signal: string) => {
    console.log(`\n[ForgeBridge] Recibida señal ${signal}, cerrando servicio...`);
    await bridge.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void handleSignal('SIGINT'));
  process.on('SIGTERM', () => void handleSignal('SIGTERM'));
}
