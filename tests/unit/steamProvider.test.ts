import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTokenRepository } from "../../src/db/repositories";
import { SteamProvider, generateSteamAliases, steamGameToProviderGame } from "../../src/providers/steam/SteamProvider";
import { SteamAppCacheRepository } from "../../src/db/repositories";
import { SteamSettingsRepository } from "../../src/providers/steam/steamSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("SteamProvider auth state", () => {
  it("returns not_connected with no settings", async () => {
    await expect(new SteamProvider().getAuthState()).resolves.toMatchObject({ status: "not_connected" });
  });

  it("returns connected for profile only and profile plus key", async () => {
    const settings = new SteamSettingsRepository();
    await settings.saveSettings({ providerId: "steam", steamId64: "76561198000000000", includeAppInfo: true, includeFreeGames: false });

    await expect(new SteamProvider().getAuthState()).resolves.toMatchObject({ status: "connected", accountId: "76561198000000000" });

    await new AuthTokenRepository().saveAuthToken({
      providerId: "steam",
      accountId: "76561198000000000",
      accessToken: "api-key",
      scopes: ["steam_web_api_key"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await expect(settings.getSettings()).resolves.toMatchObject({ apiKeyStored: true });
  });
});

describe("SteamProvider import", () => {
  it("generates deterministic Steam aliases", () => {
    expect(generateSteamAliases("The Witcher 3: Wild Hunt - Complete Edition")).toContain("The Witcher 3: Wild Hunt");
    expect(generateSteamAliases("DOOM")).toEqual([]);
  });

  it("maps Steam games to ProviderGame records", () => {
    expect(
      steamGameToProviderGame(
        {
          appid: 10,
          name: "Counter-Strike",
          playtime_forever: 120,
          rtime_last_played: 1700000000
        },
        "Counter-Strike"
      )
    ).toMatchObject({
      providerGameId: "10",
      title: "Counter-Strike",
      url: "https://store.steampowered.com/app/10",
      platform: ["PC"],
      playtimeMinutes: 120,
      lastPlayedAt: new Date(1700000000 * 1000).toISOString()
    });
  });

  it("returns a warning for empty owned-games responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ response: { game_count: 0, games: [] } })));
    const settings = new SteamSettingsRepository();
    await settings.saveSettings(
      { providerId: "steam", steamId64: "76561198000000000", includeAppInfo: true, includeFreeGames: false },
      "api-key",
      { steamId64: "76561198000000000" }
    );

    const result = await new SteamProvider().importOwnedGames();

    expect(result.games).toHaveLength(0);
    expect(result.warnings[0]).toMatchObject({ code: "EMPTY_LIBRARY" });
  });

  it("maps invalid API key errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Forbidden" }, 403)));
    const settings = new SteamSettingsRepository();
    await settings.saveSettings(
      { providerId: "steam", steamId64: "76561198000000000", includeAppInfo: true, includeFreeGames: false },
      "bad-key",
      { steamId64: "76561198000000000" }
    );

    await expect(new SteamProvider().importOwnedGames()).rejects.toMatchObject({ code: "AUTH_REQUIRED", retryable: false });
  });

  it("metadata lookup failure does not fail sync", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ response: { game_count: 1, games: [{ appid: 999, playtime_forever: 0 }] } }))
        .mockRejectedValueOnce(new TypeError("store failed"))
    );
    const settings = new SteamSettingsRepository();
    await settings.saveSettings(
      { providerId: "steam", steamId64: "76561198000000000", includeAppInfo: false, includeFreeGames: false },
      "api-key",
      { steamId64: "76561198000000000" }
    );

    const result = await new SteamProvider().importOwnedGames();
    expect(result.games[0]?.title).toBe("Steam App 999");
  });

  it("limits app metadata fetch concurrency to 4", async () => {
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: URL | RequestInfo) => {
        const url = String(input);
        if (url.includes("GetOwnedGames")) {
          return Promise.resolve(
            jsonResponse({
              response: {
                game_count: 6,
                games: Array.from({ length: 6 }, (_value, index) => ({ appid: 1000 + index, playtime_forever: 0 }))
              }
            })
          );
        }
        active += 1;
        maxActive = Math.max(maxActive, active);
        return new Promise<Response>((resolve) => {
          setTimeout(() => {
            active -= 1;
            const appId = new URL(url).searchParams.get("appids")!;
            resolve(jsonResponse({ [appId]: { success: true, data: { name: `Game ${appId}` } } }));
          }, 1);
        });
      })
    );
    const settings = new SteamSettingsRepository();
    await settings.saveSettings(
      { providerId: "steam", steamId64: "76561198000000000", includeAppInfo: false, includeFreeGames: false },
      "api-key",
      { steamId64: "76561198000000000" }
    );

    await expect(new SteamProvider().importOwnedGames()).resolves.toMatchObject({ games: expect.any(Array) });
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});

describe("Steam app cache", () => {
  it("ignores expired cache records", async () => {
    const repository = new SteamAppCacheRepository();
    await repository.saveAppDetails({
      appId: 1,
      title: "Expired",
      storeUrl: "https://store.steampowered.com/app/1",
      fetchedAt: "2020-01-01T00:00:00.000Z",
      status: "ok",
      expiresAt: "2020-01-02T00:00:00.000Z"
    });

    await expect(repository.getFreshAppDetails(1)).resolves.toBeUndefined();
  });
});
