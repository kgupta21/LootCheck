export const epicPlayniteResearchNotes = {
  referenceBehaviorFromPlaynite: [
    "Playnite opens Epic login in a native WebView.",
    "The flow uses launcher-style OAuth behavior and receives an authorization code from a launcher redirect.",
    "The authorization code is exchanged for tokens and refreshed on token failures.",
    "Library items are paged, then catalog responses enrich each item and are cached.",
    "Filtering excludes UE namespace assets, private sandbox items, DLC, digital extras, plugins, and engine plugins."
  ],
  firefoxSafeImplementationPath: [
    "Use a Legendary-compatible browser authorization-code flow inside the extension.",
    "Store Epic tokens only in local extension storage and redact token-like values from diagnostics.",
    "Keep manual import available as a fallback.",
    "Use only synthetic fixtures for catalog/library filtering, token exchange, and mapping tests."
  ],
  deferredOrUnsupportedBehavior: ["Automatic browser.identity redirect capture is deferred.", "Native messaging integration with Legendary is not implemented."],
  risksAndEndpointVerificationNeeded: [
    "Launcher user agents and device identifiers from desktop clients are not used.",
    "Epic endpoint shapes and launcher-compatible authorization-code behavior can change without notice."
  ],
  phase8BDecision: "SUPERSEDED_BY_PHASE_8C",
  phase8CDecision: "LEGENDARY_COMPATIBLE_BROWSER_AUTH"
} as const;
