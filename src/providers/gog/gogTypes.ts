import type { ImportWarning, ProviderEndpointTraceInput } from "../../shared/types";

export interface GogAccountBasic {
  isLoggedIn: boolean;
  username?: string;
  accountId?: string;
}

export interface GogLibraryGame {
  id: string;
  title: string;
  slug?: string;
  productUrl?: string;
  playtimeMinutes?: number;
  lastPlayedAt?: string;
  isExtra?: boolean;
  raw?: unknown;
}

export interface GogOwnedGameDetails {
  id: string;
  title?: string;
  downloads?: unknown[];
  raw?: unknown;
}

export interface GogFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  endpointKey?: string;
  onTrace?: (trace: ProviderEndpointTraceInput) => void;
}

export interface GogImportOptions {
  importExtras: boolean;
  useLegacyFallback: boolean;
  allowRawProviderResponses: boolean;
}

export interface GogParseResult<T> {
  ok: boolean;
  items: T[];
  pageInfo?: {
    currentPage?: number;
    totalPages?: number;
    hasNextPage?: boolean;
  };
  warning?: ImportWarning;
}
