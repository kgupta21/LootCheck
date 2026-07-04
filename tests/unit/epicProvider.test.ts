import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeMessage } from "../../src/background/messageRouter";
import { AuthTokenRepository } from "../../src/db/repositories";
import { getProvider } from "../../src/providers/providerRegistry";
import { EpicSettingsRepository } from "../../src/providers/epic/epicSettings";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Epic provider", () => {
  it("is registered as a Legendary-compatible browser auth provider", async () => {
    const epic = getProvider("epic")!;
    const authState = await epic.getAuthState();

    expect(epic.id).toBe("epic");
    expect(epic.displayName).toBe("Epic Games");
    expect(epic.supportsAuth).toBe(true);
    expect(epic.supportsManualImport).toBe(true);
    expect(epic.supportsBackgroundSync).toBe(true);
    expect(epic.accountPolicy).toBe("single_active_account");
    expect(authState).toMatchObject({
      providerId: "epic",
      status: "not_connected"
    });
  });

  it("exposes the browser authorization page handler", async () => {
    await new EpicSettingsRepository().saveSettings({ oauthClientId: "fixture-client-id" });
    vi.stubGlobal("browser", {
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 123 })
      }
    });

    const response = await routeMessage({ type: "OPEN_EPIC_AUTHORIZATION_PAGE" });

    expect(response).toMatchObject({
      type: "EPIC_AUTHORIZATION_PAGE_RESULT",
      payload: {
        url: expect.stringContaining("www.epicgames.com/id/login")
      }
    });
    expect(JSON.stringify(response)).toContain("fixture-client-id");
  });

  it("rejects missing authorization-code input as a structured auth error", async () => {
    await expect(
      routeMessage({ type: "CONNECT_EPIC_WITH_AUTHORIZATION_CODE", payload: { authorizationCode: " " } })
    ).resolves.toMatchObject({
      type: "EPIC_AUTH_RESULT",
      payload: {
        authState: {
          providerId: "epic",
          status: "needs_reauth",
          error: {
            code: "AUTH_REQUIRED"
          }
        }
      }
    });
  });

  it("connects when Epic returns scope as an array", async () => {
    await new EpicSettingsRepository().saveSettings({ tokenAuthorizationHeader: "basic fixture-token-header" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/account/api/oauth/token")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: "fixture-access-token",
                refresh_token: "fixture-refresh-token",
                account_id: "epic-account-1",
                token_type: "bearer",
                expires_in: 3600,
                scope: ["basic_profile", "friends_list"]
              }),
              { status: 200, headers: { "content-type": "application/json" } }
            )
          );
        }
        if (url.includes("/account/api/public/account/epic-account-1")) {
          return Promise.resolve(
            new Response(JSON.stringify({ account_id: "epic-account-1", displayName: "FixtureEpic" }), {
              status: 200,
              headers: { "content-type": "application/json" }
            })
          );
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
      })
    );

    const response = await routeMessage({
      type: "CONNECT_EPIC_WITH_AUTHORIZATION_CODE",
      payload: { authorizationCode: "fixture-auth-code" }
    });
    const token = await new AuthTokenRepository().getAuthToken("epic", "epic-account-1");

    expect(response).toMatchObject({
      type: "EPIC_AUTH_RESULT",
      payload: {
        authState: {
          providerId: "epic",
          status: "connected",
          accountName: "FixtureEpic"
        }
      }
    });
    expect(token?.scopes).toEqual(["basic_profile", "friends_list"]);
  });

  it("exports safe Epic diagnostics without token, auth code, or cookie fields", async () => {
    await new EpicSettingsRepository().saveSettings({
      accountId: "epic-account-1",
      displayName: "FixtureEpic",
      oauthClientId: "fixture-client-id",
      tokenAuthorizationHeader: "basic fixture-token-header"
    });
    await new AuthTokenRepository().saveAuthToken({
      providerId: "epic",
      accountId: "epic-account-1",
      accessToken: "fixture.epic.access.token",
      refreshToken: "fixture.epic.refresh.token",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const response = await routeMessage({ type: "GET_EPIC_DIAGNOSTICS" });
    const serialized = JSON.stringify(response).toLowerCase();

    expect(response).toMatchObject({
      type: "EPIC_DIAGNOSTICS_RESULT",
      payload: {
        diagnostics: {
          providerId: "epic"
        }
      }
    });
    expect(serialized).not.toContain("fixture.epic.access.token");
    expect(serialized).not.toContain("fixture.epic.refresh.token");
    expect(serialized).not.toContain("fixture-client-id");
    expect(serialized).not.toContain("fixture-token-header");
    expect(serialized).not.toContain("authorizationcode");
    expect(serialized).not.toContain("tokenauthorizationheader");
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("password");
  });

  it("documents the Legendary-compatible browser flow in the normal UI", () => {
    const source = readFileSync(new URL("../../src/options/providerSettings.ts", import.meta.url), "utf8");

    expect(source).toContain("Legendary uses");
    expect(source).toContain("Open Epic authorization page");
    expect(source).toContain("Connect Epic");
    expect(source).toContain("Sync Epic now");
    expect(source).toContain("Epic auth failed");
    expect(source).toContain("sync failed");
    expect(source).not.toContain("Finished Epic auth check");
    expect(source).not.toContain("legendary auth");
    expect(source).not.toContain("legendary list --json");
    expect(source).not.toContain("Import Legendary JSON");
    expect(source).not.toContain("tokenEndpointAuthHeader");
  });
});
