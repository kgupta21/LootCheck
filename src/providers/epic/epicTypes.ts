import type { EpicCatalogCacheRecord, ProviderGame, SyncRun } from "../../shared/types";

export type EpicAuthFlowMode = "legendary_compatible_authorization_code";

export interface EpicEndpointConfig {
  oauthUrl: string;
  accountUrl: string;
  libraryItemsUrl: string;
  catalogUrl: string;
  playtimeUrl: string;
  authCodeUrl?: string;
}

export interface EpicTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: string;
  token_type?: string;
  scope?: string | string[] | unknown;
  account_id?: string;
  displayName?: string;
}

export interface EpicTokenRecord {
  providerId: "epic";
  accountId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt?: string;
  tokenType: string;
  createdAt: string;
  updatedAt: string;
}

export interface EpicAccount {
  accountId: string;
  displayName?: string;
}

export interface EpicAsset {
  appName?: string;
  namespace?: string;
  catalogItemId?: string;
  sandboxType?: string;
  buildVersion?: string;
}

export interface EpicCatalogItem {
  id?: string;
  title?: string;
  categories?: { path: string }[];
  mainGameItem?: unknown;
  customAttributes?: Record<string, { value: string }>;
}

export interface EpicPlaytimeItem {
  artifactId: string;
  totalTime: number;
}

export interface EpicMappedGame {
  providerGameId: string;
  title: string;
  namespace?: string;
  catalogItemId?: string;
  playtimeMinutes?: number;
  sourceUrl?: string;
}

export interface EpicDiagnostics {
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
  recentErrors: Array<{ providerId: "epic"; code: string; message: string; retryable: boolean }>;
}

export interface EpicFeasibilityStatus {
  providerId: "epic";
  decision: "LEGENDARY_COMPATIBLE_BROWSER_AUTH";
  directImportImplemented: true;
  safeAuthPathConfirmed: true;
  authFlowMode: EpicAuthFlowMode;
  notesDocumentPath: string;
}

export type EpicProviderGame = ProviderGame;
export type { EpicCatalogCacheRecord };
