import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildEpicCatalogItemUrl,
  parseEpicAccount,
  parseEpicLibraryPage,
  parseEpicPlaytimeItems
} from "../../src/providers/epic/epicApi";
import { shouldImportEpicAsset } from "../../src/providers/epic/epicFilters";
import { mapEpicAssetToProviderGame } from "../../src/providers/epic/epicMappers";
import type { EpicAsset, EpicCatalogItem, EpicPlaytimeItem } from "../../src/providers/epic/epicTypes";

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../fixtures/epic/${name}`, import.meta.url), "utf8")) as T;
}

const asset: EpicAsset = {
  appName: "FortniteTestGame",
  namespace: "fn",
  catalogItemId: "catalog-game",
  sandboxType: "PUBLIC"
};

describe("Epic API feasibility helpers", () => {
  it("builds catalog URLs without auth material", () => {
    const url = buildEpicCatalogItemUrl("fn", "catalog-game");

    expect(url.hostname).toBe("catalog-public-service-prod06.ol.epicgames.com");
    expect(url.pathname).toContain("/fn/");
    expect(url.searchParams.get("id")).toBe("catalog-game");
    expect(url.toString()).not.toContain("token");
    expect(url.toString()).not.toContain("client");
  });

  it("imports normal application assets", () => {
    expect(shouldImportEpicAsset(asset, fixture<EpicCatalogItem>("catalogItem_game.json"))).toBe(true);
  });

  it("excludes UE namespace assets", () => {
    expect(shouldImportEpicAsset({ ...asset, namespace: "ue" }, fixture<EpicCatalogItem>("catalogItem_game.json"))).toBe(false);
  });

  it("excludes private sandbox assets", () => {
    expect(shouldImportEpicAsset({ ...asset, sandboxType: "PRIVATE" }, fixture<EpicCatalogItem>("catalogItem_game.json"))).toBe(false);
  });

  it("excludes missing appName", () => {
    const { appName: _appName, ...assetWithoutAppName } = asset;
    expect(shouldImportEpicAsset(assetWithoutAppName, fixture<EpicCatalogItem>("catalogItem_game.json"))).toBe(false);
  });

  it("requires applications category", () => {
    expect(shouldImportEpicAsset(asset, { id: "x", title: "No App", categories: [{ path: "games" }] })).toBe(false);
  });

  it("excludes DLC unless launchable", () => {
    const dlc = fixture<EpicCatalogItem>("catalogItem_dlc.json");
    expect(shouldImportEpicAsset(asset, dlc)).toBe(false);
    expect(shouldImportEpicAsset(asset, fixture<EpicCatalogItem>("catalogItem_launchableDlc.json"))).toBe(true);
  });

  it("excludes digital extras and plugins", () => {
    expect(shouldImportEpicAsset(asset, fixture<EpicCatalogItem>("catalogItem_digitalExtras.json"))).toBe(false);
    expect(shouldImportEpicAsset(asset, fixture<EpicCatalogItem>("catalogItem_plugin.json"))).toBe(false);
  });

  it("handles EA-managed games option", () => {
    const item = fixture<EpicCatalogItem>("catalogItem_eaManaged.json");
    expect(shouldImportEpicAsset(asset, item)).toBe(false);
    expect(shouldImportEpicAsset(asset, item, { includeEaManagedGames: true })).toBe(true);
  });

  it("handles Ubisoft-linked games option", () => {
    const item = fixture<EpicCatalogItem>("catalogItem_ubisoftLinked.json");
    expect(shouldImportEpicAsset(asset, item)).toBe(false);
    expect(shouldImportEpicAsset(asset, item, { includeUbisoftLinkedGames: true })).toBe(true);
  });

  it("maps valid assets to ProviderGame and omits raw by default", () => {
    const game = mapEpicAssetToProviderGame(
      asset,
      fixture<EpicCatalogItem>("catalogItem_game.json"),
      fixture<{ records: EpicPlaytimeItem[] }>("playtimeItems.json").records[0]
    );

    expect(game).toMatchObject({
      providerGameId: "FortniteTestGame",
      title: "Fixture Epic Game - Deluxe Edition",
      sortTitle: "Fixture Epic Game - Deluxe Edition",
      aliases: ["Fixture Epic Game"],
      platform: ["PC"],
      playtimeMinutes: 42
    });
    expect(game.raw).toBeUndefined();
  });

  it("does not map invalid title assets", () => {
    expect(() => mapEpicAssetToProviderGame(asset, { id: "catalog-game", categories: [{ path: "applications" }] })).toThrow(
      "Epic asset mapping requires"
    );
  });

  it("parses account, library, and playtime fixtures", () => {
    expect(parseEpicAccount(fixture("accountResponse.json"))).toMatchObject({
      accountId: "epic-account-1",
      displayName: "FixtureEpic"
    });
    expect(parseEpicLibraryPage(fixture("libraryItems_page1.json"))).toMatchObject({
      assets: [asset],
      nextCursor: "page-2"
    });
    expect(parseEpicPlaytimeItems(fixture("playtimeItems.json"))).toEqual([{ artifactId: "FortniteTestGame", totalTime: 42 }]);
  });

  it("maps invalid library shape to API changed", () => {
    expect(() => parseEpicLibraryPage(fixture("libraryItems_invalidShape.json"))).toThrow("Epic library response shape changed");
  });
});
