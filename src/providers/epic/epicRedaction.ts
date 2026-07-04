export function redactEpicSecrets(input: string): string {
  return input
    .replace(/(access_token["'\s:=]+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/(refresh_token["'\s:=]+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/(authorizationCode["'\s:=]+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/(authorization_code["'\s:=]+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/([?&]code=)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/(Authorization:\s*bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/(Authorization:\s*basic\s+)[A-Za-z0-9+/=._-]+/gi, "$1[REDACTED]")
    .replace(/(tokenAuthorizationHeader["'\s:=]+)[A-Za-z0-9+/=._-]+/gi, "$1[REDACTED]")
    .replace(/(sid["'\s:=]+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
}
