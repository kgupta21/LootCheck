import { afterEach, describe, expect, it, vi } from "vitest";
import { GameRepository } from "../../src/db/repositories";
import { routeMessage } from "../../src/background/messageRouter";
import { syncAllProviders, syncProvider } from "../../src/background/providerSync";
import { parseManualImportText } from "../../src/providers/manual/ManualImportProvider";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function mockOwnedGamesFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      jsonResponse({
        response: {
          game_count: 2,
          games: [
            { appid: 1086940, name: "Baldur's Gate 3", playtime_forever: 60 },
            { appid: 1145360, name: "Hades", playtime_forever: 120 }
          ]
        }
      })
    )
  );
}

async function saveSteamSettings(): Promise<void> {
  await routeMessage({
    type: "SAVE_STEAM_SETTINGS",
    payload: {
      identityInput: "76561198000000000",
      apiKey: "api-key",
      includeFreeGames: false,
      includeAppInfo: true
    }
  });
}

describe("Steam sync integration", () => {
  it("creates a sync run and imports fixture owned games", async () => {
    mockOwnedGamesFetch();
    await saveSteamSettings();

    const run = await syncProvider("steam");
    const games = await new GameRepository().getAllGames();

    expect(run).toMatchObject({ providerId: "steam", status: "success", importedCount: 2 });
    expect(games.map((game) => game.canonicalTitle).sort()).toEqual(["Baldur's Gate 3", "Hades"]);
  });

  it("merges Steam duplicates with manual provider records", async () => {
    mockOwnedGamesFetch();
    await new GameRepository().importProviderResult(
      parseManualImportText(JSON.stringify([{ title: "Baldur's Gate 3", aliases: ["Baldurs Gate III"] }]), "manual.json")
    );
    await saveSteamSettings();

    await syncProvider("steam");
    const games = await new GameRepository().getAllGames();
    const bg3 = games.find((game) => game.normalizedTitle === "baldurs gate 3");

    expect(bg3?.providerEntries.map((entry) => entry.providerId).sort()).toEqual(["manual", "steam"]);
  });

  it("syncAllProviders includes Steam and continues if Steam fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "Forbidden" }, 403)));
    await saveSteamSettings();

    const runs = await syncAllProviders();

    expect(runs.map((run) => run.providerId).sort()).toEqual(["epic", "gog", "steam"]);
    expect(runs.find((run) => run.providerId === "steam")?.status).toBe("failed");
  });

  it("Steam settings messages never expose raw API keys", async () => {
    await saveSteamSettings();

    const response = await routeMessage({ type: "GET_STEAM_SETTINGS" });
    const serialized = JSON.stringify(response);

    expect(serialized).toContain('"apiKeyStored":true');
    expect(serialized).not.toContain("api-key");
  });
});
