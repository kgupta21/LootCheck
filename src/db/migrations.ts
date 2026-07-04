import { STORES } from "./schema";

export function ensureObjectStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORES.filterPresets)) {
    db.createObjectStore(STORES.filterPresets, { keyPath: "id" });
  }

  if (!db.objectStoreNames.contains(STORES.auth)) {
    const store = db.createObjectStore(STORES.auth, { keyPath: "id" });
    store.createIndex("providerId", "providerId", { unique: false });
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

  if (!db.objectStoreNames.contains(STORES.syncRunWarnings)) {
    const store = db.createObjectStore(STORES.syncRunWarnings, { keyPath: "id" });
    store.createIndex("syncRunId", "syncRunId", { unique: false });
    store.createIndex("providerId", "providerId", { unique: false });
    store.createIndex("createdAt", "createdAt", { unique: false });
  }

  if (!db.objectStoreNames.contains(STORES.providerEndpointTrace)) {
    const store = db.createObjectStore(STORES.providerEndpointTrace, { keyPath: "id" });
    store.createIndex("syncRunId", "syncRunId", { unique: false });
    store.createIndex("providerId", "providerId", { unique: false });
    store.createIndex("startedAt", "startedAt", { unique: false });
  }
}
