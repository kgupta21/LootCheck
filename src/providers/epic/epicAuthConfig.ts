export interface EpicAuthConfig {
  oauthUrl: string;
  accountUrl: string;
  libraryItemsUrl: string;
  catalogUrl: string;
  playtimeUrl: string;
}

export const epicAuthConfig: EpicAuthConfig = {
  oauthUrl: "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token",
  accountUrl: "https://account-public-service-prod03.ol.epicgames.com/account/api/public/account",
  libraryItemsUrl:
    "https://library-service.live.use1a.on.epicgames.com/library/api/public/items?includeMetadata=true&platform=Windows",
  catalogUrl: "https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace",
  playtimeUrl: "https://library-service.live.use1a.on.epicgames.com/library/api/public/playtime/account/{accountId}/all"
};

export const EPIC_ENDPOINTS = epicAuthConfig;

export function buildEpicAuthCodeUrl(clientId: string): string {
  const redirectUrl = new URL("https://www.epicgames.com/id/api/redirect");
  redirectUrl.searchParams.set("clientId", clientId);
  redirectUrl.searchParams.set("responseType", "code");

  const loginUrl = new URL("https://www.epicgames.com/id/login");
  loginUrl.searchParams.set("redirectUrl", redirectUrl.toString());
  return loginUrl.toString();
}

export const EPIC_AUTH_CONFIG_NOTES = [
  "Phase 8C uses a Legendary-compatible user-pasted authorization-code flow inside the extension.",
  "The Epic OAuth client ID and token authorization header are stored only in local extension settings and must never be shown in diagnostics, logs, or exports.",
  "The extension never asks for or captures an Epic password and never reads Firefox cookie storage."
];
