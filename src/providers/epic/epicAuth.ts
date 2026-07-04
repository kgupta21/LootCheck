import { AuthTokenRepository } from "../../db/repositories";
import type { AuthState, AuthTokenRecord } from "../../shared/types";
import { buildEpicAuthCodeUrl, epicAuthConfig } from "./epicAuthConfig";
import { getEpicAccount } from "./epicApi";
import { EpicProviderError } from "./epicErrors";
import { EpicSettingsRepository } from "./epicSettings";
import { redactEpicSecrets } from "./epicRedaction";
import type { EpicAccount, EpicTokenRecord, EpicTokenResponse } from "./epicTypes";

const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function toFormBody(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

function scopesFromResponse(response: EpicTokenResponse): string[] {
  if (typeof response.scope === "string") {
    return response.scope.split(/\s+/).filter(Boolean);
  }
  if (Array.isArray(response.scope)) {
    return response.scope.filter((scope): scope is string => typeof scope === "string" && Boolean(scope.trim())).map((scope) => scope.trim());
  }
  return ["epic_library"];
}

function expiresAtFromResponse(response: EpicTokenResponse): string | undefined {
  return (
    response.expires_at ??
    (typeof response.expires_in === "number" && Number.isFinite(response.expires_in)
      ? new Date(Date.now() + Math.max(0, response.expires_in) * 1000).toISOString()
      : undefined)
  );
}

function assertTokenResponse(body: EpicTokenResponse): EpicTokenResponse {
  if (!body.access_token || !body.refresh_token || !body.account_id || !body.token_type) {
    throw new EpicProviderError("EPIC_INVALID_AUTH_CODE", "Epic token response shape changed.", false);
  }
  return body;
}

function requiredTokenResponse(body: EpicTokenResponse): Required<Pick<EpicTokenResponse, "access_token" | "refresh_token" | "account_id" | "token_type">> &
  EpicTokenResponse {
  assertTokenResponse(body);
  return body as Required<Pick<EpicTokenResponse, "access_token" | "refresh_token" | "account_id" | "token_type">> & EpicTokenResponse;
}

export function extractEpicAuthorizationCode(input: string): string {
  const trimmed = input.trim().replace(/^"|"$/g, "");

  if (!trimmed) {
    throw new EpicProviderError("EPIC_INVALID_AUTH_CODE", "Epic authorization code is empty.", false);
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["authorizationCode", "authorization_code", "code"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    }
  } catch {
    // Not JSON; continue with text parsing.
  }

  const authorizationCodeMatch = trimmed.match(/authorizationCode["'\s:=]+([A-Za-z0-9_-]+)/i);
  if (authorizationCodeMatch?.[1]) {
    return authorizationCodeMatch[1].trim();
  }

  const codeParamMatch = trimmed.match(/[?&]code=([A-Za-z0-9._%-]+)/i);
  if (codeParamMatch?.[1]) {
    return decodeURIComponent(codeParamMatch[1]).trim();
  }

  return trimmed;
}

export async function openEpicAuthorizationPage(): Promise<{ url: string; tabId?: number; message: string }> {
  const settings = await new EpicSettingsRepository().getSettings();
  const clientId = settings.oauthClientId?.trim();
  if (!clientId) {
    return {
      url: "",
      message: "Epic OAuth client ID is not configured. Save it in Epic settings before opening the authorization page."
    };
  }
  const authCodeUrl = buildEpicAuthCodeUrl(clientId);
  const tab = await browser.tabs.create({
    url: authCodeUrl,
    active: true
  });
  return {
    url: authCodeUrl,
    ...(tab.id !== undefined ? { tabId: tab.id } : {}),
    message:
      "Opened Epic authorization page. Log into Epic if prompted, copy the displayed authorizationCode, then paste it into LootCheck."
  };
}

export function epicTokenResponseToRecord(response: EpicTokenResponse, existingCreatedAt?: string): EpicTokenRecord {
  const now = nowIso();
  const tokenResponse = requiredTokenResponse(response);
  const expiresAt = expiresAtFromResponse(tokenResponse);
  return {
    providerId: "epic",
    accountId: tokenResponse.account_id,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    tokenType: tokenResponse.token_type,
    ...(expiresAt ? { expiresAt } : {}),
    createdAt: existingCreatedAt ?? now,
    updatedAt: now
  };
}

function authTokenRecordFromEpicToken(response: EpicTokenResponse, existingCreatedAt?: string): AuthTokenRecord {
  const record = epicTokenResponseToRecord(response, existingCreatedAt);
  return {
    providerId: "epic",
    accountId: record.accountId,
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    tokenType: record.tokenType,
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    scopes: scopesFromResponse(response),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

async function postEpicTokenForm(params: Record<string, string>, signal?: AbortSignal): Promise<EpicTokenResponse> {
  const settings = await new EpicSettingsRepository().getSettings();
  const tokenAuthorizationHeader = settings.tokenAuthorizationHeader?.trim();
  if (!tokenAuthorizationHeader) {
    throw new EpicProviderError("EPIC_INVALID_AUTH_CODE", "Epic token authorization header is not configured.", false);
  }
  const response = await fetch(epicAuthConfig.oauthUrl, {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      accept: "application/json",
      Authorization: tokenAuthorizationHeader,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: toFormBody(params)
  });
  const text = await response.text();

  if (!response.ok) {
    const safeMessage = redactEpicSecrets(`Epic token request failed: HTTP ${response.status} ${text}`);
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new EpicProviderError("EPIC_INVALID_AUTH_CODE", safeMessage, false);
    }
    if (response.status === 429) {
      throw new EpicProviderError("EPIC_RATE_LIMITED", safeMessage, true);
    }
    if (response.status >= 500) {
      throw new EpicProviderError("EPIC_NETWORK_ERROR", safeMessage, true);
    }
    throw new EpicProviderError("EPIC_API_CHANGED", safeMessage, false);
  }

  try {
    return assertTokenResponse(JSON.parse(text) as EpicTokenResponse);
  } catch (error) {
    if (error instanceof EpicProviderError) {
      throw error;
    }
    throw new EpicProviderError("EPIC_API_CHANGED", "Epic token response was not valid JSON.", false);
  }
}

export async function exchangeEpicAuthorizationCode(rawInput: string, signal?: AbortSignal): Promise<AuthTokenRecord> {
  const authorizationCode = extractEpicAuthorizationCode(rawInput);
  const tokenResponse = await postEpicTokenForm(
    {
      grant_type: "authorization_code",
      code: authorizationCode,
      token_type: "eg1"
    },
    signal
  );
  return authTokenRecordFromEpicToken(tokenResponse);
}

export async function refreshEpicToken(refreshToken: string, existingCreatedAt?: string, signal?: AbortSignal): Promise<AuthTokenRecord> {
  if (!refreshToken.trim()) {
    throw new EpicProviderError("EPIC_TOKEN_EXPIRED", "Epic refresh token is missing.", false);
  }
  const tokenResponse = await postEpicTokenForm(
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken.trim(),
      token_type: "eg1"
    },
    signal
  );
  return authTokenRecordFromEpicToken(tokenResponse, existingCreatedAt);
}

export function isEpicTokenExpiringSoon(token: AuthTokenRecord | EpicTokenRecord): boolean {
  if (!token.expiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(token.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return true;
  }

  return expiresAtMs - Date.now() < TOKEN_EXPIRY_SKEW_MS;
}

export async function startEpicLogin(interactive: boolean): Promise<AuthState> {
  const settings = await new EpicSettingsRepository().getSettings();
  if (!interactive) {
    return {
      providerId: "epic",
      status: "not_connected",
      lastCheckedAt: nowIso(),
      error: {
        providerId: "epic",
        code: "AUTH_REQUIRED",
        message: "Epic requires an explicit user login action before syncing.",
        retryable: false
      }
    };
  }
  return {
    providerId: "epic",
    status: "needs_reauth",
    ...(settings.accountId ? { accountId: settings.accountId } : {}),
    ...(settings.displayName ? { accountName: settings.displayName } : {}),
    lastCheckedAt: nowIso()
  };
}

export async function validateEpicAccount(tokens: AuthTokenRecord, signal?: AbortSignal): Promise<EpicAccount> {
  return getEpicAccount(tokens, signal);
}

export async function logoutEpic(): Promise<void> {
  await new AuthTokenRepository().deleteProviderAuthTokens("epic");
  await new EpicSettingsRepository().clearSettings();
}

export async function getStoredEpicToken(accountId?: string): Promise<AuthTokenRecord | undefined> {
  const repository = new AuthTokenRepository();
  if (accountId) {
    return repository.getAuthToken("epic", accountId);
  }
  const tokens = await repository.listProviderAuthTokens("epic");
  return tokens[0];
}

export async function getValidEpicToken(interactive = false, signal?: AbortSignal): Promise<AuthTokenRecord> {
  signal?.throwIfAborted();
  const settings = await new EpicSettingsRepository().getSettings();
  const repository = new AuthTokenRepository();
  const token = await getStoredEpicToken(settings.accountId);
  if (!token?.accessToken || !token.refreshToken || !token.accountId) {
    if (interactive) {
      await startEpicLogin(true);
    }
    throw new EpicProviderError("EPIC_AUTH_REQUIRED", "Connect Epic before syncing.", false);
  }
  if (!isEpicTokenExpiringSoon(token)) {
    return token;
  }
  try {
    const refreshed = await refreshEpicToken(token.refreshToken, token.createdAt, signal);
    await repository.saveAuthToken(refreshed);
    return refreshed;
  } catch (error) {
    await repository.deleteAuthToken("epic", token.accountId);
    throw error;
  }
}
