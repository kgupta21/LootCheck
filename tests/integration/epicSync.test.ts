import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncProvider } from "../../src/background/providerSync";
import { AuthTokenRepository, GameRepository } from "../../src/db/repositories";
import { matchOwnedGames } from "../../src/matching/ownershipMatcher";
import { setEpicApiDelayForTests } from "../../src/providers/epic/epicApi";
import { EpicSettingsRepository } from "../../src/providers/epic/epicSettings";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/epic/${name}`, import.meta.url), "utf8"));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setEpicApiDelayForTests((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
});

describe("Epic sync integration", () => {
  it("records a successful sync and ownership matching works for imported Epic titles", async () => {
    await new EpicSettingsRepository().saveSettings({
      accountId: "epic-account-1",
      displayName: "FixtureEpic",
      includeEaManagedGames: false,
      includeUbisoftLinkedGames: false,
      includePlaytime: true,
      includeCatalogMetadata: true
    });
    await new AuthTokenRepository().saveAuthToken({
      providerId: "epic",
      accountId: "epic-account-1",
      accessToken: "fixture-access-token",
      refreshToken: "fixture-refresh-token",
      tokenType: "bearer",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/account/api/public/account/")) {
          return Promise.resolve(jsonResponse(fixture("accountResponse.json")));
        }
        if (url.includes("/library/api/public/items") && !url.includes("cursor=")) {
          return Promise.resolve(jsonResponse(fixture("libraryItems_page1.json")));
        }
        if (url.includes("/library/api/public/items") && url.includes("cursor=page-2")) {
          return Promise.resolve(jsonResponse(fixture("libraryItems_page2.json")));
        }
        if (url.includes("/playtime/account/")) {
          return Promise.resolve(jsonResponse(fixture("playtimeItems.json")));
        }
        if (url.includes("id=catalog-game")) {
          return Promise.resolve(jsonResponse({ "catalog-game": fixture("catalogItem_game.json") }));
        }
        if (url.includes("id=catalog-plugin")) {
          return Promise.resolve(jsonResponse({ "catalog-plugin": fixture("catalogItem_plugin.json") }));
        }
        return Promise.resolve(jsonResponse({}, 404));
      })
    );

    const run = await syncProvider("epic");
    const games = await new GameRepository().getAllGames();
    const matches = matchOwnedGames(
      [{ value: "Fixture Epic Game", source: "h1", weight: 1 }],
      games,
      { hostname: "store.epicgames.com", pathname: "/p/fixture-epic-game", documentTitle: "Fixture Epic Game" }
    );

    expect(run).toMatchObject({ providerId: "epic", status: "success", importedCount: 1 });
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      canonicalTitle: "Fixture Epic Game - Deluxe Edition",
      playtimeMinutes: 42,
      providerEntries: [{ providerId: "epic", accountId: "epic-account-1" }]
    });
    expect(matches[0]).toMatchObject({ canonicalTitle: "Fixture Epic Game - Deluxe Edition", providers: ["epic"] });
  });

  it("scheduled sync fails without opening interactive login when Epic has no token", async () => {
    const run = await syncProvider("epic");

    expect(run.status).toBe("failed");
    expect(run.error).toContain("Connect Epic before syncing");
  });
});
