import { describe, expect, it } from "vitest";
import { AuthTokenRepository, SteamAppCacheRepository, SyncRunRepository } from "../../src/db/repositories";
import { exportSteamDiagnostics } from "../../src/providers/steam/steamDiagnostics";
import { SteamSettingsRepository } from "../../src/providers/steam/steamSettings";

describe("Steam diagnostics", () => {
  it("redacts secrets and exports safe cache stats", async () => {
    await new SteamSettingsRepository().saveSettings(
      { providerId: "steam", steamId64: "76561198000000000", includeAppInfo: true, includeFreeGames: false },
      "0123456789ABCDEF0123456789ABCDEF",
      { steamId64: "76561198000000000" }
    );
    await new AuthTokenRepository().saveAuthToken({
      providerId: "steam",
      accountId: "76561198000000000",
      accessToken: "0123456789ABCDEF0123456789ABCDEF",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await new SteamAppCacheRepository().saveAppDetails({
      appId: 1,
      title: "Cached",
      storeUrl: "https://store.steampowered.com/app/1",
      fetchedAt: new Date().toISOString(),
      status: "ok",
      expiresAt: new Date(Date.now() + 1000).toISOString()
    });
    const run = await new SyncRunRepository().createSyncRun("steam");
    await new SyncRunRepository().finishSyncRun(run.id, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: "failed key=0123456789ABCDEF0123456789ABCDEF",
      importedCount: 0,
      warningCount: 0
    });

    const diagnostics = await exportSteamDiagnostics();
    const serialized = JSON.stringify(diagnostics);
    expect(diagnostics.settings.apiKeyStored).toBe(true);
    expect(diagnostics.cacheStats.ok).toBe(1);
    expect(serialized).not.toContain("0123456789ABCDEF0123456789ABCDEF");
    expect(serialized).toContain("[redacted]");
  });
});
