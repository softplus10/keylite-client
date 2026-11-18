import { Capacitor } from '@capacitor/core';

const DB = 'keylite-credentials-v1';
const STORE = 'secure-records';
const ACCOUNT = 'account';
const KEY = 'wrapping-key';

export type SavedAccount = { server: string; account_number: string };

async function nativeStore() {
  if (!Capacitor.isNativePlatform()) return null;
  const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');
  return SecureStorage;
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read(id: string): Promise<unknown> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function write(id: string, value: unknown): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function remove(id: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function wrappingKey(): Promise<CryptoKey> {
  const existing = await read(KEY);
  if (existing instanceof CryptoKey) return existing;
  const generated = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  await write(KEY, generated);
  return generated;
}

export async function saveAccount(account: SavedAccount): Promise<void> {
  const native = await nativeStore();
  if (native) {
    await native.set({ key: ACCOUNT, value: JSON.stringify(account) });
    return;
  }
  const key = await wrappingKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(account));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  await write(ACCOUNT, { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(encrypted)) });
}

export async function loadAccount(): Promise<SavedAccount | null> {
  const native = await nativeStore();
  if (native) {
    const record = await native.get({ key: ACCOUNT });
    return record.value ? JSON.parse(record.value) as SavedAccount : null;
  }
  const record = await read(ACCOUNT) as { iv: number[]; ciphertext: number[] } | undefined;
  if (!record) return null;
  try {
    const key = await wrappingKey();
    const bytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Uint8Array.from(record.iv) },
      key, Uint8Array.from(record.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as SavedAccount;
  } catch {
    throw new Error('Saved credentials are unavailable. Sign in with your account number.');
  }
}

export async function clearAccount(): Promise<void> {
  const native = await nativeStore();
  if (native) {
    await native.remove({ key: ACCOUNT });
  } else {
    await remove(ACCOUNT);
  }
}
