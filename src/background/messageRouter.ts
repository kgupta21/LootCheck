import { AuthTokenRepository, EpicCatalogCacheRepository, SettingsRepository, SyncRunRepository } from "../db/repositories";
import { GameRepository } from "../db/repositories";
import { matchOwnedGames } from "../matching/ownershipMatcher";
import { redactSensitiveError } from "../shared/errors";
import { assistedSessionGamesToProviderImportResult, openAssistedProviderLoginOrLibrary, startAssistedProviderImport } from "../providers/assisted/assistedImport";
import type { AssistedProviderId } from "../providers/assisted/assistedTypes";
import { listProviders, providerSummary } from "../providers/providerRegistry";
import { exchangeEpicAuthorizationCode, openEpicAuthorizationPage, validateEpicAccount } from "../providers/epic/epicAuth";
import { exportEpicDiagnostics } from "../providers/epic/epicDiagnostics";
import { EpicProvider } from "../providers/epic/EpicProvider";
import { makeEpicError, toEpicProviderError } from "../providers/epic/epicErrors";
import { getEpicFeasibilityStatus, EpicSettingsRepository } from "../providers/epic/epicSettings";
import { getGogAccountBasic, getGogOwnedGamesLegacy, getGogOwnedGamesNewApi } from "../providers/gog/gogApi";
import { gogLoginLaunchResult } from "../providers/gog/gogAuth";
import { exportGogDiagnostics } from "../providers/gog/gogDiagnostics";
import { makeGogError, makeProviderErrorFromGog, toGogProviderError } from "../providers/gog/gogErrors";
import { GogSettingsRepository } from "../providers/gog/gogSettings";
import { resolveSteamIdentity } from "../providers/steam/steamApi";
import { getOwnedGames } from "../providers/steam/steamApi";
import { clearSteamMetadataCache } from "../providers/steam/steamCache";
import { exportSteamDiagnostics } from "../providers/steam/steamDiagnostics";
import { SteamSettingsRepository, parseSteamIdentityInput } from "../providers/steam/steamSettings";
import { getProviderStatuses, syncAllProviders, syncProvider } from "./providerSync";
import { updateSyncSchedule } from "./syncScheduler";
import type { AuthState, CheckOwnershipMessage, ImportWarning, OwnershipResultMessage, ProviderEndpointTraceInput, ProviderMessage, SyncRun } from "../shared/types";

const gameRepository = new GameRepository();
const settingsRepository = new SettingsRepository();
const syncRunRepository = new SyncRunRepository();
const steamSettingsRepository = new SteamSettingsRepository();
const gogSettingsRepository = new GogSettingsRepository();
const epicSettingsRepository = new EpicSettingsRepository();
const authTokenRepository = new AuthTokenRepository();

async function saveSteamSettings(payload: { identityInput: string; apiKey?: string; includeFreeGames: boolean; includeAppInfo: boolean }) {
  const identity = parseSteamIdentityInput(payload.identityInput);
  const existing = await steamSettingsRepository.getSettings();
  const existingApiKey = await steamSettingsRepository.getApiKey(existing.steamId64);
  const apiKey = payload.apiKey?.trim() || existingApiKey;
  const resolved =
    identity.type === "vanity"
      ? apiKey
        ? await resolveSteamIdentity(identity, apiKey)
        : undefined
      : await resolveSteamIdentity(identity, apiKey);
  return steamSettingsRepository.saveSettings(
    {
      providerId: "steam",
      includeFreeGames: payload.includeFreeGames,
      includeAppInfo: payload.includeAppInfo,
      ...(identity.type === "vanity" && !resolved ? { vanityName: identity.value } : {}),
      ...(identity.type === "profileUrl" ? { profileUrl: identity.value } : {})
    },
    payload.apiKey,
    resolved
  );
}

