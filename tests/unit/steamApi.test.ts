import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, getOwnedGames, getSteamAppDetails, resolveSteamIdentity, setSteamApiDelayForTests } from "../../src/providers/steam/steamApi";
import { redactSteamApiKey } from "../../src/providers/steam/steamErrors";
import { parseSteamIdentityInput } from "../../src/providers/steam/steamSettings";

afterEach(() => {
  vi.unstubAllGlobals();
  setSteamApiDelayForTests((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("Steam identity parsing", () => {
  it("parses SteamID64, profile URLs, vanity URLs, vanity names, and invalid input", () => {
    expect(parseSteamIdentityInput("76561198000000000")).toEqual({ type: "steamId64", value: "76561198000000000" });
    expect(parseSteamIdentityInput("https://steamcommunity.com/profiles/76561198000000000")).toEqual({
      type: "profileUrl",
      value: "https://steamcommunity.com/profiles/76561198000000000"
    });
    expect(parseSteamIdentityInput("https://steamcommunity.com/id/some_user")).toEqual({ type: "vanity", value: "some_user" });
    expect(parseSteamIdentityInput("some_user")).toEqual({ type: "vanity", value: "some_user" });
    expect(() => parseSteamIdentityInput("not valid/value")).toThrow();
  });
});

describe("Steam API client", () => {
  it("resolves vanity names using the Web API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ response: { success: 1, steamid: "76561198000000000" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveSteamIdentity({ type: "vanity", value: "some_user" }, "api-key")).resolves.toMatchObject({
      steamId64: "76561198000000000",
      vanityName: "some_user"
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("ResolveVanityURL");
  });

  it("fetches owned games with expected query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ response: { game_count: 1, games: [{ appid: 10, name: "Counter-Strike", playtime_forever: 5 }] } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await getOwnedGames({
      steamId64: "76561198000000000",
      apiKey: "api-key",
      includeAppInfo: true,
      includeFreeGames: true
    });

    expect(response.response.games?.[0]?.name).toBe("Counter-Strike");
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    const inputJson = JSON.parse(url.searchParams.get("input_json") ?? "{}");
    expect(inputJson.include_appinfo).toBe(true);
    expect(inputJson.include_played_free_games).toBe(true);
  });

  it("maps invalid API key and private profile failures to auth errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Forbidden" }, 403)));

    await expect(
      getOwnedGames({
        steamId64: "76561198000000000",
        apiKey: "bad-key",
        includeAppInfo: true,
        includeFreeGames: false
      })
    ).rejects.toMatchObject({ providerId: "steam", code: "AUTH_REQUIRED", retryable: false });
  });

  it("fetches public store app details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ "10": { success: true, data: { name: "Counter-Strike" } } }))
    );

    await expect(getSteamAppDetails(10)).resolves.toMatchObject({ appId: 10, title: "Counter-Strike" });
  });

  it("redacts Steam API keys in strings and query params", () => {
    expect(redactSteamApiKey("https://x.test/?key=0123456789ABCDEF0123456789ABCDEF")).toContain("key=[redacted]");
    expect(redactSteamApiKey("token 0123456789ABCDEF0123456789ABCDEF")).toBe("token [redacted]");
  });

  it("retries transient network failures", async () => {
    setSteamApiDelayForTests(() => Promise.resolve());
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("temporary network failure"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson<{ ok: boolean }>(new URL("https://partner.steam-api.com/test"))).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry invalid API key responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "Forbidden" }, 403));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchJson(new URL("https://partner.steam-api.com/test?key=0123456789ABCDEF0123456789ABCDEF"))).rejects.toMatchObject({
      code: "AUTH_REQUIRED"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps abort cancellation to a retryable network error", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(fetchJson(new URL("https://partner.steam-api.com/test"), controller.signal)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true
    });
  });

  it("maps request timeout to a retryable network error", async () => {
    setSteamApiDelayForTests(() => Promise.resolve());
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: URL | RequestInfo, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
        });
      })
    );

    await expect(fetchJson(new URL("https://partner.steam-api.com/test"), undefined, 1)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true
    });
  });
});
