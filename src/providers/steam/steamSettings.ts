import { AuthTokenRepository, SettingsRepository } from "../../db/repositories";
import { makeProviderError } from "../../shared/errors";
import type { SteamProviderSettings } from "../../shared/types";
import type { ResolvedSteamIdentity, SteamIdentityInput } from "./steamTypes";

const STEAM_SETTINGS_KEY = "steamProviderSettings";

function nowIso(): string {
  return new Date().toISOString();
}

export function parseSteamIdentityInput(input: string): SteamIdentityInput {
  const trimmed = input.trim();
  if (!trimmed) {
    throw makeProviderError("steam", "IMPORT_INVALID", "Enter a Steam profile URL, SteamID64, or vanity name.", false);
  }

  if (/^\d{15,20}$/.test(trimmed)) {
    return { type: "steamId64", value: trimmed };
  }

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://steamcommunity.com/${trimmed.replace(/^\/+/, "")}`);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.hostname !== "steamcommunity.com" && !url.hostname.endsWith(".steamcommunity.com")) {
      throw new Error("Not a Steam Community URL.");
    }
    if (parts[0] === "profiles" && parts[1] && /^\d{15,20}$/.test(parts[1])) {
      return { type: "profileUrl", value: `https://steamcommunity.com/profiles/${parts[1]}` };
    }
    if (parts[0] === "id" && parts[1] && /^[A-Za-z0-9_-]{2,64}$/.test(parts[1])) {
      return { type: "vanity", value: parts[1] };
    }
  } catch {
    // Fall through to vanity parsing.
  }

  if (/^[A-Za-z0-9_-]{2,64}$/.test(trimmed)) {
    return { type: "vanity", value: trimmed };
  }

  throw makeProviderError("steam", "IMPORT_INVALID", "Steam identity must be a SteamID64, Steam profile URL, or URL-safe vanity name.", false);
}

export function defaultSteamSettings(): SteamProviderSettings {
  return {
    providerId: "steam",
    apiKeyStored: false,
    includeFreeGames: false,
    includeAppInfo: true,
    updatedAt: nowIso()
  };
}

export class SteamSettingsRepository {
  private readonly settingsRepository = new SettingsRepository();
  private readonly authTokenRepository = new AuthTokenRepository();

  async getSettings(): Promise<SteamProviderSettings> {
    const settings = await this.settingsRepository.getSetting<SteamProviderSettings>(STEAM_SETTINGS_KEY);
    if (!settings) {
      return defaultSteamSettings();
    }
    const apiKeyStored = settings.steamId64 ? Boolean(await this.getApiKey(settings.steamId64)) : false;
    return {
      ...defaultSteamSettings(),
      ...settings,
      apiKeyStored
    };
  }

  async saveSettings(
    settings: Partial<SteamProviderSettings>,
    apiKey?: string,
    resolvedIdentity?: ResolvedSteamIdentity
  ): Promise<SteamProviderSettings> {
    const existing = await this.getSettings();
    const next: SteamProviderSettings = {
      ...existing,
      ...settings,
      ...(resolvedIdentity?.steamId64 ? { steamId64: resolvedIdentity.steamId64 } : {}),
      ...(resolvedIdentity?.vanityName ? { vanityName: resolvedIdentity.vanityName } : {}),
      ...(resolvedIdentity?.profileUrl ? { profileUrl: resolvedIdentity.profileUrl } : {}),
      providerId: "steam",
      apiKeyStored: false,
      includeFreeGames: settings.includeFreeGames ?? existing.includeFreeGames,
      includeAppInfo: settings.includeAppInfo ?? existing.includeAppInfo,
      updatedAt: nowIso()
    };
    if (resolvedIdentity) {
      next.lastResolvedAt = nowIso();
    }
    if (apiKey?.trim() && next.steamId64) {
      await this.authTokenRepository.saveAuthToken({
        providerId: "steam",
        accountId: next.steamId64,
        accessToken: apiKey.trim(),
        scopes: ["steam_web_api_key"],
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
      next.apiKeyStored = true;
    } else if (next.steamId64) {
      next.apiKeyStored = Boolean(await this.getApiKey(next.steamId64));
    }

    await this.settingsRepository.saveSetting(STEAM_SETTINGS_KEY, next);
    return next;
  }

  async clearSettings(): Promise<void> {
    const settings = await this.getSettings();
    await this.clearApiKey(settings.steamId64);
    await this.settingsRepository.deleteSetting(STEAM_SETTINGS_KEY);
  }

  async getApiKey(steamId64?: string): Promise<string | undefined> {
    if (!steamId64) {
      return undefined;
    }
    return (await this.authTokenRepository.getAuthToken("steam", steamId64))?.accessToken;
  }

  async clearApiKey(steamId64?: string): Promise<void> {
    if (steamId64) {
      await this.authTokenRepository.deleteAuthToken("steam", steamId64);
    } else {
      await this.authTokenRepository.deleteProviderAuthTokens("steam");
    }
  }
}
