import { describe, expect, it } from "vitest";
import { getProvider, listProviders } from "../../src/providers/providerRegistry";

describe("provider registry", () => {
  it("registers manual, steam, gog, epic, and amazon providers", () => {
    expect(listProviders().map((provider) => provider.id).sort()).toEqual(["amazon", "epic", "gog", "manual", "steam"]);
  });

  it("epic uses Legendary-compatible browser auth and amazon uses assisted/manual import only", async () => {
    const epic = getProvider("epic")!;
    const amazon = getProvider("amazon")!;

    const authState = await epic.getAuthState();
    expect(epic.supportsAuth).toBe(true);
    expect(epic.supportsManualImport).toBe(true);
    expect(epic.supportsBackgroundSync).toBe(true);
    expect(authState.status).toBe("not_connected");

    expect(amazon.supportsAuth).toBe(false);
    expect(amazon.supportsManualImport).toBe(true);
    expect(amazon.supportsBackgroundSync).toBe(false);
    expect((await amazon.getAuthState()).status).toBe("not_supported");
    await expect(amazon.login(true)).rejects.toMatchObject({
      providerId: "amazon",
      code: "UNSUPPORTED",
      retryable: false
    });
  });

  it("manual provider conforms to the provider interface", async () => {
    const manual = getProvider("manual")!;
    const authState = await manual.getAuthState();

    expect(manual.supportsAuth).toBe(false);
    expect(manual.supportsManualImport).toBe(true);
    expect(manual.supportsBackgroundSync).toBe(false);
    expect(authState.status).toBe("connected");
  });
});
