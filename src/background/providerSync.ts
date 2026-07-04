import { GameRepository, SyncRunRepository } from "../db/repositories";
import { getProvider, listProviders, providerSummary } from "../providers/providerRegistry";
import { makeProviderError, redactSensitiveError } from "../shared/errors";
import type { ProviderStatus, StoreId, SyncOptions, SyncRun } from "../shared/types";

const gameRepository = new GameRepository();
const syncRunRepository = new SyncRunRepository();

async function failRun(run: SyncRun, error: unknown, fallbackProviderId: StoreId): Promise<SyncRun> {
  const providerError = redactSensitiveError(error, fallbackProviderId);
  const update: Partial<SyncRun> = {
    finishedAt: new Date().toISOString(),
    status: "failed",
    importedCount: 0,
    warningCount: 0,
    error: providerError.message
  };
  await syncRunRepository.finishSyncRun(run.id, update);
  return { ...run, ...update };
}

export async function syncProvider(providerId: StoreId, options: SyncOptions = {}): Promise<SyncRun> {
  const run = await syncRunRepository.createSyncRun(providerId);
  const provider = getProvider(providerId);
  if (!provider) {
    return failRun(run, makeProviderError(providerId, "UNKNOWN", `Unknown provider: ${providerId}`, false), providerId);
  }

  if (!provider.supportsBackgroundSync) {
    return failRun(
      run,
      makeProviderError(providerId, "UNSUPPORTED", `${provider.displayName} does not support background sync.`, false),
      providerId
    );
  }

  try {
    const authState = await provider.refreshAuthIfNeeded();
    if (provider.supportsAuth && authState.status !== "connected") {
      const code = authState.status === "not_supported" ? "UNSUPPORTED" : "AUTH_REQUIRED";
      throw makeProviderError(
        providerId,
        code,
        authState.error?.message ?? `${provider.displayName} needs a supported connection before syncing.`,
        code === "AUTH_REQUIRED"
      );
    }

    const result = await provider.importOwnedGames(options.signal);
    const summary = await gameRepository.importProviderResult(result);
    await syncRunRepository.addSyncRunWarnings(syncRunRepository.syncRunWarningsFromImportResult(run.id, result));
    await syncRunRepository.addProviderEndpointTraces(syncRunRepository.endpointTracesFromImportResult(run.id, result));
    const update: Partial<SyncRun> = {
      finishedAt: new Date().toISOString(),
      status: summary.warningCount ? "partial" : "success",
      importedCount: summary.importedCount,
      warningCount: summary.warningCount
    };
    await syncRunRepository.finishSyncRun(run.id, update);
    return { ...run, ...update };
  } catch (error) {
    return failRun(run, error, providerId);
  }
}

export async function syncAllProviders(options: SyncOptions = {}): Promise<SyncRun[]> {
  const runs: SyncRun[] = [];
  for (const provider of listProviders()) {
    if (!provider.supportsBackgroundSync) {
      continue;
    }
    runs.push(await syncProvider(provider.id, { ...options, interactive: false }));
  }
  return runs;
}

export async function getProviderStatuses(providerId?: StoreId): Promise<ProviderStatus[]> {
  const providers = providerId ? [getProvider(providerId)].filter(Boolean) : listProviders();
  return Promise.all(
    providers.map(async (provider) => {
      const latestSyncRun = await syncRunRepository.getLatestSyncRun(provider!.id);
      const latestWarnings = latestSyncRun ? await syncRunRepository.listSyncRunWarnings(latestSyncRun.id) : [];
      return {
        ...providerSummary(provider!),
        authState: await provider!.getAuthState(),
        ...(latestSyncRun ? { latestSyncRun } : {}),
        ...(latestWarnings.length ? { latestWarnings } : {}),
        importedGameCount: await gameRepository.countGamesForProvider(provider!.id),
        staleGameCount: await gameRepository.countStaleGamesForProvider(provider!.id)
      };
    })
  );
}
