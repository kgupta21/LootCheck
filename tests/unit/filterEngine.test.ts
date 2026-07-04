import { describe, expect, it } from "vitest";
import { gameMatchesFilter } from "../../src/filters/filterEngine";
import type { GameRecord } from "../../src/shared/types";

function game(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    id: "game-1",
    canonicalTitle: "The Witcher 3: Wild Hunt - Complete Edition",
    normalizedTitle: "the witcher 3 wild hunt complete edition",
    sortTitle: "witcher 3 wild hunt complete edition",
    aliases: ["The Witcher 3: Wild Hunt", "Witcher 3"],
    normalizedAliases: ["the witcher 3 wild hunt", "witcher 3"],
    providerEntries: [
      {
        providerId: "manual",
        providerGameId: "witcher-3",
        sourceTitle: "The Witcher 3",
        importedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    platforms: ["PC", "Steam Deck"],
    tags: ["RPG", "Open World"],
    categories: ["Favorites"],
    releaseYear: 2015,
    isInstalled: true,
    playtimeMinutes: 120,
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides
  };
}

describe("gameMatchesFilter", () => {
  it("matches every game with an empty filter", () => {
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false })).toBe(true);
  });

  it("filters by provider", () => {
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false, providers: ["manual"] })).toBe(true);
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false, providers: ["steam"] })).toBe(false);
  });

  it("filters by platform, tag, and category", () => {
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false, platforms: ["PC"] })).toBe(true);
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false, tags: ["RPG"] })).toBe(true);
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false, categories: ["Favorites"] })).toBe(true);
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false, categories: ["Backlog"] })).toBe(false);
  });

  it("supports OR and AND matching for multi-value filters", () => {
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false, tags: ["RPG", "Strategy"] })).toBe(true);
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: true, tags: ["RPG", "Strategy"] })).toBe(false);
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: true, tags: ["RPG", "Open World"] })).toBe(true);
  });

  it("filters installed true, false, and undefined", () => {
    expect(gameMatchesFilter(game({ isInstalled: true }), { useAndFilteringStyle: false, isInstalled: true })).toBe(true);
    expect(gameMatchesFilter(game({ isInstalled: true }), { useAndFilteringStyle: false, isInstalled: false })).toBe(false);
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false })).toBe(true);
  });

  it("matches title text against aliases", () => {
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false, titleText: "Witcher 3" })).toBe(true);
  });

  it("filters by release year", () => {
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false, releaseYears: [2015] })).toBe(true);
    expect(gameMatchesFilter(game(), { useAndFilteringStyle: false, releaseYears: [2020] })).toBe(false);
  });

  it("filters by playtime presence", () => {
    expect(gameMatchesFilter(game({ playtimeMinutes: 120 }), { useAndFilteringStyle: false, hasPlaytime: true })).toBe(true);
    expect(gameMatchesFilter(game({ playtimeMinutes: 0 }), { useAndFilteringStyle: false, hasPlaytime: false })).toBe(true);
    expect(gameMatchesFilter(game({ playtimeMinutes: 120 }), { useAndFilteringStyle: false, hasPlaytime: false })).toBe(false);
  });
});
