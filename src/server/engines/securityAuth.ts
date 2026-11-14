import crypto from 'crypto';

const PLACEHOLDER_SECRETS = new Set([
  'reemplazar-con-secreto-aleatorio-de-32-bytes',
  'your_token_here',
  'your_api_key_here',
  'your_secret_here',
  'changeme',
  'placeholder',
  'my_secret',
  'secret',
  'none',
]);

const DEV_ONLY_SECRETS = new Set([
  'forge-local-dev-token-2026',
]);

export function isPlaceholderOrWeakSecret(
  secret: string | undefined | null,
  options?: { isProduction?: boolean }
): boolean {
  const normalized = String(secret || '').trim();
  if (!normalized || normalized.length < 8) {
    return true;
  }
  const lower = normalized.toLowerCase();
  if (PLACEHOLDER_SECRETS.has(lower)) {
    return true;
  }
  const isProd = options?.isProduction ?? process.env.NODE_ENV === 'production';
  if (isProd && DEV_ONLY_SECRETS.has(lower)) {
    return true;
  }
  return false;
}

export function verifyTokenConstantTime(provided: string, expected: string): boolean {
  const cleanExpected = String(expected || '').trim();
  const cleanProvided = String(provided || '').trim();
  if (!cleanExpected || !cleanProvided) {
    return false;
  }
  const a = Buffer.from(cleanProvided, 'utf-8');
  const b = Buffer.from(cleanExpected, 'utf-8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function resolveBackendApiToken(): string {
  return String(
    process.env.FORGE_LOCAL_TOKEN ||
      process.env.FORGE_SECURITY_TOKEN ||
      process.env.FORGE_API_SECRET ||
      ''
  ).trim();
}
