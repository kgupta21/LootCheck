import { normalizeTitle } from "./normalizeTitle";
import type { GameRecord, MatchConfidence, OwnershipMatch, PageContext, StoreId, TitleCandidate, TitleCandidateSource } from "../shared/types";

const FUZZY_SOURCES = new Set<TitleCandidateSource>(["domainExtractor", "jsonLd", "ogTitle", "h1"]);
const STRONG_AMBIGUOUS_SOURCES = new Set<TitleCandidateSource>(["domainExtractor", "jsonLd", "ogTitle"]);
const AMBIGUOUS_ONE_WORD_TITLES = new Set(["control", "inside", "prey", "doom", "portal", "hades"]);

function uniqueProviders(game: GameRecord): StoreId[] {
  return [...new Set(game.providerEntries.map((entry) => entry.providerId))];
}

function tokenCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function isAmbiguousTitle(normalizedTitle: string): boolean {
  return AMBIGUOUS_ONE_WORD_TITLES.has(normalizedTitle);
}

function hasStrongGameContext(candidate: TitleCandidate, pageContext: PageContext): boolean {
  return Boolean(pageContext.isLikelyGameProductPage) || STRONG_AMBIGUOUS_SOURCES.has(candidate.source);
}

function isDisplayableExactOrAlias(candidate: TitleCandidate, normalizedCandidate: string, pageContext: PageContext): boolean {
  if (!isAmbiguousTitle(normalizedCandidate)) {
    return true;
  }
  return hasStrongGameContext(candidate, pageContext);
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length]!;
}

export function titleSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeTitle(left);
  const normalizedRight = normalizeTitle(right);
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (maxLength === 0) {
    return 0;
  }
  return 1 - levenshteinDistance(normalizedLeft, normalizedRight) / maxLength;
}

function isHighConfidenceFuzzyCandidate(candidate: TitleCandidate, normalizedCandidate: string, pageContext: PageContext): boolean {
  if (!FUZZY_SOURCES.has(candidate.source)) {
    return false;
  }
  if (normalizedCandidate.length < 8 || normalizedCandidate.length > 80) {
    return false;
  }
  if (tokenCount(normalizedCandidate) < 2) {
    return false;
  }
  if (isAmbiguousTitle(normalizedCandidate) && !hasStrongGameContext(candidate, pageContext)) {
    return false;
  }
  return true;
}

function confidenceRank(confidence: MatchConfidence): number {
  switch (confidence) {
    case "exact":
      return 4;
    case "alias":
      return 3;
    case "high_fuzzy":
      return 2;
    case "low_fuzzy":
      return 1;
  }
}

function setBestMatch(matches: Map<string, OwnershipMatch>, match: OwnershipMatch): void {
  const existing = matches.get(match.gameId);
  if (!existing || confidenceRank(match.confidence) > confidenceRank(existing.confidence)) {
    matches.set(match.gameId, match);
  }
}

export function matchOwnedGames(
  candidates: TitleCandidate[],
  games: GameRecord[],
  pageContext: PageContext
): OwnershipMatch[] {
  const matches = new Map<string, OwnershipMatch>();
  const exactIndex = new Map<string, GameRecord[]>();
  const aliasIndex = new Map<string, GameRecord[]>();

  for (const game of games) {
    const exactGames = exactIndex.get(game.normalizedTitle) ?? [];
    exactGames.push(game);
    exactIndex.set(game.normalizedTitle, exactGames);

    for (const alias of game.normalizedAliases) {
      const aliasGames = aliasIndex.get(alias) ?? [];
      aliasGames.push(game);
      aliasIndex.set(alias, aliasGames);
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeTitle(candidate.value);
    if (!normalizedCandidate) {
      continue;
    }

    if (isDisplayableExactOrAlias(candidate, normalizedCandidate, pageContext)) {
      for (const game of exactIndex.get(normalizedCandidate) ?? []) {
        setBestMatch(matches, {
          gameId: game.id,
          canonicalTitle: game.canonicalTitle,
          providers: uniqueProviders(game),
          confidence: "exact",
          matchedCandidate: candidate.value,
          source: candidate.source
        });
      }

      for (const game of aliasIndex.get(normalizedCandidate) ?? []) {
        setBestMatch(matches, {
          gameId: game.id,
          canonicalTitle: game.canonicalTitle,
          providers: uniqueProviders(game),
          confidence: "alias",
          matchedCandidate: candidate.value,
          source: candidate.source
        });
      }
    }

    if (!isHighConfidenceFuzzyCandidate(candidate, normalizedCandidate, pageContext)) {
      continue;
    }

    for (const game of games) {
      if (matches.has(game.id)) {
        continue;
      }
      const similarity = Math.max(
        titleSimilarity(normalizedCandidate, game.normalizedTitle),
        ...game.normalizedAliases.map((alias) => titleSimilarity(normalizedCandidate, alias))
      );
      if (similarity >= 0.92) {
        setBestMatch(matches, {
          gameId: game.id,
          canonicalTitle: game.canonicalTitle,
          providers: uniqueProviders(game),
          confidence: "high_fuzzy",
          matchedCandidate: candidate.value,
          source: candidate.source
        });
      }
    }
  }

  return [...matches.values()].filter((match) => match.confidence !== "low_fuzzy");
}
