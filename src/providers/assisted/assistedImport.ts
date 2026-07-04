import { makeProviderError } from "../../shared/errors";
import type { ProviderGame, ProviderImportResult, StoreId } from "../../shared/types";
import { generateSteamAliases } from "../steam/SteamProvider";
import { SteamSettingsRepository } from "../steam/steamSettings";
import type { AssistedProviderId, AssistedSessionExtractionResult, AssistedSessionGame } from "./assistedTypes";

const STEAM_LIBRARY_URL = "https://steamcommunity.com/my/games/?tab=all";
const AMAZON_LIBRARY_URL = "https://luna.amazon.ca/claims/my-collection?offerType=games";
const ASSISTED_TAB_STORAGE_KEY = "owncheck.assistedProviderTabs";

const ASSISTED_ACCOUNT_ID: Record<AssistedProviderId, string> = {
  steam: "steam-browser-session",
  amazon: "amazon-browser-session"
};

const AMAZON_EDITION_SUFFIXES = [
  "Standard Edition",
  "Deluxe Edition",
  "Ultimate Edition",
  "Complete Edition",
  "Game of the Year Edition",
  "Definitive Edition"
];

function nowIso(): string {
  return new Date().toISOString();
}

function isProviderUrl(providerId: AssistedProviderId, value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    if (providerId === "steam") {
      return url.hostname === "steamcommunity.com" || url.hostname.endsWith(".steamcommunity.com") || url.hostname === "store.steampowered.com";
    }
    return url.hostname === "gaming.amazon.com" || url.hostname.startsWith("luna.amazon.") || /(^|\.)amazon\./i.test(url.hostname);
  } catch {
    return false;
  }
}

type RememberedAssistedTabs = Partial<Record<AssistedProviderId, number>>;

async function getRememberedAssistedTabs(): Promise<RememberedAssistedTabs> {
  const stored = (await browser.storage.local.get(ASSISTED_TAB_STORAGE_KEY)) as Record<string, unknown>;
  const value = stored[ASSISTED_TAB_STORAGE_KEY];
  return value && typeof value === "object" ? (value as RememberedAssistedTabs) : {};
}

async function rememberAssistedProviderTab(providerId: AssistedProviderId, tabId: number | undefined): Promise<void> {
  if (tabId === undefined) {
    return;
  }
  const tabs = await getRememberedAssistedTabs();
  tabs[providerId] = tabId;
  await browser.storage.local.set({ [ASSISTED_TAB_STORAGE_KEY]: tabs });
}

