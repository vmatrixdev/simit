/**
 * SimIt IndexedDB Session & Version Storage
 * Conforms to docs/specs/session_memory.md
 * Database: simit_db
 * Stores:
 * 1. 'sessions' (key: id, index: updatedAt, url)
 * 2. 'versions' (key: id, index: sessionId, versionIndex, timestamp)
 */

import { SessionRecord, SimulationVersion } from '../types/session';

const DB_NAME = 'simit_db';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const VERSIONS_STORE = 'versions';

// In-memory fallback if IndexedDB is not available (e.g. Node.js unit tests)
const memorySessions = new Map<string, SessionRecord>();
const memoryVersions = new Map<string, SimulationVersion>();

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      return reject(new Error('IndexedDB not supported in this environment.'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessionStore = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        sessionStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        sessionStore.createIndex('url', 'url', { unique: false });
      }

      if (!db.objectStoreNames.contains(VERSIONS_STORE)) {
        const versionStore = db.createObjectStore(VERSIONS_STORE, { keyPath: 'id' });
        versionStore.createIndex('sessionId', 'sessionId', { unique: false });
        versionStore.createIndex('versionIndex', 'versionIndex', { unique: false });
        versionStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves or updates a session record
 */
export async function saveSession(session: SessionRecord): Promise<void> {
  if (!isIndexedDBAvailable()) {
    memorySessions.set(session.id, { ...session });
    return;
  }

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    const store = tx.objectStore(SESSIONS_STORE);
    const req = store.put(session);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves a session record by ID
 */
export async function getSession(sessionId: string): Promise<SessionRecord | undefined> {
  if (!isIndexedDBAvailable()) {
    return memorySessions.get(sessionId);
  }

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const store = tx.objectStore(SESSIONS_STORE);
    const req = store.get(sessionId);
    req.onsuccess = () => resolve(req.result || undefined);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Saves a new or updated simulation version snapshot
 */
export async function saveVersion(version: SimulationVersion): Promise<void> {
  if (!isIndexedDBAvailable()) {
    memoryVersions.set(version.id, { ...version });
    return;
  }

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VERSIONS_STORE, 'readwrite');
    const store = tx.objectStore(VERSIONS_STORE);
    const req = store.put(version);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves a specific version by its version ID
 */
export async function getVersion(versionId: string): Promise<SimulationVersion | undefined> {
  if (!isIndexedDBAvailable()) {
    return memoryVersions.get(versionId);
  }

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VERSIONS_STORE, 'readonly');
    const store = tx.objectStore(VERSIONS_STORE);
    const req = store.get(versionId);
    req.onsuccess = () => resolve(req.result || undefined);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves all versions belonging to a given session, ordered by versionIndex ascending
 */
export async function getVersionsForSession(sessionId: string): Promise<SimulationVersion[]> {
  if (!isIndexedDBAvailable()) {
    return Array.from(memoryVersions.values())
      .filter((v) => v.sessionId === sessionId)
      .sort((a, b) => a.versionIndex - b.versionIndex);
  }

  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VERSIONS_STORE, 'readonly');
    const store = tx.objectStore(VERSIONS_STORE);
    const index = store.index('sessionId');
    const req = index.getAll(sessionId);
    req.onsuccess = () => {
      const results: SimulationVersion[] = req.result || [];
      results.sort((a, b) => a.versionIndex - b.versionIndex);
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Performs a 1-click state rollback to a target version (0 network calls).
 * Updates the session's activeVersionId to the target version.
 */
export async function rollbackToVersion(
  sessionId: string,
  targetVersionId: string
): Promise<SimulationVersion> {
  let version = await getVersion(targetVersionId);
  if (!version) {
    const versions = await getVersionsForSession(sessionId);
    version = versions.find(
      (v) =>
        v.id === targetVersionId ||
        v.versionLabel === targetVersionId ||
        `ver_${v.versionLabel}` === targetVersionId ||
        `ver_v${v.versionIndex}` === targetVersionId ||
        String(v.versionIndex) === targetVersionId
    );
  }
  if (!version) {
    throw new Error(`Version ${targetVersionId} not found in storage.`);
  }

  const session = await getSession(sessionId);
  if (session) {
    session.activeVersionId = version.id;
    session.updatedAt = Date.now();
    await saveSession(session);
  }

  return version;
}
