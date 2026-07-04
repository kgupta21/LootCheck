export type {
  AuthState,
  AuthTokenRecord,
  ImportWarning,
  ProviderError,
  ProviderGame,
  ProviderImportResult,
  ProviderStatus,
  ProviderSummary,
  StoreId,
  SyncOptions,
  SyncRun,
  SyncSettings
} from "../shared/types";

export { makeProviderError, isProviderError, redactSensitiveError } from "../shared/errors";
