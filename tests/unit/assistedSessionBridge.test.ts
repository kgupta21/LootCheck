import { describe, expect, it } from "vitest";
import { isAmazonCollectionYearText, isAmazonLoadMoreText } from "../../src/content/assistedSessionBridge";

describe("assisted session bridge", () => {
  it("recognizes Luna collection load-more controls", () => {
    expect(isAmazonLoadMoreText("See 10 more")).toBe(true);
    expect(isAmazonLoadMoreText("See 20 more")).toBe(true);
    expect(isAmazonLoadMoreText("Show more")).toBe(true);
  });

  it("does not treat game action controls as load-more controls", () => {
    expect(isAmazonLoadMoreText("Claim Code")).toBe(false);
    expect(isAmazonLoadMoreText("Download")).toBe(false);
    expect(isAmazonLoadMoreText("Play now")).toBe(false);
  });

  it("recognizes Luna collection year filter options", () => {
    expect(isAmazonCollectionYearText("Past 3 months")).toBe(true);
    expect(isAmazonCollectionYearText("2026")).toBe(true);
    expect(isAmazonCollectionYearText("2021")).toBe(true);
    expect(isAmazonCollectionYearText("Collected in past 3 months")).toBe(false);
    expect(isAmazonCollectionYearText("Games")).toBe(false);
  });
});
