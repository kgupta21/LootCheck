# Epic Provider Feasibility

## Summary Decision

LEGENDARY_COMPATIBLE_BROWSER_AUTH

Phase 8C uses the same Epic authorization-code pattern used by Legendary, but implemented inside the Firefox extension. LootCheck opens Epic's login/redirect URL in the browser, accepts the returned authorization code, exchanges it in the background script, stores Epic access/refresh tokens locally, and imports the library through Epic account/library/catalog endpoints.

## Playnite Reference Behavior

Playnite's Epic integration is a desktop-client flow:

1. Opens Epic login in a native WebView.
2. Uses launcher-style request behavior.
3. Captures an authorization code from a launcher redirect.
4. Exchanges that authorization code for tokens.
5. Refreshes tokens.
6. Calls Epic library item endpoints.
7. Paginates library records.
8. Fetches catalog metadata.
9. Caches catalog responses.
10. Filters Unreal Engine namespace assets, private sandbox assets, DLC, digital extras, plugins, engine plugins, and some partner-linked records.
11. Maps remaining assets to local games.

## Firefox Extension Constraints

Playnite's desktop WebView behavior does not directly map to Firefox. A WebExtension also cannot execute a local command-line tool without a native messaging host. Phase 8C therefore ports the browser authorization-code part of the Legendary-style flow into the extension instead of trying to run Legendary itself.

## Safe Auth Options Considered

### Option A: browser.identity.launchWebAuthFlow

- User experience: user clicks a connect button and completes Epic login in a browser-mediated OAuth window.
- Required permissions: `identity` and narrow Epic auth hosts if a valid redirect/callback flow exists.
- Token handling: would require local encrypted/extension storage and refresh handling.
- Risks: requires a clean extension redirect/callback contract.
- Acceptable: deferred until an audited extension client exists.

### Option B: user opens Epic login tab, extension checks session endpoint

- User experience: user signs in directly on epicgames.com, then clicks a check button.
- Required permissions: narrow Epic account/library hosts.
- Token handling: ideally none if session-backed endpoints are safely usable.
- Risks: endpoint stability and CORS/session behavior are unverified; cookie scraping is not allowed.
- Acceptable: possible future spike only after endpoint behavior is verified without cookie access.

### Option C: user-pasted authorization code

- User experience: user manually copies a code from Epic auth redirect.
- Required permissions: potentially fewer browser permissions.
- Token handling: would exchange an authorization code for tokens and store access/refresh tokens locally.
- Risks: depends on Epic continuing to support the launcher-compatible authorization-code behavior and the related library endpoints.
- Acceptable: yes for this phase, with explicit user action and local-only token storage.

### Option D: manual import only

- User experience: user imports a JSON/CSV list manually.
- Required permissions: none beyond existing local import.
- Token handling: none.
- Risks: manual maintenance burden.
- Acceptable: yes as fallback.

### Option E: Legendary CLI JSON import

- User experience: user runs `legendary auth`, then `legendary list --json > legendary-library.json`, then imports that file in LootCheck.
- Required permissions: none beyond local file import.
- Token handling: Legendary manages Epic tokens in its own local config; LootCheck does not read or store them.
- Risks: requires a local CLI step and JSON output shape may change.
- Acceptable: fallback only; not the active Phase 8C implementation.

## Endpoint Verification

| Endpoint or area | Purpose | Auth required | Documented or undocumented | Production use allowed | Test fixture added |
| --- | --- | --- | --- | --- | --- |
| Epic login/redirect URL | User-driven browser login and authorization code | Epic browser login | Undocumented launcher-compatible behavior | Used with explicit user action | Unit tests for URL construction and message handler |
| Epic OAuth/token endpoint | Exchange authorization code and refresh tokens | Yes | Legendary-derived endpoint pattern | Used in background script | Mocked tests only |
| Epic account endpoint | Verify active account | Yes | Legendary-derived endpoint pattern | Used in background script | Synthetic fixture |
| Epic library endpoint | Owned library records | Yes | Legendary-derived endpoint pattern | Used in background script | Synthetic fixtures |
| Epic catalog endpoint | Catalog title/category enrichment | Yes | Legendary-derived endpoint pattern | Used in background script | Synthetic fixtures |
| Epic playtime endpoint | Optional playtime metadata | Yes | Legendary-derived endpoint pattern | Used in background script | Synthetic fixture |

## Recommended Implementation Plan

1. Keep the user-driven authorization-code flow as the only Epic connection path.
2. Store Epic tokens only in local extension storage and redact all token-like values from diagnostics/errors.
3. Use refresh tokens for background sync after the user connects.
4. Keep manual JSON/CSV import available as a fallback.
5. Revisit `browser.identity.launchWebAuthFlow` only if a clean extension redirect/callback contract is verified.

## Deferred Items

- `browser.identity.launchWebAuthFlow` remains deferred until a clean Epic redirect/callback contract is available.
- Native messaging integration with Legendary is not implemented.
- Amazon Games direct login remains deferred.
- Launcher user agents and device identifiers remain unsupported.

## Security Guardrails

- Do not scrape cookies.
- Do not capture Epic usernames or passwords.
- Store Epic tokens only in local extension storage.
- Do not expose Epic token material, authorization codes, or the token authorization header in UI, diagnostics, messages, logs, or exports.
- Do not call live Epic APIs in automated tests.
- Do not add broad host permissions.
- Do not add analytics or an external backend.
