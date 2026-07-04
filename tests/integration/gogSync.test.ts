import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeMessage } from "../../src/background/messageRouter";
import { syncProvider } from "../../src/background/providerSync";
import { GameRepository } from "../../src/db/repositories";
import { matchOwnedGames } from "../../src/matching/ownershipMatcher";
import { setGogApiDelayForTests } from "../../src/providers/gog/gogApi";
import { GogSettingsRepository } from "../../src/providers/gog/gogSettings";

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

describe("GOG sync integration", () => {
  it("records a successful sync and ownership matching works for imported GOG titles", async () => {
    await new GogSettingsRepository().saveSettings({ accountId: "gog-account-1", username: "fixture_user" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_page1.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_page2.json")))
    );

    const run = await syncProvider("gog");
    const games = await new GameRepository().getAllGames();
    const matches = matchOwnedGames(
      [{ value: "The Witcher 3: Wild Hunt", source: "h1", weight: 1 }],
      games,
      { hostname: "www.gog.com", pathname: "/game/the_witcher_3_wild_hunt", documentTitle: "The Witcher 3" }
    );

    expect(run).toMatchObject({ providerId: "gog", status: "success", importedCount: 2 });
    expect(games.map((game) => game.canonicalTitle).sort()).toEqual(["Baldur's Gate 3", "The Witcher 3: Wild Hunt - Complete Edition"]);
    expect(matches[0]).toMatchObject({ canonicalTitle: "The Witcher 3: Wild Hunt - Complete Edition", providers: ["gog"] });
  });

  it("records partial syncs when the new API falls back to legacy", async () => {
    await new GogSettingsRepository().saveSettings({ accountId: "gog-account-1", username: "fixture_user" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_apiChanged.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("legacyFilteredProducts_success_page1.json")))
    );

    const run = await syncProvider("gog");
    const diagnostics = await routeMessage({ type: "EXPORT_GOG_DIAGNOSTICS" });
    const serialized = JSON.stringify(diagnostics);

    expect(run.status).toBe("partial");
    expect(run.warningCount).toBeGreaterThan(0);
    expect(serialized).toContain("GOG_LIBRARY_STATS_API_CHANGED");
    expect(serialized).toContain("GOG_LEGACY_FALLBACK_USED");
    expect(serialized).toContain("endpointTrace");
  });

  it("persists warning details and endpoint trace for zero-game partial syncs", async () => {
    await new GogSettingsRepository().saveSettings({ accountId: "gog-account-1", username: "fixture_user" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_empty.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("legacyFilteredProducts_empty.json")))
    );

    const run = await syncProvider("gog");
    const diagnostics = (await routeMessage({ type: "EXPORT_GOG_DIAGNOSTICS" })) as {
      payload: { diagnostics: { latestWarnings: Array<{ code: string }>; endpointTrace: Array<{ endpointKey: string; result: string }> } };
    };

    expect(run).toMatchObject({ status: "partial", importedCount: 0 });
    expect(run.warningCount).toBeGreaterThan(0);
    expect(diagnostics.payload.diagnostics.latestWarnings.map((warning) => warning.code)).toContain("GOG_EMPTY_LIBRARY_OR_PARSE_FAILED");
    expect(diagnostics.payload.diagnostics.endpointTrace.map((trace) => trace.endpointKey)).toEqual(
      expect.arrayContaining(["accountBasic", "libraryStats", "legacyFilteredProducts"])
    );
  });

  it("tests GOG endpoints without importing games", async () => {
    await new GogSettingsRepository().saveSettings({ accountId: "gog-account-1", username: "fixture_user" });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_success_page1.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("legacyFilteredProducts_success_page1.json")))
    );

    const response = (await routeMessage({ type: "TEST_GOG_LIBRARY_ENDPOINTS" })) as {
      payload: { newApiItemCount: number; legacyItemCount: number; endpointTrace: unknown[] };
    };

    expect(response.payload.newApiItemCount).toBe(1);
    expect(response.payload.legacyItemCount).toBe(1);
    expect(response.payload.endpointTrace).toHaveLength(3);
    expect(await new GameRepository().countGamesForProvider("gog")).toBe(0);
  });

  it("records failed syncs when GOG is not logged in", async () => {
    await new GogSettingsRepository().saveSettings({ accountId: "gog-account-1", username: "fixture_user" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixture("accountBasic_loggedOut.json"))));

    const run = await syncProvider("gog");

    expect(run.status).toBe("failed");
    expect(run.error).not.toContain("cookie");
    expect(run.error).not.toContain("password");
  });

  it("enforces account replacement guardrails from messages", async () => {
    await new GogSettingsRepository().saveSettings({ accountId: "old-account", username: "old_user" });
    await new GameRepository().importProviderResult({
      providerId: "gog",
      accountId: "old-account",
      importedAt: "2026-01-01T00:00:00.000Z",
      games: [{ providerGameId: "old", title: "Old GOG Game" }],
      warnings: []
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ isLoggedIn: true, username: "new_user", userId: "new-account" })))
    );

    const mismatch = await routeMessage({ type: "CHECK_GOG_LOGIN" });
    expect(JSON.stringify(mismatch)).toContain("different GOG account");
    expect(await new GameRepository().countStaleGamesForProvider("gog")).toBe(0);

    await routeMessage({ type: "CHECK_GOG_LOGIN", payload: { replaceExisting: "keep" } });
    expect(await new GameRepository().countStaleGamesForProvider("gog")).toBe(1);

    await new GogSettingsRepository().saveSettings({ accountId: "old-account", username: "old_user" });
    await routeMessage({ type: "CHECK_GOG_LOGIN", payload: { replaceExisting: "remove" } });
    expect(await new GameRepository().countGamesForProvider("gog")).toBe(0);
  });

  it("GOG messages and diagnostics never expose cookies, credentials, or tokens", async () => {
    await new GogSettingsRepository().saveSettings({ accountId: "gog-account-1", username: "fixture_user" });

    const settings = await routeMessage({ type: "GET_GOG_SETTINGS" });
    const diagnostics = await routeMessage({ type: "EXPORT_GOG_DIAGNOSTICS" });
    const serialized = JSON.stringify({ settings, diagnostics }).toLowerCase();

    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("refresh_token");
  });
});
