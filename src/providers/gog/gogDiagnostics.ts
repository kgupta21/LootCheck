import { GameRepository, SyncRunRepository } from "../../db/repositories";
import type { GogDiagnosticsExport } from "../../shared/types";
import { GogSettingsRepository } from "./gogSettings";

const gameRepository = new GameRepository();
const syncRunRepository = new SyncRunRepository();
const settingsRepository = new GogSettingsRepository();

function suggestedFixesForCodes(codes: string[]): string[] {
  const fixes = new Set<string>();
  if (codes.includes("GOG_LIBRARY_SESSION_MISSING") || codes.includes("GOG_NOT_LOGGED_IN")) {
    fixes.add("Open gog.com in Firefox, sign in, then run Check GOG login and Sync GOG again.");
  }
  if (codes.includes("GOG_LIBRARY_STATS_API_CHANGED")) {
    fixes.add("The newer GOG library endpoint shape changed. Legacy fallback was attempted.");
  }
  if (codes.includes("GOG_LEGACY_API_CHANGED")) {
    fixes.add("The legacy GOG library endpoint shape changed. Export sanitized diagnostics and update parser fixtures.");
  }
  if (codes.includes("GOG_EMPTY_LIBRARY_OR_PARSE_FAILED") || codes.includes("GOG_EMPTY_LIBRARY")) {
    fixes.add("If this account owns games, use Export sanitized GOG diagnostics and inspect endpoint trace status, content type, and item counts. Do not export cookies.");
  }
  if (codes.includes("GOG_NETWORK_ERROR") || codes.includes("GOG_RATE_LIMITED")) {
    fixes.add("Wait briefly, then retry Sync GOG now.");
  }
  return [...fixes];
}

export async function exportGogDiagnostics(): Promise<GogDiagnosticsExport> {
  const settings = await settingsRepository.getSettings();
  const latestSyncRun = await syncRunRepository.getLatestSyncRun("gog");
  const latestWarnings = latestSyncRun ? await syncRunRepository.listSyncRunWarnings(latestSyncRun.id) : await syncRunRepository.listRecentProviderWarnings("gog", 10);
  const endpointTrace = latestSyncRun ? await syncRunRepository.listEndpointTraceForSyncRun(latestSyncRun.id) : await syncRunRepository.listRecentProviderEndpointTrace("gog", 10);
  const codes = [...latestWarnings.map((warning) => warning.code), ...endpointTrace.map((trace) => trace.warningCode ?? trace.errorCode).filter((code): code is string => Boolean(code))];
  const diagnostics: GogDiagnosticsExport = {
    providerId: "gog",
    generatedAt: new Date().toISOString(),
    settings: {
      connected: Boolean(settings.accountId || settings.username),
      importExtras: settings.importExtras,
      useLegacyFallback: settings.useLegacyFallback,
      allowRawProviderResponses: settings.allowRawProviderResponses,
      directAuthSupported: settings.directAuthSupported
    },
    latestWarnings,
    endpointTrace,
    suggestedFixes: suggestedFixesForCodes(codes),
    importedGameCount: await gameRepository.countGamesForProvider("gog"),
    staleGameCount: await gameRepository.countStaleGamesForProvider("gog"),
    notes: [
      "Diagnostics intentionally exclude sensitive browser session data, credentials, and raw GOG library responses.",
      "GOG login uses the browser session only after the user signs in directly on gog.com."
    ]
  };
  if (settings.username) {
    diagnostics.settings.username = settings.username;
  }
  if (settings.accountId) {
    diagnostics.settings.accountId = settings.accountId;
  }
  if (latestSyncRun) {
    diagnostics.latestSyncRun = latestSyncRun;
  }
  return diagnostics;
}
