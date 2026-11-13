/**
 * @module bridge.test
 * @description
 * Fase 9 y 10 — Suite Automatizada de Validación End-to-End del Servicio Forge Local Bridge.
 *
 * Verifica:
 * 1. Inicio del servidor remoto simulado (Forge Cloud Coordinator) y del puente local en 127.0.0.1.
 * 2. Handshake autenticado con HMAC-SHA256 y sesión activa.
 * 3. Detección del proyecto Rojo local (`default.project.json`, archivos `.luau`).
 * 4. Detección de Roblox Studio Plugin mediante heartbeat local (`127.0.0.1`).
 * 5. Lectura de un archivo permitido por ruta relativa (`rojo.read_file`).
 * 6. Escritura de un archivo de prueba (`rojo.write_file`) y confirmación de que Rojo detecta el cambio (`rojo.detect_changes`).
 * 7. Bloqueo estricto de Path Traversal (`..`), rutas absolutas de Windows (`C:\...`), extensiones prohibidas y patrones `loadstring`.
 * 8. Envío de una operación al Plugin de Roblox Studio (`studio.get_selection` y `studio.apply_modifications`) y recepción de respuesta.
 * 9. Desconexión / solicitud de reconexión y renovación automática de sesión.
 * 10. Prevención garantizada de ejecución duplicada (`rejected_duplicate`) ante el mismo `taskId`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeMessageEnvelope,
  computeEnvelopeHmac,
  validateBridgeMessageEnvelope,
} from '../src/protocol.js';
import {
  resolveAndValidateRelativePath,
  validateAndSanitizeLuauContent,
} from '../src/security.js';
import { createForgeLocalBridgeApp } from '../src/server.js';
import {
  TaskExecutionCoordinator,
  InMemoryTaskStateStoreAdapter,
  JsonFileTaskStateStoreAdapter,
} from '../src/studioQueue.js';

const SHARED_SECRET = 'test-shared-secret-2026-hmac-key';
const PLUGIN_TOKEN = 'test-local-plugin-token-2026';

function resolveTestRojoProjectRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), 'rojo_workspace'),
    process.cwd(),
    path.resolve(process.cwd(), '../rojo_workspace'),
    path.resolve(process.cwd(), '../'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'default.project.json'))) {
      return dir;
    }
  }
  return path.resolve(process.cwd(), '../');
}

test('Fase 4 & 7 — Seguridad de Rutas Relativas, Bloqueo de Path Traversal y Contrato de Mensajes', () => {
  const projectRoot = resolveTestRojoProjectRoot();

  // 1. Ruta relativa permitida funciona
  const safe = resolveAndValidateRelativePath(projectRoot, 'src/shared/Config.luau');
  assert.equal(safe.relativePath, 'src/shared/Config.luau');
  assert.equal(safe.extension, '.luau');

  // 2. Bloqueo de Path Traversal ('..')
  assert.throws(() => {
    resolveAndValidateRelativePath(projectRoot, 'src/../../Windows/System32/cmd.exe');
  }, /Path Traversal/);

  // 3. Bloqueo de rutas absolutas de Windows
  assert.throws(() => {
    resolveAndValidateRelativePath(projectRoot, 'C:\\Windows\\win.ini');
  }, /rutas absolutas/);

  // 4. Bloqueo de extensiones no autorizadas
  assert.throws(() => {
    resolveAndValidateRelativePath(projectRoot, 'src/shared/exploit.exe');
  }, /extensión/i);

  // 5. Bloqueo de código Luau peligroso (loadstring)
  assert.throws(() => {
    validateAndSanitizeLuauContent('loadstring("print(1)")()');
  }, /prohibida/);

  // 6. Validación del Contrato de Mensajes v1.0 y firma HMAC
  const baseMsg: BridgeMessageEnvelope = {
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    taskId: 'task_unit_001',
    sessionId: 'sess_unit_abc',
    operation: 'rojo.status',
    payload: {},
    timestamp: new Date().toISOString(),
    correlationId: 'corr_unit_001',
  };
  baseMsg.signature = computeEnvelopeHmac(baseMsg, SHARED_SECRET);

  const validCheck = validateBridgeMessageEnvelope(baseMsg, {
    expectedSessionId: 'sess_unit_abc',
    sharedSecret: SHARED_SECRET,
  });
  assert.equal(validCheck.valid, true);

  // Operación fuera de la lista blanca debe ser rechazada
  const invalidOpMsg = { ...baseMsg, operation: 'shell.exec' };
  const invalidCheck = validateBridgeMessageEnvelope(invalidOpMsg, {
    sharedSecret: SHARED_SECRET,
  });
  assert.equal(invalidCheck.valid, false);
});

test('Fase 10 — Recorrido Completo de Validación End-to-End (Cloud <-> Bridge <-> Rojo <-> Roblox Studio)', async () => {
  // 1. Iniciar servidor coordinador de Forge Cloud en un puerto efímero
  const cloudApp = express();
  cloudApp.use(express.json());

  let activeSessionId = '';
  let activeSessionToken = '';
  let heartbeatCount = 0;
  const pendingCloudTasks: BridgeMessageEnvelope[] = [];
  const receivedTaskAcks: string[] = [];
  const receivedTaskResults: Map<string, any> = new Map();

  cloudApp.post('/api/v1/bridge/auth/handshake', (req, res) => {
    activeSessionId = `sess_e2e_${Date.now()}`;
    activeSessionToken = `tok_${Date.now()}`;
    res.json({
      accepted: true,
      sessionId: activeSessionId,
      sessionToken: activeSessionToken,
      expiresAt: Date.now() + 3600_000,
      wsSupported: false,
    });
  });

  cloudApp.post('/api/v1/bridge/heartbeat', (req, res) => {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${activeSessionToken}`) {
      return res.status(401).json({ error: 'Session expired' });
    }
    heartbeatCount += 1;
    const toSend = pendingCloudTasks.splice(0, pendingCloudTasks.length);
    res.json({ pendingTasks: toSend });
  });

  cloudApp.post('/api/v1/bridge/task-ack', (req, res) => {
    receivedTaskAcks.push(req.body.taskId);
    res.json({ acked: true });
  });

  cloudApp.post('/api/v1/bridge/task-result', (req, res) => {
    receivedTaskResults.set(req.body.taskId, req.body);
    res.json({ accepted: true });
  });

  const cloudServer = await new Promise<http.Server>((resolve) => {
    const s = cloudApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  const cloudPort = (cloudServer.address() as any).port;
  const cloudUrl = `http://127.0.0.1:${cloudPort}`;

  // 2. Iniciar el Puente Local en Windows (127.0.0.1) apuntando al proyecto Rojo real
  const projectRoot = resolveTestRojoProjectRoot();
  const existingLuauRelPath = fs.existsSync(path.join(projectRoot, 'src/shared/Utils/Maid.luau'))
    ? 'src/shared/Utils/Maid.luau'
    : 'src/shared/Types.luau';
  const bridgePort = 48725;
  const testStateFile = path.join(os.tmpdir(), `forge_bridge_e2e_state_${Date.now()}.json`);
  const bridge = createForgeLocalBridgeApp({
    port: bridgePort,
    rojoProjectPath: projectRoot,
    cloudUrl,
    sharedSecret: SHARED_SECRET,
    pluginLocalToken: PLUGIN_TOKEN,
    heartbeatIntervalMs: 1000,
    autoConnectCloud: true,
    stateFilePath: testStateFile,
  });

  await bridge.start();
  const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;

  try {
    // 3. Verificar conexión autenticada con Forge Cloud
    assert.ok(activeSessionId.startsWith('sess_e2e_'), 'Debe establecerse una sesión autenticada');

    // 4. Detectar el proyecto Rojo y consultar su estado sin rutas absolutas de Windows
    const statusRes = await fetch(`${bridgeBaseUrl}/local/status`, {
      headers: { 'X-Plugin-Token': PLUGIN_TOKEN },
    });
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as any;
    assert.equal(statusJson.cloudConnection.connected, true);
    assert.equal(statusJson.rojo.defaultProjectJsonFound, true);
    assert.ok(statusJson.rojo.syncedFilesCount > 0, 'Debe detectar los archivos .luau del proyecto Rojo');

    // 5. Detectar Roblox Studio mediante heartbeat del Plugin
    const pluginHbRes = await fetch(`${bridgeBaseUrl}/local/plugin/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify({
        pluginVersion: '2.2.0',
        placeName: 'NIGHTMARE.rbxl',
        selectedModelName: 'GhostDetectorModel',
        selectedPartCount: 6,
        pendingDestructiveConfirmations: 0,
      }),
    });
    assert.equal(pluginHbRes.status, 200);
    const pluginHbData = (await pluginHbRes.json()) as any;
    assert.equal(pluginHbData.studioState.connected, true);
    assert.equal(pluginHbData.studioState.selectedModelName, 'GhostDetectorModel');

    // 6. Consultar un archivo permitido (`rojo.read_file`)
    const makeSignedEnvelope = (
      taskId: string,
      operation: BridgeMessageEnvelope['operation'],
      payload: Record<string, unknown>
    ): BridgeMessageEnvelope => {
      const env: BridgeMessageEnvelope = {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        taskId,
        sessionId: activeSessionId,
        operation,
        payload,
        timestamp: new Date().toISOString(),
        correlationId: `corr_${taskId}`,
      };
      env.signature = computeEnvelopeHmac(env, SHARED_SECRET);
      return env;
    };

    const readEnv = makeSignedEnvelope('task_read_types_01', 'rojo.read_file', {
      relativePath: existingLuauRelPath,
    });
    const readRes = await fetch(`${bridgeBaseUrl}/local/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify(readEnv),
    });
    const readData = (await readRes.json()) as any;
    assert.equal(readData.status, 'completed');
    assert.ok(readData.result.content.includes('--!strict'), 'El archivo leído debe contener código Luau');

    // 7 & 8. Modificar un archivo de prueba y confirmar que Rojo detecta el cambio
    const testRelPath = 'src/shared/_ForgeBridgeValidationTest.luau';
    const testAbsPath = path.join(projectRoot, testRelPath);

    try {
      const writeEnv = makeSignedEnvelope('task_write_test_02', 'rojo.write_file', {
        relativePath: testRelPath,
        content: '--!strict\nlocal BridgeValidation = { verified = true }\nreturn BridgeValidation\n',
      });
      // Enviar la tarea a través del canal Cloud -> Bridge Heartbeat
      pendingCloudTasks.push(writeEnv);
      await bridge.cloudClient.sendHeartbeatAndPollTasks();

      // Esperar breve procesamiento asíncrono
      await new Promise((r) => setTimeout(r, 150));

      assert.ok(receivedTaskAcks.includes('task_write_test_02'), 'El puente debe confirmar recepción (ACK)');
      const cloudRecordedResult = receivedTaskResults.get('task_write_test_02');
      assert.ok(cloudRecordedResult, 'El puente debe entregar el resultado a Forge Cloud');
      assert.equal(cloudRecordedResult.status, 'completed');
      assert.equal(fs.existsSync(testAbsPath), true, 'El archivo de prueba debe existir en disco');

      // Modificar externamente el archivo en disco para comprobar detección de cambios de Rojo
      fs.writeFileSync(
        testAbsPath,
        '--!strict\nlocal BridgeValidation = { verified = true, rev = 2 }\nreturn BridgeValidation\n',
        'utf-8'
      );
      const detectEnv = makeSignedEnvelope('task_detect_03', 'rojo.detect_changes', {
        updateBaseline: true,
      });
      const detectRes = await fetch(`${bridgeBaseUrl}/local/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Plugin-Token': PLUGIN_TOKEN,
        },
        body: JSON.stringify(detectEnv),
      });
      const detectData = (await detectRes.json()) as any;
      assert.equal(detectData.status, 'completed');
      assert.equal(detectData.result.changed, true, 'Rojo debe detectar la modificación en el archivo');
    } finally {
      if (fs.existsSync(testAbsPath)) {
        fs.unlinkSync(testAbsPath);
      }
      bridge.rojoManager.captureBaselineSnapshot();
    }

    // 9 & 10. Enviar una operación al Plugin de Roblox Studio (`studio.get_selection`) y recibir su respuesta
    const studioEnv = makeSignedEnvelope('task_studio_sel_04', 'studio.get_selection', {});
    const studioExecPromise = fetch(`${bridgeBaseUrl}/local/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify(studioEnv),
    });

    await new Promise((r) => setTimeout(r, 80));

    // El plugin hace poll de la tarea en 127.0.0.1
    const pollRes = await fetch(`${bridgeBaseUrl}/local/plugin/poll`, {
      headers: { 'X-Plugin-Token': PLUGIN_TOKEN },
    });
    const pollData = (await pollRes.json()) as any;
    assert.equal(pollData.pendingTasks.length, 1);
    assert.equal(pollData.pendingTasks[0].taskId, 'task_studio_sel_04');

    // El plugin devuelve la respuesta al puente local
    const submitRes = await fetch(`${bridgeBaseUrl}/local/plugin/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify({
        taskId: 'task_studio_sel_04',
        status: 'completed',
        result: {
          selectedModelName: 'GhostDetectorModel',
          selectedPartCount: 6,
        },
      }),
    });
    assert.equal(submitRes.status, 200);

    const studioFinalRes = await studioExecPromise;
    const studioFinalData = (await studioFinalRes.json()) as any;
    assert.equal(studioFinalData.status, 'completed');
    assert.equal(studioFinalData.result.selectedModelName, 'GhostDetectorModel');

    // 11. Simular expiración/desconexión de sesión y verificar reconexión automática
    const oldSessionId = activeSessionId;
    activeSessionToken = 'invalidated_token_forcing_reauth';
    await bridge.cloudClient.sendHeartbeatAndPollTasks();
    assert.notEqual(activeSessionId, oldSessionId, 'El puente debe reconectar y obtener una nueva sesión autenticada');

    // 12. Verificar que NO se ejecutan tareas duplicadas con el mismo taskId
    const dupRes = await fetch(`${bridgeBaseUrl}/local/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify(readEnv), // Mismo taskId 'task_read_types_01'
    });
    const dupData = (await dupRes.json()) as any;
    assert.equal(dupData.status, 'rejected_duplicate');

    // 13. Verificar compilación real con el binario rojo.exe de Windows (`rojo.check_build`)
    const buildEnv = makeSignedEnvelope('task_rojo_build_05', 'rojo.check_build', {});
    const buildRes = await fetch(`${bridgeBaseUrl}/local/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify(buildEnv),
    });
    const buildData = (await buildRes.json()) as any;
    assert.equal(buildData.status, 'completed');
    assert.equal(buildData.result.valid, true, 'rojo.exe build debe compilar sin errores el proyecto local');

    // 14. Verificar rechazo de peticiones sin X-Plugin-Token (401) y con Origin externo CSRF (403)
    const noAuthRes = await fetch(`${bridgeBaseUrl}/local/plugin/poll`);
    assert.equal(noAuthRes.status, 401, 'Debe rechazar peticiones sin X-Plugin-Token');

    const csrfRes = await fetch(`${bridgeBaseUrl}/local/status`, {
      headers: { Origin: 'https://evil-attacker.example.com' },
    });
    assert.equal(csrfRes.status, 403, 'Debe bloquear peticiones cross-origin desde navegadores externos');
  } finally {
    await bridge.stop();
    await new Promise<void>((resolve) => cloudServer.close(() => resolve()));
    if (fs.existsSync(testStateFile)) {
      try {
        fs.unlinkSync(testStateFile);
      } catch {
        // ignore test cleanup error
      }
    }
  }
});

test('Fase 3 & 8 — Integración Real entre CloudBridgeCoordinator (Backend) y ForgeLocalBridge', async () => {
  const rootCoordinatorCandidate = path.resolve(
    process.cwd(),
    'src/server/engines/bridgeCoordinatorEngine.ts'
  );
  const localCoordinatorCandidate = path.resolve(
    process.cwd(),
    '../src/server/engines/bridgeCoordinatorEngine.ts'
  );
  const siblingCoordinatorCandidate = path.resolve(
    process.cwd(),
    '../../MCP-3D-rblx/src/server/engines/bridgeCoordinatorEngine.ts'
  );
  const coordinatorPath = fs.existsSync(rootCoordinatorCandidate)
    ? rootCoordinatorCandidate
    : fs.existsSync(localCoordinatorCandidate)
    ? localCoordinatorCandidate
    : siblingCoordinatorCandidate;
  if (!fs.existsSync(coordinatorPath)) {
    return;
  }

  process.env.FORGE_BRIDGE_SHARED_SECRET = SHARED_SECRET;
  const { CloudBridgeCoordinator } = await import(
    'file:///' + coordinatorPath.replace(/\\/g, '/')
  );
  const coordinator = new CloudBridgeCoordinator();

  // Montar las rutas exactas del backend de Forge AI Studio usando la instancia real de CloudBridgeCoordinator
  const realBackendApp = express();
  realBackendApp.use(express.json());

  realBackendApp.post('/api/v1/bridge/auth/handshake', (req, res) => {
    const token = String(req.headers['x-forge-token'] || '');
    const out = coordinator.handleHandshake(req.body || {}, token);
    if (!out.accepted) return res.status(401).json(out);
    return res.json(out);
  });

  realBackendApp.post('/api/v1/bridge/heartbeat', (req, res) => {
    const auth = String(req.headers.authorization || '');
    const sess = String(req.headers['x-bridge-session'] || '');
    const tok = String(req.headers['x-forge-token'] || '');
    if (!coordinator.verifySessionRequest(auth, sess, tok)) {
      return res.status(401).json({ error: 'Sesión expirada o no válida' });
    }
    return res.json(coordinator.handleHeartbeat(req.body || {}));
  });

  realBackendApp.post('/api/v1/bridge/task-ack', (req, res) => {
    const auth = String(req.headers.authorization || '');
    const sess = String(req.headers['x-bridge-session'] || '');
    const tok = String(req.headers['x-forge-token'] || '');
    if (!coordinator.verifySessionRequest(auth, sess, tok)) {
      return res.status(401).json({ error: 'Sesión expirada' });
    }
    return res.json({ acked: coordinator.handleTaskAck(String(req.body?.taskId || '')) });
  });

  realBackendApp.post('/api/v1/bridge/task-result', (req, res) => {
    const auth = String(req.headers.authorization || '');
    const sess = String(req.headers['x-bridge-session'] || '');
    const tok = String(req.headers['x-forge-token'] || '');
    if (!coordinator.verifySessionRequest(auth, sess, tok)) {
      return res.status(401).json({ error: 'Sesión expirada' });
    }
    return res.json({ accepted: coordinator.handleTaskResult(req.body) });
  });

  const backendServer = await new Promise<http.Server>((resolve) => {
    const s = realBackendApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  const backendPort = (backendServer.address() as any).port;

  const projectRoot = resolveTestRojoProjectRoot();
  const bridge = createForgeLocalBridgeApp({
    port: 48726,
    rojoProjectPath: projectRoot,
    cloudUrl: `http://127.0.0.1:${backendPort}`,
    sharedSecret: SHARED_SECRET,
    pluginLocalToken: PLUGIN_TOKEN,
    heartbeatIntervalMs: 400,
    autoConnectCloud: true,
  });

  await bridge.start();

  try {
    // 1. Verificar que CloudBridgeCoordinator registró el handshake real y no expone rutas absolutas
    const pubStatus1 = coordinator.getPublicBridgeStatus();
    assert.equal(pubStatus1.bridgeConnected, true);
    assert.equal(pubStatus1.sessionActive, true);
    assert.equal(pubStatus1.rojo.defaultProjectJsonFound, true);
    assert.equal(
      JSON.stringify(pubStatus1).includes('C:\\'),
      false,
      'El estado público en la nube jamás debe contener rutas absolutas de Windows'
    );

    // 2. Despachar tarea real firmada por CloudBridgeCoordinator y esperar resolución end-to-end (ACK + Result)
    const taskResultPromise = coordinator.enqueueTask('rojo.get_project_config', {}, true, 5000);
    await bridge.cloudClient.sendHeartbeatAndPollTasks();
    const taskResult = await taskResultPromise;
    assert.equal(taskResult.status, 'completed');
    assert.ok(taskResult.result.projectName, 'Debe devolver projectName desde default.project.json');
    assert.ok(taskResult.result.defaultProjectJson, 'Debe devolver el árbol defaultProjectJson');

    // 3. Solicitar reconexión desde CloudBridgeCoordinator y verificar renovación automática de sesión
    //    y recuperación de tareas encoladas durante la desconexión
    coordinator.requestReconnect();
    assert.equal(coordinator.isBridgeConnected(), false);
    const pendingDuringDisconnect = coordinator.enqueueTask('rojo.status', {}, true, 5000);
    // Primer pulso detecta 401 y re-autentica la sesión
    await bridge.cloudClient.sendHeartbeatAndPollTasks();
    assert.equal(
      coordinator.isBridgeConnected(),
      true,
      'El puente debe renovar la sesión automáticamente tras requestReconnect()'
    );
    // Segundo pulso recoge y ejecuta la tarea que quedó pendiente en la cola
    await bridge.cloudClient.sendHeartbeatAndPollTasks();
    const recoveredResult = await pendingDuringDisconnect;
    assert.equal(recoveredResult.status, 'completed', 'Debe recuperar y completar tareas pendientes tras reconectar');

    // 4. Verificar timeout controlado cuando una tarea excede su límite de espera
    const timeoutResult = await coordinator.enqueueTask('studio.get_selection', {}, true, 60);
    assert.equal(timeoutResult.status, 'timeout', 'Debe reportar status timeout cuando expira el plazo');
  } finally {
    await bridge.stop();
    await new Promise<void>((resolve) => backendServer.close(() => resolve()));
  }
});

test('Fase 4 & 5 — Prueba Integral Motores 3D: Forge → Cloud → Bridge → Rojo → Studio → Bridge → Cloud → Forge', async () => {
  const rootEnginesCandidate = path.resolve(
    process.cwd(),
    'src/server/engines/worldAndModelEditorEngine.ts'
  );
  const rootCoordinatorCandidate = path.resolve(
    process.cwd(),
    'src/server/engines/bridgeCoordinatorEngine.ts'
  );
  const enginesPath = fs.existsSync(rootEnginesCandidate)
    ? rootEnginesCandidate
    : path.resolve(process.cwd(), '../src/server/engines/worldAndModelEditorEngine.ts');
  const coordinatorPath = fs.existsSync(rootCoordinatorCandidate)
    ? rootCoordinatorCandidate
    : path.resolve(process.cwd(), '../src/server/engines/bridgeCoordinatorEngine.ts');
  if (!fs.existsSync(enginesPath) || !fs.existsSync(coordinatorPath)) {
    return;
  }

  process.env.FORGE_BRIDGE_SHARED_SECRET = SHARED_SECRET;
  const engines = await import('file:///' + enginesPath.replace(/\\/g, '/'));
  const { CloudBridgeCoordinator } = await import('file:///' + coordinatorPath.replace(/\\/g, '/'));
  const coordinator = new CloudBridgeCoordinator();

  // Estado en memoria de la biblioteca de assets en Cloud para la prueba integral
  const cloudAssetStore = new Map<string, any>();

  const cloudApp = express();
  cloudApp.use(express.json({ limit: '10mb' }));

  cloudApp.post('/api/v1/bridge/auth/handshake', (req, res) => {
    const token = String(req.headers['x-forge-token'] || '');
    const out = coordinator.handleHandshake(req.body || {}, token);
    if (!out.accepted) return res.status(401).json(out);
    return res.json(out);
  });

  cloudApp.post('/api/v1/bridge/heartbeat', (req, res) => {
    const auth = String(req.headers.authorization || '');
    const sess = String(req.headers['x-bridge-session'] || '');
    const tok = String(req.headers['x-forge-token'] || '');
    if (!coordinator.verifySessionRequest(auth, sess, tok)) {
      return res.status(401).json({ error: 'Sesión expirada' });
    }
    return res.json(coordinator.handleHeartbeat(req.body || {}));
  });

  cloudApp.post('/api/v1/bridge/task-ack', (req, res) => {
    const auth = String(req.headers.authorization || '');
    const sess = String(req.headers['x-bridge-session'] || '');
    const tok = String(req.headers['x-forge-token'] || '');
    if (!coordinator.verifySessionRequest(auth, sess, tok)) {
      return res.status(401).json({ error: 'Sesión expirada' });
    }
    return res.json({ acked: coordinator.handleTaskAck(String(req.body?.taskId || '')) });
  });

  cloudApp.post('/api/v1/bridge/task-result', (req, res) => {
    const auth = String(req.headers.authorization || '');
    const sess = String(req.headers['x-bridge-session'] || '');
    const tok = String(req.headers['x-forge-token'] || '');
    if (!coordinator.verifySessionRequest(auth, sess, tok)) {
      return res.status(401).json({ error: 'Sesión expirada' });
    }
    return res.json({ accepted: coordinator.handleTaskResult(req.body) });
  });

  // Endpoint real de comparación geométrica 4-dominios en Cloud
  cloudApp.post('/api/v1/assets/compare-datamodel', (req, res) => {
    const modelName = String(req.body.model_name || '');
    const existing = cloudAssetStore.get(modelName);
    const diff = engines.computeDataModelSyncDiffServer(
      existing ? existing.parts : [],
      req.body.parts || [],
      {
        baseParts: existing ? existing.parts : undefined,
        syncScope: 'full_model',
        modelName,
      }
    );
    res.json({
      found_in_forge: Boolean(existing),
      model_name: modelName,
      version: existing?.version || 1,
      diff,
    });
  });

  // Endpoint real de Push Incremental Studio -> Cloud -> Rojo
  cloudApp.post('/api/v1/assets/studio-push', (req, res) => {
    const modelName = String(req.body.model_name || 'CyberTurret3D');
    const existing = cloudAssetStore.get(modelName);
    const incomingParts = Array.isArray(req.body.parts) ? req.body.parts : [];
    const normExisting = existing ? engines.normalizePartsWithSyncMetadata(existing.parts, modelName) : [];
    const normIncoming = engines.normalizePartsWithSyncMetadata(incomingParts, modelName);

    const syncDiff = engines.computeDataModelSyncDiffServer(normExisting, normIncoming, {
      baseParts: normExisting,
      syncScope: 'full_model',
      modelName,
    });

    const luauCode = engines.buildStrictLuauFromEditedParts(modelName, normIncoming, 'Hull');
    const rbxmxContent = engines.buildRbxmxFromPartsServer(
      modelName,
      normIncoming,
      'Hull',
      'Studio Synced Asset',
      luauCode
    );

    const updatedAsset = {
      id: existing?.id || 'asset_cyberturret_01',
      name: modelName,
      version: (existing?.version || 1) + (syncDiff.in_sync ? 0 : 1),
      rojo_target_folder: 'src/shared/Assets3D',
      parts: normIncoming,
      luau_code: luauCode,
    };
    cloudAssetStore.set(modelName, updatedAsset);

    res.json({
      success: true,
      status: 'synced',
      asset: updatedAsset,
      sync_diff: syncDiff,
      luau_code: luauCode,
      rbxmx_content: rbxmxContent,
    });
  });

  const cloudServer = await new Promise<http.Server>((resolve) => {
    const s = cloudApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  const cloudPort = (cloudServer.address() as any).port;

  const projectRoot = resolveTestRojoProjectRoot();
  const bridgePort = 48727;
  const bridge = createForgeLocalBridgeApp({
    port: bridgePort,
    rojoProjectPath: projectRoot,
    cloudUrl: `http://127.0.0.1:${cloudPort}`,
    sharedSecret: SHARED_SECRET,
    pluginLocalToken: PLUGIN_TOKEN,
    heartbeatIntervalMs: 400,
    autoConnectCloud: true,
  });

  await bridge.start();
  const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;

  const modelName = 'CyberTurretValidation3D';
  const relLuauPath = `src/shared/Assets3D/${modelName}.luau`;
  const relRbxmxPath = `src/shared/Assets3D/${modelName}.rbxmx`;
  const absLuauPath = path.join(projectRoot, relLuauPath);
  const absRbxmxPath = path.join(projectRoot, relRbxmxPath);

  try {
    // 1. Crear modelo de prueba con 3 piezas jerárquicas y geometría EditableMesh real (no primitivas)
    const tetraMesh = {
      vertices: [
        [0, 0, 0],
        [1.5, 0, 0],
        [0.75, 1.2, 0],
        [0.75, 0.4, 1.4],
      ],
      normals: [
        [0, 1, 0],
        [0, 1, 0],
        [0, 1, 0],
        [0, 1, 0],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [0.5, 1],
        [0.5, 0.5],
      ],
      faces: [
        [0, 1, 2],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3],
      ],
    };

    const rawParts = [
      {
        partId: 'fpart_BasePlatform',
        name: 'BasePlatform',
        parentName: 'Root',
        parentContainerClass: 'Model',
        hierarchyPath: 'Root/BasePlatform',
        shape: 'MeshPart',
        size: [6, 1, 6],
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        color: [71, 85, 105],
        material: 'Metal',
        roughness: 0.4,
        metalness: 0.7,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Hull',
        meshData: tetraMesh,
        pbrMaterial: {
          materialName: 'TurretArmorPBR',
          publicationStatus: 'local_saved', // Solo guardado en disco, sin rbxassetid:// en la nube
        },
      },
      {
        partId: 'fpart_TurretRing',
        name: 'TurretRing',
        parentName: 'Turret',
        parentContainerClass: 'Model',
        hierarchyPath: 'Root/Turret/TurretRing',
        shape: 'MeshPart',
        size: [4, 1.5, 4],
        position: [0, 1.75, 0],
        rotation: [0, 45, 0],
        color: [100, 116, 139],
        material: 'Metal',
        roughness: 0.35,
        metalness: 0.8,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Hull',
        meshData: tetraMesh,
      },
      {
        partId: 'fpart_PlasmaCannon',
        name: 'PlasmaCannon',
        parentName: 'Turret',
        parentContainerClass: 'Model',
        hierarchyPath: 'Root/Turret/PlasmaCannon',
        shape: 'MeshPart',
        size: [1.2, 1.2, 5],
        position: [0, 2.8, 2.0],
        rotation: [-10, 45, 0],
        color: [56, 189, 248],
        material: 'Neon',
        roughness: 0.2,
        metalness: 0.9,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Hull',
        meshData: tetraMesh,
      },
    ];

    const normalizedInitialParts = engines.normalizePartsWithSyncMetadata(rawParts, modelName);
    const initialLuau = engines.buildStrictLuauFromEditedParts(modelName, normalizedInitialParts, 'Hull');
    const initialRbxmx = engines.buildRbxmxFromPartsServer(
      modelName,
      normalizedInitialParts,
      'Hull',
      '3D Asset',
      initialLuau
    );

    // Verificar que EditableMesh se utiliza y NO se sustituye por Instance.new("Part")
    assert.ok(initialLuau.includes('CreateEditableMesh'), 'Debe construir geometría real con CreateEditableMesh');
    assert.ok(initialLuau.includes('CreateMeshPartAsync'), 'Debe instanciar MeshPart desde EditableMesh');
    assert.equal(initialLuau.includes('Instance.new("Part")'), false, 'No debe sustituir EditableMesh por primitivas Part');

    // Verificar que PBR sin rbxassetid:// publicados no se declara como aplicado en SurfaceAppearance
    const pbrBinderLocalOnly = engines.generatePBRSurfaceAppearanceLuau(
      'TurretArmorPBR',
      'src/shared/Assets3D/Textures',
      0.4,
      0.7,
      '#475569',
      {} // Sin IDs de nube publicados
    );
    assert.ok(
      pbrBinderLocalOnly.includes('Publication State: local_saved, Published Channels: 0/4'),
      'Debe declarar explícitamente local_saved (0/4 canales publicados) cuando solo se guardaron archivos locales'
    );
    assert.ok(pbrBinderLocalOnly.includes('ColorMap = nil'));
    assert.equal(
      /rbxassetid:\/\/[1-9]\d*/.test(pbrBinderLocalOnly),
      false,
      'No debe inventar rbxassetid://<digitos> cuando solo se guardaron archivos locales'
    );

    cloudAssetStore.set(modelName, {
      id: 'asset_cyberturret_01',
      name: modelName,
      version: 1,
      rojo_target_folder: 'src/shared/Assets3D',
      parts: normalizedInitialParts,
      luau_code: initialLuau,
    });

    // 2. Paso Forge -> Cloud -> Bridge local -> Rojo (escritura atómica del paquete 3D)
    const writePkgPromise = coordinator.enqueueTask(
      'rojo.write_package',
      {
        files: [
          { relativePath: relLuauPath, content: initialLuau, encoding: 'utf-8' },
          { relativePath: relRbxmxPath, content: initialRbxmx, encoding: 'utf-8' },
        ],
      },
      true,
      5000
    );
    await bridge.cloudClient.sendHeartbeatAndPollTasks();
    const writePkgRes = await writePkgPromise;
    assert.equal(writePkgRes.status, 'completed');
    assert.equal(fs.existsSync(absLuauPath), true);
    assert.equal(fs.existsSync(absRbxmxPath), true);

    // 3. Paso Cloud -> Bridge local -> Roblox Studio (`studio.apply_modifications`)
    const applyStudioPromise = coordinator.enqueueTask(
      'studio.apply_modifications',
      {
        modelName,
        asset: cloudAssetStore.get(modelName),
      },
      true,
      5000
    );
    await bridge.cloudClient.sendHeartbeatAndPollTasks();
    await new Promise((r) => setTimeout(r, 60));

    const pollStudioRes = await fetch(`${bridgeBaseUrl}/local/plugin/poll`, {
      headers: { 'X-Plugin-Token': PLUGIN_TOKEN },
    });
    const pollStudioData = (await pollStudioRes.json()) as any;
    assert.equal(pollStudioData.pendingTasks.length, 1);
    assert.equal(pollStudioData.pendingTasks[0].operation, 'studio.apply_modifications');
    const studioReceivedParts = pollStudioData.pendingTasks[0].payload.asset.parts;
    assert.equal(studioReceivedParts.length, 3);

    await fetch(`${bridgeBaseUrl}/local/plugin/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify({
        taskId: pollStudioData.pendingTasks[0].taskId,
        status: 'completed',
        result: {
          modelName,
          mode: 'spawned_new',
          partCount: 3,
        },
      }),
    });

    const applyStudioDone = await applyStudioPromise;
    assert.equal(applyStudioDone.status, 'completed');

    // 4. Modificar UNA SOLA pieza (`fpart_PlasmaCannon`) en Studio y enviar Studio -> Bridge -> Cloud -> Forge
    const studioModifiedParts = JSON.parse(JSON.stringify(studioReceivedParts));
    studioModifiedParts[2].position = [0, 3.4, 2.5];
    studioModifiedParts[2].color = [244, 63, 94];

    const push1Res = await fetch(`${bridgeBaseUrl}/local/plugin/studio-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify({
        model_name: modelName,
        parts: studioModifiedParts,
        sync_scope: 'full_model',
      }),
    });
    assert.equal(push1Res.status, 200);
    const push1Data = (await push1Res.json()) as any;
    assert.equal(push1Data.success, true);
    assert.equal(
      push1Data.sync_diff.modified_parts.length,
      1,
      'Solo debe detectarse 1 pieza modificada (PlasmaCannon)'
    );
    assert.equal(push1Data.sync_diff.modified_parts[0].partId, 'fpart_PlasmaCannon');
    assert.equal(
      push1Data.sync_diff.unchanged_count,
      2,
      'Las otras 2 piezas (BasePlatform y TurretRing) deben permanecer intactas'
    );

    // Comprobar que las piezas no modificadas conservan exactamente sus hashes e identificadores
    const afterPush1Parts = push1Data.asset.parts;
    assert.equal(afterPush1Parts[0].partId, 'fpart_BasePlatform');
    assert.equal(afterPush1Parts[0].combinedHash, normalizedInitialParts[0].combinedHash);
    assert.equal(afterPush1Parts[1].partId, 'fpart_TurretRing');
    assert.equal(afterPush1Parts[1].combinedHash, normalizedInitialParts[1].combinedHash);
    assert.equal(afterPush1Parts[2].meshData.vertices.length, 4, 'EditableMesh debe conservar sus vértices');
    assert.equal(afterPush1Parts[2].meshData.faces.length, 4, 'EditableMesh debe conservar sus triángulos');

    // 5. Ejecutar una SEGUNDA sincronización sin cambios y comprobar que NO se generan modificaciones falsas
    const push2Res = await fetch(`${bridgeBaseUrl}/local/plugin/studio-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify({
        model_name: modelName,
        parts: afterPush1Parts,
        sync_scope: 'full_model',
      }),
    });
    assert.equal(push2Res.status, 200);
    const push2Data = (await push2Res.json()) as any;
    assert.equal(push2Data.sync_diff.in_sync, true, 'La segunda sincronización sin cambios debe reportar in_sync=true');
    assert.equal(
      push2Data.sync_diff.modified_parts.length,
      0,
      'No deben generarse modificaciones falsas en la segunda sincronización'
    );
    assert.equal(push2Data.sync_diff.unchanged_count, 3);
  } finally {
    if (fs.existsSync(absLuauPath)) fs.unlinkSync(absLuauPath);
    if (fs.existsSync(absRbxmxPath)) fs.unlinkSync(absRbxmxPath);
    bridge.rojoManager.captureBaselineSnapshot();
    await bridge.stop();
    await new Promise<void>((resolve) => cloudServer.close(() => resolve()));
  }
});

test('Fase 2 & 5 — Propagación E2E de estados awaiting_studio_confirmation, partially_applied y confirmación destructiva diferida (Plugin -> Bridge -> Cloud)', async () => {
  const rootCoordinatorCandidate = path.resolve(
    process.cwd(),
    'src/server/engines/bridgeCoordinatorEngine.ts'
  );
  const coordinatorPath = fs.existsSync(rootCoordinatorCandidate)
    ? rootCoordinatorCandidate
    : path.resolve(process.cwd(), '../src/server/engines/bridgeCoordinatorEngine.ts');
  if (!fs.existsSync(coordinatorPath)) {
    return;
  }

  process.env.FORGE_BRIDGE_SHARED_SECRET = SHARED_SECRET;
  const { CloudBridgeCoordinator } = await import('file:///' + coordinatorPath.replace(/\\/g, '/'));
  const coordinator = new CloudBridgeCoordinator();

  const cloudApp = express();
  cloudApp.use(express.json());

  cloudApp.post('/api/v1/bridge/auth/handshake', (req, res) => {
    const token = String(req.headers['x-forge-token'] || '');
    const out = coordinator.handleHandshake(req.body || {}, token);
    if (!out.accepted) return res.status(401).json(out);
    return res.json(out);
  });

  cloudApp.post('/api/v1/bridge/heartbeat', (req, res) => {
    const auth = String(req.headers.authorization || '');
    const sess = String(req.headers['x-bridge-session'] || '');
    const tok = String(req.headers['x-forge-token'] || '');
    if (!coordinator.verifySessionRequest(auth, sess, tok)) {
      return res.status(401).json({ error: 'Sesión expirada' });
    }
    return res.json(coordinator.handleHeartbeat(req.body || {}));
  });

  cloudApp.post('/api/v1/bridge/task-ack', (req, res) => {
    return res.json({ acked: coordinator.handleTaskAck(String(req.body?.taskId || '')) });
  });

  cloudApp.post('/api/v1/bridge/task-result', (req, res) => {
    return res.json({ accepted: coordinator.handleTaskResult(req.body) });
  });

  cloudApp.get('/api/v1/bridge/task/:taskId', (req, res) => {
    const found = coordinator.getTaskResult(req.params.taskId);
    if (!found) return res.status(404).json({ error: 'Not found' });
    return res.json(found);
  });

  const cloudServer = await new Promise<http.Server>((resolve) => {
    const s = cloudApp.listen(0, '127.0.0.1', () => resolve(s));
  });
  const cloudPort = (cloudServer.address() as any).port;

  const projectRoot = resolveTestRojoProjectRoot();
  const bridgePort = 48728;
  const bridge = createForgeLocalBridgeApp({
    port: bridgePort,
    rojoProjectPath: projectRoot,
    cloudUrl: `http://127.0.0.1:${cloudPort}`,
    sharedSecret: SHARED_SECRET,
    pluginLocalToken: PLUGIN_TOKEN,
    heartbeatIntervalMs: 400,
    autoConnectCloud: true,
  });

  await bridge.start();
  const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;

  try {
    // 1. Encolar operación con eliminación destructiva hacia Studio
    const enqueuePromise = coordinator.enqueueTask(
      'studio.reconstruct_model',
      {
        name: 'DestructiveCheckModel',
        expected_part_count: 1,
        model_hash: 'hash_after_delete_111',
      },
      true,
      5000
    );

    await bridge.cloudClient.sendHeartbeatAndPollTasks();
    await new Promise((r) => setTimeout(r, 60));

    const pollRes = await fetch(`${bridgeBaseUrl}/local/plugin/poll`, {
      headers: { 'X-Plugin-Token': PLUGIN_TOKEN },
    });
    const pollData = (await pollRes.json()) as any;
    assert.equal(pollData.pendingTasks.length, 1);
    const taskId = pollData.pendingTasks[0].taskId;

    // 2. El plugin de Roblox Studio responde inicialmente awaiting_studio_confirmation (porque hay piezas pendientes de confirmación destructiva)
    const initialPluginRes = await fetch(`${bridgeBaseUrl}/local/plugin/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify({
        taskId,
        status: 'awaiting_studio_confirmation',
        result: {
          operationId: taskId,
          taskId,
          status: 'awaiting_confirmation',
          verified: false,
          modelName: 'DestructiveCheckModel',
          expectedModelHash: 'hash_after_delete_111',
          appliedModelHash: 'hash_before_delete_222',
          expectedPartCount: 1,
          actualPartCount: 2,
          pendingDeletionPartIds: ['part_to_delete_01'],
          failedPartIds: [],
          verifiedGeometryPartIds: ['part_kept_01'],
        },
      }),
    });
    assert.equal(initialPluginRes.status, 200);

    const initialCoordinatorOut = await enqueuePromise;
    assert.ok(
      initialCoordinatorOut.status === 'awaiting_confirmation' ||
        initialCoordinatorOut.status === 'awaiting_studio_confirmation',
      'El puente y el coordinador deben preservar awaiting_confirmation / awaiting_studio_confirmation y NO convertirlo en completed'
    );
    assert.deepEqual(initialCoordinatorOut.result.pendingDeletionPartIds, ['part_to_delete_01']);

    // 3. Posteriormente el usuario confirma la eliminación en Roblox Studio y el plugin envía el recibo final completed para el MISMO taskId
    const followUpPluginRes = await fetch(`${bridgeBaseUrl}/local/plugin/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': PLUGIN_TOKEN,
      },
      body: JSON.stringify({
        taskId,
        status: 'completed',
        result: {
          operationId: taskId,
          taskId,
          status: 'completed',
          verified: true,
          modelName: 'DestructiveCheckModel',
          expectedModelHash: 'hash_after_delete_111',
          appliedModelHash: 'hash_after_delete_111',
          expectedPartCount: 1,
          actualPartCount: 1,
          removedPartIds: ['part_to_delete_01'],
          pendingDeletionPartIds: [],
          failedPartIds: [],
          verifiedGeometryPartIds: ['part_kept_01'],
        },
      }),
    });
    assert.equal(followUpPluginRes.status, 200);
    const followUpJson = (await followUpPluginRes.json()) as any;
    assert.equal(followUpJson.accepted, true, 'El puente local debe aceptar la actualización post-confirmación del mismo taskId');

    // Esperar propagación a Cloud
    await new Promise((r) => setTimeout(r, 80));

    // 4. Consultar GET /api/v1/bridge/task/:taskId en Cloud y comprobar que el recibo se actualizó a completed con verified=true
    const taskQueryRes = await fetch(`http://127.0.0.1:${cloudPort}/api/v1/bridge/task/${encodeURIComponent(taskId)}`);
    assert.equal(taskQueryRes.status, 200);
    const updatedTaskRecord = (await taskQueryRes.json()) as any;
    assert.equal(updatedTaskRecord.status, 'completed');
    assert.equal(updatedTaskRecord.result.verified, true);
    assert.equal(updatedTaskRecord.result.appliedModelHash, 'hash_after_delete_111');
    assert.deepEqual(updatedTaskRecord.result.removedPartIds, ['part_to_delete_01']);
  } finally {
    await bridge.stop();
    await new Promise<void>((resolve) => cloudServer.close(() => resolve()));
  }
});

