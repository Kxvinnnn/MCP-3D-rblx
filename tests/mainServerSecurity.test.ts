import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createMainServerApp } from '../server.ts';

function listenOnEphemeralPort(app: ReturnType<typeof createMainServerApp>['app']): Promise<{
  server: http.Server;
  baseUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind ephemeral port'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
    server.on('error', reject);
  });
}

test('Etapa 3 — Seguridad del Servidor Principal (server.ts): startup prod, tokens inválidos/ausentes, bloqueo de override HTTP y confirmación destructiva', async () => {
  // 1. Arranque en producción sin secretos -> debe lanzar error
  assert.throws(
    () =>
      createMainServerApp({
        nodeEnv: 'production',
        securityToken: '',
        bridgeSharedSecret: '',
      }),
    /FORGE_SECURITY_TOKEN|producción/i
  );

  // 2. Arranque en producción con secreto de ejemplo -> debe lanzar error
  assert.throws(
    () =>
      createMainServerApp({
        nodeEnv: 'production',
        securityToken: 'forge-local-dev-token-2026',
        bridgeSharedSecret: 'reemplazar-con-secreto-aleatorio-de-32-bytes',
      }),
    /ejemplo/i
  );

  // 3. Arranque en producción con secretos válidos (>= 16 chars) -> éxito
  const validSecret = `sec_${crypto.randomBytes(24).toString('hex')}`;
  const validBridgeSecret = `brg_${crypto.randomBytes(24).toString('hex')}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-main-sec-'));

  let srv: http.Server | null = null;
  try {
    const prodInstance = createMainServerApp({
      nodeEnv: 'production',
      securityToken: validSecret,
      bridgeSharedSecret: validBridgeSecret,
      rojoProjectPath: tmpDir,
    });
    assert.equal(prodInstance.security.valid, true);
    assert.equal(prodInstance.security.isProduction, true);

    // Verificar modo desarrollo sin token explícito: NO desactiva auth (genera token efímero no vacío)
    const devInstance = createMainServerApp({
      nodeEnv: 'development',
      securityToken: '',
      bridgeSharedSecret: '',
      rojoProjectPath: tmpDir,
    });
    assert.equal(devInstance.security.usedEphemeralDevToken, true);
    assert.ok(devInstance.security.effectiveSecurityToken.length >= 32);

    const bound = await listenOnEphemeralPort(prodInstance.app);
    srv = bound.server;
    const baseUrl = bound.baseUrl;

    // 4. Ruta protegida sin token -> 401
    const noTokStatusRes = await fetch(`${baseUrl}/api/v1/bridge/status`);
    assert.equal(noTokStatusRes.status, 401);

    const noTokPostRes = await fetch(`${baseUrl}/api/v1/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'asset-unauth', name: 'BlockedAsset', parts: [] }),
    });
    assert.equal(noTokPostRes.status, 401);

    // 5. Ruta protegida con token inválido -> 401
    const badTokRes = await fetch(`${baseUrl}/api/v1/bridge/status`, {
      headers: { 'X-Forge-Token': 'invalid-token-123' },
    });
    assert.equal(badTokRes.status, 401);

    // 6. Ruta protegida con token válido -> 200
    const okStatusRes = await fetch(`${baseUrl}/api/v1/bridge/status`, {
      headers: { 'X-Forge-Token': validSecret },
    });
    assert.equal(okStatusRes.status, 200);
    const statusJson = (await okStatusRes.json()) as Record<string, any>;
    assert.equal(statusJson.protocolVersion, '1.0');

    // No permitir sobrescribir el token mediante /api/v1/rojo/configure
    const overrideRes = await fetch(`${baseUrl}/api/v1/rojo/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': validSecret,
      },
      body: JSON.stringify({
        rojo_project_path: tmpDir,
        security_token: 'attacker-token',
      }),
    });
    assert.equal(overrideRes.status, 403);

    // Crear un asset válido con autenticación para probar el borrado destructivo
    const createRes = await fetch(`${baseUrl}/api/v1/assets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': validSecret,
      },
      body: JSON.stringify({
        id: 'asset-sec-delete-target',
        name: 'DeleteTargetModel',
        category: 'Props',
        asset_type: 'Model3D',
        parts: [],
      }),
    });
    assert.equal(createRes.status, 200);

    // 7a. Borrado destructivo sin autenticación -> 401
    const delNoAuthRes = await fetch(`${baseUrl}/api/v1/assets/asset-sec-delete-target?confirm=true`, {
      method: 'DELETE',
    });
    assert.equal(delNoAuthRes.status, 401);

    // 7b. Borrado destructivo sin confirmación explícita -> 400
    const delNoConfirmRes = await fetch(`${baseUrl}/api/v1/assets/asset-sec-delete-target`, {
      method: 'DELETE',
      headers: { 'X-Forge-Token': validSecret },
    });
    assert.equal(delNoConfirmRes.status, 400);

    // 8. Borrado destructivo con autenticación y confirmación explícita -> 200
    const delConfirmedRes = await fetch(`${baseUrl}/api/v1/assets/asset-sec-delete-target?confirm=true`, {
      method: 'DELETE',
      headers: {
        'X-Forge-Token': validSecret,
        'X-Forge-Confirm-Delete': 'true',
      },
    });
    assert.equal(delConfirmedRes.status, 200);
    const delJson = (await delConfirmedRes.json()) as Record<string, any>;
    assert.equal(delJson.deleted_ok, true);
    assert.equal(delJson.deleted, 'asset-sec-delete-target');

    // 9. Política CORS estricta: rechazar *.run.app arbitrario y no filtrar rutas internas en /health
    const untrustedCorsOptions = await fetch(`${baseUrl}/api/v1/health`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil-attacker.run.app' },
    });
    assert.equal(untrustedCorsOptions.status, 403);

    const untrustedCorsGet = await fetch(`${baseUrl}/api/v1/health`, {
      headers: { Origin: 'https://evil-attacker.run.app' },
    });
    assert.equal(untrustedCorsGet.status, 200);
    assert.equal(untrustedCorsGet.headers.get('access-control-allow-origin'), null);
    const healthJson = (await untrustedCorsGet.json()) as Record<string, any>;
    assert.equal(healthJson.rojo_project_path, undefined);
    assert.ok(healthJson.rojo_workspace);

    // 10. Bloqueo de rutas de sistema operativo en /api/v1/rojo/configure
    const sysPathRes = await fetch(`${baseUrl}/api/v1/rojo/configure`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': validSecret,
      },
      body: JSON.stringify({ rojo_project_path: '/etc/forge-blocked', initialize_if_missing: false }),
    });
    assert.equal(sysPathRes.status, 403);

    // 11. Rechazo de firma HMAC incorrecta en handshake y sesión expirada en heartbeat
    const badSigRes = await fetch(`${baseUrl}/api/v1/bridge/auth/handshake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': validBridgeSecret,
      },
      body: JSON.stringify({
        bridgeVersion: '2.3.0',
        protocolVersion: '1.0',
        timestamp: new Date().toISOString(),
        nonce: crypto.randomUUID(),
        signature: '0'.repeat(64),
      }),
    });
    assert.equal(badSigRes.status, 401);

    const expiredSessRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer expired-session-token-000',
        'X-Bridge-Session': 'sess_expired_999',
      },
      body: JSON.stringify({ bridgeVersion: '2.3.0' }),
    });
    assert.equal(expiredSessRes.status, 401);

    // 12. /api/v1/auth/session en modo producción nunca filtra FORGE_SECURITY_TOKEN y bloquea cross-site
    const prodSessionUnauthRes = await fetch(`${baseUrl}/api/v1/auth/session`);
    assert.equal(prodSessionUnauthRes.status, 200);
    const prodSessionUnauthJson = (await prodSessionUnauthRes.json()) as Record<string, any>;
    assert.equal(prodSessionUnauthJson.authenticated, false);
    assert.equal(prodSessionUnauthJson.requiresToken, true);
    assert.equal(prodSessionUnauthJson.token, undefined);

    const prodSessionValidRes = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { 'X-Forge-Token': validSecret },
    });
    assert.equal(prodSessionValidRes.status, 200);
    const prodSessionValidJson = (await prodSessionValidRes.json()) as Record<string, any>;
    assert.equal(prodSessionValidJson.authenticated, true);
    assert.equal(prodSessionValidJson.requiresToken, false);
    assert.equal(prodSessionValidJson.token, undefined);

    const prodSessionCrossOriginRes = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { Origin: 'https://evil-attacker.run.app' },
    });
    assert.equal(prodSessionCrossOriginRes.status, 403);

    const prodSessionCrossSiteRes = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(prodSessionCrossSiteRes.status, 403);
  } finally {
    if (srv) {
      await new Promise<void>((resolve) => srv!.close(() => resolve()));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Sesión efímera dev: /api/v1/auth/session solo responde a same-origin, mantiene 401 directo y habilita /api/v1/generate-3d-stream', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-dev-session-'));
  let srv: http.Server | null = null;

  try {
    const devInstance = createMainServerApp({
      nodeEnv: 'development',
      securityToken: '',
      bridgeSharedSecret: '',
      rojoProjectPath: tmpDir,
    });
    assert.equal(devInstance.security.usedEphemeralDevToken, true);

    const bound = await listenOnEphemeralPort(devInstance.app);
    srv = bound.server;
    const baseUrl = bound.baseUrl;

    // 1. Llamadas directas sin token deben seguir devolviendo 401
    const unauthStatus = await fetch(`${baseUrl}/api/v1/bridge/status`);
    assert.equal(unauthStatus.status, 401);

    const unauthGen = await fetch(`${baseUrl}/api/v1/generate-3d-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Árbol roble', category: 'Trees & Vegetation' }),
    });
    assert.equal(unauthGen.status, 401);

    // 2. Solicitudes cross-site al bootstrap de sesión deben ser rechazadas con 403
    const crossOriginSession = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { Origin: 'https://evil-attacker.run.app' },
    });
    assert.equal(crossOriginSession.status, 403);

    const crossSiteSession = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(crossSiteSession.status, 403);

    // 3. Solicitud same-origin devuelve el token efímero dev y desbloquea generación 3D SSE
    const devSessionRes = await fetch(`${baseUrl}/api/v1/auth/session`, {
      headers: {
        Origin: baseUrl,
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    assert.equal(devSessionRes.status, 200);
    const devSessionJson = (await devSessionRes.json()) as Record<string, any>;
    assert.equal(devSessionJson.authenticated, true);
    assert.equal(devSessionJson.mode, 'ephemeral_dev');
    assert.equal(devSessionJson.requiresToken, false);
    assert.equal(devSessionJson.token, devInstance.security.effectiveSecurityToken);

    const streamRes = await fetch(`${baseUrl}/api/v1/generate-3d-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': devSessionJson.token,
      },
      body: JSON.stringify({
        prompt: 'Árbol roble ancestral para Roblox',
        asset_type: 'Model3D',
        category: 'Trees & Vegetation',
        generation_mode: 'procedural',
        seed: 'forge-session-test-2026',
        save_to_rojo: false,
        save_to_library: false,
      }),
    });
    assert.equal(streamRes.status, 200);
    const sseText = await streamRes.text();
    assert.ok(sseText.includes('"type":"done"'));
    assert.ok(sseText.includes('"parts"'));

    // 4. Si el usuario configura un secreto personalizado en dev, /api/v1/auth/session NO debe exponerlo
    const customDevSecret = `custom_${crypto.randomBytes(16).toString('hex')}`;
    const customDevInstance = createMainServerApp({
      nodeEnv: 'development',
      securityToken: customDevSecret,
      bridgeSharedSecret: customDevSecret,
      rojoProjectPath: tmpDir,
    });
    const customBound = await listenOnEphemeralPort(customDevInstance.app);
    try {
      const customSessionRes = await fetch(`${customBound.baseUrl}/api/v1/auth/session`, {
        headers: { Origin: customBound.baseUrl, 'Sec-Fetch-Site': 'same-origin' },
      });
      assert.equal(customSessionRes.status, 200);
      const customSessionJson = (await customSessionRes.json()) as Record<string, any>;
      assert.equal(customSessionJson.authenticated, false);
      assert.equal(customSessionJson.mode, 'configured_token');
      assert.equal(customSessionJson.requiresToken, true);
      assert.equal(customSessionJson.token, undefined);
    } finally {
      await new Promise<void>((resolve) => customBound.server.close(() => resolve()));
    }
  } finally {
    if (srv) {
      await new Promise<void>((resolve) => srv!.close(() => resolve()));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
