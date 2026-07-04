import { STORES } from "./schema";
import { requestToPromise, withStore } from "./indexedDb";
import { defaultFilterPresets } from "../filters/filterPreset";
import { makeSortTitle, normalizeTitle, titleAliases } from "../matching/normalizeTitle";
import type {
  AuthTokenRecord,
  FilterPreset,
  GameRecord,
  ProviderEndpointTrace,
  ProviderEntry,
  ProviderGame,
  ProviderImportResult,
  EpicCatalogCacheRecord,
  SteamAppCacheRecord,
  StoreId,
  SyncRun,
  SyncRunWarning,
  SyncSettings
} from "../shared/types";

type IndexRecord = {
  id: string;
  normalizedTitleOrAlias: string;
  gameId: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function makeId(): string {
  return crypto.randomUUID();
}

function buildGameFromProviderGame(game: ProviderGame, result: ProviderImportResult): GameRecord {
  const importedAt = result.importedAt;
  const aliases = titleAliases(game.title, game.aliases);
  const providerEntry: ProviderEntry = {
    providerId: result.providerId,
    providerGameId: game.providerGameId,
    sourceTitle: game.title,
    importedAt
  };
  const record: GameRecord = {
    id: makeId(),
    canonicalTitle: game.title.trim(),
    normalizedTitle: normalizeTitle(game.title),
    sortTitle: game.sortTitle ?? makeSortTitle(game.title),
    aliases,
    normalizedAliases: unique(aliases.map(normalizeTitle)),
    providerEntries: [providerEntry],
    platforms: unique(game.platform ?? []),
    tags: unique(game.tags ?? []),
    categories: unique(game.categories ?? []),
    addedAt: importedAt,
    updatedAt: importedAt
  };

  if (result.accountId) providerEntry.accountId = result.accountId;
  if (game.url) providerEntry.sourceUrl = game.url;
  if (game.raw !== undefined) providerEntry.raw = game.raw;
  if (game.isInstalled !== undefined) record.isInstalled = game.isInstalled;
  if (game.playtimeMinutes !== undefined) record.playtimeMinutes = game.playtimeMinutes;
  if (game.lastPlayedAt) record.lastPlayedAt = game.lastPlayedAt;

  return record;
}

function mergeGame(existing: GameRecord, incoming: GameRecord): GameRecord {
  const providerEntries = [...existing.providerEntries];

  for (const incomingEntry of incoming.providerEntries) {
    const existingIndex = providerEntries.findIndex(
      (entry) =>
        entry.providerId === incomingEntry.providerId &&
        entry.providerGameId === incomingEntry.providerGameId &&
        entry.accountId === incomingEntry.accountId
    );
    if (existingIndex >= 0) {
      providerEntries[existingIndex] = incomingEntry;
    } else {
      providerEntries.push(incomingEntry);
    }
  }

  const aliases = unique([
    ...existing.aliases,
    ...incoming.aliases,
    incoming.canonicalTitle === existing.canonicalTitle ? undefined : incoming.canonicalTitle
  ]);

  const merged: GameRecord = {
    ...existing,
    aliases,
    normalizedAliases: unique([...aliases.map(normalizeTitle), ...existing.normalizedAliases, ...incoming.normalizedAliases]),
    providerEntries,
    platforms: unique([...existing.platforms, ...incoming.platforms]),
    tags: unique([...existing.tags, ...incoming.tags]),
    categories: unique([...existing.categories, ...incoming.categories]),
    updatedAt: incoming.updatedAt
  };

  const isInstalled = existing.isInstalled || incoming.isInstalled;
  if (isInstalled !== undefined) {
    merged.isInstalled = isInstalled;
  } else {
    delete merged.isInstalled;
  }

  const playtimeMinutes = Math.max(existing.playtimeMinutes ?? 0, incoming.playtimeMinutes ?? 0);
  if (playtimeMinutes > 0) {
    merged.playtimeMinutes = playtimeMinutes;
  } else {
    delete merged.playtimeMinutes;
  }

  const lastPlayedAt = [existing.lastPlayedAt, incoming.lastPlayedAt].filter(Boolean).sort().at(-1);
  if (lastPlayedAt) {
    merged.lastPlayedAt = lastPlayedAt;
  } else {
    delete merged.lastPlayedAt;
  }

  if (merged.isInstalled === undefined) {
    delete merged.isInstalled;
  }

  return merged;
}

export class GameRepository {
  async getAllGames(): Promise<GameRecord[]> {
    return withStore(STORES.games, "readonly", async (stores) => requestToPromise(stores[STORES.games]!.getAll()));
  }

  async countGamesForProvider(providerId: StoreId): Promise<number> {
    const games = await this.getAllGames();
    return games.filter((game) => game.providerEntries.some((entry) => entry.providerId === providerId && !entry.isStale)).length;
  }

  async countStaleGamesForProvider(providerId: StoreId): Promise<number> {
    const games = await this.getAllGames();
    return games.filter((game) => game.providerEntries.some((entry) => entry.providerId === providerId && entry.isStale)).length;
  }

  async searchByTitle(searchText: string): Promise<GameRecord[]> {
    const normalizedSearch = normalizeTitle(searchText);
    const games = await this.getAllGames();
    if (!normalizedSearch) {
      return games.sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));
    }
    return games
      .filter(
        (game) =>
          game.normalizedTitle.includes(normalizedSearch) ||
          game.normalizedAliases.some((alias) => alias.includes(normalizedSearch))
      )
      .sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));
  }

  async importProviderResult(result: ProviderImportResult): Promise<{ importedCount: number; warningCount: number }> {
    const validGames = result.games.filter((game) => normalizeTitle(game.title));
    const existingGames = await this.getAllGames();

    const mergedById = new Map(existingGames.map((game) => [game.id, game]));
    const byNormalizedTitle = new Map(existingGames.map((game) => [game.normalizedTitle, game.id]));
    for (const game of existingGames) {
      for (const alias of game.normalizedAliases) {
        byNormalizedTitle.set(alias, game.id);
      }
    }

    for (const providerGame of validGames) {
      const incoming = buildGameFromProviderGame(providerGame, result);
      const matchedId =
        byNormalizedTitle.get(incoming.normalizedTitle) ??
        incoming.normalizedAliases.map((alias) => byNormalizedTitle.get(alias)).find(Boolean);

      if (matchedId) {
        const merged = mergeGame(mergedById.get(matchedId)!, incoming);
        mergedById.set(matchedId, merged);
        byNormalizedTitle.set(merged.normalizedTitle, matchedId);
        for (const alias of merged.normalizedAliases) {
          byNormalizedTitle.set(alias, matchedId);
        }
      } else {
        mergedById.set(incoming.id, incoming);
        byNormalizedTitle.set(incoming.normalizedTitle, incoming.id);
        for (const alias of incoming.normalizedAliases) {
          byNormalizedTitle.set(alias, incoming.id);
        }
      }
    }

    await this.replaceAllGames([...mergedById.values()]);

    return { importedCount: validGames.length, warningCount: result.warnings.length };
  }

  async markProviderEntriesStale(providerId: StoreId, accountId?: string): Promise<number> {
    const games = await this.getAllGames();
    let changed = 0;
    const updated = games.map((game) => {
      const providerEntries = game.providerEntries.map((entry) => {
        if (entry.providerId !== providerId || (accountId && entry.accountId !== accountId) || entry.isStale) {
          return entry;
        }
        changed += 1;
        return { ...entry, isStale: true };
      });
      return { ...game, providerEntries, updatedAt: changed ? nowIso() : game.updatedAt };
    });
    if (changed > 0) {
      await this.replaceAllGames(updated);
    }
    return changed;
  }

  async removeProviderGames(providerId: StoreId, accountId?: string): Promise<number> {
    const games = await this.getAllGames();
    let removedEntries = 0;
    const updated: GameRecord[] = [];
    for (const game of games) {
      const providerEntries = game.providerEntries.filter((entry) => {
        const remove = entry.providerId === providerId && (!accountId || entry.accountId === accountId);
        if (remove) {
          removedEntries += 1;
        }
        return !remove;
      });
      if (providerEntries.length > 0) {
        updated.push({ ...game, providerEntries, updatedAt: providerEntries.length === game.providerEntries.length ? game.updatedAt : nowIso() });
      }
    }
    if (removedEntries > 0) {
      await this.replaceAllGames(updated);
    }
    return removedEntries;
  }

  private async replaceAllGames(games: GameRecord[]): Promise<void> {
    await withStore([STORES.games, STORES.aliases, STORES.normalizedTitleIndex], "readwrite", async (stores) => {
      const gamesStore = stores[STORES.games]!;
      const aliasesStore = stores[STORES.aliases]!;
      const indexStore = stores[STORES.normalizedTitleIndex]!;

      const pending: Array<Promise<unknown>> = [
        requestToPromise(gamesStore.clear()),
        requestToPromise(aliasesStore.clear()),
        requestToPromise(indexStore.clear())
      ];

      for (const game of games) {
        pending.push(requestToPromise(gamesStore.put(game)));
        const aliases = [game.normalizedTitle, ...game.normalizedAliases];
        for (const [index, normalizedTitleOrAlias] of aliases.entries()) {
          const record: IndexRecord = {
            id: `${game.id}:${index}:${normalizedTitleOrAlias}`,
            normalizedTitleOrAlias,
            gameId: game.id
          };
          pending.push(requestToPromise(indexStore.put(record)));
          if (index > 0) {
            pending.push(
              requestToPromise(
                aliasesStore.put({
                  id: `${game.id}:${index}:${normalizedTitleOrAlias}`,
                  normalizedAlias: normalizedTitleOrAlias,
                  gameId: game.id
                })
              )
            );
          }
        }
      }
      await Promise.all(pending);
    });
  }

  async clearAllData(): Promise<void> {
    await withStore(
      [
        STORES.games,
        STORES.providers,
        STORES.auth,
        STORES.aliases,
        STORES.normalizedTitleIndex,
        STORES.syncRuns,
        STORES.syncRunWarnings,
        STORES.providerEndpointTrace,
        STORES.settings,
        STORES.steamAppCache,
        STORES.epicCatalogCache
      ],
      "readwrite",
      async (stores) => {
        for (const store of Object.values(stores)) {
          store.clear();
        }
      }
    );
  }
}

