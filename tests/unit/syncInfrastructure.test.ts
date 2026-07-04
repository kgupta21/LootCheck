import { describe, expect, it, vi } from "vitest";
import { routeMessage } from "../../src/background/messageRouter";
import { syncAllProviders } from "../../src/background/providerSync";
import { initializeSyncScheduler, syncProviderIdsForSchedule } from "../../src/background/syncScheduler";
import { AuthTokenRepository, SettingsRepository, SyncRunRepository, normalizeSyncSettings } from "../../src/db/repositories";

describe("sync run repository", () => {
  it("creates, finishes, lists, and fetches sync runs", async () => {
    const repository = new SyncRunRepository();
    const run = await repository.createSyncRun("steam");

    await repository.finishSyncRun(run.id, {
      finishedAt: "2026-01-01T00:00:00.000Z",
      status: "failed",
      importedCount: 0,
      warningCount: 0,
      error: "Direct login is not implemented yet."
    });

    const latest = await repository.getLatestSyncRun("steam");
    const recent = await repository.listRecentSyncRuns("steam", 5);

    expect(latest).toMatchObject({ id: run.id, status: "failed" });
    expect(recent).toHaveLength(1);
  });
});

describe("provider sync orchestration", () => {
  it("continues syncAllProviders after provider failures", async () => {
    const runs = await syncAllProviders();

    expect(runs.map((run) => run.providerId).sort()).toEqual(["epic", "gog", "steam"]);
    expect(runs.every((run) => run.status === "failed")).toBe(true);
  });
});

describe("scheduled sync settings", () => {
  it("normalizes minimum interval and excludes manual provider", () => {
    const normalized = normalizeSyncSettings({
      scheduledSyncEnabled: true,
      scheduledSyncIntervalHours: 0,
      providerIds: ["manual", "steam", "steam", "gog"]
    });

    expect(normalized.scheduledSyncIntervalHours).toBe(1);
    expect(normalized.providerIds).toEqual(["steam", "gog"]);
  });

  it("scheduled provider list excludes manual provider", () => {
    expect(
      syncProviderIdsForSchedule({
        scheduledSyncEnabled: true,
        scheduledSyncIntervalHours: 24,
        providerIds: ["manual", "steam", "epic"]
      })
    ).toEqual(["steam", "epic"]);
  });

  it("persists sync settings through the settings repository", async () => {
    const repository = new SettingsRepository();
    const saved = await repository.saveSyncSettings({
      scheduledSyncEnabled: true,
      scheduledSyncIntervalHours: 2,
      providerIds: ["manual", "steam"]
    });

    expect(saved.providerIds).toEqual(["steam"]);
    expect(await repository.getSyncSettings()).toMatchObject(saved);
  });

  it("recreates the browser alarm on scheduler startup", async () => {
    const repository = new SettingsRepository();
    await repository.saveSyncSettings({
      scheduledSyncEnabled: true,
      scheduledSyncIntervalHours: 2,
      providerIds: ["manual", "steam"]
    });
    const clear = vi.fn().mockResolvedValue(true);
    const create = vi.fn();
    const addListener = vi.fn();
    vi.stubGlobal("browser", { alarms: { clear, create, onAlarm: { addListener } } });

    await initializeSyncScheduler();

    expect(clear).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith("owncheck-scheduled-sync", { periodInMinutes: 120 });
  });
});

describe("auth token repository", () => {
  it("saves, fetches, deletes one token, and deletes all provider tokens", async () => {
    const repository = new AuthTokenRepository();

    await repository.saveAuthToken({
      providerId: "steam",
      accountId: "account-a",
      accessToken: "access_token=super-secret-value",
      refreshToken: "refresh_token=another-secret-value",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await repository.saveAuthToken({
      providerId: "steam",
      accountId: "account-b",
      accessToken: "access_token=super-secret-value-b",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(await repository.getAuthToken("steam", "account-a")).toMatchObject({ providerId: "steam", accountId: "account-a" });

    await repository.deleteAuthToken("steam", "account-a");
    expect(await repository.getAuthToken("steam", "account-a")).toBeUndefined();
    expect(await repository.getAuthToken("steam", "account-b")).toBeDefined();

    await repository.deleteProviderAuthTokens("steam");
    expect(await repository.getAuthToken("steam", "account-b")).toBeUndefined();
  });
});

describe("message router provider messages", () => {
  it("does not expose token data through provider status messages", async () => {
    const repository = new AuthTokenRepository();
    await repository.saveAuthToken({
      providerId: "steam",
      accessToken: "access_token=must-not-leak",
      refreshToken: "refresh_token=must-not-leak",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    const response = await routeMessage({ type: "GET_PROVIDER_STATUS" });
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("refresh_token");
  });
});
