import { Capacitor } from '@capacitor/core';

/**
 * A native install uses Android Keystore / iOS Keychain via Capacitor.
 * Browsers and extensions use an origin-bound, non-extractable AES-GCM key
 * saved with IndexedDB structured cloning. This mitigates casual storage
 * disclosure, but does NOT protect against XSS or compromised same-origin JS.
 * KDBX master passwords are never persisted.
 */
const DB = 'keylite-device-secrets-v1';
const KEY = 'local-aes-key';
const ENTRY = 'account-number';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('secrets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getItem<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction('secrets', 'readonly');
      const request = tx.objectStore('secrets').get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function putItem(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('secrets', 'readwrite');
      tx.objectStore('secrets').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function deleteItem(key: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('secrets', 'readwrite');
      tx.objectStore('secrets').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

async function localKey(create: boolean): Promise<CryptoKey | undefined> {
  let key = await getItem<CryptoKey>(KEY);
  if (!key && create) {
    key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    await putItem(KEY, key);
  }
  return key;
}

export async function saveAccount(number: string): Promise<void> {
  if (isNative()) {
    const { SecureStorage } = await import('@capnative/capacitor-secure-storage');
    await SecureStorage.set({ key: ENTRY, value: number });
    return;
  }
  const key = await localKey(true);
  if (!key) throw new Error('Unable to create an encryption key');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, encoder.encode(number)
  );
  await putItem(ENTRY, { iv: Array.from(iv), ciphertext: encrypted });
}

export async function loadAccount(): Promise<string | null> {
  if (isNative()) {
    const { SecureStorage } = await import('@capnative/capacitor-secure-storage');
    const record = await SecureStorage.get({ key: ENTRY });
    return record.value ?? null;
  }
  const record = await getItem<{iv: number[]; ciphertext: ArrayBuffer}>(ENTRY);
  if (!record) return null;
  const key = await localKey(false);
  if (!key) return null;
  try {
    const value = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
      key, record.ciphertext
    );
    return decoder.decode(value);
  } catch {
    // Never silently overwrite a corrupted remembered credential.
    throw new Error('Saved account could not be decrypted on this device');
  }
}

export async function forgetAccount(): Promise<void> {
  if (isNative()) {
    const { SecureStorage } = await import('@capnative/capacitor-secure-storage');
    await SecureStorage.remove({ key: ENTRY });
    return;
  }
  await deleteItem(ENTRY);
}
