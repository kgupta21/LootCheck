import { makeProviderError } from "../../shared/errors";
import type { AuthState, ProviderImportResult } from "../../shared/types";
import type { GameStoreProvider } from "../Provider";

function nowIso(): string {
  return new Date().toISOString();
}

export class AmazonProvider implements GameStoreProvider {
  id = "amazon" as const;
  displayName = "Amazon Games";
  supportsAuth = false;
  supportsManualImport = true;
  supportsBackgroundSync = false;
  accountPolicy = "single_active_account" as const;

  async getAuthState(): Promise<AuthState> {
    return {
      providerId: this.id,
      status: "not_supported",
      lastCheckedAt: nowIso(),
      error: makeProviderError(
        this.id,
        "UNSUPPORTED",
        "Amazon Games background login is not implemented yet. Use browser-session import or manual import.",
        false
      )
    };
  }

  async login(): Promise<AuthState> {
    throw makeProviderError(this.id, "UNSUPPORTED", "Amazon Games direct login not implemented yet.", false);
  }

  async logout(): Promise<void> {
    return undefined;
  }

  async refreshAuthIfNeeded(): Promise<AuthState> {
    return this.getAuthState();
  }

  async importOwnedGames(): Promise<ProviderImportResult> {
    throw makeProviderError(this.id, "UNSUPPORTED", "Amazon Games direct library import is not implemented yet.", false);
  }
}
