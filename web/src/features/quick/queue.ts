/**
 * Receipts taken without signal wait in IndexedDB on the phone and go up once the connection is
 * back. Only a network failure queues a file. A server answer, even an error, never does, so a
 * rejected file is never retried forever. Every call fails soft: without IndexedDB (private
 * browsing, tests) nothing queues and the upload error shows instead.
 */
const DB_NAME = 'mtn-ledger-quick';
const STORE = 'pending';

export interface PendingReceipt {
  id: number;
  name: string;
  type: string;
  lastModified: number;
  data: Blob;
  queuedAt: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB is not available.'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function queueReceipt(file: File): Promise<boolean> {
  try {
    const row = { name: file.name, type: file.type, lastModified: file.lastModified, data: file, queuedAt: new Date().toISOString() };
    await withStore('readwrite', (s) => s.add(row));
    return true;
  } catch {
    return false;
  }
}

export async function pendingReceipts(): Promise<PendingReceipt[]> {
  try {
    return await withStore('readonly', (s) => s.getAll() as IDBRequest<PendingReceipt[]>);
  } catch {
    return [];
  }
}

export async function dropPending(id: number): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(id));
  } catch {
    // Nothing to drop.
  }
}

export function toFile(p: PendingReceipt): File {
  return new File([p.data], p.name, { type: p.type, lastModified: p.lastModified });
}

/** fetch() rejects with a TypeError when the request never reached a server. */
export function isNetworkFailure(e: unknown): boolean {
  return e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}
