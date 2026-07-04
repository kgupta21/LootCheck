import { describe, expect, it } from "vitest";
import { sortGames } from "../../src/filters/sortEngine";
import type { GameRecord } from "../../src/shared/types";

function game(id: string, title: string, overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    id,
    canonicalTitle: title,
    normalizedTitle: title.toLowerCase(),
    sortTitle: title.toLowerCase(),
    aliases: [],
    normalizedAliases: [],
    providerEntries: [
      {
        providerId: "manual",
        providerGameId: id,
        sourceTitle: title,
        importedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    platforms: [],
    tags: [],
    categories: [],
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("sortGames", () => {
  it("sorts by title", () => {
    const sorted = sortGames([game("b", "Zelda"), game("a", "Alan Wake 2")], "title", "asc");
    expect(sorted.map((item) => item.canonicalTitle)).toEqual(["Alan Wake 2", "Zelda"]);
  });

  it("sorts by provider with title as a secondary sort", () => {
    const sorted = sortGames(
      [
        game("b", "Beta", { providerEntries: [{ providerId: "steam", providerGameId: "b", sourceTitle: "Beta", importedAt: "x" }] }),
        game("a", "Alpha", { providerEntries: [{ providerId: "manual", providerGameId: "a", sourceTitle: "Alpha", importedAt: "x" }] })
      ],
      "provider",
      "asc"
    );
    expect(sorted.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("sorts release years with missing values last", () => {
    const sorted = sortGames([game("missing", "Missing"), game("new", "New", { releaseYear: 2024 }), game("old", "Old", { releaseYear: 1999 })], "releaseYear", "asc");
    expect(sorted.map((item) => item.id)).toEqual(["old", "new", "missing"]);
  });

  it("sorts by date added", () => {
    const sorted = sortGames(
      [game("new", "New", { addedAt: "2026-02-01T00:00:00.000Z" }), game("old", "Old", { addedAt: "2026-01-01T00:00:00.000Z" })],
      "dateAdded",
      "desc"
    );
    expect(sorted.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("sorts last played with missing values last", () => {
    const sorted = sortGames([game("missing", "Missing"), game("played", "Played", { lastPlayedAt: "2026-01-01T00:00:00.000Z" })], "lastPlayed", "desc");
    expect(sorted.map((item) => item.id)).toEqual(["played", "missing"]);
  });

  it("sorts by playtime", () => {
    const sorted = sortGames([game("none", "None"), game("more", "More", { playtimeMinutes: 300 }), game("less", "Less", { playtimeMinutes: 20 })], "playtime", "desc");
    expect(sorted.map((item) => item.id)).toEqual(["more", "less", "none"]);
  });

  it("sorts installed groups by direction", () => {
    const sorted = sortGames([game("no", "No", { isInstalled: false }), game("yes", "Yes", { isInstalled: true })], "installed", "desc");
    expect(sorted.map((item) => item.id)).toEqual(["yes", "no"]);
  });

  it("does not mutate the input array", () => {
    const games = [game("b", "Beta"), game("a", "Alpha")];
    const sorted = sortGames(games, "title", "asc");
    expect(sorted).not.toBe(games);
    expect(games.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
