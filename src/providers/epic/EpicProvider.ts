import { EpicCatalogCacheRepository, GameRepository } from "../../db/repositories";
import type { AuthState, ProviderGame, ProviderImportResult } from "../../shared/types";
import type { GameStoreProvider } from "../Provider";
import { getEpicCatalogItem, getEpicLibraryItems, getEpicPlaytimeItems } from "./epicApi";
import {
  epicCatalogCacheKey,
  failedEpicCatalogCacheRecord,
  missingEpicCatalogCacheRecord,
  okEpicCatalogCacheRecord
} from "./epicCatalogCache";
import { EpicProviderError, makeEpicError, toEpicProviderError } from "./epicErrors";
import { shouldImportEpicAsset } from "./epicFilters";
import { getStoredEpicToken, getValidEpicToken, startEpicLogin, validateEpicAccount } from "./epicAuth";
import { mapEpicAssetToProviderGame } from "./epicMappers";
import { EpicSettingsRepository } from "./epicSettings";
import type { EpicAsset, EpicCatalogItem, EpicPlaytimeItem } from "./epicTypes";

const MAX_EPIC_CATALOG_CONCURRENCY = 4;

function nowIso(): string {
  return new Date().toISOString();
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function assetCacheKey(asset: EpicAsset): string | undefined {
  return asset.namespace && asset.catalogItemId ? epicCatalogCacheKey(asset.namespace, asset.catalogItemId, asset.buildVersion) : undefined;
}

export class EpicProvider implements GameStoreProvider {
  id = "epic" as const;
  displayName = "Epic Games";
  supportsAuth = true;
  supportsManualImport = true;
  supportsBackgroundSync = true;
  accountPolicy = "single_active_account" as const;

  private readonly settingsRepository = new EpicSettingsRepository();
  private readonly catalogCacheRepository = new EpicCatalogCacheRepository();

  async getAuthState(): Promise<AuthState> {
    const settings = await this.settingsRepository.getSettings();
    const token = await getStoredEpicToken(settings.accountId);
    if (!token?.accessToken) {
      return {
        providerId: this.id,
        status: "not_connected",
        ...(settings.accountId ? { accountId: settings.accountId } : {}),
        ...(settings.displayName ? { accountName: settings.displayName } : {}),
        lastCheckedAt: nowIso()
      };
    }

    const expiresAt = token.expiresAt ? Date.parse(token.expiresAt) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      return {
        providerId: this.id,
        status: "expired",
        ...(token.accountId ? { accountId: token.accountId } : {}),
        ...(settings.displayName ? { accountName: settings.displayName } : {}),
        lastCheckedAt: nowIso(),
        error: makeEpicError("EPIC_TOKEN_EXPIRED", "Epic token is expired. Reconnect Epic.", false)
      };
    }

    return {
      providerId: this.id,
      status: "connected",
      ...(token.accountId ? { accountId: token.accountId } : {}),
      ...(settings.displayName ? { accountName: settings.displayName } : {}),
      lastCheckedAt: nowIso()
    };
  }

  async login(interactive: boolean): Promise<AuthState> {
    return startEpicLogin(interactive);
  }

  async logout(): Promise<void> {
    await this.settingsRepository.clearSettings();
    const { logoutEpic } = await import("./epicAuth");
    await logoutEpic();
  }

  async refreshAuthIfNeeded(): Promise<AuthState> {
    try {
      const token = await getValidEpicToken(false);
      return {
        providerId: this.id,
        status: "connected",
        ...(token.accountId ? { accountId: token.accountId } : {}),
        lastCheckedAt: nowIso()
      };
    } catch (error) {
      const epicError = toEpicProviderError(error);
      return {
        providerId: this.id,
        status: epicError.epicCode === "EPIC_TOKEN_EXPIRED" ? "needs_reauth" : "not_connected",
        lastCheckedAt: nowIso(),
        error: epicError
      };
    }
  }

  private async catalogForAsset(
    token: Awaited<ReturnType<typeof getValidEpicToken>>,
    asset: EpicAsset,
    warnings: ProviderImportResult["warnings"],
    signal?: AbortSignal
  ): Promise<EpicCatalogItem | undefined> {
    if (!asset.namespace || !asset.catalogItemId) {
      warnings.push({
        code: "EPIC_CATALOG_ITEM_MISSING",
        message: "Epic asset did not include namespace or catalog item ID.",
        ...(asset.appName ? { providerGameId: asset.appName } : {})
      });
      return undefined;
    }

    const key = assetCacheKey(asset)!;
    const cached = await this.catalogCacheRepository.getFreshRecord(key);
    if (cached?.status === "ok") {
      return cached.item as EpicCatalogItem;
    }
    if (cached?.status === "missing") {
      return undefined;
    }

    try {
      const item = await getEpicCatalogItem(token, asset.namespace, asset.catalogItemId, key, signal);
      if (item) {
        await this.catalogCacheRepository.saveRecord(
          okEpicCatalogCacheRecord(asset.namespace, asset.catalogItemId, item, asset.buildVersion)
        );
        return item;
      }
      await this.catalogCacheRepository.saveRecord(missingEpicCatalogCacheRecord(asset.namespace, asset.catalogItemId, asset.buildVersion));
      return undefined;
    } catch (error) {
      const epicError = toEpicProviderError(error);
      warnings.push({
        code: epicError.epicCode,
        message: `Epic catalog lookup failed for ${asset.appName ?? asset.catalogItemId}.`,
        ...(asset.appName ? { providerGameId: asset.appName } : {})
      });
      await this.catalogCacheRepository.saveRecord(
        failedEpicCatalogCacheRecord(asset.namespace, asset.catalogItemId, epicError.epicCode, asset.buildVersion)
      );
      return undefined;
    }
  }

  async importOwnedGames(signal?: AbortSignal): Promise<ProviderImportResult> {
    const settings = await this.settingsRepository.getSettings();
    const token = await getValidEpicToken(false, signal);
    const account = await validateEpicAccount(token);

    if (settings.accountId && settings.accountId !== account.accountId) {
      throw makeEpicError("EPIC_ACCOUNT_MISMATCH", "Stored Epic account and active Epic token do not match. Reconnect Epic.", false);
    }
    if (!settings.accountId || settings.displayName !== account.displayName) {
      await this.settingsRepository.saveSettings({
        accountId: account.accountId,
        ...(account.displayName ? { displayName: account.displayName } : {}),
        lastResolvedAt: nowIso()
      });
    }

    const warnings: ProviderImportResult["warnings"] = [];
    const assets = await getEpicLibraryItems(token, signal);
    if (assets.length === 0) {
      warnings.push({
        code: "EPIC_EMPTY_LIBRARY",
        message: "Epic returned no owned library assets. The account library may be empty or unavailable."
      });
    }

    const playtimeByArtifactId = new Map<string, EpicPlaytimeItem>();
    if (settings.includePlaytime) {
      try {
        const playtime = await getEpicPlaytimeItems(token, account.accountId, signal);
        for (const item of playtime) {
          playtimeByArtifactId.set(item.artifactId, item);
        }
      } catch (error) {
        const epicError = toEpicProviderError(error);
        warnings.push({ code: epicError.epicCode, message: "Epic playtime metadata could not be imported." });
      }
    }

    const catalogByCacheKey = new Map<string, EpicCatalogItem | undefined>();
    const uniqueAssets = [...new Map(assets.map((asset) => [assetCacheKey(asset) ?? asset.appName ?? crypto.randomUUID(), asset])).values()];
    if (settings.includeCatalogMetadata) {
      await mapWithConcurrency(uniqueAssets, MAX_EPIC_CATALOG_CONCURRENCY, async (asset) => {
        const key = assetCacheKey(asset);
        if (!key || catalogByCacheKey.has(key)) {
          return;
        }
        catalogByCacheKey.set(key, await this.catalogForAsset(token, asset, warnings, signal));
      });
    }

    const games: ProviderGame[] = [];
    for (const asset of assets) {
      signal?.throwIfAborted();
      const key = assetCacheKey(asset);
      const catalogItem = key ? catalogByCacheKey.get(key) : undefined;
      if (!catalogItem || !shouldImportEpicAsset(asset, catalogItem, settings)) {
        continue;
      }
      try {
        games.push(mapEpicAssetToProviderGame(asset, catalogItem, playtimeByArtifactId.get(asset.appName ?? "")));
      } catch (error) {
        warnings.push({
          code: "EPIC_API_CHANGED",
          message: error instanceof Error ? error.message : "Epic asset could not be mapped.",
          ...(asset.appName ? { providerGameId: asset.appName } : {})
        });
      }
    }

    return {
      providerId: "epic",
      accountId: account.accountId,
      importedAt: nowIso(),
      games,
      warnings
    };
  }

  async replaceAccount(oldAccountId: string, mode: "keep" | "remove"): Promise<void> {
    const gameRepository = new GameRepository();
    if (mode === "keep") {
      await gameRepository.markProviderEntriesStale("epic", oldAccountId);
    } else {
      await gameRepository.removeProviderGames("epic", oldAccountId);
    }
  }
}
