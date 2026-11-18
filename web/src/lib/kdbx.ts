import * as kdbx from 'kdbxweb';
import { argon2d, argon2id } from 'hash-wasm';

export type Credential = {
  id: string;
  title: string;
  username: string;
  password: string;
  website: string;
  notes: string;
  group: string;
  original: kdbx.KdbxEntry;
};

let database: kdbx.Kdbx | null = null;
let configured = false;
export let filename = 'vault.kdbx';

function kdf() {
  if (configured) return;
  kdbx.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type) => {
    const config = {
      password: new Uint8Array(password), salt: new Uint8Array(salt),
      memorySize: memory, iterations, hashLength: length, parallelism,
      outputType: 'binary' as const
    };
    const output = type === 0 ? await argon2d(config) : await argon2id(config);
    return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
  });
  configured = true;
}

export function unlocked(): boolean { return database !== null; }

export async function open(bytes: ArrayBuffer, password: string, name = 'vault.kdbx') {
  kdf();
  database = await kdbx.Kdbx.load(bytes, new kdbx.Credentials(kdbx.ProtectedValue.fromString(password)));
  filename = name;
}

export function create(name: string, password: string) {
  kdf();
  database = kdbx.Kdbx.create(new kdbx.Credentials(kdbx.ProtectedValue.fromString(password)), name);
  filename = name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() + '.kdbx';
}

export function lock() { database = null; }

function get(entry: kdbx.KdbxEntry, key: string): string {
  const v = entry.fields.get(key);
  return typeof v === 'string' ? v : v?.getText() ?? '';
}

export function list(): Credential[] {
  if (!database) return [];
  const result: Credential[] = [];
  function visit(group: kdbx.KdbxGroup, parent: string) {
    const groupName = [parent, group.name].filter(Boolean).join(' / ');
    for (const entry of group.entries) {
      result.push({
        id: entry.uuid.toString(), title: get(entry, 'Title'),
        username: get(entry, 'UserName'), password: get(entry, 'Password'),
        website: get(entry, 'URL'), notes: get(entry, 'Notes'),
        group: groupName, original: entry
      });
    }
    group.groups.forEach((g) => visit(g, groupName));
  }
  database.groups.forEach((group) => visit(group, ''));
  return result.sort((a,b)=>a.title.localeCompare(b.title));
}

export function add(): string {
  if (!database) throw new Error('Unlock your vault first');
  const entry = database.createEntry(database.getDefaultGroup());
  entry.fields.set('Title', 'New Password');
  entry.fields.set('UserName', '');
  entry.fields.set('Password', kdbx.ProtectedValue.fromString(''));
  entry.fields.set('URL', '');
  entry.fields.set('Notes', '');
  entry.times.update();
  return entry.uuid.toString();
}

export function update(item: Credential, values: Pick<Credential, 'title'|'username'|'password'|'website'|'notes'>) {
  item.original.pushHistory();
  item.original.fields.set('Title', values.title);
  item.original.fields.set('UserName', values.username);
  item.original.fields.set('Password', kdbx.ProtectedValue.fromString(values.password));
  item.original.fields.set('URL', values.website);
  item.original.fields.set('Notes', values.notes);
  item.original.times.update();
}
export function remove(item: Credential) { database?.remove(item.original); }
export async function save(): Promise<ArrayBuffer> {
  if (!database) throw new Error('Unlock your vault first');
  return database.save();
}
