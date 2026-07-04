# GOG Playnite Reference Notes

Phase 8A uses `JosefNemec/PlayniteExtensions` as an architectural reference only:

- `source/Libraries/GogLibrary/GogLibrary.cs`
- `source/Libraries/GogLibrary/Services/GogAccountClient.cs`

## Reference Behavior From Playnite

- Account basic state is checked before import.
- The newer library stats path pages through `/u/{username}/games/stats`.
- Legacy fallback uses `/account/getFilteredProducts?hiddenFlag=0&mediaType=1&page={page}&sortBy=title`.
- Owned game details can be fetched from `/account/gameDetails/{gameId}.json`.

## Firefox-Safe Implementation Path

- The extension opens a normal GOG account tab and asks the user to sign in directly with GOG.
- `Check GOG login` uses browser-session `fetch` calls with `credentials: "include"` to GOG-owned endpoints.
- The extension never asks for a GOG password and does not read browser cookie storage.
- Import tries the newer stats endpoint first and can fall back to the legacy product endpoint.
- Manual import remains available if direct browser-session access is not feasible for a user's Firefox/GOG session.

## Deferred Or Unsupported Behavior

- Native WebView login is unsupported in a Firefox WebExtension.
- Cookie scraping and credential capture are unsupported.
- Importing GOG extras as separate games is disabled by default.

## Risks / Endpoint Verification Needed

- GOG endpoint shapes are unofficial and can change; API-shape failures are classified as `GOG_API_CHANGED`.
- GOG session access may be affected by browser partitioning or third-party cookie/session behavior.
- Automated tests use fixtures and mocks only; they do not call live GOG APIs.
