import type { AuthState, ImportWarning, ProviderEndpointTraceInput, ProviderGame, ProviderImportResult } from "../../shared/types";
import type { GameStoreProvider } from "../Provider";
import { getGogAccountBasic, getGogOwnedGamesLegacy, getGogOwnedGamesNewApi } from "./gogApi";
import { makeGogError, makeProviderErrorFromGog, GogProviderError, toGogProviderError } from "./gogErrors";
import { GogSettingsRepository } from "./gogSettings";
import type { GogImportOptions, GogLibraryGame } from "./gogTypes";

function nowIso(): string {
  return new Date().toISOString();
}

const GOG_EDITION_SUFFIXES = [
  "Complete Edition",
  "Game of the Year Edition",
  "GOTY Edition",
  "Deluxe Edition",
  "Ultimate Edition",
  "Definitive Edition",
  "Enhanced Edition",
  "Director's Cut"
];

export function generateGogAliases(title: string): string[] {
  const aliases = new Set<string>();
  for (const suffix of GOG_EDITION_SUFFIXES) {
    const stripped = title.replace(new RegExp(`\\s*[-:–—]?\\s*${suffix}\\s*$`, "i"), "").trim();
    if (stripped && stripped !== title && (stripped.length >= 4 || /\d/.test(stripped))) {
      aliases.add(stripped);
    }
  }
  return [...aliases].sort((a, b) => a.localeCompare(b));
}

