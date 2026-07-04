import { SteamAppCacheRepository } from "../../db/repositories";
import type { AuthState, ProviderGame, ProviderImportResult } from "../../shared/types";
import type { GameStoreProvider } from "../Provider";
import { getOwnedGames, getSteamAppDetails, resolveSteamIdentity } from "./steamApi";
import { cacheRecordFromDetails, failedCacheRecord } from "./steamCache";
import { makeSteamError } from "./steamErrors";
import { SteamSettingsRepository, parseSteamIdentityInput } from "./steamSettings";
import type { ResolvedSteamIdentity, SteamOwnedGame } from "./steamTypes";

function nowIso(): string {
  return new Date().toISOString();
}

function lastPlayedIso(value: number | undefined): string | undefined {
  return value && value > 0 ? new Date(value * 1000).toISOString() : undefined;
}

const STEAM_EDITION_SUFFIXES = [
  "Complete Edition",
  "Game of the Year Edition",
  "GOTY Edition",
  "Deluxe Edition",
  "Ultimate Edition",
  "Definitive Edition",
  "Enhanced Edition",
  "Remastered",
  "Anniversary Edition"
];

export function generateSteamAliases(title: string): string[] {
  const aliases = new Set<string>();
  for (const suffix of STEAM_EDITION_SUFFIXES) {
    const stripped = title.replace(new RegExp(`\\s*[-:–—]?\\s*${suffix}\\s*$`, "i"), "").trim();
    if (stripped && stripped !== title && (stripped.length >= 4 || /\d/.test(stripped))) {
      aliases.add(stripped);
    }
  }
  return [...aliases].sort((a, b) => a.localeCompare(b));
}

export function steamGameToProviderGame(game: SteamOwnedGame, title: string): ProviderGame {
  const providerGame: ProviderGame = {
    providerGameId: String(game.appid),
    title,
    sortTitle: title,
    aliases: generateSteamAliases(title),
    url: `https://store.steampowered.com/app/${game.appid}`,
    platform: ["PC"],
    tags: [],
    categories: [],
    playtimeMinutes: game.playtime_forever ?? 0,
    raw: game
  };
  const lastPlayedAt = lastPlayedIso(game.rtime_last_played);
  if (lastPlayedAt) {
    providerGame.lastPlayedAt = lastPlayedAt;
  }
  return providerGame;
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

export class SteamProvider implements GameStoreProvider {
  id = "steam" as const;
  displayName = "Steam";
  supportsAuth = true;
  supportsManualImport = false;
  supportsBackgroundSync = true;
  accountPolicy = "single_active_account" as const;

  private readonly settingsRepository = new SteamSettingsRepository();
  private readonly appCacheRepository = new SteamAppCacheRepository();

  async getAuthState(): Promise<AuthState> {
    const settings = await this.settingsRepository.getSettings();
    if (!settings.steamId64 && !settings.vanityName && !settings.profileUrl) {
      return {
        providerId: this.id,
        status: "not_connected",
        lastCheckedAt: nowIso()
      };
    }

    const state: AuthState = {
      providerId: this.id,
      status: "connected",
      accountName: settings.vanityName ?? settings.steamId64 ?? "Steam profile",
      lastCheckedAt: nowIso()
    };
    if (settings.steamId64) {
      state.accountId = settings.steamId64;
    }
    return state;
  }

  async login(): Promise<AuthState> {
    throw makeSteamError("STEAM_UNKNOWN", "Steam browser login is not implemented. Add a Steam profile and optional API key in settings.");
  }

  async logout(): Promise<void> {
    await this.settingsRepository.clearSettings();
  }

  async refreshAuthIfNeeded(): Promise<AuthState> {
    return this.getAuthState();
  }

  private async resolveSettingsIdentity(apiKey: string | undefined): Promise<ResolvedSteamIdentity> {
    const settings = await this.settingsRepository.getSettings();
    if (settings.steamId64) {
      const resolved: ResolvedSteamIdentity = {
        steamId64: settings.steamId64,
        profileUrl: settings.profileUrl ?? `https://steamcommunity.com/profiles/${settings.steamId64}`
      };
      if (settings.vanityName) {
        resolved.vanityName = settings.vanityName;
      }
      return resolved;
    }
    const input = settings.profileUrl ?? settings.vanityName;
    if (!input) {
      throw makeSteamError("STEAM_INVALID_IDENTITY", "Add a Steam profile or SteamID64 before syncing.");
    }
    const resolved = await resolveSteamIdentity(parseSteamIdentityInput(input), apiKey);
    await this.settingsRepository.saveSettings(settings, undefined, resolved);
    return resolved;
  }

  private async titleForGame(game: SteamOwnedGame, includeAppInfo: boolean, signal?: AbortSignal): Promise<string> {
    if (includeAppInfo && game.name?.trim()) {
      return game.name.trim();
    }

    const cached = await this.appCacheRepository.getFreshAppDetails(game.appid);
    if (cached?.title) {
      return cached.title;
    }
    if (cached?.status === "missing" || cached?.status === "failed") {
      return `Steam App ${game.appid}`;
    }

    try {
      const details = await getSteamAppDetails(game.appid, signal);
      if (details) {
        await this.appCacheRepository.saveAppDetails(cacheRecordFromDetails(details));
      } else {
        await this.appCacheRepository.saveAppDetails(
          cacheRecordFromDetails({
            appId: game.appid,
            storeUrl: `https://store.steampowered.com/app/${game.appid}`
          })
        );
      }
      return details?.title?.trim() || `Steam App ${game.appid}`;
    } catch (error) {
      await this.appCacheRepository.saveAppDetails(failedCacheRecord(game.appid, (error as { steamCode?: string })?.steamCode ?? "STEAM_UNKNOWN"));
      return `Steam App ${game.appid}`;
    }
  }

  async importOwnedGames(signal?: AbortSignal): Promise<ProviderImportResult> {
    const settings = await this.settingsRepository.getSettings();
    const apiKey = await this.settingsRepository.getApiKey(settings.steamId64);
    if (!apiKey) {
      throw makeSteamError("STEAM_INVALID_API_KEY", "A Steam Web API key is required to import owned games.");
    }

    const resolved = await this.resolveSettingsIdentity(apiKey);
    const response = await getOwnedGames({
      steamId64: resolved.steamId64,
      apiKey,
      includeAppInfo: settings.includeAppInfo,
      includeFreeGames: settings.includeFreeGames,
      ...(signal ? { signal } : {})
    });

    const steamGames = response.response.games ?? [];
    const warnings =
      steamGames.length === 0
        ? [
            {
              code: "EMPTY_LIBRARY",
              message: "Steam returned no owned games. The profile may be private or the library may be empty."
            }
          ]
        : [];

    const games: ProviderGame[] = [];
    for (const steamGame of steamGames) {
      if (signal?.aborted) {
        throw makeSteamError("STEAM_NETWORK_ERROR", "Steam import was cancelled.");
      }
    }

    const titleByAppId = new Map<number, string>();
    const uniqueGames = [...new Map(steamGames.map((game) => [game.appid, game])).values()];
    await mapWithConcurrency(uniqueGames, 4, async (steamGame) => {
      titleByAppId.set(steamGame.appid, await this.titleForGame(steamGame, settings.includeAppInfo, signal));
    });

    for (const steamGame of steamGames) {
      games.push(steamGameToProviderGame(steamGame, titleByAppId.get(steamGame.appid) ?? `Steam App ${steamGame.appid}`));
    }

    return {
      providerId: "steam",
      accountId: resolved.steamId64,
      importedAt: nowIso(),
      games,
      warnings
    };
  }
}
