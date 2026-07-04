export const amazonPlayniteResearchNotes = {
  referenceBehaviorFromPlaynite: [
    "Playnite uses an Amazon sign-in WebView.",
    "It captures an OAuth-style authorization code, registers a desktop device, stores bearer tokens, and refreshes tokens.",
    "Entitlements are requested from an Amazon Games distribution endpoint and mapped to game records.",
    "Desktop installed games can be read from Amazon's local SQLite install database."
  ],
  firefoxSafeImplementationPath: [
    "Keep Amazon Games visible as a provider stub.",
    "Use manual import help until a safe browser-extension login path is verified.",
    "Do not copy Playnite device/client identifiers or launcher behavior into the extension."
  ],
  deferredOrUnsupportedBehavior: [
    "Amazon direct login, device registration, entitlement sync, and local desktop install DB access are deferred.",
    "Native desktop SQLite install database access is unavailable from a Firefox WebExtension."
  ],
  risksAndEndpointVerificationNeeded: [
    "Device registration/client identifiers must be verified for extension use before implementation.",
    "The extension must not capture credentials or scrape browser cookies."
  ]
} as const;
