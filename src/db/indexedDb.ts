import { DB_NAME, DB_VERSION, STORES } from "./schema";
import { ensureObjectStores } from "./migrations";

let dbPromise: Promise<IDBDatabase> | undefined;

export function resetDatabaseConnectionForTests(): void {
  dbPromise = undefined;
}

export function openOwnCheckDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORES.games)) {
        const store = db.createObjectStore(STORES.games, { keyPath: "id" });
        store.createIndex("normalizedTitle", "normalizedTitle", { unique: false });
        store.createIndex("canonicalTitle", "canonicalTitle", { unique: false });
        store.createIndex("sortTitle", "sortTitle", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.providers)) {
        db.createObjectStore(STORES.providers, { keyPath: "id" });
      }

      if (db.objectStoreNames.contains(STORES.auth)) {
        const authStore = request.transaction?.objectStore(STORES.auth);
        if (authStore?.keyPath !== "id") {
          db.deleteObjectStore(STORES.auth);
        }
      }

      if (!db.objectStoreNames.contains(STORES.auth)) {
        const store = db.createObjectStore(STORES.auth, { keyPath: "id" });
        store.createIndex("providerId", "providerId", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.aliases)) {
        const store = db.createObjectStore(STORES.aliases, { keyPath: "id" });
        store.createIndex("normalizedAlias", "normalizedAlias", { unique: false });
        store.createIndex("gameId", "gameId", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.normalizedTitleIndex)) {
        const store = db.createObjectStore(STORES.normalizedTitleIndex, { keyPath: "id" });
        store.createIndex("normalizedTitleOrAlias", "normalizedTitleOrAlias", { unique: false });
        store.createIndex("gameId", "gameId", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.syncRuns)) {
        const store = db.createObjectStore(STORES.syncRuns, { keyPath: "id" });
        store.createIndex("providerId", "providerId", { unique: false });
        store.createIndex("startedAt", "startedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.filterPresets)) {
        db.createObjectStore(STORES.filterPresets, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORES.steamAppCache)) {
        db.createObjectStore(STORES.steamAppCache, { keyPath: "appId" });
      }

      if (!db.objectStoreNames.contains(STORES.epicCatalogCache)) {
        const store = db.createObjectStore(STORES.epicCatalogCache, { keyPath: "key" });
        store.createIndex("namespace", "namespace", { unique: false });
        store.createIndex("catalogItemId", "catalogItemId", { unique: false });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
      }

      ensureObjectStores(db);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function withStore<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  callback: (stores: Record<string, IDBObjectStore>, transaction: IDBTransaction) => T | Promise<T>
): Promise<T> {
  const db = await openOwnCheckDb();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const transaction = db.transaction(names, mode);
  const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)]));
  const done = transactionDone(transaction);
  const result = await callback(stores, transaction);
  await done;
  return result;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function deleteOwnCheckDb(): Promise<void> {
  const db = dbPromise ? await dbPromise : undefined;
  db?.close();
  dbPromise = undefined;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database delete is blocked by another LootCheck tab."));
  });
}
