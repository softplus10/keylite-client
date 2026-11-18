import { clearAccount, loadAccount, saveAccount } from './secure-storage';

export type RemoteVault = { id: string; name: string; revision: number; hash: string|null };
export type Registered = { account_number: string; token: string };

const DEFAULT_SERVER = 'https://keylite.u72mlzb.workers.dev';
let server = DEFAULT_SERVER;
let base = new URL('/api', DEFAULT_SERVER).toString().replace(/\/$/, '');
let token = '';
let activeAccount: string | null = null;

export function setServer(input: string) {
  const url = new URL(input);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Use an HTTPS server URL');
  }
  server = url.origin;
  base = server + '/api';
  token = '';
  activeAccount = null;
}

export function currentAccount(): string | null { return activeAccount; }
export function hasSession(): boolean { return token.length > 0; }

function api(route: string) { return base + route; }
function headers(extra: Record<string, string> = {}) {
  if (!token) throw new Error('Sign in first');
  return { Authorization: 'Bearer ' + token, ...extra };
}

export async function register(): Promise<string> {
  const response = await fetch(api('/register'), { method: 'POST', cache: 'no-store' });
  if (!response.ok) throw new Error('Registration failed (' + response.status + ')');
  const result = await response.json() as Registered;
  if (!result.account_number || !result.token) throw new Error('Invalid server registration response');
  // Persist before reporting success, so a failed write never silently loses the only account secret.
  await saveAccount({ server, account_number: result.account_number });
  token = result.token;
  activeAccount = result.account_number;
  return result.account_number;
}

export async function login(accountNumber: string): Promise<void> {
  const response = await fetch(api('/login'), {
    method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_number: accountNumber })
  });
  if (!response.ok) throw new Error('Sign in failed (' + response.status + ')');
  const data = await response.json() as { token: string };
  if (!data.token) throw new Error('Invalid server response');
  await saveAccount({ server, account_number: accountNumber });
  token = data.token;
  activeAccount = accountNumber;
}

export async function restoreSession(): Promise<boolean> {
  const saved = await loadAccount();
  if (!saved) return false;
  setServer(saved.server);
  try {
    const response = await fetch(api('/login'), {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_number: saved.account_number })
    });
    if (!response.ok) return false;
    const result = await response.json() as { token: string };
    if (!result.token) return false;
    token = result.token;
    activeAccount = saved.account_number;
    return true;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
  if (token) {
    try {
      await fetch(api('/logout'), { method: 'POST', headers: headers() });
    } catch {
      // Local sign-out still clears the saved credential when offline.
    }
  }
  token = '';
  activeAccount = null;
  await clearAccount();
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
