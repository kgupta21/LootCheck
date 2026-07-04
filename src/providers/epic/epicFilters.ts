import type { EpicAsset, EpicCatalogItem } from "./epicTypes";

function categoryPaths(catalogItem?: EpicCatalogItem): Set<string> {
  return new Set((catalogItem?.categories ?? []).map((category) => category.path.toLowerCase()));
}

function customAttributeValue(catalogItem: EpicCatalogItem | undefined, keys: string[]): string | undefined {
  const attributes = catalogItem?.customAttributes ?? {};
  for (const key of keys) {
    const match = Object.entries(attributes).find(([attributeKey]) => attributeKey.toLowerCase() === key.toLowerCase());
    const value = match?.[1]?.value;
    if (value?.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function truthyAttribute(catalogItem: EpicCatalogItem | undefined, keys: string[]): boolean {
  const value = customAttributeValue(catalogItem, keys);
  return Boolean(value && /^(true|1|yes|ea|ubisoft)$/i.test(value));
}

export function shouldImportEpicAsset(
  asset: EpicAsset,
  catalogItem?: EpicCatalogItem,
  options: {
    includeEaManagedGames?: boolean;
    includeUbisoftLinkedGames?: boolean;
  } = {}
): boolean {
  if (asset.namespace?.toLowerCase() === "ue") {
    return false;
  }
  if (asset.sandboxType === "PRIVATE") {
    return false;
  }
  if (!asset.appName?.trim()) {
    return false;
  }
  const categories = categoryPaths(catalogItem);
  if (!categories.has("applications")) {
    return false;
  }
  if (catalogItem?.mainGameItem && !categories.has("addons/launchable")) {
    return false;
  }
  if (categories.has("digitalextras") || categories.has("plugins") || categories.has("plugins/engine")) {
    return false;
  }
  if (!options.includeEaManagedGames && truthyAttribute(catalogItem, ["isEAManaged", "eaManaged", "partnerLinkTypeEA"])) {
    return false;
  }
  if (!options.includeUbisoftLinkedGames && truthyAttribute(catalogItem, ["isUbisoftLinked", "ubisoftLinked", "partnerLinkTypeUbisoft"])) {
    return false;
  }
  return true;
}
