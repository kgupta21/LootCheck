import { describe, expect, it } from "vitest";
import { GameRepository } from "../../src/db/repositories";
import { parseManualImportText } from "../../src/providers/manual/ManualImportProvider";

describe("GameRepository", () => {
  it("writes manual JSON imports to IndexedDB", async () => {
    const repository = new GameRepository();
    const result = parseManualImportText(
      JSON.stringify([
        {
          title: "Baldur's Gate 3",
          aliases: ["Baldurs Gate III"],
          platforms: ["PC"],
          tags: ["RPG"],
          playtimeMinutes: 120
        }
      ]),
      "games.json"
    );

    await repository.importProviderResult(result);
    const games = await repository.getAllGames();

    expect(games).toHaveLength(1);
    expect(games[0]?.canonicalTitle).toBe("Baldur's Gate 3");
    expect(games[0]?.normalizedAliases).toContain("baldurs gate 3");
    expect(games[0]?.platforms).toEqual(["PC"]);
  });

  it("merges duplicate owned games by normalized title", async () => {
    const repository = new GameRepository();

    await repository.importProviderResult(
      parseManualImportText(JSON.stringify([{ title: "Baldur’s Gate III", source: "manual" }]), "one.json")
    );
    await repository.importProviderResult(
      parseManualImportText(JSON.stringify([{ title: "Baldur's Gate 3", source: "manual" }]), "two.json")
    );

    const games = await repository.getAllGames();

    expect(games).toHaveLength(1);
    expect(games[0]?.providerEntries).toHaveLength(2);
  });
});
