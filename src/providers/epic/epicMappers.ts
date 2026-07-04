import type { ProviderGame } from "../../shared/types";
import type { EpicAsset, EpicCatalogItem, EpicPlaytimeItem } from "./epicTypes";

const EPIC_EDITION_SUFFIXES = [
  "Standard Edition",
  "Deluxe Edition",
  "Ultimate Edition",
  "Complete Edition",
  "Game of the Year Edition",
  "GOTY Edition",
  "Definitive Edition"
];

export function generateEpicAliases(title: string): string[] {
  const aliases = new Set<string>();
  for (const suffix of EPIC_EDITION_SUFFIXES) {
    const stripped = title.replace(new RegExp(`\\s*[-:–—]?\\s*${suffix}\\s*$`, "i"), "").trim();
    if (stripped && stripped !== title && stripped.length >= 4) {
      aliases.add(stripped);
    }
  }
  return [...aliases].sort((a, b) => a.localeCompare(b));
}

export function mapEpicAssetToProviderGame(
  asset: EpicAsset,
  catalogItem: EpicCatalogItem,
  playtime?: EpicPlaytimeItem,
  options: {
    storeRawProviderResponses?: boolean;
  } = {}
): ProviderGame {
  const providerGameId = asset.appName?.trim();
  const title = catalogItem.title?.trim();
  if (!providerGameId || !title) {
    throw new Error("Epic asset mapping requires an appName and catalog title.");
  }

  const game: ProviderGame = {
    providerGameId,
    title,
    sortTitle: title,
    aliases: generateEpicAliases(title),
    platform: ["PC"],
    tags: [],
    categories: []
  };

  if (catalogItem.id) {
    game.url = `https://store.epicgames.com/p/${catalogItem.id}`;
  }
  if (playtime?.artifactId === providerGameId && Number.isFinite(playtime.totalTime)) {
    game.playtimeMinutes = Math.max(0, Math.round(playtime.totalTime));
  }
  if (options.storeRawProviderResponses) {
    game.raw = { asset, catalogItem, playtime };
  }
  return game;
}