async function testSteamSettings(payload: { identityInput: string; apiKey?: string; includeFreeGames: boolean; includeAppInfo: boolean }) {
  const identity = parseSteamIdentityInput(payload.identityInput);
  const existing = await steamSettingsRepository.getSettings();
  const apiKey = payload.apiKey?.trim() || (await steamSettingsRepository.getApiKey(existing.steamId64));
  const resolved = await resolveSteamIdentity(identity, apiKey);
  if (apiKey) {
    await getOwnedGames({
      steamId64: resolved.steamId64,
      apiKey,
      includeAppInfo: false,
      includeFreeGames: payload.includeFreeGames
    });
  }
  return {
    steamId64: resolved.steamId64,
    vanityName: resolved.vanityName,
    profileUrl: resolved.profileUrl,
    apiKeyUsable: Boolean(apiKey)
  };
}

async function checkGogLogin(replaceExisting?: "keep" | "remove"): Promise<AuthState> {
  const settings = await gogSettingsRepository.getSettings();
  try {
    const account = await getGogAccountBasic();
    if (!account.isLoggedIn) {
      return {
        providerId: "gog",
        status: "needs_reauth",
        lastCheckedAt: new Date().toISOString(),
        error: makeGogError("GOG_NOT_LOGGED_IN", "GOG says the browser session is not logged in.", false)
      };
    }

    const accountId = account.accountId ?? account.username;
    if (settings.accountId && accountId && settings.accountId !== accountId) {
      if (!replaceExisting) {
        return {
          providerId: "gog",
          status: "needs_reauth",
          accountId: settings.accountId,
          ...(settings.username ? { accountName: settings.username } : {}),
          lastCheckedAt: new Date().toISOString(),
          error: makeGogError("GOG_ACCOUNT_MISMATCH", "A different GOG account is signed in. Choose how to replace the stored account.", false)
        };
      }
      if (replaceExisting === "keep") {
        await gameRepository.markProviderEntriesStale("gog", settings.accountId);
      } else {
        await gameRepository.removeProviderGames("gog", settings.accountId);
      }
    }

    await gogSettingsRepository.saveSettings({
      ...(accountId ? { accountId } : {}),
      ...(account.username ? { username: account.username } : {}),
      lastCheckedAt: new Date().toISOString(),
      directAuthSupported: true
    });
    return {
      providerId: "gog",
      status: "connected",
      ...(accountId ? { accountId } : {}),
      ...(account.username ? { accountName: account.username } : {}),
      lastCheckedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      providerId: "gog",
      status: "error",
      ...(settings.accountId ? { accountId: settings.accountId } : {}),
      ...(settings.username ? { accountName: settings.username } : {}),
      lastCheckedAt: new Date().toISOString(),
      error: makeProviderErrorFromGog(error)
    };
  }
}

async function connectEpicWithAuthorizationCode(authorizationCode: string, replaceExisting?: "keep" | "remove"): Promise<AuthState> {
  const settings = await epicSettingsRepository.getSettings();
  try {
    const token = await exchangeEpicAuthorizationCode(authorizationCode);
    const account = await validateEpicAccount(token);

    if (settings.accountId && settings.accountId !== account.accountId) {
      if (!replaceExisting) {
        return {
          providerId: "epic",
          status: "needs_reauth",
          accountId: settings.accountId,
          ...(settings.displayName ? { accountName: settings.displayName } : {}),
          lastCheckedAt: new Date().toISOString(),
          error: makeEpicError("EPIC_ACCOUNT_MISMATCH", "A different Epic account was authorized. Choose how to replace the stored account.", false)
        };
      }
      await new EpicProvider().replaceAccount(settings.accountId, replaceExisting);
    }

    await authTokenRepository.deleteProviderAuthTokens("epic");
    await authTokenRepository.saveAuthToken({ ...token, accountId: account.accountId });
    await epicSettingsRepository.saveSettings({
      accountId: account.accountId,
      ...(account.displayName ? { displayName: account.displayName } : {}),
      lastResolvedAt: new Date().toISOString()
    });
    return {
      providerId: "epic",
      status: "connected",
      accountId: account.accountId,
      ...(account.displayName ? { accountName: account.displayName } : {}),
      lastCheckedAt: new Date().toISOString()
    };
  } catch (error) {
    const epicError = toEpicProviderError(error);
    return {
      providerId: "epic",
      status: epicError.code === "AUTH_REQUIRED" || epicError.code === "TOKEN_EXPIRED" ? "needs_reauth" : "error",
      ...(settings.accountId ? { accountId: settings.accountId } : {}),
      ...(settings.displayName ? { accountName: settings.displayName } : {}),
      lastCheckedAt: new Date().toISOString(),
      error: epicError
    };
  }
}

