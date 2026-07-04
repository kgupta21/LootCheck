import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractAmazonGamesFromGraphqlPayload,
  extractAmazonGamesViaGraphql,
  extractAssistedGamesFromPage
} from "../../src/providers/assisted/assistedPageExtractors";

function documentFromHtml(html: string, url: string): Document {
  const window = new Window({ url });
  window.document.write(html);
  return window.document as unknown as Document;
}

describe("assisted browser-session page extractors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts Steam games from visible app links and embedded JSON", () => {
    const document = documentFromHtml(
      `
        <a href="https://store.steampowered.com/app/1086940/Baldurs_Gate_3/"><img alt="Baldur's Gate 3"></a>
        <script type="application/json">
          {"games":[{"appid":1145360,"name":"Hades","playtime_forever":123}]}
        </script>
      `,
      "https://steamcommunity.com/profiles/76561198000000000/games/?tab=all"
    );

    const result = extractAssistedGamesFromPage("steam", document);

    expect(result).toMatchObject({
      providerId: "steam",
      accountMarker: "76561198000000000",
      source: "combined"
    });
    expect(result.games).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerGameId: "1086940", title: "Baldur's Gate 3" }),
        expect.objectContaining({ providerGameId: "1145360", title: "Hades", playtimeMinutes: 123 })
      ])
    );
  });

  it("extracts Amazon Games from visible cards and embedded JSON", () => {
    const document = documentFromHtml(
      `
        <a data-asin="AMZN-BG3" href="https://gaming.amazon.com/detail/bg3" aria-label="Baldur's Gate 3"></a>
        <script type="application/json">
          {"props":{"entitlements":[{"productId":"AMZN-HADES","productTitle":"Hades"}]}}
        </script>
      `,
      "https://gaming.amazon.com/home"
    );

    const result = extractAssistedGamesFromPage("amazon", document);

    expect(result.providerId).toBe("amazon");
    expect(result.source).toBe("combined");
    expect(result.games).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerGameId: "AMZN-BG3", title: "Baldur's Gate 3" }),
        expect.objectContaining({ providerGameId: "AMZN-HADES", title: "Hades" })
      ])
    );
  });

  it("extracts Amazon Games from Prime Gaming-style product links and artwork", () => {
    const document = documentFromHtml(
      `
        <a href="https://luna.amazon.ca/claims/details/fallout-new-vegas" aria-label="Fallout: New Vegas"></a>
        <button aria-label="Claim"></button>
        <a href="https://luna.amazon.ca/claims/details/witcher-3"><img alt="Image of The Witcher 3: Wild Hunt Complete Edition"></a>
      `,
      "https://gaming.amazon.com/home"
    );

    const result = extractAssistedGamesFromPage("amazon", document);

    expect(result.games).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Fallout: New Vegas" }),
        expect.objectContaining({ title: "The Witcher 3: Wild Hunt Complete Edition" })
      ])
    );
    expect(result.games.map((game) => game.title)).not.toContain("Claim");
  });

  it("rejects Amazon UI labels, dates, account text, icon names, and delivery messages", () => {
    const document = documentFromHtml(
      `
        <h2>Amazon Games library</h2>
        <div aria-label="AngleDown"></div>
        <div aria-label="Back to top"></div>
        <div aria-label="Kartik (k*****9@gmail.com)"></div>
        <div aria-label="Jun 27, 2026"></div>
        <div aria-label="Delivered to your Epic Games Store library on Jun 12, 2026."></div>
        <div aria-label="8SAF8469E2EDE282F8"></div>
        <a href="https://luna.amazon.ca/claims/details/pinball-spire" aria-label="Pinball Spire"></a>
      `,
      "https://luna.amazon.ca/claims/my-collection?offerType=games"
    );

    const result = extractAssistedGamesFromPage("amazon", document);

    expect(result.games.map((game) => game.title)).toEqual(["Pinball Spire"]);
  });

  it("extracts Amazon Games from the Canadian Luna collection URL", () => {
    const document = documentFromHtml(
      `
        <a href="https://luna.amazon.ca/claims/details/fallout-new-vegas" aria-label="Fallout: New Vegas"></a>
      `,
      "https://luna.amazon.ca/claims/my-collection?offerType=games"
    );

    const result = extractAssistedGamesFromPage("amazon", document);

    expect(result.games).toEqual([
      expect.objectContaining({
        providerGameId: "fallout-new-vegas",
        title: "Fallout: New Vegas",
        sourceUrl: "https://luna.amazon.ca/claims/details/fallout-new-vegas"
      })
    ]);
  });


  it("maps Amazon games from GraphQL-shaped response data", () => {
    const games = extractAmazonGamesFromGraphqlPayload({
      data: {
        library: {
          items: [
            {
              productId: "AMZN-NEW-VEGAS",
              productTitle: "Fallout: New Vegas",
              productUrl: "/detail/fallout-new-vegas"
            }
          ]
        }
      }
    });

    expect(games).toEqual([
      expect.objectContaining({
        providerGameId: "AMZN-NEW-VEGAS",
        title: "Fallout: New Vegas",
        sourceUrl: "https://gaming.amazon.com/detail/fallout-new-vegas"
      })
    ]);
  });

  it("can call Prime Gaming GraphQL using a page CSRF token and discovered payload", async () => {
    const document = documentFromHtml(
      `
        <input name="csrf-key" value="csrf-fixture">
        <script type="application/json">
          {"props":{"operationName":"LibraryQuery","variables":{"page":1},"query":"query LibraryQuery { library { items { productId productTitle } } }"}}
        </script>
      `,
      "https://gaming.amazon.com/home"
    );
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            library: {
              items: [{ productId: "AMZN-HADES", productTitle: "Hades" }]
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetch);

    const games = await extractAmazonGamesViaGraphql(document);

    expect(fetch).toHaveBeenCalledWith(
      "https://gaming.amazon.com/graphql",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({ "csrf-token": "csrf-fixture" })
      })
    );
    expect(games).toEqual([expect.objectContaining({ providerGameId: "AMZN-HADES", title: "Hades" })]);
  });

  it("does not walk token-like embedded fields", () => {
    const document = documentFromHtml(
      `
        <script type="application/json">
          {"access_token":{"productId":"SECRET","productTitle":"Should Not Import"},"items":[{"productId":"VISIBLE","title":"Visible Game"}]}
        </script>
      `,
      "https://gaming.amazon.com/home"
    );

    const result = extractAssistedGamesFromPage("amazon", document);

    expect(result.games.map((game) => game.title)).toEqual(["Visible Game"]);
  });
});
