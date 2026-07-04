import { makeProviderError } from "../../shared/errors";
import type { ProviderError } from "../../shared/types";

export type EpicErrorCode =
  | "EPIC_AUTH_REQUIRED"
  | "EPIC_DIRECT_SYNC_UNSUPPORTED"
  | "EPIC_TOKEN_EXPIRED"
  | "EPIC_INVALID_AUTH_CODE"
  | "EPIC_ACCOUNT_MISMATCH"
  | "EPIC_LIBRARY_UNAVAILABLE"
  | "EPIC_EMPTY_LIBRARY"
  | "EPIC_CATALOG_ITEM_MISSING"
  | "EPIC_RATE_LIMITED"
  | "EPIC_NETWORK_ERROR"
  | "EPIC_API_CHANGED"
  | "EPIC_UNKNOWN";

const ERROR_CODE_MAP: Record<EpicErrorCode, ProviderError["code"]> = {
  EPIC_AUTH_REQUIRED: "AUTH_REQUIRED",
  EPIC_DIRECT_SYNC_UNSUPPORTED: "UNSUPPORTED",
  EPIC_TOKEN_EXPIRED: "TOKEN_EXPIRED",
  EPIC_INVALID_AUTH_CODE: "AUTH_REQUIRED",
  EPIC_ACCOUNT_MISMATCH: "AUTH_REQUIRED",
  EPIC_LIBRARY_UNAVAILABLE: "UNKNOWN",
  EPIC_EMPTY_LIBRARY: "UNKNOWN",
  EPIC_CATALOG_ITEM_MISSING: "UNKNOWN",
  EPIC_RATE_LIMITED: "RATE_LIMITED",
  EPIC_NETWORK_ERROR: "NETWORK_ERROR",
  EPIC_API_CHANGED: "API_CHANGED",
  EPIC_UNKNOWN: "UNKNOWN"
};

export class EpicProviderError extends Error implements ProviderError {
  providerId = "epic" as const;
  code: ProviderError["code"];
  retryable: boolean;
  epicCode: EpicErrorCode;

  constructor(epicCode: EpicErrorCode, message: string, retryable = false) {
    const providerError = makeProviderError("epic", ERROR_CODE_MAP[epicCode], message, retryable);
    super(providerError.message);
    this.name = "EpicProviderError";
    this.code = providerError.code;
    this.retryable = providerError.retryable;
    this.epicCode = epicCode;
  }
}

export function makeEpicError(epicCode: EpicErrorCode, message: string, retryable = false): EpicProviderError {
  return new EpicProviderError(epicCode, message, retryable);
}

export function toEpicProviderError(error: unknown): EpicProviderError {
  if (error instanceof EpicProviderError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new EpicProviderError("EPIC_NETWORK_ERROR", "Epic request was aborted.", false);
  }
  if (error instanceof TypeError) {
    return new EpicProviderError("EPIC_NETWORK_ERROR", error.message || "Epic network request failed.", true);
  }
  if (error instanceof Error) {
    return new EpicProviderError("EPIC_UNKNOWN", error.message, false);
  }
  return new EpicProviderError("EPIC_UNKNOWN", "Unknown Epic provider error.", false);
}
