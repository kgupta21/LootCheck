import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getGogAccountBasic,
  getGogOwnedGameDetails,
  getGogOwnedGamesLegacy,
  getGogOwnedGamesNewApi,
  parseGogAccountBasic,
  parseGogLibraryGame,
  setGogApiDelayForTests
} from "../../src/providers/gog/gogApi";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/gog/${name}`, import.meta.url), "utf8"));
}

function textFixture(name: string): string {
  return readFileSync(new URL(`../fixtures/gog/${name}`, import.meta.url), "utf8");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  setGogApiDelayForTests((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
});

describe("GOG API client", () => {
  it("parses account basic logged-in and logged-out responses", () => {
    expect(parseGogAccountBasic(fixture("accountBasic_loggedIn.json"))).toEqual({
      isLoggedIn: true,
      username: "fixture_user",
      accountId: "gog-account-1"
    });
    expect(parseGogAccountBasic(fixture("accountBasic_loggedOut.json"))).toEqual({ isLoggedIn: false });
  });

  it("fetches account basic with browser-session credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixture("accountBasic_loggedIn.json")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGogAccountBasic()).resolves.toMatchObject({ isLoggedIn: true, username: "fixture_user" });

    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ credentials: "include" }));
  });

  it("pages through the new library stats endpoint", async () => {
    const fetchMock = vi
      .fn()
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_success_page1.json")))
        .mockResolvedValueOnce(jsonResponse(fixture("libraryStats_success_page2.json")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getGogOwnedGamesNewApi("fixture_user");

    expect(result.games.map((game) => game.title)).toEqual([
      "Baldur's Gate 3",
      "The Witcher 3: Wild Hunt - Complete Edition"
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns parser warnings for empty library stats responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixture("libraryStats_empty.json"))));

    const result = await getGogOwnedGamesNewApi("fixture_user");

    expect(result.games).toEqual([]);
    expect(result.warnings[0]).toMatchObject({ code: "GOG_LIBRARY_STATS_EMPTY", endpoint: "libraryStats" });
  });

  it("pages through the legacy fallback endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixture("legacyFilteredProducts_page1.json"))));

    await expect(getGogOwnedGamesLegacy()).resolves.toMatchObject({ games: [{ id: "hades", title: "Hades" }] });
  });

  it("maps API shape changes to API_CHANGED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixture("libraryStats_apiChanged.json"))));

    await expect(getGogOwnedGamesNewApi("fixture_user")).rejects.toMatchObject({ gogCode: "GOG_LIBRARY_STATS_API_CHANGED" });
  });

  it("detects HTML login pages before JSON parsing and emits sanitized trace", async () => {
    const traces: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlResponse(textFixture("libraryStats_htmlLoginPage.html"))));

    await expect(getGogOwnedGamesNewApi("fixture_user", undefined, (trace) => traces.push(trace))).rejects.toMatchObject({
      gogCode: "GOG_LIBRARY_SESSION_MISSING"
    });
    expect(traces).toMatchObject([{ endpointKey: "libraryStats", result: "html_login_page", warningCode: "GOG_LIBRARY_SESSION_MISSING" }]);
    expect(JSON.stringify(traces)).not.toContain("Sign in to continue");
  });

  it("maps legacy fallback shape changes to GOG_LEGACY_API_CHANGED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixture("legacyFilteredProducts_apiChanged.json"))));

    await expect(getGogOwnedGamesLegacy()).rejects.toMatchObject({ gogCode: "GOG_LEGACY_API_CHANGED" });
  });

  it("fetches owned game details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(fixture("gameDetails.json"))));

    await expect(getGogOwnedGameDetails("1086940")).resolves.toMatchObject({ id: "1086940", title: "Baldur's Gate 3" });
  });

  it("converts playtime and last activity fields", () => {
    const game = parseGogLibraryGame({
      id: "game",
      title: "Fixture Game",
      playtimeSeconds: 3660,
      lastSession: 1700000000
    });

    expect(game?.playtimeMinutes).toBe(61);
    expect(game?.lastPlayedAt).toBe("2023-11-14T22:13:20.000Z");
  });

  it("parses numeric GOG product IDs from legacy records", () => {
    expect(parseGogLibraryGame({ id: 123456, title: "Numeric ID Game" })).toMatchObject({
      id: "123456",
      title: "Numeric ID Game"
    });
  });

  it("does not keep paging empty library stats pages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        page: 1,
        totalPages: 4,
        totalResults: 0,
        items: []
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getGogOwnedGamesNewApi("fixture_user");

    expect(result.games).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ code: "GOG_LIBRARY_STATS_EMPTY" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures and does not retry auth failures", async () => {
    setGogApiDelayForTests(() => Promise.resolve());
    const transientFetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("temporary network failure"))
      .mockResolvedValueOnce(jsonResponse(fixture("accountBasic_loggedIn.json")));
    vi.stubGlobal("fetch", transientFetch);
    await expect(getGogAccountBasic()).resolves.toMatchObject({ isLoggedIn: true });
    expect(transientFetch).toHaveBeenCalledTimes(2);

    const authFetch = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    vi.stubGlobal("fetch", authFetch);
    await expect(getGogAccountBasic()).rejects.toMatchObject({ gogCode: "GOG_NOT_LOGGED_IN" });
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
});
