import type { AccountPolicy, AuthState, ProviderImportResult, StoreId } from "../shared/types";

export interface GameStoreProvider {
  id: StoreId;
  displayName: string;
  supportsAuth: boolean;
  supportsManualImport: boolean;
  supportsBackgroundSync: boolean;
  accountPolicy?: AccountPolicy;

  getAuthState(): Promise<AuthState>;
  login(interactive: boolean): Promise<AuthState>;
  logout(): Promise<void>;
  refreshAuthIfNeeded(): Promise<AuthState>;

  importOwnedGames(signal?: AbortSignal): Promise<ProviderImportResult>;
}
