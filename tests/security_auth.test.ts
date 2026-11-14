import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  isPlaceholderOrWeakSecret,
  verifyTokenConstantTime,
} from '../src/server/engines/securityAuth.ts';
import { CloudBridgeCoordinator } from '../src/server/engines/bridgeCoordinatorEngine.ts';

function signHandshake(
  secret: string,
  bridgeVersion: string,
  protocolVersion: string,
  timestamp: string,
  nonce: string
): string {
  const canonical = `${bridgeVersion}|${protocolVersion}|${timestamp}|${nonce}`;
  return crypto.createHmac('sha256', secret).update(canonical, 'utf-8').digest('hex');
}

test('Fase 2.1 — Validación constante de tokens y rechazo de secretos vacíos/ejemplo', () => {
  const realSecret = 'f9a8c7e6d5b4a39281706f5e4d3c2b1a';
  assert.equal(verifyTokenConstantTime(realSecret, realSecret), true);
  assert.equal(verifyTokenConstantTime('wrong-token-value-12345678901234', realSecret), false);
  assert.equal(verifyTokenConstantTime('', realSecret), false);
  assert.equal(verifyTokenConstantTime(realSecret, ''), false);

  assert.equal(isPlaceholderOrWeakSecret(''), true);
  assert.equal(isPlaceholderOrWeakSecret('short'), true);
  assert.equal(isPlaceholderOrWeakSecret('reemplazar-con-secreto-aleatorio-de-32-bytes'), true);
  assert.equal(isPlaceholderOrWeakSecret('changeme'), true);
  assert.equal(isPlaceholderOrWeakSecret('forge-local-dev-token-2026', { isProduction: true }), true);
  assert.equal(isPlaceholderOrWeakSecret('forge-local-dev-token-2026', { isProduction: false }), false);
  assert.equal(isPlaceholderOrWeakSecret(realSecret, { isProduction: true }), false);
});

test('Fase 2.2 — Handshake HMAC, anti-replay (nonce), timestamp expirado y secretos independientes', () => {
  const prevSecret = process.env.FORGE_BRIDGE_SHARED_SECRET;
  const bridgeSecret = 'bridge_secret_9a8b7c6d5e4f3a2b1c0d';
  process.env.FORGE_BRIDGE_SHARED_SECRET = bridgeSecret;

  try {
    const coord = new CloudBridgeCoordinator();
    const ts = new Date().toISOString();
    const nonce1 = crypto.randomUUID();
    const sig1 = signHandshake(bridgeSecret, '1.0.0', '1.0', ts, nonce1);

    // 1. Handshake válido
    const okRes = coord.handleHandshake({
      bridgeVersion: '1.0.0',
      protocolVersion: '1.0',
      timestamp: ts,
      nonce: nonce1,
      signature: sig1,
    });
    assert.equal(okRes.accepted, true);
    assert.ok(okRes.sessionId);
    assert.ok(okRes.sessionToken);

    // 2. Nonce repetido (replay attack) debe rechazarse
    const replayRes = coord.handleHandshake({
      bridgeVersion: '1.0.0',
      protocolVersion: '1.0',
      timestamp: ts,
      nonce: nonce1,
      signature: sig1,
    });
    assert.equal(replayRes.accepted, false);
    assert.match(String(replayRes.error), /replay|Nonce repetido/i);

    // 3. Firma HMAC incorrecta debe rechazarse
    const nonce2 = crypto.randomUUID();
    const badSigRes = coord.handleHandshake({
      bridgeVersion: '1.0.0',
      protocolVersion: '1.0',
      timestamp: ts,
      nonce: nonce2,
      signature: '0'.repeat(64),
    });
    assert.equal(badSigRes.accepted, false);

    // 4. Timestamp expirado (> 5 minutos) debe rechazarse
    const oldTs = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const nonce3 = crypto.randomUUID();
    const oldSig = signHandshake(bridgeSecret, '1.0.0', '1.0', oldTs, nonce3);
    const expiredTsRes = coord.handleHandshake({
      bridgeVersion: '1.0.0',
      protocolVersion: '1.0',
      timestamp: oldTs,
      nonce: nonce3,
      signature: oldSig,
    });
    assert.equal(expiredTsRes.accepted, false);

    // 5. Token de sesión válido vs inválido vs expirado/reconexión
    assert.equal(coord.verifySessionRequest(`Bearer ${okRes.sessionToken}`, okRes.sessionId), true);
    assert.equal(coord.verifySessionRequest('Bearer invalid_token', okRes.sessionId), false);
    assert.equal(coord.verifySessionRequest('', okRes.sessionId, 'wrong_secret'), false);

    coord.requestReconnect();
    assert.equal(coord.verifySessionRequest(`Bearer ${okRes.sessionToken}`, okRes.sessionId), false);
  } finally {
    if (prevSecret === undefined) delete process.env.FORGE_BRIDGE_SHARED_SECRET;
    else process.env.FORGE_BRIDGE_SHARED_SECRET = prevSecret;
  }
});

test('Fase 2.3 — Handshake rechaza secreto vacío o placeholder', () => {
  const prevSecret = process.env.FORGE_BRIDGE_SHARED_SECRET;
  const prevSecTok = process.env.FORGE_SECURITY_TOKEN;
  const prevLocTok = process.env.FORGE_LOCAL_TOKEN;

  try {
    process.env.FORGE_BRIDGE_SHARED_SECRET = '';
    process.env.FORGE_SECURITY_TOKEN = '';
    process.env.FORGE_LOCAL_TOKEN = '';
    const coordEmpty = new CloudBridgeCoordinator();
    const resEmpty = coordEmpty.handleHandshake({
      bridgeVersion: '1.0.0',
      protocolVersion: '1.0',
      timestamp: new Date().toISOString(),
      nonce: crypto.randomUUID(),
      signature: '',
    });
    assert.equal(resEmpty.accepted, false);

    process.env.FORGE_BRIDGE_SHARED_SECRET = 'reemplazar-con-secreto-aleatorio-de-32-bytes';
    const ts = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const sig = signHandshake('reemplazar-con-secreto-aleatorio-de-32-bytes', '1.0.0', '1.0', ts, nonce);
    const resPlaceholder = coordEmpty.handleHandshake({
      bridgeVersion: '1.0.0',
      protocolVersion: '1.0',
      timestamp: ts,
      nonce,
      signature: sig,
    });
    assert.equal(resPlaceholder.accepted, false);
  } finally {
    if (prevSecret === undefined) delete process.env.FORGE_BRIDGE_SHARED_SECRET;
    else process.env.FORGE_BRIDGE_SHARED_SECRET = prevSecret;
    if (prevSecTok === undefined) delete process.env.FORGE_SECURITY_TOKEN;
    else process.env.FORGE_SECURITY_TOKEN = prevSecTok;
    if (prevLocTok === undefined) delete process.env.FORGE_LOCAL_TOKEN;
    else process.env.FORGE_LOCAL_TOKEN = prevLocTok;
  }
});
