import type { AssistedProviderId, AssistedSessionExtractionResult, AssistedSessionGame } from "./assistedTypes";

const TOKEN_KEY_PATTERN = /(token|authorization|auth|cookie|sid|session|password|secret|refresh|access)/i;
const BAD_VISIBLE_TITLES = new Set([
  "account",
  "all",
  "alertinfo",
  "angle down",
  "angledown",
  "angle right",
  "angleright",
  "arrow down chevron",
  "arrowdownchevron",
  "back to top",
  "breadcrumbs",
  "browse",
  "cart",
  "claim",
  "claim code",
  "claim games",
  "codes",
  "collected",
  "collected in",
  "collected on",
  "community",
  "conditions of use",
  "cookie notice",
  "delivered",
  "download",
  "download the amazon games app (windows)",
  "en",
  "external link with box",
  "externallinkwithbox",
  "facebook",
  "filter by collected in past 3 months",
  "follow @luna",
  "friends",
  "game",
  "games",
  "get the amazon games app",
  "global",
  "help",
  "home",
  "in-game content",
  "instagram",
  "instructions",
  "interest-based ads",
  "language selector dropdown",
  "link to amazon website",
  "library",
  "login",
  "logout",
  "logolunahorizontal",
  "news",
  "profile",
  "search",
  "settings",
  "sign in",
  "store",
  "support",
  "wishlist"
]);

const BAD_VISIBLE_TITLE_PATTERN =
  /^(claim|claimed|download|install|learn more|play now|prime gaming|included with prime|sign in|sign out|try luna|view details|watch trailer)$/i;
const DATE_TITLE_PATTERN = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(,\s+\d{4})?$/i;
const HASHLIKE_TITLE_PATTERN = /^[A-Z0-9]{10,}$/;
const DELIVERY_MESSAGE_PATTERN = /^delivered to your .+ library on .+\.$/i;
const ACCOUNT_TITLE_PATTERN = /account|@|gmail\.com|\*{2,}/i;

function stripAmazonImagePrefix(value: string | undefined): string | undefined {
  return value?.replace(/^image of\s+/i, "");
}

function cleanTitle(value: string | undefined): string | undefined {
  const title = value
    ?.replace(/\s+/g, " ")
    .replace(/\s+\|\s+.*$/i, "")
    .replace(/\s+-\s+Steam$/i, "")
    .replace(/\s+-\s+Amazon.*$/i, "")
    .trim();
  if (!title || title.length < 2) {
    return undefined;
  }
  if (BAD_VISIBLE_TITLES.has(title.toLowerCase())) {
    return undefined;
  }
  if (
    BAD_VISIBLE_TITLE_PATTERN.test(title) ||
    DATE_TITLE_PATTERN.test(title) ||
    HASHLIKE_TITLE_PATTERN.test(title) ||
    DELIVERY_MESSAGE_PATTERN.test(title) ||
    ACCOUNT_TITLE_PATTERN.test(title)
  ) {
    return undefined;
  }
  return title;
}

function safeId(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
}

export function uniqueAssistedGames(games: AssistedSessionGame[]): AssistedSessionGame[] {
  const byKey = new Map<string, AssistedSessionGame>();
  for (const game of games) {
    const key = `${game.providerGameId}:${game.title.toLowerCase()}`;
    if (!byKey.has(key)) {
      byKey.set(key, game);
    }
  }
  return [...byKey.values()];
}

function textFromElement(element: HTMLElement): string | undefined {
  const anchor = element.tagName.toLowerCase() === "a" ? (element as HTMLAnchorElement) : element.querySelector<HTMLAnchorElement>("a[href]");
  const image = element.querySelector<HTMLImageElement>("img[alt]");
  return (
    cleanTitle(element.getAttribute("aria-label") ?? undefined) ??
    cleanTitle(element.getAttribute("title") ?? undefined) ??
    cleanTitle(anchor?.getAttribute("aria-label") ?? undefined) ??
    cleanTitle(anchor?.getAttribute("title") ?? undefined) ??
    cleanTitle(image?.alt) ??
    cleanTitle(element.textContent ?? undefined)
  );
}

