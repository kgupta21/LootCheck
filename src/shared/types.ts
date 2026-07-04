export type StoreId = "manual" | "steam" | "gog" | "epic" | "amazon";

export type AccountPolicy = "single_active_account" | "multiple_accounts_unsupported";

export type AuthStateStatus =
  | "not_supported"
  | "not_connected"
  | "connected"
  | "expired"
  | "needs_reauth"
  | "error";

export interface ProviderError {
  providerId: StoreId;
  code:
    | "AUTH_REQUIRED"
    | "TOKEN_EXPIRED"
    | "NETWORK_ERROR"
    | "RATE_LIMITED"
    | "API_CHANGED"
    | "UNSUPPORTED"
    | "IMPORT_INVALID"
    | "UNKNOWN";
  message: string;
  retryable: boolean;
}

export interface AuthState {
  providerId: StoreId;
  status: AuthStateStatus;
  accountId?: string;
  accountName?: string;
  lastCheckedAt?: string;
  error?: ProviderError;
}

export interface ProviderImportResult {
  providerId: StoreId;
  accountId?: string;
  importedAt: string;
  games: ProviderGame[];
  warnings: ImportWarning[];
  endpointTrace?: ProviderEndpointTraceInput[];
}

export interface ImportWarning {
  code: string;
  message: string;
  providerGameId?: string;
  row?: number;
  phase?: string;
  endpoint?: string;
  retryable?: boolean;
}

export interface SyncRunWarning {
  id: string;
  syncRunId: string;
  providerId: StoreId;
  code: string;
  message: string;
  phase?: string;
  endpoint?: string;
  retryable?: boolean;
  createdAt: string;
}

export interface ProviderEndpointTrace {
  id: string;
  syncRunId: string;
  providerId: StoreId;
  endpointKey: string;
  urlPath: string;
  startedAt: string;
  finishedAt?: string;
  httpStatus?: number;
  contentType?: string;
  result:
    | "success"
    | "empty"
    | "not_logged_in"
    | "html_login_page"
    | "api_changed"
    | "network_error"
    | "rate_limited"
    | "unknown_error";
  itemCount?: number;
  warningCode?: string;
  errorCode?: string;
}

export type ProviderEndpointTraceInput = Omit<ProviderEndpointTrace, "id" | "syncRunId" | "providerId">;

export interface ProviderGame {
  providerGameId: string;
  title: string;
  sortTitle?: string;
  aliases?: string[];
  url?: string;
  platform?: string[];
  tags?: string[];
  categories?: string[];
  isInstalled?: boolean;
  playtimeMinutes?: number;
  lastPlayedAt?: string;
  raw?: unknown;
}

export interface ProviderEntry {
  providerId: StoreId;
  providerGameId: string;
  accountId?: string;
  sourceTitle: string;
  sourceUrl?: string;
  importedAt: string;
  isStale?: boolean;
  raw?: unknown;
}

export interface GameRecord {
  id: string;
  canonicalTitle: string;
  normalizedTitle: string;
  sortTitle: string;
  aliases: string[];
  normalizedAliases: string[];
  providerEntries: ProviderEntry[];
  platforms: string[];
  tags: string[];
  categories: string[];
  releaseYear?: number;
  isInstalled?: boolean;
  playtimeMinutes?: number;
  lastPlayedAt?: string;
  addedAt: string;
  updatedAt: string;
}

export interface GameRecordSummary {
  id: string;
  canonicalTitle: string;
  normalizedTitle: string;
  normalizedAliases: string[];
  providers: StoreId[];
  updatedAt: string;
}

export type MatchConfidence = "exact" | "alias" | "high_fuzzy" | "low_fuzzy";

export type TitleCandidateSource =
  | "documentTitle"
  | "ogTitle"
  | "twitterTitle"
  | "jsonLd"
  | "h1"
  | "urlSlug"
  | "domainExtractor";

export interface TitleCandidate {
  value: string;
  source: TitleCandidateSource;
  weight: number;
}

export interface OwnershipMatch {
  gameId: string;
  canonicalTitle: string;
  providers: StoreId[];
  confidence: MatchConfidence;
  matchedCandidate: string;
  source: TitleCandidateSource;
}

export interface PageContext {
  hostname: string;
  pathname: string;
  documentTitle: string;
  isLikelyGameProductPage?: boolean;
}

