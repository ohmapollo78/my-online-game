// Server address configuration. Development uses VITE_SERVER_URL from .env.development
// (ws://localhost:2567). Production defaults to the same host that served the page
// (wss://your-domain), or an explicit VITE_SERVER_URL from .env.production.
// Players can override it in Settings (stored locally).

const KEY = 'animaldash.serverUrl';

export function serverUrl(): string {
  try { const o = localStorage.getItem(KEY); if (o) return o; } catch { /* ignore */ }
  const env = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}
export function setServerOverride(url: string): void {
  try { if (url) localStorage.setItem(KEY, url); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export function serverOverride(): string { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } }
export const httpUrl = (ws: string): string => ws.replace(/^ws(s?):/, 'http$1:');
