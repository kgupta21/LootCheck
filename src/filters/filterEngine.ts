import { normalizeTitle } from "../matching/normalizeTitle";
import type { FilterPresetSettings, GameRecord } from "../shared/types";

function matchValues(values: string[], filterValues: string[] | undefined, useAnd: boolean): boolean {
  if (!filterValues || filterValues.length === 0) {
    return true;
  }
  const normalizedValues = new Set(values.map((value) => value.toLowerCase()));
  return useAnd
    ? filterValues.every((value) => normalizedValues.has(value.toLowerCase()))
    : filterValues.some((value) => normalizedValues.has(value.toLowerCase()));
}

function titleMatches(game: GameRecord, titleText: string): boolean {
  const normalizedSearch = normalizeTitle(titleText);
  if (!normalizedSearch) {
    return true;
  }
  const normalizedTitles = [
    normalizeTitle(game.canonicalTitle),
    game.normalizedTitle,
    ...game.aliases.map(normalizeTitle),
    ...game.normalizedAliases
  ];
  return normalizedTitles.some((title) => title.includes(normalizedSearch));
}

export function gameMatchesFilter(game: GameRecord, filter: FilterPresetSettings): boolean {
  const useAnd = filter.useAndFilteringStyle;

  if (filter.titleText && !titleMatches(game, filter.titleText)) {
    return false;
  }

  if (filter.providers?.length) {
    const providers = game.providerEntries.map((entry) => entry.providerId);
    if (!matchValues(providers, filter.providers, useAnd)) return false;
  }

  if (!matchValues(game.platforms ?? [], filter.platforms, useAnd)) return false;
  if (!matchValues(game.tags ?? [], filter.tags, useAnd)) return false;
  if (!matchValues(game.categories ?? [], filter.categories, useAnd)) return false;

  if (typeof filter.isInstalled === "boolean" && Boolean(game.isInstalled) !== filter.isInstalled) {
    return false;
  }

  if (filter.releaseYears?.length && (!game.releaseYear || !filter.releaseYears.includes(game.releaseYear))) {
    return false;
  }

  if (filter.hasPlaytime === true && !game.playtimeMinutes) {
    return false;
  }

  if (filter.hasPlaytime === false && (game.playtimeMinutes ?? 0) > 0) {
    return false;
  }

  return true;
}
