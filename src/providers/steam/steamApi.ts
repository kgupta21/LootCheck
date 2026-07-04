import { parseSteamIdentityInput } from "./steamSettings";
import { isRetryableSteamError, makeSteamError, redactSteamApiKey } from "./steamErrors";
import type {
  GetOwnedGamesParams,
  ResolvedSteamIdentity,
  SteamAppDetails,
  SteamIdentityInput,
  SteamOwnedGamesResponse
} from "./steamTypes";

const STEAM_WEB_API_BASE = "https://partner.steam-api.com";
const STEAM_STORE_BASE = "https://store.steampowered.com";
export const defaultSteamRequestTimeoutMs = 15000;

let delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function setSteamApiDelayForTests(nextDelay: typeof delay): void {
  delay = nextDelay;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw makeSteamError("STEAM_NETWORK_ERROR", "Steam import was cancelled.");
  }
}

function mapSteamHttpError(status: number, fallbackMessage: string): never {
  if (status === 401 || status === 403) {
    throw makeSteamError("STEAM_INVALID_API_KEY", "Steam API key looks invalid or the Steam library is inaccessible.");
  }
  if (status === 429) {
    throw makeSteamError("STEAM_RATE_LIMITED");
  }
  if (status >= 500) {
    throw makeSteamError("STEAM_NETWORK_ERROR", "Steam API is temporarily unavailable.");
  }
  throw makeSteamError("STEAM_UNKNOWN", fallbackMessage);
}

function abortSignalWithTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  const timeout = setTimeout(() => controller.abort(new Error("Steam request timed out.")), timeoutMs);
  signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  };
}

function retryDelayMs(attempt: number): number {
  if (attempt === 2) {
    return 500 + Math.floor(Math.random() * 501);
  }
  return 1500 + Math.floor(Math.random() * 1501);
}

async function fetchJsonOnce<T>(url: URL, signal?: AbortSignal, timeoutMs = defaultSteamRequestTimeoutMs): Promise<T> {
  assertNotAborted(signal);
  let response: Response;
  const timeoutSignal = abortSignalWithTimeout(signal, timeoutMs);
  try {
    response = await fetch(url, { signal: timeoutSignal.signal });
  } catch (error) {
    if (signal?.aborted) {
      throw makeSteamError("STEAM_NETWORK_ERROR", "Steam import was cancelled.");
    }
    throw makeSteamError("STEAM_NETWORK_ERROR", error instanceof Error ? redactSteamApiKey(error.message) : undefined);
  } finally {
    timeoutSignal.cleanup();
  }

  if (!response.ok) {
    mapSteamHttpError(response.status, `Steam request failed with HTTP ${response.status}.`);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw makeSteamError("STEAM_API_CHANGED");
  }
}

export async function fetchJson<T>(url: URL, signal?: AbortSignal, timeoutMs = defaultSteamRequestTimeoutMs): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchJsonOnce<T>(url, signal, timeoutMs);
    } catch (error) {
      lastError = error;
      if (!isRetryableSteamError(error) || attempt === 3) {
        throw error;
      }
      await delay(retryDelayMs(attempt + 1));
    }
  }
  throw lastError;
}

function steamIdFromProfileUrl(input: string): string | undefined {
  const parsed = parseSteamIdentityInput(input);
  if (parsed.type === "profileUrl") {
    return parsed.value.split("/").filter(Boolean).at(-1);
  }
  if (parsed.type === "steamId64") {
    return parsed.value;
  }
  return undefined;
}

export async function resolveSteamIdentity(input: SteamIdentityInput, apiKey?: string): Promise<ResolvedSteamIdentity> {
  if (input.type === "steamId64") {
    return {
      steamId64: input.value,
      profileUrl: `https://steamcommunity.com/profiles/${input.value}`
    };
  }

  if (input.type === "profileUrl") {
    const steamId64 = steamIdFromProfileUrl(input.value);
    if (steamId64) {
      return {
        steamId64,
        profileUrl: `https://steamcommunity.com/profiles/${steamId64}`
      };
    }
    const vanity = parseSteamIdentityInput(input.value);
    if (vanity.type === "vanity") {
      return resolveSteamIdentity(vanity, apiKey);
    }
  }

  if (!apiKey) {
    throw makeSteamError("STEAM_INVALID_API_KEY", "A Steam Web API key is required to resolve vanity profile names.");
  }

  const url = new URL("/ISteamUser/ResolveVanityURL/v1/", STEAM_WEB_API_BASE);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("vanityurl", input.value);
  const body = await fetchJson<{ response?: { success?: number; steamid?: string; message?: string } }>(url);
  if (body.response?.success !== 1 || !body.response.steamid) {
    throw makeSteamError("STEAM_INVALID_IDENTITY", body.response?.message ?? "Steam vanity profile could not be resolved.");
  }
  return {
    steamId64: body.response.steamid,
    vanityName: input.value,
    profileUrl: `https://steamcommunity.com/id/${input.value}`
  };
}

export async function getOwnedGames(params: GetOwnedGamesParams): Promise<SteamOwnedGamesResponse> {
  if (!params.apiKey) {
    throw makeSteamError("STEAM_INVALID_API_KEY", "A Steam Web API key is required to import owned games.");
  }

  const url = new URL("/IPlayerService/GetOwnedGames/v1/", STEAM_WEB_API_BASE);
  url.searchParams.set("key", params.apiKey);
  url.searchParams.set(
    "input_json",
    JSON.stringify({
      steamid: params.steamId64,
      include_appinfo: params.includeAppInfo,
      include_played_free_games: params.includeFreeGames
    })
  );

  const body = await fetchJson<SteamOwnedGamesResponse>(url, params.signal);
  if (!body.response || typeof body.response !== "object") {
    throw makeSteamError("STEAM_API_CHANGED", "Steam owned-games response was missing the response object.");
  }
  return body;
}

export async function getSteamAppDetails(appId: number, signal?: AbortSignal): Promise<SteamAppDetails | undefined> {
  const url = new URL("/api/appdetails", STEAM_STORE_BASE);
  url.searchParams.set("appids", String(appId));
  url.searchParams.set("filters", "basic");

  try {
    const body = await fetchJson<Record<string, { success?: boolean; data?: { name?: string } }>>(url, signal);
    const item = body[String(appId)];
    if (!item?.success) {
      return undefined;
    }
    const details: SteamAppDetails = {
      appId,
      storeUrl: `https://store.steampowered.com/app/${appId}`,
      raw: item
    };
    if (item.data?.name) {
      details.title = item.data.name;
    }
    return details;
  } catch (error) {
    if ((error as { code?: string })?.code === "RATE_LIMITED") {
      throw error;
    }
    return undefined;
  }
}
