/**
 * @module forgeApiClient
 * @description
 * Cliente HTTP autenticado para todas las peticiones frontend hacia el Gateway / Backend
 * y el Forge Local Bridge. Inyecta automáticamente `X-Forge-Token` desde `localStorage`
 * (`forge_security_token`) cuando existe sin hardcodear secretos en el bundle.
 */

export const FORGE_TOKEN_STORAGE_KEY = 'forge_security_token';
export const FORGE_AUTH_REQUIRED_EVENT = 'forge-auth-required';

export interface ForgeSessionBootstrapResult {
  token: string | null;
  requiresToken: boolean;
  mode?: string;
}

let inFlightSessionBootstrap: Promise<ForgeSessionBootstrapResult> | null = null;

export function getStoredForgeToken(): string {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return (window.localStorage.getItem(FORGE_TOKEN_STORAGE_KEY) || '').trim();
    }
  } catch {
    // Ignore storage access restrictions
  }
  return '';
}

export function setStoredForgeToken(token: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const trimmed = String(token || '').trim();
      if (trimmed.length > 0) {
        window.localStorage.setItem(FORGE_TOKEN_STORAGE_KEY, trimmed);
      } else {
        window.localStorage.removeItem(FORGE_TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage access restrictions
  }
}

function getRequestUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (typeof URL !== 'undefined' && input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return '';
}

function isProtectedInternalApiRequest(input: RequestInfo | URL): boolean {
  const urlStr = getRequestUrlString(input);
  if (!urlStr) return false;
  if (urlStr.startsWith('/api/v1/') && !urlStr.startsWith('/api/v1/auth/session')) {
    return true;
  }
  if (typeof window !== 'undefined' && window.location) {
    try {
      const parsed = new URL(urlStr, window.location.origin);
      return (
        parsed.origin === window.location.origin &&
        parsed.pathname.startsWith('/api/v1/') &&
        !parsed.pathname.startsWith('/api/v1/auth/session')
      );
    } catch {
      return false;
    }
  }
  return false;
}

function dispatchForgeAuthRequired(url: string): void {
  try {
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(FORGE_AUTH_REQUIRED_EVENT, {
          detail: { status: 401, url },
        })
      );
    }
  } catch {
    // Ignore event dispatch errors
  }
}

export async function ensureForgeSessionToken(
  forceRefresh = false
): Promise<ForgeSessionBootstrapResult> {
  if (!forceRefresh) {
    const existing = getStoredForgeToken();
    if (existing) {
      return { token: existing, requiresToken: false };
    }
  }

  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    const existing = getStoredForgeToken();
    return { token: existing || null, requiresToken: !existing };
  }

  if (!forceRefresh && inFlightSessionBootstrap) {
    return inFlightSessionBootstrap;
  }

  const runBootstrap = (async (): Promise<ForgeSessionBootstrapResult> => {
    try {
      const existing = getStoredForgeToken();
      const sessionHeaders: Record<string, string> = {};
      if (existing) {
        sessionHeaders['X-Forge-Token'] = existing;
      }

      const res = await fetch('/api/v1/auth/session', {
        method: 'GET',
        cache: 'no-store',
        headers: sessionHeaders,
      });

      if (!res.ok) {
        return { token: null, requiresToken: true };
      }

      const data = (await res.json().catch(() => ({}))) as {
        authenticated?: boolean;
        mode?: string;
        requiresToken?: boolean;
        token?: string;
      };

      const issuedToken = typeof data.token === 'string' ? data.token.trim() : '';
      if (issuedToken) {
        setStoredForgeToken(issuedToken);
        return {
          token: issuedToken,
          requiresToken: false,
          mode: data.mode,
        };
      }

      // If an obsolete ephemeral dev token was stored from a previous session
      // and the server now requires an explicit configured token, clear it cleanly.
      if (forceRefresh && data.requiresToken && existing.startsWith('forge_dev_ephem_')) {
        setStoredForgeToken('');
      }

      return {
        token: data.authenticated ? existing || null : null,
        requiresToken: Boolean(data.requiresToken),
        mode: data.mode,
      };
    } catch {
      const existing = getStoredForgeToken();
      return { token: existing || null, requiresToken: !existing };
    } finally {
      inFlightSessionBootstrap = null;
    }
  })();

  inFlightSessionBootstrap = runBootstrap;
  return runBootstrap;
}

export async function verifyAndSaveForgeToken(
  candidateToken: string
): Promise<{ ok: boolean; error?: string }> {
  const cleaned = String(candidateToken || '').trim();
  if (!cleaned) {
    return { ok: false, error: 'Ingresa un token válido antes de guardar.' };
  }

  try {
    const res = await fetch('/api/v1/auth/session', {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'X-Forge-Token': cleaned,
        Authorization: `Bearer ${cleaned}`,
      },
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        authenticated?: boolean;
        token?: string;
      };
      if (data.authenticated) {
        setStoredForgeToken(data.token ? String(data.token).trim() : cleaned);
        return { ok: true };
      }
      return {
        ok: false,
        error: 'El token ingresado no coincide con el token configurado en el servidor.',
      };
    }
  } catch {
    // Fallback below: persist so user can retry when offline/local
  }

  setStoredForgeToken(cleaned);
  return { ok: true };
}

export function getForgeAuthHeaders(extraHeaders?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {};

  if (extraHeaders) {
    if (typeof Headers !== 'undefined' && extraHeaders instanceof Headers) {
      extraHeaders.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(extraHeaders)) {
      for (const [key, value] of extraHeaders) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, extraHeaders);
    }
  }

  const token = getStoredForgeToken();
  if (token) {
    if (!headers['X-Forge-Token'] && !headers['x-forge-token']) {
      headers['X-Forge-Token'] = token;
    }
    if (!headers['Authorization'] && !headers['authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  return headers;
}

export async function forgeFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const isInternalProtected = isProtectedInternalApiRequest(input);
  const initialHeaders = getForgeAuthHeaders(init.headers);
  const callerProvidedAuth = Boolean(
    initialHeaders['X-Forge-Token'] ||
      initialHeaders['x-forge-token'] ||
      initialHeaders['Authorization'] ||
      initialHeaders['authorization']
  );

  if (isInternalProtected && !callerProvidedAuth) {
    await ensureForgeSessionToken(false);
  }

  const headers = getForgeAuthHeaders(init.headers);
  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (
    response.status === 401 &&
    isInternalProtected &&
    !init.signal?.aborted
  ) {
    const sentToken = headers['X-Forge-Token'] || headers['x-forge-token'] || '';
    const refreshed = await ensureForgeSessionToken(true);

    if (refreshed.token && refreshed.token !== sentToken) {
      const retryHeaders = getForgeAuthHeaders(init.headers);
      const retryResponse = await fetch(input, {
        ...init,
        headers: retryHeaders,
      });
      if (retryResponse.status === 401) {
        dispatchForgeAuthRequired(getRequestUrlString(input));
      }
      return retryResponse;
    }

    dispatchForgeAuthRequired(getRequestUrlString(input));
  }

  return response;
}
