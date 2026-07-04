import { normalizeTitle, titleAliases } from "./normalizeTitle";
import type { GameRecord, ProviderGame } from "../shared/types";

export interface MergeExplanation {
  matched: boolean;
  reason:
    | "exact_normalized_title"
    | "alias_match"
    | "external_provider_id"
    | "high_confidence_fuzzy"
    | "rejected_low_confidence"
    | "rejected_short_ambiguous_title";
  confidence: number;
  sourceTitle: string;
  targetTitle: string;
}

const AMBIGUOUS_SHORT_TITLES = new Set(["control", "inside", "prey", "doom", "portal", "hades"]);

function providerIdMatch(source: ProviderGame, target: GameRecord): boolean {
  return target.providerEntries.some((entry) => entry.providerGameId === source.providerGameId);
}

function normalizedSourceAliases(source: ProviderGame): string[] {
  return [...titleAliases(source.title, source.aliases), ...(source.aliases ?? [])].map(normalizeTitle).filter(Boolean);
}

export function explainMergeDecision(source: ProviderGame, target: GameRecord): MergeExplanation {
  const sourceNormalized = normalizeTitle(source.title);
  const targetAliases = new Set([target.normalizedTitle, ...target.normalizedAliases]);
  const sourceAliases = normalizedSourceAliases(source);

  if (providerIdMatch(source, target)) {
    return {
      matched: true,
      reason: "external_provider_id",
      confidence: 1,
      sourceTitle: source.title,
      targetTitle: target.canonicalTitle
    };
  }

  if (sourceNormalized === target.normalizedTitle) {
    return {
      matched: true,
      reason: "exact_normalized_title",
      confidence: 1,
      sourceTitle: source.title,
      targetTitle: target.canonicalTitle
    };
  }

  if (sourceAliases.some((alias) => targetAliases.has(alias))) {
    return {
      matched: true,
      reason: "alias_match",
      confidence: 0.95,
      sourceTitle: source.title,
      targetTitle: target.canonicalTitle
    };
  }

  if (AMBIGUOUS_SHORT_TITLES.has(sourceNormalized)) {
    return {
      matched: false,
      reason: "rejected_short_ambiguous_title",
      confidence: 0.1,
      sourceTitle: source.title,
      targetTitle: target.canonicalTitle
    };
  }

  return {
    matched: false,
    reason: "rejected_low_confidence",
    confidence: 0,
    sourceTitle: source.title,
    targetTitle: target.canonicalTitle
  };
}
