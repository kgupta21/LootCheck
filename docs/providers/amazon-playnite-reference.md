# Amazon Games Playnite Reference Notes

Phase 8A uses `JosefNemec/PlayniteExtensions` as an architectural reference only:

- `source/Libraries/AmazonGamesLibrary/AmazonGamesLibrary.cs`
- `source/Libraries/AmazonGamesLibrary/Services/AmazonAccountClient.cs`

## Reference Behavior From Playnite

1. Amazon sign-in opens in a native WebView.
2. OAuth-style authorization code capture follows sign-in.
3. Device registration is performed with an Amazon auth endpoint.
4. Bearer tokens are stored locally.
5. Tokens are refreshed as needed.
6. Entitlements are requested from an Amazon Games distribution endpoint.
7. Entitlements map to game records.
8. Installed desktop games can be read from Amazon's local SQLite install database.

## Firefox-Safe Implementation Path

- Amazon Games remains a visible provider stub in Phase 8A.
- Manual import remains the safe fallback.
- Direct login requires a verified browser-extension flow that does not capture credentials.
- No Amazon tokens, device identifiers, or copied launcher/client identifiers are stored.

## Deferred Or Unsupported Behavior

- Direct Amazon Games login.
- Device registration.
- Token storage and refresh.
- Entitlements import.
- Native desktop SQLite install database reads.

## Risks / Endpoint Verification Needed

- Native desktop install databases are unavailable to Firefox WebExtensions.
- Device registration and client identifiers from Playnite are desktop-app specific and must not be copied blindly.
- The extension must not capture credentials or scrape cookies.
- Endpoint behavior must be verified against current Amazon Games web/API behavior before any direct provider implementation.
