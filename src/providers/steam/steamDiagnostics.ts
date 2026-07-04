import { SteamAppCacheRepository, SyncRunRepository } from "../../db/repositories";
import { makeProviderError } from "../../shared/errors";
import type { ProviderError, SyncRun } from "../../shared/types";
import { steamCacheStats, type SteamCacheStats } from "./steamCache";
import { redactSteamApiKey } from "./steamErrors";
import { SteamSettingsRepository } from "./steamSettings";

export interface SteamDiagnosticsExport {
  providerId: "steam";
  settings: {
    steamId64Present: boolean;
    vanityNamePresent: boolean;
    profileUrlPresent: boolean;
    apiKeyStored: boolean;
    includeFreeGames: boolean;
    includeAppInfo: boolean;
  };
  latestSyncRun?: SyncRun;
  cacheStats: SteamCacheStats;
  recentErrors: ProviderError[];
}

export async function exportSteamDiagnostics(): Promise<SteamDiagnosticsExport> {
  const settings = await new SteamSettingsRepository().getSettings();
  const latestSyncRun = await new SyncRunRepository().getLatestSyncRun("steam");
  const recentRuns = await new SyncRunRepository().listRecentSyncRuns("steam", 5);
  const cacheRecords = await new SteamAppCacheRepository().listAppDetails();
  const diagnostics: SteamDiagnosticsExport = {
    providerId: "steam",
    settings: {
      steamId64Present: Boolean(settings.steamId64),
      vanityNamePresent: Boolean(settings.vanityName),
      profileUrlPresent: Boolean(settings.profileUrl),
      apiKeyStored: settings.apiKeyStored,
      includeFreeGames: settings.includeFreeGames,
      includeAppInfo: settings.includeAppInfo
    },
    cacheStats: steamCacheStats(cacheRecords),
    recentErrors: recentRuns
      .filter((run) => run.error)
      .map((run) => makeProviderError("steam", "UNKNOWN", redactSteamApiKey(run.error!), true))
  };
  if (latestSyncRun) {
    diagnostics.latestSyncRun = {
      ...latestSyncRun,
      ...(latestSyncRun.error ? { error: redactSteamApiKey(latestSyncRun.error) } : {})
    };
  }
  return diagnostics;
}