export class SyncRunRepository {
  async createSyncRun(providerId: StoreId): Promise<SyncRun> {
    const run: SyncRun = {
      id: crypto.randomUUID(),
      providerId,
      startedAt: nowIso(),
      status: "running",
      importedCount: 0,
      warningCount: 0
    };
    await withStore(STORES.syncRuns, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.syncRuns]!.put(run));
    });
    return run;
  }

  async finishSyncRun(id: string, update: Partial<SyncRun>): Promise<void> {
    await withStore(STORES.syncRuns, "readwrite", async (stores) => {
      const store = stores[STORES.syncRuns]!;
      const existing = (await requestToPromise(store.get(id))) as SyncRun | undefined;
      if (!existing) {
        throw new Error(`Sync run not found: ${id}`);
      }
      await requestToPromise(
        store.put({
          ...existing,
          ...update,
          id: existing.id,
          providerId: existing.providerId
        })
      );
    });
  }

  async addSyncRunWarning(warning: SyncRunWarning): Promise<void> {
    await withStore(STORES.syncRunWarnings, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.syncRunWarnings]!.put(warning));
    });
  }

  async addSyncRunWarnings(warnings: SyncRunWarning[]): Promise<void> {
    if (warnings.length === 0) {
      return;
    }
    await withStore(STORES.syncRunWarnings, "readwrite", async (stores) => {
      const store = stores[STORES.syncRunWarnings]!;
      await Promise.all(warnings.map((warning) => requestToPromise(store.put(warning))));
    });
  }

  async listSyncRunWarnings(syncRunId: string): Promise<SyncRunWarning[]> {
    return withStore(STORES.syncRunWarnings, "readonly", async (stores) => {
      const warnings = (await requestToPromise(stores[STORES.syncRunWarnings]!.getAll())) as SyncRunWarning[];
      return warnings.filter((warning) => warning.syncRunId === syncRunId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }

  async listRecentProviderWarnings(providerId: StoreId, limit = 20): Promise<SyncRunWarning[]> {
    return withStore(STORES.syncRunWarnings, "readonly", async (stores) => {
      const warnings = (await requestToPromise(stores[STORES.syncRunWarnings]!.getAll())) as SyncRunWarning[];
      return warnings
        .filter((warning) => warning.providerId === providerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    });
  }

  async addProviderEndpointTrace(trace: ProviderEndpointTrace): Promise<void> {
    await withStore(STORES.providerEndpointTrace, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.providerEndpointTrace]!.put(trace));
    });
  }

  async addProviderEndpointTraces(traces: ProviderEndpointTrace[]): Promise<void> {
    if (traces.length === 0) {
      return;
    }
    await withStore(STORES.providerEndpointTrace, "readwrite", async (stores) => {
      const store = stores[STORES.providerEndpointTrace]!;
      await Promise.all(traces.map((trace) => requestToPromise(store.put(trace))));
    });
  }

  async listEndpointTraceForSyncRun(syncRunId: string): Promise<ProviderEndpointTrace[]> {
    return withStore(STORES.providerEndpointTrace, "readonly", async (stores) => {
      const traces = (await requestToPromise(stores[STORES.providerEndpointTrace]!.getAll())) as ProviderEndpointTrace[];
      return traces.filter((trace) => trace.syncRunId === syncRunId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    });
  }

  async listRecentProviderEndpointTrace(providerId: StoreId, limit = 20): Promise<ProviderEndpointTrace[]> {
    return withStore(STORES.providerEndpointTrace, "readonly", async (stores) => {
      const traces = (await requestToPromise(stores[STORES.providerEndpointTrace]!.getAll())) as ProviderEndpointTrace[];
      return traces
        .filter((trace) => trace.providerId === providerId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit);
    });
  }

  syncRunWarningsFromImportResult(syncRunId: string, result: ProviderImportResult): SyncRunWarning[] {
    return result.warnings.map((warning, index) => ({
      id: `${syncRunId}:warning:${index}:${warning.code}`,
      syncRunId,
      providerId: result.providerId,
      code: warning.code,
      message: warning.message,
      ...(warning.phase ? { phase: warning.phase } : {}),
      ...(warning.endpoint ? { endpoint: warning.endpoint } : {}),
      ...(warning.retryable !== undefined ? { retryable: warning.retryable } : {}),
      createdAt: nowIso()
    }));
  }

  endpointTracesFromImportResult(syncRunId: string, result: ProviderImportResult): ProviderEndpointTrace[] {
    return (result.endpointTrace ?? []).map((trace, index) => ({
      id: `${syncRunId}:trace:${index}:${trace.endpointKey}`,
      syncRunId,
      providerId: result.providerId,
      ...trace
    }));
  }

  async listRecentSyncRuns(providerId?: StoreId, limit = 20): Promise<SyncRun[]> {
    return withStore(STORES.syncRuns, "readonly", async (stores) => {
      const runs = (await requestToPromise(stores[STORES.syncRuns]!.getAll())) as SyncRun[];
      return runs
        .filter((run) => !providerId || run.providerId === providerId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit);
    });
  }

  async getLatestSyncRun(providerId: StoreId): Promise<SyncRun | undefined> {
    return (await this.listRecentSyncRuns(providerId, 1))[0];
  }

  async recordManualImport(providerId: StoreId, importedCount: number, warningCount: number, error?: string): Promise<void> {
    const timestamp = nowIso();
    const run = await this.createSyncRun(providerId);
    const update: Partial<SyncRun> = {
      startedAt: timestamp,
      finishedAt: timestamp,
      status: error ? "failed" : warningCount ? "partial" : "success",
      importedCount,
      warningCount
    };
    if (error) {
      update.error = error;
    }
    await this.finishSyncRun(run.id, update);
  }
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  scheduledSyncEnabled: false,
  scheduledSyncIntervalHours: 24,
  providerIds: ["steam", "gog", "amazon"]
};

export function normalizeSyncSettings(settings: SyncSettings): SyncSettings {
  const interval = Number.isFinite(Number(settings.scheduledSyncIntervalHours)) ? Number(settings.scheduledSyncIntervalHours) : 24;
  return {
    scheduledSyncEnabled: Boolean(settings.scheduledSyncEnabled),
    scheduledSyncIntervalHours: Math.max(1, Math.floor(interval)),
    providerIds: [...new Set(settings.providerIds.filter((providerId) => providerId !== "manual"))]
  };
}

export class SettingsRepository {
  async getSetting<T>(key: string): Promise<T | undefined> {
    return withStore(STORES.settings, "readonly", async (stores) => {
      const record = (await requestToPromise(stores[STORES.settings]!.get(key))) as { key: string; value: T } | undefined;
      return record?.value;
    });
  }

  async saveSetting<T>(key: string, value: T): Promise<void> {
    await withStore(STORES.settings, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.settings]!.put({ key, value }));
    });
  }

  async deleteSetting(key: string): Promise<void> {
    await withStore(STORES.settings, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.settings]!.delete(key));
    });
  }

  async getSyncSettings(): Promise<SyncSettings> {
    return withStore(STORES.settings, "readonly", async (stores) => {
      const record = (await requestToPromise(stores[STORES.settings]!.get("syncSettings"))) as
        | { key: "syncSettings"; value: SyncSettings }
        | undefined;
      return normalizeSyncSettings(record?.value ?? DEFAULT_SYNC_SETTINGS);
    });
  }

  async saveSyncSettings(settings: SyncSettings): Promise<SyncSettings> {
    const normalized = normalizeSyncSettings(settings);
    await withStore(STORES.settings, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.settings]!.put({ key: "syncSettings", value: normalized }));
    });
    return normalized;
  }
}

