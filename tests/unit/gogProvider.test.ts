import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameRepository } from "../../src/db/repositories";
import { GogProvider, generateGogAliases, gogGameToProviderGame } from "../../src/providers/gog/GogProvider";
import { setGogApiDelayForTests } from "../../src/providers/gog/gogApi";
import { GogSettingsRepository } from "../../src/providers/gog/gogSettings";
import { parseManualImportText } from "../../src/providers/manual/ManualImportProvider";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/gog/${name}`, import.meta.url), "utf8"));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setGogApiDelayForTests((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
});

describe("GOG provider", () => {
  it("maps ProviderGame data and omits raw responses by default", () => {
    const game = gogGameToProviderGame(
      {
        id: "witcher3-complete",
        title: "The Witcher 3: Wild Hunt - Complete Edition",
        slug: "the_witcher_3_wild_hunt_complete_edition",
        playtimeMinutes: 120,
        raw: { secretShape: true }
      },
      { importExtras: false, useLegacyFallback: true, allowRawProviderResponses: false }
    );

    expect(game).toMatchObject({
      providerGameId: "witcher3-complete",
      title: "The Witcher 3: Wild Hunt - Complete Edition",
      aliases: ["The Witcher 3: Wild Hunt"],
      platform: ["PC"],
      playtimeMinutes: 120
    });
    expect(game?.raw).toBeUndefined();
    expect(generateGogAliases("The Witcher 3: Wild Hunt - Complete Edition")).toEqual(["The Witcher 3: Wild Hunt"]);
  });

  it("imports new API pages and skips extras by default", async () => {
    await new GogSettingsRepository().saveSettings({ accountId: "gog-account-1", username: "fixture_user" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_page1.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_page2.json")))
    );

    const result = await new GogProvider().importOwnedGames();

    expect(result.games.map((game) => game.title)).toEqual(["Baldur's Gate 3", "The Witcher 3: Wild Hunt - Complete Edition"]);
    expect(JSON.stringify(result.games)).not.toContain("Bonus Goodies");
  });

  it("includes extras only when enabled", () => {
    const extra = gogGameToProviderGame(
      { id: "extra", title: "Fixture Extras", isExtra: true },
      { importExtras: false, useLegacyFallback: true, allowRawProviderResponses: false }
    );
    const included = gogGameToProviderGame(
      { id: "extra", title: "Fixture Extras", isExtra: true },
      { importExtras: true, useLegacyFallback: true, allowRawProviderResponses: false }
    );

    expect(extra).toBeUndefined();
    expect(included?.title).toBe("Fixture Extras");
  });

  it("falls back to the legacy endpoint when the new API changes shape", async () => {
    await new GogSettingsRepository().saveSettings({ accountId: "gog-account-1", username: "fixture_user" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_apiChanged.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("legacyFilteredProducts_success_page1.json")))
    );

    const result = await new GogProvider().importOwnedGames();

    expect(result.games.map((game) => game.title)).toEqual(["Hades"]);
    expect(result.warnings.map((warning) => warning.code)).toContain("GOG_NEW_API_FALLBACK");
  });

  it("returns an empty-library warning", async () => {
    await new GogSettingsRepository().saveSettings({ accountId: "gog-account-1", username: "fixture_user" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_empty.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("legacyFilteredProducts_empty.json")))
    );

    const result = await new GogProvider().importOwnedGames();

    expect(result.games).toHaveLength(0);
    expect(result.warnings.map((warning) => warning.code)).toContain("GOG_EMPTY_LIBRARY_OR_PARSE_FAILED");
    expect(result.endpointTrace?.map((trace) => trace.endpointKey)).toContain("legacyFilteredProducts");
  });

  it("keeps stale GOG entries or removes them for account replacement", async () => {
    const repository = new GameRepository();
    await repository.importProviderResult({
      providerId: "gog",
      accountId: "old-account",
      importedAt: "2026-01-01T00:00:00.000Z",
      games: [{ providerGameId: "old", title: "Old GOG Game" }],
      warnings: []
    });
    await repository.importProviderResult(parseManualImportText(JSON.stringify([{ title: "Manual Game" }]), "manual.json"));

    expect(await repository.markProviderEntriesStale("gog", "old-account")).toBe(1);
    expect(await repository.countStaleGamesForProvider("gog")).toBe(1);
    expect(await repository.removeProviderGames("gog", "old-account")).toBe(1);

    const games = await repository.getAllGames();
    expect(games.map((game) => game.canonicalTitle)).toEqual(["Manual Game"]);
  });
});