test('Fase 3 & 4 — Confirmaciones destructivas simultáneas, respuestas duplicadas/tardías/cruzadas y recuperación tras reinicio con TaskStateStoreAdapter', async () => {
  const tmpStateFile = path.join(os.tmpdir(), `forge_task_state_test_${Date.now()}.json`);
  const fileAdapter = new JsonFileTaskStateStoreAdapter(tmpStateFile);

  const buildStudioEnvelope = (taskId: string, modelName: string, modelHash: string): BridgeMessageEnvelope => ({
    protocolVersion: BRIDGE_PROTOCOL_VERSION,
    taskId,
    sessionId: 'sess_sim_test',
    correlationId: `corr_${taskId}`,
    operation: 'studio.apply_modifications',
    payload: {
      name: modelName,
      expected_part_count: 1,
      model_hash: modelHash,
    },
    timestamp: new Date().toISOString(),
  });

  try {
    // 1. Iniciar primer coordinador con persistencia en archivo JSON
    const coord1 = new TaskExecutionCoordinator({
      stateStore: fileAdapter,
      confirmationExpirationMs: 5000,
    });

    const taskAId = 'task_sim_del_A';
    const taskBId = 'task_sim_del_B';

    // Encolar dos operaciones destructivas simultáneas (Task A y Task B)
    const pTaskA = coord1.enqueueForStudioPlugin(
      buildStudioEnvelope(taskAId, 'SimultaneousModelA', 'hash_A_final'),
      'secret_sim_test',
      4000
    );

    const pTaskB = coord1.enqueueForStudioPlugin(
      buildStudioEnvelope(taskBId, 'SimultaneousModelB', 'hash_B_final'),
      'secret_sim_test',
      4000
    );

    const dispatched = coord1.dequeueNextForStudioPlugin();
    assert.equal(dispatched.length, 2, 'Deben despacharse las 2 tareas simultáneas');

    // Ambas responden inicialmente awaiting_studio_confirmation con sus respectivos partIdsToDelete
    const initA = coord1.submitStudioPluginResult({
      taskId: taskAId,
      status: 'awaiting_studio_confirmation',
      result: {
        taskId: taskAId,
        operationId: taskAId,
        status: 'awaiting_confirmation',
        verified: false,
        modelName: 'SimultaneousModelA',
        expectedPartCount: 1,
        actualPartCount: 2,
        expectedModelHash: 'hash_A_final',
        appliedModelHash: 'hash_A_pre',
        verifiedGeometryPartIds: ['part_A_keep'],
        failedPartIds: [],
        pendingDeletionPartIds: ['part_A_del_1'],
      },
    });
    assert.equal(initA, true);

    const initB = coord1.submitStudioPluginResult({
      taskId: taskBId,
      status: 'awaiting_studio_confirmation',
      result: {
        taskId: taskBId,
        operationId: taskBId,
        status: 'awaiting_confirmation',
        verified: false,
        modelName: 'SimultaneousModelB',
        expectedPartCount: 1,
        actualPartCount: 2,
        expectedModelHash: 'hash_B_final',
        appliedModelHash: 'hash_B_pre',
        verifiedGeometryPartIds: ['part_B_keep'],
        failedPartIds: [],
        pendingDeletionPartIds: ['part_B_del_1'],
      },
    });
    assert.equal(initB, true);

    const resInitialA = await pTaskA;
    const resInitialB = await pTaskB;
    assert.equal(resInitialA.status, 'awaiting_studio_confirmation');
    assert.equal(resInitialB.status, 'awaiting_studio_confirmation');
    assert.equal(coord1.getAllAwaitingConfirmations().length, 2);

    // 2. Simular desconexión y REINICIO del coordinador/Bridge cargando el estado desde JsonFileTaskStateStoreAdapter
    coord1.shutdown();
    const coordAfterRestart = new TaskExecutionCoordinator({
      stateStore: new JsonFileTaskStateStoreAdapter(tmpStateFile),
      confirmationExpirationMs: 5000,
    });

    const recoveredPending = coordAfterRestart.getAllAwaitingConfirmations();
    assert.equal(recoveredPending.length, 2, 'Tras reiniciar, debe recuperar las 2 confirmaciones pendientes del store');

    // 3. Intentar enviar una respuesta con operationId o modelName perteneciente a OTRA tarea -> debe ser RECHAZADA
    const crossTaskAttempt = coordAfterRestart.submitStudioPluginResult({
      taskId: taskAId,
      status: 'completed',
      result: {
        taskId: taskAId,
        operationId: taskBId, // operationId cruzado de la Tarea B
        status: 'completed',
        verified: true,
        modelName: 'SimultaneousModelA',
        expectedPartCount: 1,
        actualPartCount: 1,
        expectedModelHash: 'hash_A_final',
        appliedModelHash: 'hash_A_final',
        verifiedGeometryPartIds: ['part_A_keep'],
        failedPartIds: [],
        pendingDeletionPartIds: [],
        removedPartIds: ['part_A_del_1'],
      },
    });
    assert.equal(crossTaskAttempt, false, 'Debe rechazar una respuesta cuyo operationId pertenece a otra tarea');

    // Intentar eliminar una pieza que NO estaba autorizada en partIdsToDelete -> debe ser RECHAZADA
    const unauthorizedPartDeleteAttempt = coordAfterRestart.submitStudioPluginResult({
      taskId: taskAId,
      status: 'completed',
      result: {
        taskId: taskAId,
        operationId: taskAId,
        status: 'completed',
        verified: true,
        modelName: 'SimultaneousModelA',
        expectedPartCount: 1,
        actualPartCount: 1,
        expectedModelHash: 'hash_A_final',
        appliedModelHash: 'hash_A_final',
        verifiedGeometryPartIds: ['part_A_keep'],
        failedPartIds: [],
        pendingDeletionPartIds: [],
        removedPartIds: ['part_UNEXPECTED_999'],
      },
    });
    assert.equal(
      unauthorizedPartDeleteAttempt,
      false,
      'Debe rechazar una confirmación cuyas piezas eliminadas no coinciden exactamente con partIdsToDelete'
    );

    // 4. Confirmar la primera tarea (Task A) -> ACEPTADA
    const confirmA = coordAfterRestart.submitStudioPluginResult({
      taskId: taskAId,
      status: 'completed',
      result: {
        taskId: taskAId,
        operationId: taskAId,
        status: 'completed',
        verified: true,
        modelName: 'SimultaneousModelA',
        expectedPartCount: 1,
        actualPartCount: 1,
        expectedModelHash: 'hash_A_final',
        appliedModelHash: 'hash_A_final',
        verifiedGeometryPartIds: ['part_A_keep'],
        failedPartIds: [],
        pendingDeletionPartIds: [],
        removedPartIds: ['part_A_del_1'],
      },
    });
    assert.equal(confirmA, true, 'Debe aceptar la confirmación legítima de la primera tarea (Task A)');
    assert.equal(coordAfterRestart.getCompletedTaskResult(taskAId)?.status, 'completed');

    // 5. Enviar respuesta DUPLICADA para Task A -> RECHAZADA
    const duplicateConfirmA = coordAfterRestart.submitStudioPluginResult({
      taskId: taskAId,
      status: 'completed',
      result: {
        taskId: taskAId,
        operationId: taskAId,
        status: 'completed',
        verified: true,
        modelName: 'SimultaneousModelA',
        expectedPartCount: 1,
        actualPartCount: 1,
        expectedModelHash: 'hash_A_final',
        appliedModelHash: 'hash_A_final',
        verifiedGeometryPartIds: ['part_A_keep'],
        failedPartIds: [],
        pendingDeletionPartIds: [],
        removedPartIds: ['part_A_del_1'],
      },
    });
    assert.equal(duplicateConfirmA, false, 'Debe rechazar una confirmación duplicada para Task A');

    // 6. Cancelar la segunda tarea (Task B) -> ACEPTADA como partially_applied
    const cancelB = coordAfterRestart.submitStudioPluginResult({
      taskId: taskBId,
      status: 'partially_applied',
      result: {
        taskId: taskBId,
        operationId: taskBId,
        status: 'partially_applied',
        verified: false,
        modelName: 'SimultaneousModelB',
        expectedPartCount: 1,
        actualPartCount: 2,
        expectedModelHash: 'hash_B_final',
        appliedModelHash: 'hash_B_pre',
        verifiedGeometryPartIds: ['part_B_keep'],
        failedPartIds: ['part_B_del_1'],
        pendingDeletionPartIds: [],
        removedPartIds: [],
        errors: ['Eliminación destructiva cancelada por el usuario'],
      },
    });
    assert.equal(cancelB, true, 'Debe aceptar la cancelación de la segunda tarea (Task B)');
    assert.equal(coordAfterRestart.getCompletedTaskResult(taskBId)?.status, 'partially_applied');

    // 7. Intentar confirmar la segunda tarea (Task B) DESPUÉS de haberla cancelado -> RECHAZADA
    const confirmBAfterCancel = coordAfterRestart.submitStudioPluginResult({
      taskId: taskBId,
      status: 'completed',
      result: {
        taskId: taskBId,
        operationId: taskBId,
        status: 'completed',
        verified: true,
        modelName: 'SimultaneousModelB',
        expectedPartCount: 1,
        actualPartCount: 1,
        expectedModelHash: 'hash_B_final',
        appliedModelHash: 'hash_B_final',
        verifiedGeometryPartIds: ['part_B_keep'],
        failedPartIds: [],
        pendingDeletionPartIds: [],
        removedPartIds: ['part_B_del_1'],
      },
    });
    assert.equal(
      confirmBAfterCancel,
      false,
      'Debe rechazar cualquier intento de confirmar Task B después de haber sido cancelada'
    );

    // 8. Verificar expiración de confirmaciones tardías (confirmationExpirationMs corto) y registro de historial
    const memAdapter = new InMemoryTaskStateStoreAdapter();
    const coordShortExpiry = new TaskExecutionCoordinator({
      stateStore: memAdapter,
      confirmationExpirationMs: 50, // 50ms (will clamp to min 500ms or check directly)
    });

    const taskCId = 'task_sim_exp_C';
    const pTaskC = coordShortExpiry.enqueueForStudioPlugin(
      buildStudioEnvelope(taskCId, 'ExpiringModelC', 'hash_C_final'),
      'secret_exp_test',
      2000
    );
    coordShortExpiry.dequeueNextForStudioPlugin();

    coordShortExpiry.submitStudioPluginResult({
      taskId: taskCId,
      status: 'awaiting_studio_confirmation',
      result: {
        taskId: taskCId,
        operationId: taskCId,
        status: 'awaiting_confirmation',
        verified: false,
        modelName: 'ExpiringModelC',
        expectedPartCount: 1,
        actualPartCount: 2,
        expectedModelHash: 'hash_C_final',
        appliedModelHash: 'hash_C_pre',
        verifiedGeometryPartIds: ['part_C_keep'],
        failedPartIds: [],
        pendingDeletionPartIds: ['part_C_del'],
      },
    });
    await pTaskC;

    // Esperar a que expire el plazo de confirmación (>500ms)
    await new Promise((r) => setTimeout(r, 550));

    const lateConfirmC = coordShortExpiry.submitStudioPluginResult({
      taskId: taskCId,
      status: 'completed',
      result: {
        taskId: taskCId,
        operationId: taskCId,
        status: 'completed',
        verified: true,
        modelName: 'ExpiringModelC',
        expectedPartCount: 1,
        actualPartCount: 1,
        expectedModelHash: 'hash_C_final',
        appliedModelHash: 'hash_C_final',
        verifiedGeometryPartIds: ['part_C_keep'],
        failedPartIds: [],
        pendingDeletionPartIds: [],
        removedPartIds: ['part_C_del'],
      },
    });
    assert.equal(lateConfirmC, false, 'Debe rechazar una confirmación tardía cuya ventana expiresAt ya venció');
    assert.equal(coordShortExpiry.getAwaitingConfirmationRecord(taskCId)?.status, 'expired');

    // Verificar que el historial de resultados se mantiene en el TaskStateStoreAdapter
    assert.ok(coordAfterRestart.getTaskResultHistory().length >= 4, 'El coordinador debe conservar el historial de transiciones');
  } finally {
    if (fs.existsSync(tmpStateFile)) {
      fs.unlinkSync(tmpStateFile);
    }
  }
});