export class SteamAppCacheRepository {
  async getFreshAppDetails(appId: number): Promise<SteamAppCacheRecord | undefined> {
    const record = (await withStore(STORES.steamAppCache, "readonly", async (stores) =>
      requestToPromise(stores[STORES.steamAppCache]!.get(appId))
    )) as SteamAppCacheRecord | undefined;
    if (!record) {
      return undefined;
    }
    const expiresAt = Date.parse(record.expiresAt);
    return Number.isFinite(expiresAt) && Date.now() <= expiresAt ? record : undefined;
  }

  async saveAppDetails(record: SteamAppCacheRecord): Promise<void> {
    await withStore(STORES.steamAppCache, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.steamAppCache]!.put(record));
    });
  }

  async listAppDetails(): Promise<SteamAppCacheRecord[]> {
    return withStore(STORES.steamAppCache, "readonly", async (stores) =>
      requestToPromise(stores[STORES.steamAppCache]!.getAll())
    );
  }

  async clearAppDetails(): Promise<void> {
    await withStore(STORES.steamAppCache, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.steamAppCache]!.clear());
    });
  }
}

function authTokenId(providerId: StoreId, accountId?: string): string {
  return `${providerId}:${accountId ?? "default"}`;
}

export class AuthTokenRepository {
  async getAuthToken(providerId: StoreId, accountId?: string): Promise<AuthTokenRecord | undefined> {
    return withStore(STORES.auth, "readonly", async (stores) => {
      return requestToPromise(stores[STORES.auth]!.get(authTokenId(providerId, accountId)));
    });
  }