function warningFromGogError(error: unknown, phase: string, endpoint: string): ImportWarning {
  const gogError = toGogProviderError(error);
  return {
    code: gogError.gogCode,
    message: gogError.message,
    phase,
    endpoint,
    retryable: gogError.retryable
  };
}

async function testGogLibraryEndpoints() {
  const settings = await gogSettingsRepository.getSettings();
  const endpointTrace: ProviderEndpointTraceInput[] = [];
  const warnings: ImportWarning[] = [];
  const collectTrace = (trace: ProviderEndpointTraceInput) => endpointTrace.push(trace);
  const account = await getGogAccountBasic(collectTrace);
  if (!account.isLoggedIn) {
    warnings.push({
      code: "GOG_NOT_LOGGED_IN",
      message: "GOG says the browser session is not logged in.",
      phase: "accountCheck",
      endpoint: "accountBasic"
    });
    return { account, warnings, endpointTrace, newApiItemCount: 0, legacyItemCount: 0 };
  }

  const username = account.username ?? settings.username;
  let newApiItemCount = 0;
  let legacyItemCount = 0;
  if (username) {
    try {
      const result = await getGogOwnedGamesNewApi(username, undefined, collectTrace, true);
      newApiItemCount = result.games.length;
      warnings.push(...result.warnings);
    } catch (error) {
      warnings.push(warningFromGogError(error, "libraryStats", "libraryStats"));
    }
  } else {
    warnings.push({
      code: "GOG_LIBRARY_STATS_API_CHANGED",
      message: "GOG account endpoint did not return a username for the library stats endpoint.",
      phase: "libraryStats",
      endpoint: "libraryStats"
    });
  }

  if (settings.useLegacyFallback) {
    try {
      const result = await getGogOwnedGamesLegacy(undefined, collectTrace, true);
      legacyItemCount = result.games.length;
      warnings.push(...result.warnings);
    } catch (error) {
      warnings.push(warningFromGogError(error, "legacyFallback", "legacyFilteredProducts"));
    }
  }

  return { account, warnings, endpointTrace, newApiItemCount, legacyItemCount };
}

