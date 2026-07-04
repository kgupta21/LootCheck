import { describe, expect, it } from "vitest";
import { latestWarningText } from "../../src/options/providerWarningText";

describe("provider warning text", () => {
  it("formats latest GOG warning code and message for the options card", () => {
    expect(
      latestWarningText({
        id: "warning-1",
        syncRunId: "sync-1",
        providerId: "gog",
        code: "GOG_EMPTY_LIBRARY_OR_PARSE_FAILED",
        message: "GOG returned zero games from both library endpoints.",
        createdAt: "2026-06-27T00:00:00.000Z"
      })
    ).toBe("GOG_EMPTY_LIBRARY_OR_PARSE_FAILED: GOG returned zero games from both library endpoints.");
  });
});