export interface CheckOwnershipMessage {
  type: "CHECK_OWNERSHIP";
  payload: {
    url: string;
    titleCandidates: TitleCandidate[];
    pageContext: PageContext;
  };
}

export interface OwnershipResultMessage {
  type: "OWNERSHIP_RESULT";
  payload: {
    matches: OwnershipMatch[];
  };
}

export interface SyncRun {
  id: string;
  providerId: StoreId;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "success" | "partial" | "failed";
  importedCount: number;
  warningCount: number;
  error?: string;
}

export interface SyncOptions {
  interactive?: boolean;
  force?: boolean;
  signal?: AbortSignal;
}

export interface SyncSettings {
  scheduledSyncEnabled: boolean;
  scheduledSyncIntervalHours: number;
  providerIds: StoreId[];
}

export interface AuthTokenRecord {
  id?: string;
  providerId: StoreId;
  accountId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenType?: string;
  scopes?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SteamProviderSettings {
  providerId: "steam";
  steamId64?: string;
  vanityName?: string;
  profileUrl?: string;
  apiKeyStored: boolean;
  includeFreeGames: boolean;
  includeAppInfo: boolean;
  lastResolvedAt?: string;
  updatedAt: string;
}

export interface SteamAppCacheRecord {
  appId: number;
  title?: string;
  storeUrl: string;
  fetchedAt: string;
  status: "ok" | "missing" | "failed";
  errorCode?: string;
  expiresAt: string;
  raw?: unknown;
}

export interface GogProviderSettings {
  providerId: "gog";
  accountId?: string;
  username?: string;
  importExtras: boolean;
  useLegacyFallback: boolean;
  allowRawProviderResponses: boolean;
  directAuthSupported: boolean;
  lastCheckedAt?: string;
  updatedAt: string;
}

export interface GogDiagnosticsExport {
  providerId: "gog";
  generatedAt: string;
  settings: {
    connected: boolean;
    username?: string;
    accountId?: string;
    importExtras: boolean;
    useLegacyFallback: boolean;
    allowRawProviderResponses: boolean;
    directAuthSupported: boolean;
  };
  latestSyncRun?: SyncRun;
  latestWarnings: SyncRunWarning[];
  endpointTrace: ProviderEndpointTrace[];
  suggestedFixes: string[];
  importedGameCount: number;
  staleGameCount: number;
  notes: string[];
}

export interface EpicProviderSettings {
  providerId: "epic";
  accountId?: string;
  displayName?: string;
  includeEaManagedGames: boolean;
  includeUbisoftLinkedGames: boolean;
  includePlaytime: boolean;
  includeCatalogMetadata: boolean;
  oauthClientId?: string;
  tokenAuthorizationHeader?: string;
  authFlowMode: "legendary_compatible_authorization_code";
  lastResolvedAt?: string;
  updatedAt: string;
}

export interface EpicCatalogCacheRecord {
  key: string;
  namespace: string;
  catalogItemId: string;
  buildVersion?: string;
  status: "ok" | "missing" | "failed";
  item?: unknown;
  errorCode?: string;
  fetchedAt: string;
  expiresAt: string;
}

export interface EpicDiagnosticsExport {
  providerId: "epic";
  connected: boolean;
  accountIdPresent: boolean;
  tokenStored: boolean;
  refreshTokenStored: boolean;
  latestSyncRun?: SyncRun;
  importedGameCount: number;
  staleGameCount: number;
  cacheStats: {
    total: number;
    ok: number;
    missing: number;
    failed: number;
    expired: number;
  };
  recentErrors: ProviderError[];
}

export interface ProviderSummary {
  id: StoreId;
  displayName: string;
  supportsAuth: boolean;
  supportsManualImport: boolean;
  supportsBackgroundSync: boolean;
  accountPolicy?: AccountPolicy;
}

export interface ProviderStatus extends ProviderSummary {
  authState: AuthState;
  latestSyncRun?: SyncRun;
  latestWarnings?: SyncRunWarning[];
  importedGameCount: number;
  staleGameCount?: number;
}

export type ProviderMessage =
  | { type: "GET_PROVIDERS" }
  | { type: "GET_PROVIDER_STATUS"; payload?: { providerId?: StoreId } }
  | { type: "SYNC_PROVIDER"; payload: { providerId: StoreId; force?: boolean } }
  | { type: "SYNC_ALL_PROVIDERS"; payload?: { force?: boolean } }
  | { type: "GET_SYNC_SETTINGS" }
  | { type: "SAVE_SYNC_SETTINGS"; payload: SyncSettings }
  | { type: "GET_RECENT_SYNC_RUNS"; payload?: { providerId?: StoreId; limit?: number } }
  | { type: "GET_STEAM_SETTINGS" }
  | { type: "SAVE_STEAM_SETTINGS"; payload: { identityInput: string; apiKey?: string; includeFreeGames: boolean; includeAppInfo: boolean } }
  | { type: "CLEAR_STEAM_API_KEY" }
  | { type: "CLEAR_STEAM_SETTINGS" }
  | { type: "RESOLVE_STEAM_IDENTITY"; payload: { identityInput: string } }
  | { type: "TEST_STEAM_SETTINGS"; payload: { identityInput: string; apiKey?: string; includeFreeGames: boolean; includeAppInfo: boolean } }
  | { type: "REBUILD_STEAM_METADATA_CACHE" }
  | { type: "EXPORT_STEAM_DIAGNOSTICS" }
  | { type: "OPEN_STEAM_LOGIN_OR_LIBRARY" }
  | { type: "START_STEAM_ASSISTED_IMPORT" }
  | { type: "GET_EPIC_SETTINGS" }
  | {
      type: "SAVE_EPIC_SETTINGS";
      payload: {
        includeEaManagedGames: boolean;
        includeUbisoftLinkedGames: boolean;
        includePlaytime: boolean;
        includeCatalogMetadata: boolean;
        oauthClientId?: string;
        tokenAuthorizationHeader?: string;
      };
    }
  | { type: "OPEN_EPIC_AUTHORIZATION_PAGE" }
  | { type: "CONNECT_EPIC_WITH_AUTHORIZATION_CODE"; payload: { authorizationCode: string; replaceExisting?: "keep" | "remove" } }
  | { type: "CHECK_EPIC_AUTH" }
  | { type: "DISCONNECT_PROVIDER"; payload: { providerId: StoreId } }
  | { type: "REMOVE_PROVIDER_GAMES"; payload: { providerId: StoreId; accountId?: string } }
  | { type: "REBUILD_EPIC_CATALOG_CACHE" }
  | { type: "GET_EPIC_DIAGNOSTICS" }
  | { type: "GET_EPIC_FEASIBILITY_STATUS" }
  | { type: "GET_GOG_SETTINGS" }
  | { type: "SAVE_GOG_SETTINGS"; payload: { importExtras: boolean; useLegacyFallback: boolean; allowRawProviderResponses?: boolean } }
  | { type: "OPEN_GOG_LOGIN" }
  | { type: "CHECK_GOG_LOGIN"; payload?: { replaceExisting?: "keep" | "remove" } }
  | { type: "TEST_GOG_LIBRARY_ENDPOINTS" }
  | { type: "DISCONNECT_GOG" }
  | { type: "REMOVE_GOG_IMPORTED_GAMES"; payload?: { accountId?: string } }
  | { type: "EXPORT_GOG_DIAGNOSTICS" }
  | { type: "OPEN_AMAZON_LOGIN_OR_LIBRARY" }
  | { type: "START_AMAZON_ASSISTED_IMPORT" }
  | {
      type: "AMAZON_ASSISTED_IMPORT_BATCH";
      payload: {
        batchLabel?: string;
        games: Array<{
          providerGameId: string;
          title: string;
          sourceUrl?: string;
          playtimeMinutes?: number;
          isInstalled?: boolean;
        }>;
      };
    }
  | { type: "EXPORT_LIBRARY_JSON" };

export interface FilterPreset {
  id: string;
  name: string;
  settings: FilterPresetSettings;
  sortingOrder: SortOrder;
  sortingDirection: SortDirection;
  createdAt: string;
  updatedAt: string;
}

export interface FilterPresetSettings {
  useAndFilteringStyle: boolean;
  providers?: StoreId[];
  platforms?: string[];
  tags?: string[];
  categories?: string[];
  isInstalled?: boolean;
  titleText?: string;
  releaseYears?: number[];
  hasPlaytime?: boolean;
}

export type SortOrder =
  | "title"
  | "provider"
  | "platform"
  | "releaseYear"
  | "dateAdded"
  | "dateModified"
  | "lastPlayed"
  | "playtime"
  | "installed";

export type SortDirection = "asc" | "desc";