async function getRememberedProviderTab(providerId: AssistedProviderId): Promise<browser.tabs.Tab | undefined> {
  const tabId = (await getRememberedAssistedTabs())[providerId];
  if (tabId === undefined) {
    return undefined;
  }
  try {
    return await browser.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

async function findProviderTab(providerId: AssistedProviderId): Promise<browser.tabs.Tab | undefined> {
  const rememberedTab = await getRememberedProviderTab(providerId);
  if (rememberedTab?.id !== undefined) {
    return rememberedTab;
  }

  const activeTabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeProviderTab = activeTabs.find((tab) => isProviderUrl(providerId, tab.url));
  if (activeProviderTab) {
    return activeProviderTab;
  }
  const url =
    providerId === "steam"
      ? ["https://steamcommunity.com/*", "https://store.steampowered.com/*"]
      : ["https://gaming.amazon.com/*", "https://luna.amazon.com/*", "https://luna.amazon.ca/*", "https://www.amazon.com/*", "https://www.amazon.ca/*"];
  const tabs = await browser.tabs.query({ url });
  return tabs.find((tab) => isProviderUrl(providerId, tab.url));
}

export async function openAssistedProviderLoginOrLibrary(
  providerId: AssistedProviderId
): Promise<{ providerId: AssistedProviderId; url: string; tabId?: number; message: string }> {
  const url = providerId === "steam" ? STEAM_LIBRARY_URL : AMAZON_LIBRARY_URL;
  const tab = await browser.tabs.create({ url, active: true });
  await rememberAssistedProviderTab(providerId, tab.id);
  return {
    providerId,
    url,
    ...(tab.id !== undefined ? { tabId: tab.id } : {}),
    message:
      providerId === "steam"
        ? "Opened Steam. Sign in if prompted, make sure your library page is visible, then click Import from current Steam session."
        : "Opened Amazon Games. Sign in if prompted, make sure your games/library page is visible, then click Import from current Amazon session."
  };
}

function amazonAliases(title: string): string[] {
  const aliases = new Set<string>();
  for (const suffix of AMAZON_EDITION_SUFFIXES) {
    const stripped = title.replace(new RegExp(`\\s*[-:–—]?\\s*${suffix}\\s*$`, "i"), "").trim();
    if (stripped && stripped !== title && stripped.length >= 4) {
      aliases.add(stripped);
    }
  }
  return [...aliases].sort((a, b) => a.localeCompare(b));
}

function sessionGameToProviderGame(providerId: AssistedProviderId, game: AssistedSessionGame): ProviderGame {
  return {
    providerGameId: game.providerGameId,
    title: game.title,
    sortTitle: game.title,
    aliases: providerId === "steam" ? generateSteamAliases(game.title) : amazonAliases(game.title),
    ...(game.sourceUrl ? { url: game.sourceUrl } : {}),
    platform: ["PC"],
    tags: [],
    categories: [],
    ...(game.playtimeMinutes !== undefined ? { playtimeMinutes: game.playtimeMinutes } : {}),
    ...(game.isInstalled !== undefined ? { isInstalled: game.isInstalled } : {})
  };
}

export function assistedSessionGamesToProviderImportResult(
  providerId: AssistedProviderId,
  games: AssistedSessionGame[],
  options: { accountMarker?: string; warnings?: ProviderImportResult["warnings"] } = {}
): ProviderImportResult {
  return {
    providerId,
    accountId: options.accountMarker ?? ASSISTED_ACCOUNT_ID[providerId],
    importedAt: nowIso(),
    games: games.map((game) => sessionGameToProviderGame(providerId, game)),
    warnings: options.warnings ?? []
  };
}

async function saveAssistedAccountHint(providerId: AssistedProviderId, extraction: AssistedSessionExtractionResult): Promise<void> {
  if (providerId !== "steam") {
    return;
  }
  if (extraction.accountMarker && /^\d{15,20}$/.test(extraction.accountMarker)) {
    await new SteamSettingsRepository().saveSettings(
      {
        steamId64: extraction.accountMarker,
        profileUrl: `https://steamcommunity.com/profiles/${extraction.accountMarker}`,
        includeAppInfo: true
      },
      undefined,
      {
        steamId64: extraction.accountMarker,
        profileUrl: `https://steamcommunity.com/profiles/${extraction.accountMarker}`
      }
    );
  }
}

export async function startAssistedProviderImport(providerId: AssistedProviderId): Promise<ProviderImportResult> {
  const tab = await findProviderTab(providerId);
  if (!tab?.id) {
    await openAssistedProviderLoginOrLibrary(providerId);
    throw makeProviderError(
      providerId,
      "AUTH_REQUIRED",
      `No ${providerId} browser tab is available. Sign in normally, open your library page, then retry the assisted import.`,
      false
    );
  }

  let extraction: AssistedSessionExtractionResult | undefined;
  try {
    const response = (await browser.tabs.sendMessage(tab.id, {
      type: "EXTRACT_ASSISTED_PROVIDER_LIBRARY",
      payload: { providerId }
    })) as { type?: string; payload?: AssistedSessionExtractionResult } | undefined;
    extraction = response?.payload;
  } catch {
    throw makeProviderError(
      providerId,
      "UNKNOWN",
      `Could not read the ${providerId} library page. Reload the provider page after updating the extension, then retry.`,
      false
    );
  }

  if (!extraction || extraction.providerId !== providerId) {
    throw makeProviderError(providerId, "API_CHANGED", `${providerId} did not return assisted library data.`, false);
  }

  const games = extraction.games.map((game) => sessionGameToProviderGame(providerId, game));
  if (games.length === 0) {
    throw makeProviderError(
      providerId,
      "UNKNOWN",
      `No ${providerId} games were visible on the current page. Open the full provider library page and retry.`,
      false
    );
  }

  await saveAssistedAccountHint(providerId, extraction);

  return assistedSessionGamesToProviderImportResult(providerId, extraction.games, {
    ...(extraction.accountMarker ? { accountMarker: extraction.accountMarker } : {}),
    warnings: extraction.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.providerGameId ? { providerGameId: warning.providerGameId } : {})
    }))
  });
}
