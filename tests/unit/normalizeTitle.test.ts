import { describe, expect, it } from "vitest";
import { normalizeTitle, titleAliases } from "../../src/matching/normalizeTitle";

describe("normalizeTitle", () => {
  it("normalizes punctuation, trademarks, and roman numerals", () => {
    expect(normalizeTitle("Baldur’s Gate III®")).toBe("baldurs gate 3");
  });

  it("strips trailing store and platform noise", () => {
    expect(normalizeTitle("The Witcher 3: Wild Hunt (Steam PC)")).toBe("the witcher 3 wild hunt");
  });

  it("keeps sequel numbers", () => {
    expect(normalizeTitle("Portal 2")).toBe("portal 2");
  });
});

describe("titleAliases", () => {
  it("adds edition-stripped aliases", () => {
    expect(titleAliases("The Witcher 3: Wild Hunt - Complete Edition").map(normalizeTitle)).toContain(
      "the witcher 3 wild hunt"
    );
  });
});
