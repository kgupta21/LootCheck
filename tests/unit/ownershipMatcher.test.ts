import { describe, expect, it } from "vitest";
import { matchOwnedGames } from "../../src/matching/ownershipMatcher";
import type { GameRecord, PageContext, TitleCandidate } from "../../src/shared/types";

function game(overrides: Partial<GameRecord>): GameRecord {
  return {
    id: "game-1",
    canonicalTitle: "Baldur's Gate 3",
    normalizedTitle: "baldurs gate 3",
    sortTitle: "baldurs gate 3",
    aliases: ["Baldurs Gate III"],
    normalizedAliases: ["baldurs gate 3"],
    providerEntries: [
      {
        providerId: "manual",
        providerGameId: "bg3",
        sourceTitle: "Baldur's Gate 3",
        importedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    platforms: ["PC"],
    tags: [],
    categories: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function context(overrides: Partial<PageContext> = {}): PageContext {
  return {
    hostname: "store.steampowered.com",
    pathname: "/app/1086940/Baldurs_Gate_3/",
    documentTitle: "Baldur's Gate 3 on Steam",
    isLikelyGameProductPage: true,
    ...overrides
  };
}

function candidate(value: string, overrides: Partial<TitleCandidate> = {}): TitleCandidate {
  return {
    value,
    source: "domainExtractor",
    weight: 100,
    ...overrides
  };
}

describe("ownership matching", () => {
  it("returns an owned exact match", () => {
    const matches = matchOwnedGames([candidate("Baldur's Gate 3")], [game({})], context());

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ confidence: "exact", canonicalTitle: "Baldur's Gate 3" });
  });

  it("returns an owned alias match", () => {
    const matches = matchOwnedGames(
      [candidate("The Witcher 3 Wild Hunt")],
      [
        game({
          id: "witcher-3",
          canonicalTitle: "The Witcher 3: Wild Hunt - Complete Edition",
          normalizedTitle: "the witcher 3 wild hunt complete edition",
          aliases: ["The Witcher 3: Wild Hunt"],
          normalizedAliases: ["the witcher 3 wild hunt"]
        })
      ],
      context()
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.confidence).toBe("alias");
  });

  it("returns no match for an unowned page", () => {
    const matches = matchOwnedGames([candidate("Alan Wake 2")], [game({})], context());

    expect(matches).toHaveLength(0);
  });

  it("allows strict high-confidence fuzzy matches from strong page sources", () => {
    const matches = matchOwnedGames([candidate("Baldurs Gatee 3", { source: "h1", weight: 75 })], [game({})], context());

    expect(matches).toHaveLength(1);
    expect(matches[0]?.confidence).toBe("high_fuzzy");
  });

  it("does not return low-confidence fuzzy matches for weak sources", () => {
    const matches = matchOwnedGames(
      [candidate("Baldurs Gatee 3", { source: "documentTitle", weight: 55 })],
      [game({})],
      context()
    );

    expect(matches).toHaveLength(0);
  });

  it("blocks ambiguous one-word matches without product context", () => {
    const matches = matchOwnedGames(
      [candidate("Control", { source: "h1", weight: 75 })],
      [
        game({
          id: "control",
          canonicalTitle: "Control",
          normalizedTitle: "control",
          aliases: [],
          normalizedAliases: []
        })
      ],
      context({
        hostname: "example.com",
        pathname: "/review/control",
        documentTitle: "Control review",
        isLikelyGameProductPage: false
      })
    );

    expect(matches).toHaveLength(0);
  });
});