export function gogGameToProviderGame(game: GogLibraryGame, options: GogImportOptions): ProviderGame | undefined {
  if (game.isExtra && !options.importExtras) {
    return undefined;
  }
  const providerGame: ProviderGame = {
    providerGameId: game.id,
    title: game.title,
    sortTitle: game.title,
    aliases: generateGogAliases(game.title),
    url: game.productUrl ?? (game.slug ? `https://www.gog.com/game/${game.slug}` : `https://www.gog.com/account`),
    platform: ["PC"],
    tags: [],
    categories: []
  };
  if (game.playtimeMinutes !== undefined) {
    providerGame.playtimeMinutes = game.playtimeMinutes;
  }
  if (game.lastPlayedAt) {
    providerGame.lastPlayedAt = game.lastPlayedAt;
  }
  if (options.allowRawProviderResponses) {
    providerGame.raw = game.raw;
  }
  return providerGame;
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

export class GogProvider implements GameStoreProvider {
  id = "gog" as const;
  displayName = "GOG";
  supportsAuth = true;
  supportsManualImport = true;
  supportsBackgroundSync = true;
  accountPolicy = "single_active_account" as const;

  private readonly settingsRepository = new GogSettingsRepository();

  async getAuthState(): Promise<AuthState> {
    const settings = await this.settingsRepository.getSettings();
    if (!settings.accountId && !settings.username) {
      return {
        providerId: this.id,
        status: "not_connected",
        lastCheckedAt: nowIso()
      };
    }

    try {
      const account = await getGogAccountBasic();
      if (!account.isLoggedIn) {
        return {
          providerId: this.id,
          status: "needs_reauth",
          ...(settings.accountId ? { accountId: settings.accountId } : {}),
          ...(settings.username ? { accountName: settings.username } : {}),
          lastCheckedAt: nowIso(),
          error: makeGogError("GOG_NOT_LOGGED_IN", "GOG says the browser session is not logged in.", false)
        };
      }
      const accountId = account.accountId ?? account.username;
      if (settings.accountId && accountId && settings.accountId !== accountId) {
        return {
          providerId: this.id,
          status: "needs_reauth",
          accountId: settings.accountId,
          ...(settings.username ? { accountName: settings.username } : {}),
          lastCheckedAt: nowIso(),
          error: makeGogError("GOG_ACCOUNT_MISMATCH", "A different GOG account is signed in. Confirm replacement before syncing.", false)
        };
      }
      const next = await this.settingsRepository.saveSettings({
        ...(accountId ? { accountId } : {}),
        ...(account.username ? { username: account.username } : {}),
        lastCheckedAt: nowIso(),
        directAuthSupported: true
      });
      return {
        providerId: this.id,
        status: "connected",
        ...(next.accountId ? { accountId: next.accountId } : {}),
        ...(next.username ? { accountName: next.username } : {}),
        lastCheckedAt: nowIso()
      };
    } catch (error) {
      return {
        providerId: this.id,
        status: "error",
        ...(settings.accountId ? { accountId: settings.accountId } : {}),
        ...(settings.username ? { accountName: settings.username } : {}),
        lastCheckedAt: nowIso(),
        error: makeProviderErrorFromGog(error)
      };
    }
  }

  async login(): Promise<AuthState> {
    return this.getAuthState();
  }

  async logout(): Promise<void> {
    await this.settingsRepository.clearSettings();
  }

  async refreshAuthIfNeeded(): Promise<AuthState> {
    return this.getAuthState();
  }

  async importOwnedGames(signal?: AbortSignal): Promise<ProviderImportResult> {
    const settings = await this.settingsRepository.getSettings();
    const endpointTrace: ProviderEndpointTraceInput[] = [];
    const collectTrace = (trace: ProviderEndpointTraceInput) => endpointTrace.push(trace);
    const authState = await this.getAuthState();
    if (authState.status !== "connected") {
      throw makeGogError("GOG_NOT_LOGGED_IN", authState.error?.message ?? "Connect GOG before syncing.", false);
    }

    const warnings: ProviderImportResult["warnings"] = [];
    let libraryGames: GogLibraryGame[] = [];
    const username = authState.accountName ?? settings.username;
    if (!settings.useLegacyFallback && !username) {
      throw makeGogError("GOG_NOT_LOGGED_IN", "GOG username is required for the current library endpoint.", false);
    }

    const account = await getGogAccountBasic(collectTrace);
    if (!account.isLoggedIn) {
      throw makeGogError("GOG_NOT_LOGGED_IN", "GOG says the browser session is not logged in.", false);
    }

    let triedLegacyFallback = false;
    let newEndpointHadWarning = false;
    try {
      if (!username) {
        throw new GogProviderError("GOG_LIBRARY_STATS_API_CHANGED", "GOG account endpoint did not return a username.", false);
      }
      const newApi = await getGogOwnedGamesNewApi(username, signal, collectTrace);
      libraryGames = newApi.games;
      warnings.push(...newApi.warnings);
      newEndpointHadWarning = newApi.warnings.length > 0;
    } catch (error) {
      if (!settings.useLegacyFallback) {
        throw error;
      }
      newEndpointHadWarning = true;
      warnings.push(warningFromGogError(error, "libraryStats", "libraryStats"));
      warnings.push({
        code: "GOG_NEW_API_FALLBACK",
        message: "GOG's newer library endpoint returned an unexpected shape, so the extension tried the legacy fallback.",
        phase: "libraryStats",
        endpoint: "libraryStats"
      });
    }

    if (settings.useLegacyFallback && (libraryGames.length === 0 || newEndpointHadWarning)) {
      triedLegacyFallback = true;
      try {
        const legacy = await getGogOwnedGamesLegacy(signal, collectTrace);
        if (legacy.games.length > 0) {
          libraryGames = legacy.games;
        }
        warnings.push(...legacy.warnings);
        if (legacy.games.length > 0 && newEndpointHadWarning) {
          warnings.push({
            code: "GOG_LEGACY_FALLBACK_USED",
            message: "GOG legacy fallback imported games after the newer endpoint could not be used cleanly.",
            phase: "legacyFallback",
            endpoint: "legacyFilteredProducts"
          });
        }
      } catch (error) {
        warnings.push(warningFromGogError(error, "legacyFallback", "legacyFilteredProducts"));
      }
    }

    const options: GogImportOptions = {
      importExtras: settings.importExtras,
      useLegacyFallback: settings.useLegacyFallback,
      allowRawProviderResponses: settings.allowRawProviderResponses
    };
    const games = libraryGames.map((game) => gogGameToProviderGame(game, options)).filter((game): game is ProviderGame => Boolean(game));
    if (libraryGames.length === 0) {
      warnings.push({
        code: triedLegacyFallback ? "GOG_EMPTY_LIBRARY_OR_PARSE_FAILED" : "GOG_EMPTY_LIBRARY",
        message: triedLegacyFallback
          ? "GOG returned zero games from both library endpoints. This may mean the account has no games, the session lacks library access, or the parser needs updating."
          : "GOG returned no owned games. The account library may be empty or unavailable.",
        phase: triedLegacyFallback ? "legacyFallback" : "libraryStats",
        endpoint: triedLegacyFallback ? "legacyFilteredProducts" : "libraryStats"
      });
    }

    return {
      providerId: "gog",
      ...(authState.accountId ? { accountId: authState.accountId } : {}),
      importedAt: nowIso(),
      games,
      warnings,
      endpointTrace
    };
  }
}
