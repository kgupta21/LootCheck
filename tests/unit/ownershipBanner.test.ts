/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from "vitest";
import { renderOwnershipBanner, resetOwnershipBannerStateForTests } from "../../src/content/ownershipBanner";
import type { OwnershipMatch } from "../../src/shared/types";

function match(overrides: Partial<OwnershipMatch> = {}): OwnershipMatch {
  return {
    gameId: "game-1",
    canonicalTitle: "Baldur's Gate 3",
    providers: ["manual"],
    confidence: "exact",
    matchedCandidate: "Baldur's Gate 3",
    source: "domainExtractor",
    ...overrides
  };
}

afterEach(() => {
  resetOwnershipBannerStateForTests();
});

describe("ownership banner", () => {
  it("does not render for empty matches", () => {
    renderOwnershipBanner([], "https://example.com/no-match");

    expect(document.querySelector("#owncheck-games-banner")).toBeNull();
  });

  it("renders for positive matches", () => {
    renderOwnershipBanner([match()], "https://example.com/bg3");

    const host = document.querySelector("#owncheck-games-banner");
    expect(host).not.toBeNull();
    expect(host?.shadowRoot?.textContent).toContain("You already own: Baldur's Gate 3");
    expect(host?.shadowRoot?.querySelector("[role='status']")).not.toBeNull();
    expect(host?.shadowRoot?.querySelector("button")?.textContent).toBe("Dismiss");
  });

  it("dismisses per URL for the current session", () => {
    renderOwnershipBanner([match()], "https://example.com/bg3");
    document.querySelector("#owncheck-games-banner")?.shadowRoot?.querySelector("button")?.click();

    expect(document.querySelector("#owncheck-games-banner")).toBeNull();

    renderOwnershipBanner([match()], "https://example.com/bg3");
    expect(document.querySelector("#owncheck-games-banner")).toBeNull();

    renderOwnershipBanner([match()], "https://example.com/other");
    expect(document.querySelector("#owncheck-games-banner")).not.toBeNull();
  });
});