  async saveAuthToken(record: AuthTokenRecord): Promise<void> {
    const now = nowIso();
    const normalized: AuthTokenRecord = {
      ...record,
      id: authTokenId(record.providerId, record.accountId),
      createdAt: record.createdAt || now,
      updatedAt: now
    };
    await withStore(STORES.auth, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.auth]!.put(normalized));
    });
  }

  async deleteAuthToken(providerId: StoreId, accountId?: string): Promise<void> {
    await withStore(STORES.auth, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.auth]!.delete(authTokenId(providerId, accountId)));
    });
  }

  async deleteProviderAuthTokens(providerId: StoreId): Promise<void> {
    await withStore(STORES.auth, "readwrite", async (stores) => {
      const store = stores[STORES.auth]!;
      const tokens = (await requestToPromise(store.getAll())) as AuthTokenRecord[];
      await Promise.all(
        tokens
          .filter((token) => token.providerId === providerId)
          .map((token) => requestToPromise(store.delete(token.id ?? authTokenId(token.providerId, token.accountId))))
      );
    });
  }

  async listProviderAuthTokens(providerId: StoreId): Promise<AuthTokenRecord[]> {
    return withStore(STORES.auth, "readonly", async (stores) => {
      const tokens = (await requestToPromise(stores[STORES.auth]!.getAll())) as AuthTokenRecord[];
      return tokens.filter((token) => token.providerId === providerId);
    });
  }
}

