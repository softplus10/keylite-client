export type RemoteVault = { id: string; name: string; revision: number; hash: string | null };
export type Registration = { account_number: string; token: string };

const DEFAULT_SERVER = 'https://keylite.u72mlzb.workers.dev';
let base = new URL('/api', DEFAULT_SERVER).toString().replace(/\/$/, '');
let token = '';

export function setServer(input: string): void {
  const url = new URL(input);
  if (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Use an HTTPS server URL');
  }
  base = url.origin + '/api';
  token = '';
}
function api(path: string): string { return base + path; }
function headers(extra: Record<string, string> = {}): Record<string, string> {
  if (!token) throw new Error('Sign in first');
  return { Authorization: 'Bearer ' + token, ...extra };
}
export async function register(): Promise<Registration> {
  const response = await fetch(api('/register'), { method: 'POST', cache: 'no-store' });
  if (!response.ok) throw new Error('Registration failed (' + response.status + ')');
  const result = await response.json() as Registration;
  if (!result.account_number || !result.token) throw new Error('Invalid server response');
  token = result.token;
  return result;
}
export async function login(accountNumber: string): Promise<void> {
  const response = await fetch(api('/login'), {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_number: accountNumber })
  });
  if (!response.ok) throw new Error('Sign in failed (' + response.status + ')');
  const data = await response.json() as { token: string };
  if (!data.token) throw new Error('Invalid session response');
  token = data.token;
}
export async function logout(): Promise<void> {
  if (token) {
    try { await fetch(api('/logout'), { method: 'POST', headers: headers() }); }
    catch { /* Local logout works offline, but the remote session may remain valid until expiry. */ }
  }
  token = '';
}
export async function vaults(): Promise<RemoteVault[]> {
  const response = await fetch(api('/vaults'), {headers:headers()});
  if (!response.ok) throw new Error('Unable to list vaults');
  return response.json();
}
export async function createVault(name: string): Promise<{id:string}> {
  const response = await fetch(api('/vaults'), {
    method:'POST',headers:headers({'Content-Type':'application/json'}),
    body:JSON.stringify({name})
  });
  if (!response.ok) throw new Error('Unable to create vault');
  return response.json();
}
export async function pull(id: string) {
  const response = await fetch(api('/vaults/' + encodeURIComponent(id)), {headers:headers()});
  if (!response.ok) throw new Error('Download failed ('+response.status+')');
  const etag=response.headers.get('ETag');
  if (!etag) throw new Error('Server did not provide ETag');
  return {bytes: await response.arrayBuffer(),etag};
}
export class ConflictError extends Error {}
export async function push(id:string, bytes:ArrayBuffer, etag:string|null) {
  const response = await fetch(api('/vaults/' + encodeURIComponent(id)),{
    method:'PUT',
    headers:headers({'Content-Type':'application/octet-stream','If-Match':etag||'*'}),
    body:bytes
  });
  if (response.status === 412) throw new ConflictError('Remote revision changed. Export your local edits before resolving.');
  if (!response.ok) throw new Error('Upload rejected (' + response.status + ')');
  const next = response.headers.get('ETag');
  if (!next) throw new Error('Server did not return ETag');
  return next;
}
