import type { AuthTokenRecord } from "../../shared/types";
import { epicAuthConfig } from "./epicAuthConfig";
import { EpicProviderError, toEpicProviderError } from "./epicErrors";
import { shouldImportEpicAsset } from "./epicFilters";
import { mapEpicAssetToProviderGame } from "./epicMappers";
import { redactEpicSecrets } from "./epicRedaction";
import type { EpicAccount, EpicAsset, EpicCatalogItem, EpicPlaytimeItem } from "./epicTypes";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;

let delayForTests: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setEpicApiDelayForTests(delay: (ms: number) => Promise<void>): void {
  delayForTests = delay;
}

export function buildEpicCatalogItemUrl(namespace: string, catalogItemId: string): URL {
  return new URL(
    `${epicAuthConfig.catalogUrl}/${encodeURIComponent(namespace)}/bulk/items?id=${encodeURIComponent(catalogItemId)}&locale=en-US&country=US&includeMainGameDetails=true`
  );
}

function abortError(): DOMException {
  return new DOMException("Epic request was aborted.", "AbortError");
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

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function endpointError(status: number): EpicProviderError {
  if (status === 401 || status === 403) {
    return new EpicProviderError("EPIC_TOKEN_EXPIRED", "Epic authentication expired or was rejected.", false);
  }
  if (status === 404) {
    return new EpicProviderError("EPIC_CATALOG_ITEM_MISSING", "Epic catalog item was not found.", false);
  }
  if (status === 429) {
    return new EpicProviderError("EPIC_RATE_LIMITED", "Epic rate-limited the request.", true);
  }
  if (status >= 500) {
    return new EpicProviderError("EPIC_NETWORK_ERROR", `Epic endpoint failed with HTTP ${status}.`, true);
  }
  return new EpicProviderError("EPIC_API_CHANGED", `Epic endpoint returned unexpected HTTP ${status}.`, false);
}

function bearerHeader(tokens: AuthTokenRecord): string {
  if (!tokens.accessToken) {
    throw new EpicProviderError("EPIC_AUTH_REQUIRED", "Connect Epic before syncing.", false);
  }
  const tokenType = tokens.tokenType?.trim() || "bearer";
  return `${tokenType} ${tokens.accessToken}`;
}

export async function epicAuthenticatedFetch<T>(
  url: URL,
  tokens: AuthTokenRecord,
  options: { signal?: AbortSignal; retries?: number; timeoutMs?: number } = {}
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeout = withTimeout(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          Authorization: bearerHeader(tokens)
        },
        signal: timeout.signal
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const error = endpointError(response.status);
        error.message = redactEpicSecrets(`${error.message}${text ? ` ${text}` : ""}`);
        if (isRetryableStatus(response.status) && attempt < retries) {
          await delayForTests(250 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      return (await response.json()) as T;
    } catch (error) {
      const epicError = toEpicProviderError(error);
      if (epicError.retryable && attempt < retries) {
        await delayForTests(250 * 2 ** attempt);
        continue;
      }
      throw epicError;
    } finally {
      timeout.cleanup();
    }
  }
  throw new EpicProviderError("EPIC_UNKNOWN", "Epic request failed after retries.", false);
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
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(record: unknown, keys: string[]): number | undefined {
  const value = valueAt(record, keys);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseEpicAccount(body: unknown): EpicAccount {
  const accountId = stringValue(body, ["account_id", "accountId", "id"]);
  if (!accountId) {
    throw new EpicProviderError("EPIC_API_CHANGED", "Epic account response shape changed.", false);
  }
  const displayName = stringValue(body, ["displayName", "display_name", "name"]);
  return {
    accountId,
    ...(displayName ? { displayName } : {})
  };
}

export function parseEpicLibraryPage(body: unknown): { assets: EpicAsset[]; nextCursor?: string } {
  const records = valueAt(body, ["records", "items", "data"]);
  if (!Array.isArray(records)) {
    throw new EpicProviderError("EPIC_API_CHANGED", "Epic library response shape changed.", false);
  }
  const assets = records
    .filter((record): record is Record<string, unknown> => Boolean(record && typeof record === "object"))
    .map((record) => {
      const appName = stringValue(record, ["appName", "app_name"]);
      const namespace = stringValue(record, ["namespace"]);
      const catalogItemId = stringValue(record, ["catalogItemId", "catalog_item_id"]);
      const sandboxType = stringValue(record, ["sandboxType", "sandbox_type"]);
      const buildVersion = stringValue(record, ["buildVersion", "build_version"]);
      return {
        ...(appName ? { appName } : {}),
        ...(namespace ? { namespace } : {}),
        ...(catalogItemId ? { catalogItemId } : {}),
        ...(sandboxType ? { sandboxType } : {}),
        ...(buildVersion ? { buildVersion } : {})
      };
    });
  const paging = valueAt(body, ["paging", "pagination"]);
  const responseMetadata = valueAt(body, ["responseMetadata"]);
  const nextCursor = stringValue(responseMetadata, ["nextCursor"]) ?? stringValue(paging, ["nextCursor", "next", "cursor"]);
  return {
    assets,
    ...(nextCursor ? { nextCursor } : {})
  };
}

export function parseEpicPlaytimeItems(body: unknown): EpicPlaytimeItem[] {
  const records = Array.isArray(body) ? body : valueAt(body, ["records", "items", "data"]);
  if (!Array.isArray(records)) {
    throw new EpicProviderError("EPIC_API_CHANGED", "Epic playtime response shape changed.", false);
  }
  return records
    .map((record) => {
      const artifactId = stringValue(record, ["artifactId", "artifact_id", "appName"]);
      const totalTime = numberValue(record, ["totalTime", "total_time", "minutes"]);
      return artifactId && totalTime !== undefined ? { artifactId, totalTime } : undefined;
    })
    .filter((item): item is EpicPlaytimeItem => Boolean(item));
}

export function parseEpicCatalogItem(body: unknown, catalogItemId?: string): EpicCatalogItem | undefined {
  const direct = body as EpicCatalogItem;
  const nested =
    catalogItemId && body && typeof body === "object" ? (body as Record<string, unknown>)[catalogItemId] : undefined;
  const candidate = nested && typeof nested === "object" ? (nested as EpicCatalogItem) : direct;
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const id = stringValue(candidate, ["id"]) ?? catalogItemId;
  const title = stringValue(candidate, ["title"]);
  if (!id && !title) {
    return undefined;
  }
  return {
    ...(id ? { id } : {}),
    ...(title ? { title } : {}),
    ...(Array.isArray(candidate.categories) ? { categories: candidate.categories } : {}),
    ...(candidate.mainGameItem ? { mainGameItem: candidate.mainGameItem } : {}),
    ...(candidate.customAttributes ? { customAttributes: candidate.customAttributes } : {})
  };
}

export async function getEpicAccount(tokens: AuthTokenRecord, signal?: AbortSignal): Promise<EpicAccount> {
  const account = parseEpicAccount(
    await epicAuthenticatedFetch<unknown>(
      new URL(`${epicAuthConfig.accountUrl}/${encodeURIComponent(tokens.accountId ?? "")}`),
      tokens,
      signal ? { signal } : {}
    )
  );
  if (tokens.accountId && account.accountId !== tokens.accountId) {
    throw new EpicProviderError("EPIC_ACCOUNT_MISMATCH", "Epic account validation failed.", false);
  }
  return account;
}

export async function getEpicLibraryItems(tokens: AuthTokenRecord, signal?: AbortSignal): Promise<EpicAsset[]> {
  const assets: EpicAsset[] = [];
  let cursor: string | undefined;
  for (let page = 1; page < 500; page += 1) {
    const url = new URL(epicAuthConfig.libraryItemsUrl);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }
    const parsed = parseEpicLibraryPage(await epicAuthenticatedFetch<unknown>(url, tokens, signal ? { signal } : {}));
    assets.push(...parsed.assets);
    cursor = parsed.nextCursor;
    if (!cursor) {
      return assets;
    }
  }
  throw new EpicProviderError("EPIC_API_CHANGED", "Epic library pagination did not terminate.", false);
}

export async function getEpicPlaytimeItems(
  tokens: AuthTokenRecord,
  accountId: string,
  signal?: AbortSignal
): Promise<EpicPlaytimeItem[]> {
  const url = new URL(epicAuthConfig.playtimeUrl.replace("{accountId}", encodeURIComponent(accountId)));
  return parseEpicPlaytimeItems(await epicAuthenticatedFetch<unknown>(url, tokens, signal ? { signal } : {}));
}

export async function getEpicCatalogItem(
  tokens: AuthTokenRecord,
  namespace: string,
  catalogItemId: string,
  _cacheKey: string,
  signal?: AbortSignal
): Promise<EpicCatalogItem | undefined> {
  const url = buildEpicCatalogItemUrl(namespace, catalogItemId);
  return parseEpicCatalogItem(await epicAuthenticatedFetch<unknown>(url, tokens, { ...(signal ? { signal } : {}), retries: 1 }), catalogItemId);
}

export { mapEpicAssetToProviderGame, shouldImportEpicAsset };
