const STORAGE_KEY = 'forge_local_token';

export function getForgeApiToken(): string {
  try {
    return (window.localStorage.getItem(STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setForgeApiToken(token: string): void {
  try {
    const clean = token.trim();
    if (clean) {
      window.localStorage.setItem(STORAGE_KEY, clean);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent('forge-token-updated', { detail: { hasToken: Boolean(clean) } }));
  } catch {
    // ignore storage errors
  }
}

export async function forgeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getForgeApiToken();
  if (token && !headers.has('X-Forge-Token')) {
    headers.set('X-Forge-Token', token);
  }
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 || res.status === 503) {
    window.dispatchEvent(new CustomEvent('forge-auth-required', { detail: { status: res.status } }));
  }
  return res;
}
