import type { ProviderGame, SteamAppCacheRecord, SteamProviderSettings } from "../../shared/types";

export type SteamIdentityInput =
  | { type: "steamId64"; value: string }
  | { type: "vanity"; value: string }
  | { type: "profileUrl"; value: string };

export interface ResolvedSteamIdentity {
  steamId64: string;
  vanityName?: string;
  profileUrl?: string;
}

export interface GetOwnedGamesParams {
  steamId64: string;
  apiKey?: string;
  includeAppInfo: boolean;
  includeFreeGames: boolean;
  signal?: AbortSignal;
}

export interface SteamOwnedGame {
  appid: number;
  name?: string;
  playtime_forever?: number;
  rtime_last_played?: number;
  img_icon_url?: string;
  has_community_visible_stats?: boolean;
  playtime_windows_forever?: number;
  playtime_mac_forever?: number;
  playtime_linux_forever?: number;
  [key: string]: unknown;
}

export interface SteamOwnedGamesResponse {
  response: {
    game_count?: number;
    games?: SteamOwnedGame[];
  };
}

export interface SteamAppDetails {
  appId: number;
  title?: string;
  storeUrl: string;
  raw?: unknown;
}

export type { ProviderGame, SteamAppCacheRecord, SteamProviderSettings };
