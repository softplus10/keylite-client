export type RemoteVault = { id: string; name: string; revision: number; hash: string|null };

const DEFAULT_SERVER = 'https://keylite.u72mlzb.workers.dev';
let base = new URL('/api', DEFAULT_SERVER).toString().replace(/\/$/, '');
let token = '';
export function setServer(input: string) {
  const url = new URL(input);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Use an HTTPS URL');
  }
  base = url.origin + '/api';
}
function api(route: string) {
  if (!base) throw new Error('Connect to a server first');
  return base + route;
}
function headers(extra: Record<string, string> = {}) {
  if (!token) throw new Error('Sign in first');
  return { Authorization: 'Bearer ' + token, ...extra };
}
export type Registration = { account_number: string; token: string };
export async function register(): Promise<Registration> {
  const response = await fetch(api('/register'), { method: 'POST' });
  if (!response.ok) throw new Error('Account creation failed (' + response.status + ')');
  const result = await response.json() as Registration;
  token = result.token;
  return result;
}
export async function login(accountNumber: string): Promise<void> {
  const response = await fetch(api('/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_number: accountNumber })
  });
  if (!response.ok) throw new Error('Invalid account number (' + response.status + ')');
  token = (await response.json() as { token: string }).token;
}
export async function logout() {
  if (token) { try { await fetch(api('/logout'), {method:'POST',headers:headers()}); } catch {/* Offline logout still locks locally. */} }
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
