import { describe, expect, it } from "vitest";
import { isProviderError, makeProviderError, redactSensitiveError } from "../../src/shared/errors";
import { redactForLog } from "../../src/shared/logger";

describe("provider errors", () => {
  it("creates and identifies structured provider errors", () => {
    const error = makeProviderError("steam", "AUTH_REQUIRED", "Steam needs login.", true);

    expect(isProviderError(error)).toBe(true);
    expect(error).toMatchObject({ providerId: "steam", code: "AUTH_REQUIRED", retryable: true });
  });

  it("redacts sensitive error and log text", () => {
    const error = redactSensitiveError(new Error("failed with access_token=abc123456789012345678901234567890"), "steam");
    const redacted = redactForLog({ refreshToken: "refresh_token=abc123456789012345678901234567890" });

    expect(error.message).toContain("[redacted]");
    expect(JSON.stringify(redacted)).toContain("[redacted]");
    expect(JSON.stringify(redacted)).not.toContain("abc123456789012345678901234567890");
  });

  it("redacts Epic auth material", () => {
    const text =
      "authorization: Basic abcdef1234567890 code=secret-code authorizationCode: another-code access_token: epic-access refresh_token: epic-refresh sid: browser-session";
    const error = redactSensitiveError(new Error(text), "epic");

    expect(error.message).not.toContain("abcdef1234567890");
    expect(error.message).not.toContain("secret-code");
    expect(error.message).not.toContain("another-code");
    expect(error.message).not.toContain("epic-access");
    expect(error.message).not.toContain("epic-refresh");
    expect(error.message).not.toContain("browser-session");
    expect(error.message).toContain("[redacted]");
  });
});
