import { makeProviderError } from "../../shared/errors";
import type { ProviderError } from "../../shared/types";

export type SteamErrorCode =
  | "STEAM_INVALID_IDENTITY"
  | "STEAM_INVALID_API_KEY"
  | "STEAM_PROFILE_PRIVATE"
  | "STEAM_GAMES_PRIVATE"
  | "STEAM_EMPTY_LIBRARY"
  | "STEAM_RATE_LIMITED"
  | "STEAM_NETWORK_ERROR"
  | "STEAM_API_CHANGED"
  | "STEAM_UNKNOWN";

const STEAM_KEY_PATTERN = /\b[A-Fa-f0-9]{32}\b/g;
const STEAM_KEY_PARAM_PATTERN = /([?&](?:key|api_key|apikey)=)([^&#]+)/gi;

export function redactSteamApiKey(input: string): string {
  return input.replace(STEAM_KEY_PARAM_PATTERN, "$1[redacted]").replace(STEAM_KEY_PATTERN, "[redacted]");
}

export function steamErrorToProviderError(code: SteamErrorCode, message?: string): ProviderError {
  const text = redactSteamApiKey(message ?? defaultSteamMessage(code));
  switch (code) {
    case "STEAM_INVALID_API_KEY":
      return makeProviderError("steam", "AUTH_REQUIRED", text, false);
    case "STEAM_INVALID_IDENTITY":
      return makeProviderError("steam", "IMPORT_INVALID", text, false);
    case "STEAM_PROFILE_PRIVATE":
    case "STEAM_GAMES_PRIVATE":
    case "STEAM_EMPTY_LIBRARY":
      return makeProviderError("steam", "AUTH_REQUIRED", text, false);
    case "STEAM_RATE_LIMITED":
      return makeProviderError("steam", "RATE_LIMITED", text, true);
    case "STEAM_NETWORK_ERROR":
      return makeProviderError("steam", "NETWORK_ERROR", text, true);
    case "STEAM_API_CHANGED":
      return makeProviderError("steam", "API_CHANGED", text, false);
    case "STEAM_UNKNOWN":
    default:
      return makeProviderError("steam", "UNKNOWN", text, true);
  }
}

export function isRetryableSteamError(error: unknown): boolean {
  const typed = error as { steamCode?: SteamErrorCode; code?: string; message?: string };
  if (typed.message?.toLowerCase().includes("cancelled")) {
    return false;
  }
  const code = typed.steamCode;
  return code === "STEAM_NETWORK_ERROR" || code === "STEAM_RATE_LIMITED";
}

export function makeSteamError(code: SteamErrorCode, message?: string): ProviderError & { steamCode: SteamErrorCode } {
  return {
    ...steamErrorToProviderError(code, message),
    steamCode: code
  };
}

function defaultSteamMessage(code: SteamErrorCode): string {
  switch (code) {
    case "STEAM_INVALID_IDENTITY":
      return "Steam identity is invalid. Check the SteamID64 or profile URL.";
    case "STEAM_INVALID_API_KEY":
      return "Steam API key looks invalid. Update it in Steam provider settings.";
    case "STEAM_PROFILE_PRIVATE":
      return "Steam profile appears private or inaccessible.";
    case "STEAM_GAMES_PRIVATE":
      return "Steam profile found, but owned games are private. Make Game Details public or use another import method.";
    case "STEAM_EMPTY_LIBRARY":
      return "Steam returned no games. This may mean the library is empty or game details are private.";
    case "STEAM_RATE_LIMITED":
      return "Steam is rate limiting requests. Try again later.";
    case "STEAM_NETWORK_ERROR":
      return "Steam request failed. Check your connection and try again.";
    case "STEAM_API_CHANGED":
      return "Steam returned an unexpected response.";
    case "STEAM_UNKNOWN":
      return "Unknown Steam provider error.";
  }
}
