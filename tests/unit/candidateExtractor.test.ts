import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractTitleCandidatesFromPage, getPageContext } from "../../src/matching/candidateExtractor";

function fixture(name: string): string {
  return readFileSync(resolve("tests/fixtures", name), "utf8");
}

function match(html: string, pattern: RegExp): string | undefined {
  return html.match(pattern)?.[1]?.trim();
}

function namesFromJsonLd(html: string): string[] {
  return [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((scriptMatch) => {
      try {
        const parsed = JSON.parse(scriptMatch[1] ?? "{}");
        return typeof parsed.name === "string" ? [parsed.name] : [];
      } catch {
        return [];
      }
    });
}

describe("candidate extraction", () => {
  it("extracts high-weight Steam product candidates", () => {
    const html = fixture("steam-product.html");
    const documentTitle = match(html, /<title>(.*?)<\/title>/i) ?? "";
    const ogTitle = match(html, /property="og:title"\s+content="([^"]+)"/i) ?? "";
    const twitterTitle = match(html, /name="twitter:title"\s+content="([^"]+)"/i) ?? "";
    const h1 = match(html, /<h1>(.*?)<\/h1>/i);
    const candidates = extractTitleCandidatesFromPage({
      url: "https://store.steampowered.com/app/1086940/Baldurs_Gate_3/",
      documentTitle,
      ogTitle,
      twitterTitle,
      jsonLdNames: namesFromJsonLd(html),
      h1Texts: h1 ? [h1] : []
    });

    expect(candidates[0]).toMatchObject({
      value: "Baldurs Gate 3",
      source: "domainExtractor",
      weight: 100
    });
    expect(candidates.some((candidate) => candidate.value === "Baldur's Gate 3")).toBe(true);
  });

  it("extracts GOG and Epic domain candidates from product URLs", () => {
    const gogCandidates = extractTitleCandidatesFromPage({
      url: "https://www.gog.com/en/game/cyberpunk_2077",
      documentTitle: "Cyberpunk 2077 - GOG.com",
      ogTitle: "Cyberpunk 2077"
    });
    const epicCandidates = extractTitleCandidatesFromPage({
      url: "https://store.epicgames.com/en-US/p/alan-wake-2",
      documentTitle: "Alan Wake 2 | Download and Buy Today - Epic Games Store",
      ogTitle: "Alan Wake 2"
    });

    expect(gogCandidates[0]).toMatchObject({ value: "cyberpunk 2077", source: "domainExtractor" });
    expect(epicCandidates[0]).toMatchObject({ value: "alan wake 2", source: "domainExtractor" });
  });

  it("falls back to generic page signals and URL slugs", () => {
    const candidates = extractTitleCandidatesFromPage({
      url: "https://example.com/reviews/baldurs-gate-3-review",
      documentTitle: "Baldur's Gate 3 review",
      ogTitle: "Baldur's Gate 3 review",
      h1Texts: ["Baldur's Gate 3 review"]
    });

    expect(candidates.map((candidate) => candidate.source)).toContain("ogTitle");
    expect(candidates.map((candidate) => candidate.source)).toContain("urlSlug");
  });

  it("builds page context for product pages and generic pages", () => {
    expect(
      getPageContext({
        url: "https://store.steampowered.com/app/1086940/Baldurs_Gate_3/",
        documentTitle: "Baldur's Gate 3 on Steam"
      }).isLikelyGameProductPage
    ).toBe(true);
    expect(
      getPageContext({
        url: "https://example.com/articles/control-your-lights",
        documentTitle: "Control your lights"
      }).isLikelyGameProductPage
    ).toBe(false);
  });
});
