import { afterEach, describe, expect, it, vi } from "vitest";
import { routeMessage } from "../../src/background/messageRouter";
import { GameRepository } from "../../src/db/repositories";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockBrowserForAssistedImport(providerId: "steam" | "amazon", payload: unknown): void {
  const url = providerId === "steam" ? "https://steamcommunity.com/profiles/76561198000000000/games/?tab=all" : "https://gaming.amazon.com/home";
  vi.stubGlobal("browser", {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined)
      }
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42, url, active: true }]),
      get: vi.fn().mockRejectedValue(new Error("No remembered tab")),
      create: vi.fn().mockResolvedValue({ id: 42, url }),
      sendMessage: vi.fn().mockResolvedValue({
        type: "ASSISTED_PROVIDER_LIBRARY_RESULT",
        payload
      })
    }
  });
}

describe("assisted browser-session import integration", () => {
  it("imports Steam games from the current browser session without an API key", async () => {
    mockBrowserForAssistedImport("steam", {
      providerId: "steam",
      accountMarker: "76561198000000000",
      source: "visible",
      games: [{ providerGameId: "1086940", title: "Baldur's Gate 3", sourceUrl: "https://store.steampowered.com/app/1086940" }],
      warnings: []
    });

    const response = await routeMessage({ type: "START_STEAM_ASSISTED_IMPORT" });
    const games = await new GameRepository().getAllGames();

    expect(response).toMatchObject({
      type: "ASSISTED_PROVIDER_IMPORT_RESULT",
      payload: {
        syncRun: {
          providerId: "steam",
          status: "success",
          importedCount: 1
        }
      }
    });
    expect(games[0]).toMatchObject({
      canonicalTitle: "Baldur's Gate 3",
      providerEntries: [{ providerId: "steam", accountId: "76561198000000000" }]
    });
  });

  it("imports Amazon games from the current browser session", async () => {
    mockBrowserForAssistedImport("amazon", {
      providerId: "amazon",
      source: "visible",
      games: [{ providerGameId: "AMZN-HADES", title: "Hades", sourceUrl: "https://gaming.amazon.com/detail/hades" }],
      warnings: []
    });

    const response = await routeMessage({ type: "START_AMAZON_ASSISTED_IMPORT" });
    const games = await new GameRepository().getAllGames();

    expect(response).toMatchObject({
      type: "ASSISTED_PROVIDER_IMPORT_RESULT",
      payload: {
        syncRun: {
          providerId: "amazon",
          status: "success",
          importedCount: 1
        }
      }
    });
    expect(games[0]).toMatchObject({
      canonicalTitle: "Hades",
      providerEntries: [{ providerId: "amazon", accountId: "amazon-browser-session" }]
    });
  });

  it("imports Amazon games from the remembered Luna tab after login redirects", async () => {
    vi.stubGlobal("browser", {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({ "owncheck.assistedProviderTabs": { amazon: 77 } }),
          set: vi.fn().mockResolvedValue(undefined)
        }
      },
      tabs: {
        query: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({ id: 77, url: "https://luna.amazon.com/library" }),
        create: vi.fn(),
        sendMessage: vi.fn().mockResolvedValue({
          type: "ASSISTED_PROVIDER_LIBRARY_RESULT",
          payload: {
            providerId: "amazon",
            source: "visible",
            games: [{ providerGameId: "AMZN-BG3", title: "Baldur's Gate 3", sourceUrl: "https://luna.amazon.com/detail/bg3" }],
            warnings: []
          }
        })
      }
    });

    const response = await routeMessage({ type: "START_AMAZON_ASSISTED_IMPORT" });
    const games = await new GameRepository().getAllGames();

    expect(response).toMatchObject({
      type: "ASSISTED_PROVIDER_IMPORT_RESULT",
      payload: {
        syncRun: {
          providerId: "amazon",
          status: "success",
          importedCount: 1
        }
      }
    });
    expect(games[0]).toMatchObject({
      canonicalTitle: "Baldur's Gate 3",
      providerEntries: [{ providerId: "amazon", accountId: "amazon-browser-session" }]
    });
  });

  it("imports Amazon collection batches immediately and exports the complete library", async () => {
    const batchResponse = await routeMessage({
      type: "AMAZON_ASSISTED_IMPORT_BATCH",
      payload: {
        batchLabel: "2025",
        games: [
          {
            providerGameId: "AMZN-PINBALL-SPIRE",
            title: "Pinball Spire",
            sourceUrl: "https://luna.amazon.ca/claims/details/pinball-spire"
          }
        ]
      }
    });
    const exportResponse = (await routeMessage({ type: "EXPORT_LIBRARY_JSON" })) as {
      payload: { games: Array<{ canonicalTitle: string }> };
    };

    expect(batchResponse).toMatchObject({
      type: "AMAZON_ASSISTED_IMPORT_BATCH_RESULT",
      payload: {
        batchLabel: "2025",
        importedCount: 1
      }
    });
    expect(exportResponse.payload.games).toEqual([expect.objectContaining({ canonicalTitle: "Pinball Spire" })]);
  });
});