function hrefFromElement(element: HTMLElement): string | undefined {
  const anchor = element.tagName.toLowerCase() === "a" ? (element as HTMLAnchorElement) : element.querySelector<HTMLAnchorElement>("a[href]");
  return anchor?.href ?? element.getAttribute("href") ?? undefined;
}

function steamAppIdFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value, "https://store.steampowered.com");
    return url.pathname.match(/\/app\/(\d+)/i)?.[1];
  } catch {
    return undefined;
  }
}

function steamAccountMarker(documentRef: Document): string | undefined {
  const current = documentRef.location?.href;
  const profileMatch = current?.match(/\/profiles\/(\d{15,20})/);
  if (profileMatch?.[1]) {
    return profileMatch[1];
  }
  const link = documentRef.querySelector<HTMLAnchorElement>('a[href*="/profiles/"]');
  return link?.href.match(/\/profiles\/(\d{15,20})/)?.[1];
}

export function extractVisibleSteamGames(documentRef: Document = document): AssistedSessionGame[] {
  const games: AssistedSessionGame[] = [];
  const selectors = [
    'a[href*="store.steampowered.com/app/"]',
    'a[href*="/app/"]',
    "[data-ds-appid]",
    "[data-appid]",
    ".gameListRow",
    ".gameListRowLogo"
  ];
  for (const element of Array.from(documentRef.querySelectorAll<HTMLElement>(selectors.join(",")))) {
    const href = hrefFromElement(element);
    const appId = element.dataset.dsAppid?.split(",")[0] ?? element.dataset.appid ?? steamAppIdFromUrl(href);
    if (!appId || !/^\d+$/.test(appId)) {
      continue;
    }
    const title = textFromElement(element);
    if (!title || title.toLowerCase().includes("store page")) {
      continue;
    }
    games.push({
      providerGameId: appId,
      title,
      sourceUrl: `https://store.steampowered.com/app/${appId}`
    });
  }
  return uniqueAssistedGames(games);
}

function isTokenLikeKey(key: string): boolean {
  return TOKEN_KEY_PATTERN.test(key);
}

function stringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() && !isTokenLikeKey(key)) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value) && !isTokenLikeKey(key)) {
      return String(value);
    }
  }
  return undefined;
}

function numberValue(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && !isTokenLikeKey(key)) {
      return value;
    }
  }
  return undefined;
}

function recordToSteamGame(record: Record<string, unknown>): AssistedSessionGame | undefined {
  const appId = stringValue(record, ["appid", "appId", "app_id", "id"]);
  const title = cleanTitle(stringValue(record, ["name", "title", "displayName"]));
  if (!appId || !/^\d+$/.test(appId) || !title) {
    return undefined;
  }
  const playtimeMinutes = numberValue(record, ["playtime_forever", "playtimeMinutes", "playtime_minutes"]);
  return {
    providerGameId: appId,
    title,
    sourceUrl: `https://store.steampowered.com/app/${appId}`,
    ...(playtimeMinutes !== undefined ? { playtimeMinutes } : {})
  };
}

function amazonIdFromUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value, "https://gaming.amazon.com");
    return url.pathname.split("/").filter(Boolean).at(-1);
  } catch {
    return undefined;
  }
}

