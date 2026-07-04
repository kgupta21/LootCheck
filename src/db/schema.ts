export const DB_NAME = "owncheck_games_db";
export const DB_VERSION = 5;

export const STORES = {
  games: "games",
  providers: "providers",
  auth: "auth",
  aliases: "aliases",
  normalizedTitleIndex: "normalizedTitleIndex",
  syncRuns: "syncRuns",
  syncRunWarnings: "syncRunWarnings",
  providerEndpointTrace: "providerEndpointTrace",
  filterPresets: "filterPresets",
  settings: "settings",
  steamAppCache: "steamAppCache",
  epicCatalogCache: "epicCatalogCache"
} as const;
