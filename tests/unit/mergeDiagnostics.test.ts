import { describe, expect, it } from "vitest";
import { explainMergeDecision } from "../../src/matching/mergeDiagnostics";
import type { GameRecord, ProviderGame } from "../../src/shared/types";

function target(title: string): GameRecord {
  return {
    id: "game",
    canonicalTitle: title,
    normalizedTitle: title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    sortTitle: title.toLowerCase(),
    aliases: [],
    normalizedAliases: [],
    providerEntries: [],
    platforms: [],
    tags: [],
    categories: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function source(title: string): ProviderGame {
  return {
    providerGameId: "1",
    title
  };
}

describe("explainMergeDecision", () => {
  it("explains exact and alias merge decisions", () => {
    expect(explainMergeDecision(source("DOOM"), target("Doom"))).toMatchObject({
      matched: true,
      reason: "exact_normalized_title"
    });
    expect(explainMergeDecision(source("The Witcher 3: Wild Hunt - Complete Edition"), target("The Witcher 3: Wild Hunt"))).toMatchObject({
      matched: true,
      reason: "alias_match"
    });
  });

  it("rejects ambiguous short titles when not exact or alias", () => {
    expect(explainMergeDecision(source("Portal"), target("Portal News"))).toMatchObject({
      matched: false,
      reason: "rejected_short_ambiguous_title"
    });
  });
});