function isAmazonProductUrl(value: string | undefined): boolean {
  if (!value || !isAmazonLibraryUrl(value)) {
    return false;
  }
  try {
    const url = new URL(value, "https://gaming.amazon.com");
    return /\/(claims\/)?(details?|detail)\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function hasAmazonProductIdentifier(record: Record<string, unknown>, sourceUrl: string | undefined): boolean {
  return Boolean(
    stringValue(record, ["productId", "asin", "entitlementId", "offerId", "gameId", "contentId"]) ||
      isAmazonProductUrl(sourceUrl)
  );
}

function recordToAmazonGame(record: Record<string, unknown>): AssistedSessionGame | undefined {
  const sourceUrl = stringValue(record, ["url", "href", "productUrl", "detailUrl", "link"]);
  if (!hasAmazonProductIdentifier(record, sourceUrl)) {
    return undefined;
  }
  const title = cleanTitle(stripAmazonImagePrefix(stringValue(record, ["productTitle", "title", "displayName", "name"])));
  if (!title) {
    return undefined;
  }
  const providerGameId = safeId(
    stringValue(record, ["productId", "asin", "entitlementId", "offerId", "gameId", "contentId"]) ?? amazonIdFromUrl(sourceUrl),
    title
  );
  let normalizedSourceUrl: string | undefined;
  if (sourceUrl) {
    try {
      normalizedSourceUrl = new URL(sourceUrl, "https://gaming.amazon.com").toString();
    } catch {
      normalizedSourceUrl = undefined;
    }
  }
  return {
    providerGameId,
    title,
    ...(normalizedSourceUrl ? { sourceUrl: normalizedSourceUrl } : {})
  };
}

export function extractAmazonGamesFromGraphqlPayload(payload: unknown): AssistedSessionGame[] {
  const games: AssistedSessionGame[] = [];
  walkForGames(payload, "amazon", games);
  return uniqueAssistedGames(games);
}

function walkForGames(
  value: unknown,
  providerId: AssistedProviderId,
  games: AssistedSessionGame[],
  depth = 0
): void {
  if (depth > 10 || value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkForGames(item, providerId, games, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  const game = providerId === "steam" ? recordToSteamGame(record) : recordToAmazonGame(record);
  if (game) {
    games.push(game);
  }
  for (const [key, nested] of Object.entries(record)) {
    if (!isTokenLikeKey(key)) {
      walkForGames(nested, providerId, games, depth + 1);
    }
  }
}

export function extractEmbeddedAssistedGames(providerId: AssistedProviderId, documentRef: Document = document): AssistedSessionGame[] {
  const games: AssistedSessionGame[] = [];
  for (const script of Array.from(documentRef.querySelectorAll<HTMLScriptElement>("script"))) {
    const text = script.textContent?.trim();
    if (!text || TOKEN_KEY_PATTERN.test(script.id)) {
      continue;
    }
    try {
      walkForGames(JSON.parse(text), providerId, games);
    } catch {
      continue;
    }
  }
  return uniqueAssistedGames(games);
}

function isAmazonLibraryUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value, "https://gaming.amazon.com");
    return /(^|\.)amazon\./i.test(url.hostname) || url.hostname === "gaming.amazon.com" || url.hostname.startsWith("luna.amazon.");
  } catch {
    return false;
  }
}

export function extractVisibleAmazonGames(documentRef: Document = document): AssistedSessionGame[] {
  const games: AssistedSessionGame[] = [];
  const selectors = [
    'a[href*="/claims/details/"]',
    'a[href*="/claim/details/"]',
    'a[href*="/details/"]',
    'a[href*="/detail/"]',
    'a[href*="offerType=games"]',
    'img[alt^="Image of "]',
    "[data-asin]",
    "[data-product-id]",
    "[data-productid]"
  ];
  for (const element of Array.from(documentRef.querySelectorAll<HTMLElement>(selectors.join(",")))) {
    const linkElement = element.closest<HTMLAnchorElement>("a[href]");
    const href = hrefFromElement(element) ?? linkElement?.href;
    const hasProductEvidence =
      isAmazonProductUrl(href) ||
      Boolean(element.dataset.asin ?? element.dataset.productId ?? element.dataset.productid) ||
      (element.tagName.toLowerCase() === "img" && /^image of\s+/i.test((element as HTMLImageElement).alt));
    if (!hasProductEvidence) {
      continue;
    }
    if (href && !isAmazonLibraryUrl(href)) {
      continue;
    }
    const imageTitle = element.tagName.toLowerCase() === "img" ? stripAmazonImagePrefix((element as HTMLImageElement).alt) : undefined;
    const title = cleanTitle(imageTitle) ?? textFromElement(element);
    if (!title || title.length < 2 || title.length > 120) {
      continue;
    }
    const lowerTitle = title.toLowerCase();
    if (/^(amazon|luna|prime gaming|home|library|search|menu|settings|account|help)$/.test(lowerTitle)) {
      continue;
    }
    const providerGameId = safeId(
      element.dataset.asin ?? element.dataset.productId ?? element.dataset.productid ?? amazonIdFromUrl(href),
      title
    );
    let normalizedSourceUrl: string | undefined;
    if (href) {
      try {
        normalizedSourceUrl = new URL(href, "https://gaming.amazon.com").toString();
      } catch {
        normalizedSourceUrl = undefined;
      }
    }
    games.push({
      providerGameId,
      title,
      ...(normalizedSourceUrl ? { sourceUrl: normalizedSourceUrl } : {})
    });
  }
  return uniqueAssistedGames(games);
}

function cloneSafeGraphqlPayload(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const query = typeof record.query === "string" ? record.query : undefined;
  const operationName = typeof record.operationName === "string" ? record.operationName : undefined;
  const variables = record.variables && typeof record.variables === "object" ? record.variables : undefined;
  const extensions = record.extensions && typeof record.extensions === "object" ? record.extensions : undefined;
  if (!query && !operationName && !extensions) {
    return undefined;
  }
  const payload: Record<string, unknown> = {};
  if (operationName) {
    payload.operationName = operationName;
  }
  if (query) {
    payload.query = query;
  }
  if (variables) {
    payload.variables = variables;
  }
  if (extensions) {
    payload.extensions = extensions;
  }
  return payload;
}

function walkForGraphqlPayloads(value: unknown, payloads: Record<string, unknown>[], depth = 0): void {
  if (depth > 8 || value === null || value === undefined || payloads.length >= 6) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkForGraphqlPayloads(item, payloads, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  const record = value as Record<string, unknown>;
  const payload = cloneSafeGraphqlPayload(record);
  if (payload) {
    payloads.push(payload);
  }
  for (const [key, nested] of Object.entries(record)) {
    if (!isTokenLikeKey(key)) {
      walkForGraphqlPayloads(nested, payloads, depth + 1);
    }
  }
}

export function extractAmazonGraphqlRequestPayloads(documentRef: Document = document): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [];
  for (const script of Array.from(documentRef.querySelectorAll<HTMLScriptElement>("script"))) {
    const text = script.textContent?.trim();
    if (!text || !text.includes("operationName") || TOKEN_KEY_PATTERN.test(script.id)) {
      continue;
    }
    try {
      walkForGraphqlPayloads(JSON.parse(text), payloads);
    } catch {
      continue;
    }
  }
  const seen = new Set<string>();
  return payloads.filter((payload) => {
    const key = JSON.stringify(payload);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function getPrimeGamingCsrfToken(documentRef: Document = document): string | undefined {
  const value =
    documentRef.querySelector<HTMLInputElement>('input[name="csrf-key"]')?.value ??
    documentRef.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ??
    documentRef.querySelector<HTMLElement>("[data-csrf-token]")?.dataset.csrfToken;
  return value?.trim() || undefined;
}

export async function extractAmazonGamesViaGraphql(documentRef: Document = document): Promise<AssistedSessionGame[]> {
  const csrfToken = getPrimeGamingCsrfToken(documentRef);
  const payloads = extractAmazonGraphqlRequestPayloads(documentRef);
  if (payloads.length === 0) {
    return [];
  }

  const games: AssistedSessionGame[] = [];
  for (const payload of payloads) {
    try {
      const response = await fetch("https://gaming.amazon.com/graphql", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...(csrfToken ? { "csrf-token": csrfToken } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        continue;
      }
      games.push(...extractAmazonGamesFromGraphqlPayload(await response.json()));
    } catch {
      continue;
    }
    if (games.length > 0) {
      break;
    }
  }
  return uniqueAssistedGames(games);
}

export function extractAssistedGamesFromPage(
  providerId: AssistedProviderId,
  documentRef: Document = document
): AssistedSessionExtractionResult {
  const visible = providerId === "steam" ? extractVisibleSteamGames(documentRef) : extractVisibleAmazonGames(documentRef);
  const embedded = extractEmbeddedAssistedGames(providerId, documentRef);
  const games = uniqueAssistedGames([...visible, ...embedded]);
  const accountMarker = providerId === "steam" ? steamAccountMarker(documentRef) : undefined;
  const source =
    visible.length > 0 && embedded.length > 0
      ? "combined"
      : visible.length > 0
        ? "visible"
        : embedded.length > 0
          ? "embeddedJson"
          : "visible";
  return {
    providerId,
    games,
    ...(accountMarker ? { accountMarker } : {}),
    source,
    warnings:
      games.length === 0
        ? [
            {
              code: `${providerId.toUpperCase()}_ASSISTED_IMPORT_EMPTY`,
              message: `No ${providerId} library games were visible in the current browser page.`
            }
          ]
        : []
  };
}
