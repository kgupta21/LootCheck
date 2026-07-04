import { normalizeTitle } from "../../matching/normalizeTitle";
import type { ImportWarning, ProviderEndpointTraceInput } from "../../shared/types";
import { GogProviderError, toGogProviderError } from "./gogErrors";
import type { GogAccountBasic, GogFetchOptions, GogLibraryGame, GogOwnedGameDetails, GogParseResult } from "./gogTypes";

const ACCOUNT_BASIC_URL = "https://menu.gog.com/v1/account/basic";
const LEGACY_LIBRARY_URL = "https://www.gog.com/account/getFilteredProducts";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;

let delayForTests: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setGogApiDelayForTests(delay: (ms: number) => Promise<void>): void {
  delayForTests = delay;
}

function abortError(): DOMException {
  return new DOMException("GOG request was aborted.", "AbortError");
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeout);
      throw abortError();
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

function valueAt(record: unknown, keys: string[]): unknown {
  if (!record || typeof record !== "object") {
    return undefined;
  }
  for (const key of keys) {
    const value = (record as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function stringValue(record: unknown, keys: string[]): string | undefined {
  const value = valueAt(record, keys);
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function numberValue(record: unknown, keys: string[]): number | undefined {
  const value = valueAt(record, keys);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function booleanValue(record: unknown, keys: string[]): boolean | undefined {
  const value = valueAt(record, keys);
  return typeof value === "boolean" ? value : undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function endpointError(status: number, url: URL): GogProviderError {
  if (status === 401 || status === 403) {
    return new GogProviderError("GOG_NOT_LOGGED_IN", "GOG says the browser session is not logged in.", false);
  }
  if (status === 429) {
    return new GogProviderError("GOG_RATE_LIMITED", "GOG rate-limited the request.", true);
  }
  if (status >= 500) {
    return new GogProviderError("GOG_NETWORK_ERROR", `GOG endpoint failed with HTTP ${status}.`, true);
  }
  if (status === 404) {
    return new GogProviderError("GOG_LIBRARY_PRIVATE_OR_UNAVAILABLE", `GOG endpoint is unavailable: ${url.pathname}`, false);
  }
  return new GogProviderError("GOG_API_CHANGED", `GOG endpoint returned unexpected HTTP ${status}.`, false);
}

function traceResultForError(error: GogProviderError): ProviderEndpointTraceInput["result"] {
  switch (error.gogCode) {
    case "GOG_NOT_LOGGED_IN":
      return "not_logged_in";
    case "GOG_LIBRARY_SESSION_MISSING":
      return "html_login_page";
    case "GOG_RATE_LIMITED":
      return "rate_limited";
    case "GOG_NETWORK_ERROR":
      return "network_error";
    case "GOG_API_CHANGED":
    case "GOG_LIBRARY_STATS_API_CHANGED":
    case "GOG_LEGACY_API_CHANGED":
      return "api_changed";
    default:
      return "unknown_error";
  }
}

function htmlLooksLikeLoginPage(text: string): boolean {
  return /sign\s*in|log\s*in|login|gog\.com\/login|GalaxyAccounts/i.test(text);
}

export async function fetchGogJson<T>(url: URL, options: GogFetchOptions = {}): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const endpointKey = options.endpointKey ?? url.pathname;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const startedAt = new Date().toISOString();
    const trace: ProviderEndpointTraceInput = {
      endpointKey,
      urlPath: url.pathname,
      startedAt,
      result: "unknown_error"
    };
    const timeout = withTimeout(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: {
          accept: "application/json, text/plain, */*"
        },
        signal: timeout.signal
      });
      trace.httpStatus = response.status;
      const contentTypeHeader = response.headers.get("content-type");
      if (contentTypeHeader) {
        trace.contentType = contentTypeHeader;
      }
      if (!response.ok) {
        const error = endpointError(response.status, url);
        trace.result = traceResultForError(error);
        trace.errorCode = error.gogCode;
        trace.finishedAt = new Date().toISOString();
        options.onTrace?.(trace);
        if (isRetryableStatus(response.status) && attempt < retries) {
          await delayForTests(250 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      if (/html/i.test(contentType) || /^\s*</.test(text)) {
        const code = htmlLooksLikeLoginPage(text) ? "GOG_LIBRARY_SESSION_MISSING" : "GOG_API_CHANGED";
        const error = new GogProviderError(
          code,
          code === "GOG_LIBRARY_SESSION_MISSING"
            ? "GOG login is detected, but the library endpoint returned a login page. Open gog.com, sign in again, then click Check GOG login."
            : "GOG returned HTML where JSON was expected.",
          false
        );
        trace.result = code === "GOG_LIBRARY_SESSION_MISSING" ? "html_login_page" : "api_changed";
        trace.warningCode = code;
        trace.finishedAt = new Date().toISOString();
        options.onTrace?.(trace);
        throw error;
      }
      try {
        const parsed = JSON.parse(text) as T;
        trace.result = "success";
        trace.finishedAt = new Date().toISOString();
        options.onTrace?.(trace);
        return parsed;
      } catch {
        const error = new GogProviderError("GOG_API_CHANGED", "GOG returned a non-JSON response where JSON was expected.", false);
        trace.result = "api_changed";
        trace.warningCode = "GOG_API_CHANGED";
        trace.finishedAt = new Date().toISOString();
        options.onTrace?.(trace);
        throw error;
      }
    } catch (error) {
      const gogError = toGogProviderError(error);
      if (!trace.finishedAt) {
        trace.result = traceResultForError(gogError);
        trace.errorCode = gogError.gogCode;
        trace.finishedAt = new Date().toISOString();
        options.onTrace?.(trace);
      }
      if (gogError.retryable && attempt < retries) {
        await delayForTests(250 * 2 ** attempt);
        continue;
      }
      throw gogError;
    } finally {
      timeout.cleanup();
    }
  }
  throw new GogProviderError("GOG_UNKNOWN", "GOG request failed after retries.", false);
}

export function parseGogAccountBasic(body: unknown): GogAccountBasic {
  const username =
    stringValue(body, ["username", "login", "nickname"]) ??
    stringValue(valueAt(body, ["userData", "user", "account"]), ["username", "login", "nickname"]);
  const accountId =
    stringValue(body, ["userId", "id", "accountId"]) ??
    stringValue(valueAt(body, ["userData", "user", "account"]), ["userId", "id", "accountId"]);
  const loggedIn = booleanValue(body, ["isLoggedIn", "loggedIn", "authenticated"]);

  if (loggedIn === false || (!username && !accountId)) {
    return { isLoggedIn: false };
  }
  return {
    isLoggedIn: true,
    ...(username ? { username } : {}),
    ...(accountId ? { accountId } : {})
  };
}

export async function getGogAccountBasic(onTrace?: (trace: ProviderEndpointTraceInput) => void): Promise<GogAccountBasic> {
  return parseGogAccountBasic(await fetchGogJson<unknown>(new URL(ACCOUNT_BASIC_URL), { endpointKey: "accountBasic", ...(onTrace ? { onTrace } : {}) }));
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
  }
  if (typeof value === "number" && value > 0) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }
  return undefined;
}

function playtimeMinutes(record: unknown): number | undefined {
  const explicit = numberValue(record, ["playtimeMinutes", "playtime_minutes", "minutesPlayed"]);
  if (explicit !== undefined) {
    return Math.max(0, Math.round(explicit));
  }
  const seconds = numberValue(record, ["playtimeSeconds", "playtime_seconds", "timePlayedSeconds"]);
  if (seconds !== undefined) {
    return Math.max(0, Math.round(seconds / 60));
  }
  const rawPlaytime = numberValue(record, ["playtime", "timePlayed"]);
  if (rawPlaytime !== undefined) {
    return rawPlaytime > 10000 ? Math.max(0, Math.round(rawPlaytime / 60)) : Math.max(0, Math.round(rawPlaytime));
  }
  return undefined;
}

export function parseGogLibraryGame(record: unknown): GogLibraryGame | undefined {
  const id = stringValue(record, ["id", "gameId", "productId", "gogGameId"]);
  const title = stringValue(record, ["title", "name", "productTitle"]);
  if (!id || !title || !normalizeTitle(title)) {
    return undefined;
  }
  const slug = stringValue(record, ["slug", "urlSlug"]);
  const productUrl = stringValue(record, ["url", "productUrl"]);
  const type = stringValue(record, ["type", "category", "mediaType"]);
  const isExtra =
    booleanValue(record, ["isExtra", "extra"]) === true ||
    Boolean(type && /extra|bonus|goodie|dlc/i.test(type) && !/game/i.test(type));
  const lastPlayedAt = normalizeTimestamp(valueAt(record, ["lastPlayedAt", "lastSession", "lastPlayed", "lastActivity"]));
  const minutes = playtimeMinutes(record);
  return {
    id,
    title,
    ...(slug ? { slug } : {}),
    ...(productUrl ? { productUrl } : {}),
    ...(minutes !== undefined ? { playtimeMinutes: minutes } : {}),
    ...(lastPlayedAt ? { lastPlayedAt } : {}),
    isExtra,
    raw: record
  };
}

function recordsFromPage(body: unknown): unknown[] {
  const direct = valueAt(body, ["items", "games", "products", "ownedGames", "data"]);
  if (Array.isArray(direct)) {
    return direct;
  }
  const nested = valueAt(valueAt(body, ["library", "response"]), ["items", "games", "products"]);
  if (Array.isArray(nested)) {
    return nested;
  }
  return [];
}

function totalPages(body: unknown): number | undefined {
  return numberValue(body, ["totalPages", "pages", "pageCount"]) ?? numberValue(valueAt(body, ["pagination"]), ["totalPages", "pages"]);
}

function currentPage(body: unknown, fallback: number): number {
  return numberValue(body, ["page", "currentPage"]) ?? numberValue(valueAt(body, ["pagination"]), ["page", "currentPage"]) ?? fallback;
}

function hasNextPage(body: unknown, page: number, records: unknown[]): boolean {
  const total = totalPages(body);
  if (total !== undefined) {
    return page < total;
  }
  const next = valueAt(body, ["nextPage", "next", "hasNextPage"]);
  if (typeof next === "boolean") {
    return next;
  }
  return records.length > 0 && records.length >= 50;
}

export function parseLibraryPage(body: unknown, page: number, endpoint: "libraryStats" | "legacyFilteredProducts"): GogParseResult<GogLibraryGame> {
  const records = recordsFromPage(body);
  const games = records.map(parseGogLibraryGame).filter((game): game is GogLibraryGame => Boolean(game));
  const pages = totalPages(body);
  const pageInfo = {
    currentPage: currentPage(body, page),
    ...(pages !== undefined ? { totalPages: pages } : {}),
    hasNextPage: hasNextPage(body, currentPage(body, page), records)
  };
  if (records.length === 0 && totalPages(body) === undefined && page === 1) {
    const knownEmpty = numberValue(body, ["totalResults", "total", "count"]) === 0;
    if (!knownEmpty) {
      return {
        ok: false,
        items: [],
        pageInfo,
        warning: {
          code: endpoint === "libraryStats" ? "GOG_LIBRARY_STATS_API_CHANGED" : "GOG_LEGACY_API_CHANGED",
          message:
            endpoint === "libraryStats"
              ? "GOG's newer library endpoint returned an unexpected shape, so the extension tried the legacy fallback."
              : "GOG's legacy library endpoint returned an unexpected shape.",
          phase: endpoint === "libraryStats" ? "libraryStats" : "legacyFallback",
          endpoint
        }
      };
    }
  }
  if (records.length > 0 && games.length === 0) {
    return {
      ok: false,
      items: [],
      pageInfo,
      warning: {
        code: endpoint === "libraryStats" ? "GOG_LIBRARY_STATS_API_CHANGED" : "GOG_LEGACY_API_CHANGED",
        message: endpoint === "libraryStats" ? "GOG library stats records were present but no games could be parsed." : "GOG legacy product records were present but no games could be parsed.",
        phase: endpoint === "libraryStats" ? "libraryStats" : "legacyFallback",
        endpoint
      }
    };
  }
  return {
    ok: true,
    items: games,
    pageInfo,
    ...(games.length === 0
      ? {
          warning: {
            code: endpoint === "libraryStats" ? "GOG_LIBRARY_STATS_EMPTY" : "GOG_LEGACY_EMPTY",
            message: endpoint === "libraryStats" ? "GOG's newer library endpoint returned zero games." : "GOG's legacy library endpoint returned zero games.",
            phase: endpoint === "libraryStats" ? "libraryStats" : "legacyFallback",
            endpoint
          }
        }
      : {})
  };
}

export async function getGogOwnedGamesNewApi(
  username: string,
  signal?: AbortSignal,
  onTrace?: (trace: ProviderEndpointTraceInput) => void,
  firstPageOnly = false
): Promise<{ games: GogLibraryGame[]; warnings: ImportWarning[] }> {
  const games: GogLibraryGame[] = [];
  const warnings: ImportWarning[] = [];
  for (let page = 1; page < 500; page += 1) {
    const url = new URL(`https://www.gog.com/u/${encodeURIComponent(username)}/games/stats`);
    url.searchParams.set("page", String(page));
    let latestTrace: ProviderEndpointTraceInput | undefined;
    let body: unknown;
    try {
      body = await fetchGogJson<unknown>(url, { ...(signal ? { signal } : {}), endpointKey: "libraryStats", onTrace: (trace) => (latestTrace = trace) });
    } catch (error) {
      if (latestTrace) {
        onTrace?.(latestTrace);
      }
      throw error;
    }
    const parsed = parseLibraryPage(body, page, "libraryStats");
    if (latestTrace) {
      latestTrace.itemCount = parsed.items.length;
      latestTrace.result = parsed.items.length ? "success" : parsed.ok ? "empty" : "api_changed";
      if (parsed.warning) {
        latestTrace.warningCode = parsed.warning.code;
      }
      onTrace?.(latestTrace);
    }
    if (parsed.warning && !warnings.some((warning) => warning.code === parsed.warning?.code && warning.endpoint === parsed.warning?.endpoint)) {
      warnings.push(parsed.warning);
    }
    if (!parsed.ok) {
      throw new GogProviderError("GOG_LIBRARY_STATS_API_CHANGED", parsed.warning?.message ?? "GOG library stats response shape changed.", false);
    }
    games.push(...parsed.items);
    if (parsed.items.length === 0 && parsed.warning) {
      return { games, warnings };
    }
    if (firstPageOnly || !parsed.pageInfo?.hasNextPage) {
      return { games, warnings };
    }
  }
  throw new GogProviderError("GOG_LIBRARY_STATS_API_CHANGED", "GOG library pagination did not terminate.", false);
}

export async function getGogOwnedGamesLegacy(
  signal?: AbortSignal,
  onTrace?: (trace: ProviderEndpointTraceInput) => void,
  firstPageOnly = false
): Promise<{ games: GogLibraryGame[]; warnings: ImportWarning[] }> {
  const games: GogLibraryGame[] = [];
  const warnings: ImportWarning[] = [];
  for (let page = 1; page < 500; page += 1) {
    const url = new URL(LEGACY_LIBRARY_URL);
    url.searchParams.set("hiddenFlag", "0");
    url.searchParams.set("mediaType", "1");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sortBy", "title");
    let latestTrace: ProviderEndpointTraceInput | undefined;
    let body: unknown;
    try {
      body = await fetchGogJson<unknown>(url, {
        ...(signal ? { signal } : {}),
        endpointKey: "legacyFilteredProducts",
        onTrace: (trace) => (latestTrace = trace)
      });
    } catch (error) {
      if (latestTrace) {
        onTrace?.(latestTrace);
      }
      throw error;
    }
    const parsed = parseLibraryPage(body, page, "legacyFilteredProducts");
    if (latestTrace) {
      latestTrace.itemCount = parsed.items.length;
      latestTrace.result = parsed.items.length ? "success" : parsed.ok ? "empty" : "api_changed";
      if (parsed.warning) {
        latestTrace.warningCode = parsed.warning.code;
      }
      onTrace?.(latestTrace);
    }
    if (parsed.warning && !warnings.some((warning) => warning.code === parsed.warning?.code && warning.endpoint === parsed.warning?.endpoint)) {
      warnings.push(parsed.warning);
    }
    if (!parsed.ok) {
      throw new GogProviderError("GOG_LEGACY_API_CHANGED", parsed.warning?.message ?? "GOG legacy library response shape changed.", false);
    }
    games.push(...parsed.items);
    if (parsed.items.length === 0 && parsed.warning) {
      return { games, warnings };
    }
    if (firstPageOnly || !parsed.pageInfo?.hasNextPage) {
      return { games, warnings };
    }
  }
  throw new GogProviderError("GOG_LEGACY_API_CHANGED", "GOG legacy library pagination did not terminate.", false);
}

export async function getGogOwnedGameDetails(gameId: string, signal?: AbortSignal): Promise<GogOwnedGameDetails | undefined> {
  const url = new URL(`https://www.gog.com/account/gameDetails/${encodeURIComponent(gameId)}.json`);
  try {
    const body = await fetchGogJson<unknown>(url, { ...(signal ? { signal } : {}), retries: 1, endpointKey: "gameDetails" });
    const id = stringValue(body, ["id", "gameId", "productId"]) ?? gameId;
    const title = stringValue(body, ["title", "name"]);
    const downloads = valueAt(body, ["downloads"]);
    return {
      id,
      ...(title ? { title } : {}),
      ...(Array.isArray(downloads) ? { downloads } : {}),
      raw: body
    };
  } catch (error) {
    const gogError = toGogProviderError(error);
    if (gogError.gogCode === "GOG_LIBRARY_PRIVATE_OR_UNAVAILABLE") {
      return undefined;
    }
    throw gogError;
  }
}
