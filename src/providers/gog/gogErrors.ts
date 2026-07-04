import { makeProviderError } from "../../shared/errors";
import type { ProviderError } from "../../shared/types";

export type GogErrorCode =
  | "GOG_NOT_LOGGED_IN"
  | "GOG_ACCOUNT_MISMATCH"
  | "GOG_LIBRARY_PRIVATE_OR_UNAVAILABLE"
  | "GOG_LIBRARY_SESSION_MISSING"
  | "GOG_EMPTY_LIBRARY"
  | "GOG_EMPTY_LIBRARY_OR_PARSE_FAILED"
  | "GOG_LIBRARY_STATS_API_CHANGED"
  | "GOG_LIBRARY_STATS_EMPTY"
  | "GOG_LEGACY_API_CHANGED"
  | "GOG_LEGACY_EMPTY"
  | "GOG_RATE_LIMITED"
  | "GOG_NETWORK_ERROR"
  | "GOG_API_CHANGED"
  | "GOG_UNKNOWN";

export class GogProviderError extends Error {
  constructor(
    readonly gogCode: GogErrorCode,
    message: string,
    readonly retryable = false
  ) {
    super(message);
    this.name = "GogProviderError";
  }
}

export function gogCodeToProviderErrorCode(code: GogErrorCode): ProviderError["code"] {
  switch (code) {
    case "GOG_NOT_LOGGED_IN":
    case "GOG_ACCOUNT_MISMATCH":
    case "GOG_LIBRARY_SESSION_MISSING":
      return "AUTH_REQUIRED";
    case "GOG_RATE_LIMITED":
      return "RATE_LIMITED";
    case "GOG_NETWORK_ERROR":
      return "NETWORK_ERROR";
    case "GOG_LIBRARY_STATS_API_CHANGED":
    case "GOG_LEGACY_API_CHANGED":
    case "GOG_API_CHANGED":
      return "API_CHANGED";
    case "GOG_LIBRARY_PRIVATE_OR_UNAVAILABLE":
    case "GOG_EMPTY_LIBRARY":
    case "GOG_EMPTY_LIBRARY_OR_PARSE_FAILED":
    case "GOG_LIBRARY_STATS_EMPTY":
    case "GOG_LEGACY_EMPTY":
      return "IMPORT_INVALID";
    case "GOG_UNKNOWN":
      return "UNKNOWN";
  }
}

export function makeGogError(code: GogErrorCode, message: string, retryable = false): ProviderError {
  return makeProviderError("gog", gogCodeToProviderErrorCode(code), message, retryable);
}

export function toGogProviderError(error: unknown): GogProviderError {
  if (error instanceof GogProviderError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new GogProviderError("GOG_NETWORK_ERROR", "GOG request was cancelled or timed out.", true);
  }
  if (error instanceof TypeError) {
    return new GogProviderError("GOG_NETWORK_ERROR", error.message || "GOG network request failed.", true);
  }
  if (error instanceof Error) {
    return new GogProviderError("GOG_UNKNOWN", error.message, false);
  }
  return new GogProviderError("GOG_UNKNOWN", "Unknown GOG provider error.", false);
}

export function makeProviderErrorFromGog(error: unknown): ProviderError {
  const gogError = toGogProviderError(error);
  return makeGogError(gogError.gogCode, gogError.message, gogError.retryable);
}
