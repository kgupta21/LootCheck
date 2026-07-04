import type { ProviderError, StoreId } from "./types";
import { redactEpicSecrets } from "../providers/epic/epicRedaction";

const TOKEN_LIKE_PATTERN =
  /([A-Fa-f0-9]{32}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}|(?:authorization:\s*basic\s+)[^\s"',}]+|(?:authorization:\s*bearer\s+)[^\s"',}]+|(?:code=)[^&#\s]+|(?:authorizationCode|access_token|refresh_token|id_token|accessToken|refreshToken|idToken|sid)["'=:\s]+["']?[^"'\s,}]+|([?&](?:key|api_key|apikey)=)([^&#\s]+))/gi;

export function redactSensitiveText(value: string): string {
  return redactEpicSecrets(value).replace(TOKEN_LIKE_PATTERN, (match, _token, keyPrefix) =>
    keyPrefix ? `${keyPrefix}[redacted]` : "[redacted]"
  );
}

export function makeProviderError(
  providerId: StoreId,
  code: ProviderError["code"],
  message: string,
  retryable = false
): ProviderError {
  return {
    providerId,
    code,
    message: redactSensitiveText(message),
    retryable
  };
}

export function isProviderError(value: unknown): value is ProviderError {
  if (!value || typeof value !== "object") {
    return false;
  }
  const error = value as Partial<ProviderError>;
  return (
    typeof error.providerId === "string" &&
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.retryable === "boolean"
  );
}

export function redactSensitiveError(error: unknown, fallbackProviderId: StoreId = "manual"): ProviderError {
  if (isProviderError(error)) {
    return {
      ...error,
      message: redactSensitiveText(error.message)
    };
  }
  if (error instanceof Error) {
    return makeProviderError(fallbackProviderId, "UNKNOWN", error.message, false);
  }
  return makeProviderError(fallbackProviderId, "UNKNOWN", "Unknown provider error.", false);
}

export function redactSensitiveValue<T>(value: T): T | string {
  if (typeof value === "string") {
    return redactSensitiveText(value) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value), (_key, nested) =>
      typeof nested === "string" ? redactSensitiveText(nested) : nested
    ) as T;
  } catch {
    return "[unserializable]";
  }
}
