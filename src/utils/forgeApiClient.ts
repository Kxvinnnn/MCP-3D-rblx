/**
 * @module forgeApiClient
 * @description
 * Cliente HTTP autenticado para todas las peticiones frontend hacia el Gateway / Backend
 * y el Forge Local Bridge. Inyecta automáticamente `X-Forge-Token` desde `localStorage`
 * (`forge_security_token`) cuando existe sin hardcodear secretos en el bundle.
 */

export const FORGE_TOKEN_STORAGE_KEY = 'forge_security_token';

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

export function forgeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = getForgeAuthHeaders(init.headers);
  return fetch(input, {
    ...init,
    headers,
  });
}
