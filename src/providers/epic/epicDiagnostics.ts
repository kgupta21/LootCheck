import { AuthTokenRepository, GameRepository, SyncRunRepository } from "../../db/repositories";
import { getEpicCatalogCacheStats } from "./epicCatalogCache";
import { EpicSettingsRepository } from "./epicSettings";
import type { EpicDiagnostics } from "./epicTypes";

export async function exportEpicDiagnostics(): Promise<EpicDiagnostics> {
  const settings = await new EpicSettingsRepository().getSettings();
  const token = settings.accountId
    ? await new AuthTokenRepository().getAuthToken("epic", settings.accountId)
    : (await new AuthTokenRepository().listProviderAuthTokens("epic"))[0];
  const latestSyncRun = await new SyncRunRepository().getLatestSyncRun("epic");
  const gameRepository = new GameRepository();
  return {
    providerId: "epic",
    connected: Boolean(settings.accountId && token?.accessToken),
    accountIdPresent: Boolean(settings.accountId),
    tokenStored: Boolean(token?.accessToken),
    refreshTokenStored: Boolean(token?.refreshToken),
    ...(latestSyncRun ? { latestSyncRun } : {}),
    importedGameCount: await gameRepository.countGamesForProvider("epic"),
    staleGameCount: await gameRepository.countStaleGamesForProvider("epic"),
    cacheStats: await getEpicCatalogCacheStats(),
    recentErrors: latestSyncRun?.error
      ? [
          {
            providerId: "epic",
            code: "UNKNOWN",
            message: latestSyncRun.error,
            retryable: false
          }
        ]
      : []
  };
}