test('Etapa 2 — Seguridad Completa de Forge Local Bridge: arranque sin token, 401/200 rutas protegidas, anti-replay, HMAC inválido, expiración de sesión y reconexión', async () => {
  const projectRoot = resolveTestRojoProjectRoot();
  const prevNodeEnv = process.env.NODE_ENV;
  const prevPluginTok = process.env.FORGE_PLUGIN_LOCAL_TOKEN;
  const prevLocalTok = process.env.FORGE_LOCAL_TOKEN;
  const prevSharedSecret = process.env.FORGE_BRIDGE_SHARED_SECRET;

  delete process.env.FORGE_PLUGIN_LOCAL_TOKEN;
  delete process.env.FORGE_LOCAL_TOKEN;
  delete process.env.FORGE_BRIDGE_SHARED_SECRET;

  try {
    // 1. Iniciar sin token o secreto -> rechazo seguro antes de escuchar
    assert.throws(
      () =>
        createForgeLocalBridgeApp({
          port: 48731,
          rojoProjectPath: projectRoot,
          pluginLocalToken: '',
          sharedSecret: SHARED_SECRET,
          autoConnectCloud: false,
        }),
      /FORGE_PLUGIN_LOCAL_TOKEN|pluginLocalToken/i
    );

    assert.throws(
      () =>
        createForgeLocalBridgeApp({
          port: 48732,
          rojoProjectPath: projectRoot,
          pluginLocalToken: PLUGIN_TOKEN,
          sharedSecret: '',
          autoConnectCloud: false,
        }),
      /FORGE_BRIDGE_SHARED_SECRET|sharedSecret/i
    );

    // En producción rechaza secretos de ejemplo
    process.env.NODE_ENV = 'production';
    assert.throws(
      () =>
        createForgeLocalBridgeApp({
          port: 48733,
          rojoProjectPath: projectRoot,
          pluginLocalToken: 'forge-local-dev-token-2026',
          sharedSecret: SHARED_SECRET,
          autoConnectCloud: false,
        }),
      /ejemplo|Producción/i
    );
    process.env.NODE_ENV = prevNodeEnv || 'test';

    // Servidor Cloud simulado con expiración corta y seguimiento de sesiones
    const cloudApp = express();
    cloudApp.use(express.json());
    let sessionSeq = 0;
    let currentSessionId = '';
    let currentSessionToken = '';
    let currentExpiresAt = 0;
    let rejectNextHeartbeat = false;

    cloudApp.post('/api/v1/bridge/auth/handshake', (_req, res) => {
      sessionSeq += 1;
      currentSessionId = `sess_sec_${sessionSeq}`;
      currentSessionToken = `tok_sec_${sessionSeq}`;
      currentExpiresAt = Date.now() + 30_000;
      res.json({
        accepted: true,
        sessionId: currentSessionId,
        sessionToken: currentSessionToken,
        expiresAt: currentExpiresAt,
        wsSupported: false,
      });
    });

    cloudApp.post('/api/v1/bridge/heartbeat', (req, res) => {
      const auth = req.headers.authorization || '';
      if (rejectNextHeartbeat || Date.now() > currentExpiresAt || auth !== `Bearer ${currentSessionToken}`) {
        rejectNextHeartbeat = false;
        return res.status(401).json({ error: 'Sesión expirada' });
      }
      res.json({ pendingTasks: [] });
    });

    cloudApp.post('/api/v1/bridge/task-ack', (_req, res) => res.json({ acked: true }));
    cloudApp.post('/api/v1/bridge/task-result', (_req, res) => res.json({ accepted: true }));

    const cloudServer = await new Promise<http.Server>((resolve) => {
      const s = cloudApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const cloudPort = (cloudServer.address() as any).port;
    const bridgePort = 48734;
    const testStateFile = path.join(os.tmpdir(), `forge_sec_e2e_${Date.now()}.json`);

    const bridge = createForgeLocalBridgeApp({
      port: bridgePort,
      rojoProjectPath: projectRoot,
      cloudUrl: `http://127.0.0.1:${cloudPort}`,
      sharedSecret: SHARED_SECRET,
      pluginLocalToken: PLUGIN_TOKEN,
      heartbeatIntervalMs: 1200,
      autoConnectCloud: true,
      stateFilePath: testStateFile,
    });
    await bridge.start();
    const baseUrl = `http://127.0.0.1:${bridgePort}`;

    try {
      // 2. Petición a ruta protegida (/local/status y /local/plugin/poll) sin token -> 401
      const statusNoAuth = await fetch(`${baseUrl}/local/status`);
      assert.equal(statusNoAuth.status, 401);
      const pollNoAuth = await fetch(`${baseUrl}/local/plugin/poll`);
      assert.equal(pollNoAuth.status, 401);

      // 3. Petición con token incorrecto -> 401
      const wrongTokenRes = await fetch(`${baseUrl}/local/status`, {
        headers: { 'X-Plugin-Token': 'wrong-token-value-123' },
      });
      assert.equal(wrongTokenRes.status, 401);

      // 4. Petición con token correcto -> 200
      const okRes = await fetch(`${baseUrl}/local/status`, {
        headers: { 'X-Plugin-Token': PLUGIN_TOKEN },
      });
      assert.equal(okRes.status, 200);

      // 5. Reenvío de mensaje firmado ya usado -> rechazado
      const signedEnvelope: BridgeMessageEnvelope = {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        taskId: 'task_sec_replay_01',
        sessionId: currentSessionId,
        operation: 'rojo.status',
        payload: {},
        timestamp: new Date().toISOString(),
        correlationId: 'corr_sec_replay_01',
      };
      signedEnvelope.signature = computeEnvelopeHmac(signedEnvelope, SHARED_SECRET);

      const firstExec = await fetch(`${baseUrl}/local/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Plugin-Token': PLUGIN_TOKEN,
        },
        body: JSON.stringify(signedEnvelope),
      });
      assert.equal(firstExec.status, 200);
      const firstBody = (await firstExec.json()) as any;
      assert.equal(firstBody.status, 'completed');

      const replayExec = await fetch(`${baseUrl}/local/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Plugin-Token': PLUGIN_TOKEN,
        },
        body: JSON.stringify(signedEnvelope),
      });
      assert.equal(replayExec.status, 409);
      const replayBody = (await replayExec.json()) as any;
      assert.equal(replayBody.status, 'rejected_duplicate');

      // 6. Firma HMAC inválida -> rechazado (400 en HTTP y failed en cloudClient)
      const forgedEnvelope: BridgeMessageEnvelope = {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        taskId: 'task_sec_forged_02',
        sessionId: currentSessionId,
        operation: 'rojo.status',
        payload: {},
        timestamp: new Date().toISOString(),
        correlationId: 'corr_sec_forged_02',
        signature: 'deadbeef'.repeat(8),
      };
      const forgedRes = await fetch(`${baseUrl}/local/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Plugin-Token': PLUGIN_TOKEN,
        },
        body: JSON.stringify(forgedEnvelope),
      });
      assert.equal(forgedRes.status, 400);
      const forgedBody = (await forgedRes.json()) as any;
      assert.equal(forgedBody.status, 'failed');
      assert.match(String(forgedBody.error), /HMAC/i);

      // También verifyEnvelopeHmac con secreto vacío falla cerrado
      const emptySecretCheck = validateBridgeMessageEnvelope(signedEnvelope, {
        sharedSecret: '',
      });
      assert.equal(emptySecretCheck.valid, false);

      // 7. Sesión expirada -> rechazada por cloud y renovada automáticamente en el ciclo de heartbeat
      const sessionBeforeExpiry = currentSessionId;
      currentExpiresAt = Date.now() - 1000;
      await bridge.cloudClient.sendHeartbeatAndPollTasks();
      assert.notEqual(currentSessionId, sessionBeforeExpiry);
      assert.equal(bridge.cloudClient.getStatus().connected, true);

      // 8. Reconexión explícita tras desconexión -> estado consistente
      const sessionBeforeReconnect = currentSessionId;
      const reconnectRes = await fetch(`${baseUrl}/local/reconnect`, {
        method: 'POST',
        headers: { 'X-Plugin-Token': PLUGIN_TOKEN },
      });
      assert.equal(reconnectRes.status, 200);
      const reconnectBody = (await reconnectRes.json()) as any;
      assert.equal(reconnectBody.reconnected, true);
      assert.notEqual(reconnectBody.cloudConnection.sessionId, sessionBeforeReconnect);
      assert.equal(reconnectBody.cloudConnection.connected, true);
    } finally {
      await bridge.stop();
      await new Promise<void>((resolve) => cloudServer.close(() => resolve()));
      if (fs.existsSync(testStateFile)) {
        fs.unlinkSync(testStateFile);
      }
    }
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevPluginTok === undefined) delete process.env.FORGE_PLUGIN_LOCAL_TOKEN;
    else process.env.FORGE_PLUGIN_LOCAL_TOKEN = prevPluginTok;
    if (prevLocalTok === undefined) delete process.env.FORGE_LOCAL_TOKEN;
    else process.env.FORGE_LOCAL_TOKEN = prevLocalTok;
    if (prevSharedSecret === undefined) delete process.env.FORGE_BRIDGE_SHARED_SECRET;
    else process.env.FORGE_BRIDGE_SHARED_SECRET = prevSharedSecret;
  }
});

test('Etapa 8 — Persistencia atómica (tmp+rename), detección de corrupción JSON y recuperación tras reinicio real del proceso OS', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-etapa8-bridge-'));
  const statePath = path.join(tmpDir, 'bridge-state.json');

  try {
    // 1. Validar escritura atómica ante fallo inyectado: NO destruye último estado válido ni deja temporales
    const adapter = new JsonFileTaskStateStoreAdapter(statePath);
    const coord = new TaskExecutionCoordinator({ stateStore: adapter, confirmationExpirationMs: 30000 });
    const envOk: BridgeMessageEnvelope = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      taskId: 'task_atomic_seed_01',
      sessionId: 'sess_atomic',
      operation: 'rojo.status',
      payload: {},
      timestamp: new Date().toISOString(),
      correlationId: 'corr_atomic_01',
    };
    const okRes = await coord.executeDeduplicated(envOk, async () => ({ healthy: true }));
    assert.equal(okRes.status, 'completed');
    const validRawBeforeFailure = fs.readFileSync(statePath, 'utf-8');

    adapter.setBeforeRenameHook(() => {
      throw new Error('EIO simulated disk failure before rename');
    });
    const envFail: BridgeMessageEnvelope = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      taskId: 'task_atomic_fail_02',
      sessionId: 'sess_atomic',
      operation: 'rojo.status',
      payload: {},
      timestamp: new Date().toISOString(),
      correlationId: 'corr_atomic_02',
    };
    await assert.rejects(
      () => coord.executeDeduplicated(envFail, async () => ({ healthy: true })),
      /Fallo al persistir estado/i
    );
    adapter.setBeforeRenameHook(undefined);

    assert.equal(
      fs.readFileSync(statePath, 'utf-8'),
      validRawBeforeFailure,
      'Un fallo antes de rename debe preservar íntegro el último estado válido en disco'
    );
    assert.equal(
      fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp')).length,
      0,
      'No deben quedar archivos .tmp huérfanos tras error de escritura'
    );
    assert.ok(coord.getPersistenceDiagnostics().saveErrorCount >= 1);

    // 2. Corrupción total de JSON y registros incompletos -> rechazo sin marcar como recuperados
    const corruptPath = path.join(tmpDir, 'corrupt-state.json');
    fs.writeFileSync(corruptPath, '{"completedTasks": { "bad": ', 'utf-8');
    const corruptCoord = new TaskExecutionCoordinator({
      stateStore: new JsonFileTaskStateStoreAdapter(corruptPath),
    });
    const corruptDiag = corruptCoord.getPersistenceDiagnostics();
    assert.equal(corruptDiag.corruptedFileDetected, true);
    assert.equal(corruptDiag.loadErrorCount, 1);
    assert.equal(corruptDiag.recoveredCompletedTasksCount, 0);

    const partialPath = path.join(tmpDir, 'partial-records.json');
    fs.writeFileSync(
      partialPath,
      JSON.stringify({
        completedTasks: {
          broken_task: { taskId: 'broken_task' }, // faltan campos obligatorios
        },
        awaitingConfirmations: {
          incomplete_await: { taskId: 'incomplete_await', status: 'awaiting_confirmation' },
        },
        resultHistory: [{ taskId: '' }],
      }),
      'utf-8'
    );
    const partialCoord = new TaskExecutionCoordinator({
      stateStore: new JsonFileTaskStateStoreAdapter(partialPath),
    });
    const partialDiag = partialCoord.getPersistenceDiagnostics();
    assert.ok(partialDiag.invalidRecordsRejected >= 3);
    assert.equal(partialDiag.recoveredCompletedTasksCount, 0);
    assert.equal(partialDiag.recoveredAwaitingConfirmationsCount, 0);

    // 3. Reinicio REAL de proceso OS de forge-bridge: awaiting_studio_confirmation sobrevive SIGTERM y se confirma en Proceso 2
    const procStatePath = path.join(tmpDir, 'proc-restart-state.json');
    const projectRoot = resolveTestRojoProjectRoot();
    const serverEntryTs = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../src/server.ts'
    );

    const pendingCloudTasks: BridgeMessageEnvelope[] = [];
    const cloudTaskResults: Map<string, any> = new Map();
    let currentSessionId = '';
    let currentSessionToken = '';

    const cloudApp = express();
    cloudApp.use(express.json());
    cloudApp.post('/api/v1/bridge/auth/handshake', (_req, res) => {
      currentSessionId = `sess_proc_${Date.now()}`;
      currentSessionToken = `tok_proc_${Date.now()}`;
      res.json({
        accepted: true,
        sessionId: currentSessionId,
        sessionToken: currentSessionToken,
        expiresAt: Date.now() + 300_000,
        wsSupported: false,
      });
    });
    cloudApp.post('/api/v1/bridge/heartbeat', (_req, res) => {
      const toSend = pendingCloudTasks.splice(0, pendingCloudTasks.length);
      res.json({ pendingTasks: toSend });
    });
    cloudApp.post('/api/v1/bridge/task-ack', (_req, res) => res.json({ acked: true }));
    cloudApp.post('/api/v1/bridge/task-result', (req, res) => {
      if (req.body?.taskId) {
        cloudTaskResults.set(req.body.taskId, req.body);
      }
      res.json({ accepted: true });
    });

    const cloudServer = await new Promise<http.Server>((resolve) => {
      const s = cloudApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const cloudPort = (cloudServer.address() as any).port;

    const waitForBridgeReady = async (port: number) => {
      const url = `http://127.0.0.1:${port}/local/status`;
      for (let i = 0; i < 40; i++) {
        try {
          const r = await fetch(url, { headers: { 'X-Plugin-Token': PLUGIN_TOKEN } });
          if (r.status === 200) return (await r.json()) as any;
        } catch {
          // still starting
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`Bridge child process on port ${port} did not become ready`);
    };

    const spawnBridgeProc = (bridgePort: number) =>
      spawn(process.execPath, ['--import', 'tsx', serverEntryTs], {
        cwd: path.resolve(path.dirname(serverEntryTs), '..'),
        env: {
          ...process.env,
          NODE_ENV: 'test',
          BRIDGE_PORT: String(bridgePort),
          ROJO_PROJECT_PATH: projectRoot,
          FORGE_CLOUD_URL: `http://127.0.0.1:${cloudPort}`,
          FORGE_BRIDGE_SHARED_SECRET: SHARED_SECRET,
          FORGE_PLUGIN_LOCAL_TOKEN: PLUGIN_TOKEN,
          BRIDGE_HEARTBEAT_INTERVAL_MS: '150',
          BRIDGE_STATE_FILE_PATH: procStatePath,
        },
        stdio: 'pipe',
      });

    // Proceso 1
    const proc1 = spawnBridgeProc(48741);
    try {
      const st1 = await waitForBridgeReady(48741);
      assert.equal(st1.persistence.hasStateFile, true);

      const taskId = 'task_real_proc_restart_01';
      const reconstructEnv: BridgeMessageEnvelope = {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        taskId,
        sessionId: currentSessionId || 'sess_proc',
        operation: 'studio.reconstruct_model',
        payload: {
          name: 'RestartSurvivingModel',
          expected_part_count: 1,
          model_hash: 'hash_final_proc',
        },
        timestamp: new Date().toISOString(),
        correlationId: 'corr_proc_restart_01',
      };
      reconstructEnv.signature = computeEnvelopeHmac(reconstructEnv, SHARED_SECRET);
      pendingCloudTasks.push(reconstructEnv);

      // Plugin hace poll hasta recibir la tarea
      let polledTask: any = null;
      for (let i = 0; i < 25 && !polledTask; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const pRes = await fetch('http://127.0.0.1:48741/local/plugin/poll', {
          headers: { 'X-Plugin-Token': PLUGIN_TOKEN },
        });
        const pJson: any = await pRes.json();
        if (Array.isArray(pJson.pendingTasks) && pJson.pendingTasks.length > 0) {
          polledTask = pJson.pendingTasks[0];
        }
      }
      assert.ok(polledTask, 'Proceso 1 debe entregar la tarea studio.reconstruct_model al plugin');

      // Plugin reporta awaiting_studio_confirmation al Proceso 1
      const awaitRes = await fetch('http://127.0.0.1:48741/local/plugin/result', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Plugin-Token': PLUGIN_TOKEN,
        },
        body: JSON.stringify({
          taskId,
          status: 'awaiting_studio_confirmation',
          result: {
            taskId,
            operationId: taskId,
            status: 'awaiting_confirmation',
            verified: false,
            modelName: 'RestartSurvivingModel',
            expectedPartCount: 1,
            actualPartCount: 2,
            expectedModelHash: 'hash_final_proc',
            appliedModelHash: 'hash_before_proc',
            verifiedGeometryPartIds: ['part_keep_01'],
            failedPartIds: [],
            pendingDeletionPartIds: ['part_del_01'],
          },
        }),
      });
      assert.equal(awaitRes.status, 200);
      await new Promise((r) => setTimeout(r, 150));

      // Terminar Proceso 1 limpiamente con SIGTERM
      const exitPromise1 = new Promise<number | null>((resolve) => {
        proc1.once('exit', (code) => resolve(code));
      });
      proc1.kill('SIGTERM');
      await exitPromise1;
    } finally {
      if (!proc1.killed && proc1.exitCode === null) proc1.kill('SIGKILL');
    }

    // Verificar que el archivo persistido sobrevivió al Proceso 1
    assert.equal(fs.existsSync(procStatePath), true);

    // Proceso 2 arrancando desde cero sobre el mismo archivo de estado
    const proc2 = spawnBridgeProc(48742);
    try {
      const st2 = await waitForBridgeReady(48742);
      assert.equal(st2.persistence.recoveredAwaitingConfirmationsCount, 1);
      assert.equal(st2.queue.awaitingConfirmationsCount, 1);

      // Plugin envía confirmación destructiva al Proceso 2 tras reinicio
      const confirmRes = await fetch('http://127.0.0.1:48742/local/plugin/result', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Plugin-Token': PLUGIN_TOKEN,
        },
        body: JSON.stringify({
          taskId: 'task_real_proc_restart_01',
          status: 'completed',
          result: {
            taskId: 'task_real_proc_restart_01',
            operationId: 'task_real_proc_restart_01',
            status: 'completed',
            verified: true,
            modelName: 'RestartSurvivingModel',
            expectedPartCount: 1,
            actualPartCount: 1,
            expectedModelHash: 'hash_final_proc',
            appliedModelHash: 'hash_final_proc',
            verifiedGeometryPartIds: ['part_keep_01'],
            failedPartIds: [],
            pendingDeletionPartIds: [],
            removedPartIds: ['part_del_01'],
          },
        }),
      });
      assert.equal(confirmRes.status, 200);
      const confirmJson: any = await confirmRes.json();
      assert.equal(confirmJson.accepted, true, 'Proceso 2 debe aceptar la confirmación pendiente recuperada tras reinicio OS');

      await new Promise((r) => setTimeout(r, 200));
      const finalCloudResult = cloudTaskResults.get('task_real_proc_restart_01');
      assert.ok(finalCloudResult, 'Proceso 2 debe notificar la confirmación final a Forge Cloud');
      assert.equal(finalCloudResult.status, 'completed');

      const exitPromise2 = new Promise<number | null>((resolve) => {
        proc2.once('exit', (code) => resolve(code));
      });
      proc2.kill('SIGTERM');
      await exitPromise2;
    } finally {
      if (!proc2.killed && proc2.exitCode === null) proc2.kill('SIGKILL');
      await new Promise<void>((resolve) => cloudServer.close(() => resolve()));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});