export class EpicCatalogCacheRepository {
  async getFreshRecord(key: string): Promise<EpicCatalogCacheRecord | undefined> {
    const record = (await withStore(STORES.epicCatalogCache, "readonly", async (stores) =>
      requestToPromise(stores[STORES.epicCatalogCache]!.get(key))
    )) as EpicCatalogCacheRecord | undefined;
    if (!record) {
      return undefined;
    }
    const expiresAt = Date.parse(record.expiresAt);
    return Number.isFinite(expiresAt) && Date.now() <= expiresAt ? record : undefined;
  }

  async saveRecord(record: EpicCatalogCacheRecord): Promise<void> {
    await withStore(STORES.epicCatalogCache, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.epicCatalogCache]!.put(record));
    });
  }

  async listRecords(): Promise<EpicCatalogCacheRecord[]> {
    return withStore(STORES.epicCatalogCache, "readonly", async (stores) =>
      requestToPromise(stores[STORES.epicCatalogCache]!.getAll())
    );
  }

  async clear(): Promise<void> {
    await withStore(STORES.epicCatalogCache, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.epicCatalogCache]!.clear());
    });
  }
}

export class FilterPresetRepository {
  async listFilterPresets(): Promise<FilterPreset[]> {
    return withStore(STORES.filterPresets, "readonly", async (stores) => {
      const presets = (await requestToPromise(stores[STORES.filterPresets]!.getAll())) as FilterPreset[];
      return presets.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
    });
  }

  async getFilterPreset(id: string): Promise<FilterPreset | undefined> {
    return withStore(STORES.filterPresets, "readonly", async (stores) =>
      requestToPromise(stores[STORES.filterPresets]!.get(id))
    );
  }

  async saveFilterPreset(preset: FilterPreset): Promise<void> {
    await withStore(STORES.filterPresets, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.filterPresets]!.put(preset));
    });
  }

  async deleteFilterPreset(id: string): Promise<void> {
    await withStore(STORES.filterPresets, "readwrite", async (stores) => {
      await requestToPromise(stores[STORES.filterPresets]!.delete(id));
    });
  }

  async ensureDefaultFilterPresets(): Promise<void> {
    const defaults = defaultFilterPresets();
    await withStore(STORES.filterPresets, "readwrite", async (stores) => {
      const store = stores[STORES.filterPresets]!;
      const pending: Array<Promise<unknown>> = [];
      for (const preset of defaults) {
        const existing = await requestToPromise(store.get(preset.id));
        if (!existing) {
          pending.push(requestToPromise(store.put(preset)));
        }
      }
      await Promise.all(pending);
    });
  }
}
