# Epic Games Playnite Reference Notes

Phase 8A uses `JosefNemec/PlayniteExtensions` as an architectural reference only:

- `source/Libraries/EpicLibrary/EpicLibrary.cs`
- `source/Libraries/EpicLibrary/Services/EpicAccountClient.cs`

## Reference Behavior From Playnite

1. User opens Epic login in a native WebView.
2. Playnite uses launcher-style browser/client behavior.
3. Login produces an authorization code from a launcher redirect.
4. Authorization code is exchanged for tokens.
5. Tokens are refreshed on token errors.
6. Library items endpoint returns paged records.
7. Catalog endpoint enriches each item.
8. Catalog responses are cached.
9. Assets are filtered to exclude UE namespace, private sandbox items, DLC, digital extras, plugins, and engine plugins.
10. Valid assets map to local games by app name and catalog title.

## Firefox-Safe Implementation Path

- Epic uses a Legendary-compatible user-driven authorization-code flow inside the extension.
- LootCheck opens Epic's login/redirect URL in the browser, then the user pastes the returned authorization code into the Epic provider card.
- LootCheck exchanges and refreshes tokens in the background script and stores them only in local extension storage.
- Manual JSON/CSV import remains the fallback.
- Catalog/library filtering and mapping helpers are covered with synthetic fixtures only.

## Deferred Or Unsupported Behavior

- `browser.identity.launchWebAuthFlow` pending a clean redirect/callback contract.
- Running Legendary directly from the extension without a native messaging host.
- Fully automatic redirect capture through `browser.identity.launchWebAuthFlow`.
- Launcher user-agent/client emulation.
- Device identifiers and cookie scraping.

## Risks / Endpoint Verification Needed

- Playnite is a desktop app with native WebView behavior; its login path does not directly map to a Firefox extension.
- Endpoint shapes and OAuth requirements can change without notice.
- The Legendary-compatible token exchange depends on Epic continuing to accept the current browser authorization-code behavior.
- UI, logs, diagnostics, and messages must never expose tokens or credentials.