async function runAssistedProviderImport(providerId: AssistedProviderId): Promise<SyncRun> {
  const run = await syncRunRepository.createSyncRun(providerId);
  try {
    const result = await startAssistedProviderImport(providerId);
    const summary = await gameRepository.importProviderResult(result);
    await syncRunRepository.addSyncRunWarnings(syncRunRepository.syncRunWarningsFromImportResult(run.id, result));
    const update: Partial<SyncRun> = {
      finishedAt: new Date().toISOString(),
      status: summary.warningCount ? "partial" : "success",
      importedCount: summary.importedCount,
      warningCount: summary.warningCount
    };
    await syncRunRepository.finishSyncRun(run.id, update);
    return { ...run, ...update };
  } catch (error) {
    const providerError = redactSensitiveError(error, providerId);
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
}

export async function routeMessage(message: unknown): Promise<OwnershipResultMessage | unknown | undefined> {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return undefined;
  }

  const type = (message as { type: string }).type;

  if (type === "CHECK_OWNERSHIP") {
    const checkMessage = message as CheckOwnershipMessage;
    const games = await gameRepository.getAllGames();
    return {
      type: "OWNERSHIP_RESULT",
      payload: {
        matches: matchOwnedGames(checkMessage.payload.titleCandidates, games, checkMessage.payload.pageContext)
      }
    };
  }

  const providerMessage = message as ProviderMessage;

  if (type === "GET_PROVIDERS") {
    return {
      type: "PROVIDERS_RESULT",
      payload: {
        providers: listProviders().map(providerSummary)
      }
    };
  }

  if (type === "GET_PROVIDER_STATUS") {
    return {
      type: "PROVIDER_STATUS_RESULT",
      payload: {
        statuses: await getProviderStatuses(providerMessage.type === "GET_PROVIDER_STATUS" ? providerMessage.payload?.providerId : undefined)
      }
    };
  }

  if (type === "SYNC_PROVIDER" && providerMessage.type === "SYNC_PROVIDER") {
    const options = { interactive: false, ...(providerMessage.payload.force === undefined ? {} : { force: providerMessage.payload.force }) };
    return {
      type: "SYNC_PROVIDER_RESULT",
      payload: {
        syncRun: await syncProvider(providerMessage.payload.providerId, options)
      }
    };
  }

  if (type === "SYNC_ALL_PROVIDERS") {
    const force = providerMessage.type === "SYNC_ALL_PROVIDERS" ? providerMessage.payload?.force : undefined;
    const options = { interactive: false, ...(force === undefined ? {} : { force }) };
    return {
      type: "SYNC_ALL_PROVIDERS_RESULT",
      payload: {
        syncRuns: await syncAllProviders(options)
      }
    };
  }

  if (type === "GET_SYNC_SETTINGS") {
    return {
      type: "SYNC_SETTINGS_RESULT",
      payload: {
        settings: await settingsRepository.getSyncSettings()
      }
    };
  }

  if (type === "SAVE_SYNC_SETTINGS" && providerMessage.type === "SAVE_SYNC_SETTINGS") {
    await updateSyncSchedule(providerMessage.payload);
    return {
      type: "SYNC_SETTINGS_RESULT",
      payload: {
        settings: await settingsRepository.getSyncSettings()
      }
    };
  }

  if (type === "GET_RECENT_SYNC_RUNS") {
    const payload = providerMessage.type === "GET_RECENT_SYNC_RUNS" ? providerMessage.payload : undefined;
    return {
      type: "RECENT_SYNC_RUNS_RESULT",
      payload: {
        syncRuns: await syncRunRepository.listRecentSyncRuns(payload?.providerId, payload?.limit)
      }
    };
  }

  if (type === "EXPORT_LIBRARY_JSON") {
    return {
      type: "LIBRARY_JSON_EXPORT_RESULT",
      payload: {
        exportedAt: new Date().toISOString(),
        games: await gameRepository.getAllGames()
      }
    };
  }

  if (type === "GET_STEAM_SETTINGS") {
    return {
      type: "STEAM_SETTINGS_RESULT",
      payload: {
        settings: await steamSettingsRepository.getSettings()
      }
    };
  }

  if (type === "SAVE_STEAM_SETTINGS" && providerMessage.type === "SAVE_STEAM_SETTINGS") {
    return {
      type: "STEAM_SETTINGS_RESULT",
      payload: {
        settings: await saveSteamSettings(providerMessage.payload)
      }
    };
  }

  if (type === "CLEAR_STEAM_API_KEY") {
    const settings = await steamSettingsRepository.getSettings();
    await steamSettingsRepository.clearApiKey(settings.steamId64);
    return {
      type: "STEAM_SETTINGS_RESULT",
      payload: {
        settings: await steamSettingsRepository.getSettings()
      }
    };
  }

  if (type === "CLEAR_STEAM_SETTINGS") {
    await steamSettingsRepository.clearSettings();
    return {
      type: "STEAM_SETTINGS_RESULT",
      payload: {
        settings: await steamSettingsRepository.getSettings()
      }
    };
  }

  if (type === "RESOLVE_STEAM_IDENTITY" && providerMessage.type === "RESOLVE_STEAM_IDENTITY") {
    const settings = await steamSettingsRepository.getSettings();
    return {
      type: "STEAM_IDENTITY_RESULT",
      payload: {
        identity: await resolveSteamIdentity(parseSteamIdentityInput(providerMessage.payload.identityInput), await steamSettingsRepository.getApiKey(settings.steamId64))
      }
    };
  }

  if (type === "TEST_STEAM_SETTINGS" && providerMessage.type === "TEST_STEAM_SETTINGS") {
    return {
      type: "STEAM_TEST_RESULT",
      payload: {
        result: await testSteamSettings(providerMessage.payload)
      }
    };
  }

  if (type === "REBUILD_STEAM_METADATA_CACHE") {
    await clearSteamMetadataCache();
    return {
      type: "STEAM_METADATA_CACHE_RESULT",
      payload: { cleared: true }
    };
  }

  if (type === "EXPORT_STEAM_DIAGNOSTICS") {
    return {
      type: "STEAM_DIAGNOSTICS_RESULT",
      payload: {
        diagnostics: await exportSteamDiagnostics()
      }
    };
  }

  if (type === "OPEN_STEAM_LOGIN_OR_LIBRARY") {
    return {
      type: "ASSISTED_PROVIDER_OPEN_RESULT",
      payload: await openAssistedProviderLoginOrLibrary("steam")
    };
  }

  if (type === "START_STEAM_ASSISTED_IMPORT") {
    return {
      type: "ASSISTED_PROVIDER_IMPORT_RESULT",
      payload: {
        syncRun: await runAssistedProviderImport("steam")
      }
    };
  }

  if (type === "GET_EPIC_SETTINGS") {
    return {
      type: "EPIC_SETTINGS_RESULT",
      payload: {
        settings: await epicSettingsRepository.getSettings()
      }
    };
  }

  if (type === "SAVE_EPIC_SETTINGS" && providerMessage.type === "SAVE_EPIC_SETTINGS") {
    return {
      type: "EPIC_SETTINGS_RESULT",
      payload: {
        settings: await epicSettingsRepository.saveSettings(providerMessage.payload)
      }
    };
  }

  if (type === "OPEN_EPIC_AUTHORIZATION_PAGE") {
    return {
      type: "EPIC_AUTHORIZATION_PAGE_RESULT",
      payload: await openEpicAuthorizationPage()
    };
  }

  if (type === "CONNECT_EPIC_WITH_AUTHORIZATION_CODE" && providerMessage.type === "CONNECT_EPIC_WITH_AUTHORIZATION_CODE") {
    return {
      type: "EPIC_AUTH_RESULT",
      payload: {
        authState: await connectEpicWithAuthorizationCode(
          providerMessage.payload.authorizationCode,
          providerMessage.payload.replaceExisting
        )
      }
    };
  }

  if (type === "CHECK_EPIC_AUTH") {
    return {
      type: "EPIC_AUTH_RESULT",
      payload: {
        authState: await new EpicProvider().refreshAuthIfNeeded()
      }
    };
  }

  if (type === "DISCONNECT_PROVIDER" && providerMessage.type === "DISCONNECT_PROVIDER") {
    if (providerMessage.payload.providerId === "epic") {
      await authTokenRepository.deleteProviderAuthTokens("epic");
      await epicSettingsRepository.clearSettings();
      return {
        type: "DISCONNECT_PROVIDER_RESULT",
        payload: { providerId: "epic", disconnected: true }
      };
    }
  }

  if (type === "REMOVE_PROVIDER_GAMES" && providerMessage.type === "REMOVE_PROVIDER_GAMES") {
    const removedCount = await gameRepository.removeProviderGames(providerMessage.payload.providerId, providerMessage.payload.accountId);
    return {
      type: "REMOVE_PROVIDER_GAMES_RESULT",
      payload: { providerId: providerMessage.payload.providerId, removedCount }
    };
  }

  if (type === "REBUILD_EPIC_CATALOG_CACHE") {
    await new EpicCatalogCacheRepository().clear();
    return {
      type: "EPIC_CATALOG_CACHE_RESULT",
      payload: { cleared: true }
    };
  }

  if (type === "GET_EPIC_DIAGNOSTICS") {
    return {
      type: "EPIC_DIAGNOSTICS_RESULT",
      payload: {
        diagnostics: await exportEpicDiagnostics()
      }
    };
  }

  if (type === "GET_EPIC_FEASIBILITY_STATUS") {
    return {
      type: "EPIC_FEASIBILITY_STATUS_RESULT",
      payload: {
        status: getEpicFeasibilityStatus()
      }
    };
  }

  if (type === "GET_GOG_SETTINGS") {
    return {
      type: "GOG_SETTINGS_RESULT",
      payload: {
        settings: await gogSettingsRepository.getSettings()
      }
    };
  }

  if (type === "SAVE_GOG_SETTINGS" && providerMessage.type === "SAVE_GOG_SETTINGS") {
    return {
      type: "GOG_SETTINGS_RESULT",
      payload: {
        settings: await gogSettingsRepository.saveSettings(providerMessage.payload)
      }
    };
  }

  if (type === "OPEN_GOG_LOGIN") {
    return {
      type: "GOG_LOGIN_RESULT",
      payload: gogLoginLaunchResult()
    };
  }

  if (type === "CHECK_GOG_LOGIN" && providerMessage.type === "CHECK_GOG_LOGIN") {
    const authState = await checkGogLogin(providerMessage.payload?.replaceExisting);
    return {
      type: "GOG_AUTH_RESULT",
      payload: { authState }
    };
  }

  if (type === "TEST_GOG_LIBRARY_ENDPOINTS") {
    return {
      type: "GOG_LIBRARY_ENDPOINT_TEST_RESULT",
      payload: await testGogLibraryEndpoints()
    };
  }

  if (type === "DISCONNECT_GOG") {
    await gogSettingsRepository.clearSettings();
    return {
      type: "GOG_SETTINGS_RESULT",
      payload: {
        settings: await gogSettingsRepository.getSettings()
      }
    };
  }

  if (type === "REMOVE_GOG_IMPORTED_GAMES" && providerMessage.type === "REMOVE_GOG_IMPORTED_GAMES") {
    const removedCount = await gameRepository.removeProviderGames("gog", providerMessage.payload?.accountId);
    return {
      type: "GOG_REMOVE_RESULT",
      payload: { removedCount }
    };
  }

  if (type === "EXPORT_GOG_DIAGNOSTICS") {
    return {
      type: "GOG_DIAGNOSTICS_RESULT",
      payload: {
        diagnostics: await exportGogDiagnostics()
      }
    };
  }

  if (type === "OPEN_AMAZON_LOGIN_OR_LIBRARY") {
    return {
      type: "ASSISTED_PROVIDER_OPEN_RESULT",
      payload: await openAssistedProviderLoginOrLibrary("amazon")
    };
  }

  if (type === "START_AMAZON_ASSISTED_IMPORT") {
    return {
      type: "ASSISTED_PROVIDER_IMPORT_RESULT",
      payload: {
        syncRun: await runAssistedProviderImport("amazon")
      }
    };
  }

  if (type === "AMAZON_ASSISTED_IMPORT_BATCH" && providerMessage.type === "AMAZON_ASSISTED_IMPORT_BATCH") {
    const result = assistedSessionGamesToProviderImportResult("amazon", providerMessage.payload.games, {
      warnings: providerMessage.payload.batchLabel
        ? [
            {
              code: "AMAZON_ASSISTED_BATCH_IMPORTED",
              message: `Imported Amazon collection batch: ${providerMessage.payload.batchLabel}.`,
              phase: "assistedImport"
            }
          ]
        : []
    });
    const summary = await gameRepository.importProviderResult(result);
    return {
      type: "AMAZON_ASSISTED_IMPORT_BATCH_RESULT",
      payload: {
        batchLabel: providerMessage.payload.batchLabel,
        importedCount: summary.importedCount,
        warningCount: summary.warningCount
      }
    };
  }

  return undefined;
}
