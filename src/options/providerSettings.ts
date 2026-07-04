import type {
  EpicProviderSettings,
  GameRecord,
  GogProviderSettings,
  ProviderStatus,
  ProviderSummary,
  SteamProviderSettings,
  StoreId,
  SyncRun,
  SyncSettings
} from "../shared/types";
import { latestWarningText } from "./providerWarningText";

const providerGrid = document.querySelector<HTMLElement>("#provider-status-grid")!;
const scheduledSyncEnabledInput = document.querySelector<HTMLInputElement>("#scheduled-sync-enabled")!;
const scheduledSyncIntervalInput = document.querySelector<HTMLInputElement>("#scheduled-sync-interval")!;
const scheduledSyncProviders = document.querySelector<HTMLElement>("#scheduled-sync-providers")!;
const saveSyncSettingsButton = document.querySelector<HTMLButtonElement>("#save-sync-settings-button")!;

type StatusCallback = (message: string) => void;
type DataChangedCallback = () => Promise<void>;

async function sendMessage<T>(message: unknown): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}

function formatDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleString() : "Never";
}

function statusText(status: ProviderStatus): string {
  if (status.authState.status === "not_supported") {
    return status.authState.error?.message ?? "Direct login is not available yet.";
  }
  return status.authState.status.replace(/_/g, " ");
}

function epicAuthStatusMessage(authState: ProviderStatus["authState"]): string {
  if (authState.status === "connected") {
    return `Connected Epic${authState.accountName ? ` as ${authState.accountName}` : ""}.`;
  }
  return `Epic auth failed: ${authState.error?.message ?? authState.status.replace(/_/g, " ")}.`;
}

function syncRunStatusMessage(run: SyncRun): string {
  if (run.status === "success") {
    return `Finished ${run.providerId} sync. Imported ${run.importedCount} games.`;
  }
  if (run.status === "partial") {
    return `Finished ${run.providerId} sync with ${run.warningCount} warnings. Imported ${run.importedCount} games.`;
  }
  if (run.status === "failed") {
    return `${run.providerId} sync failed: ${run.error ?? "Unknown error."}`;
  }
  return `${run.providerId} sync is running.`;
}

async function exportCompleteLibraryJson(): Promise<number> {
  const result = await sendMessage<{ payload: { exportedAt: string; games: GameRecord[] } }>({ type: "EXPORT_LIBRARY_JSON" });
  const blob = new Blob([JSON.stringify(result.payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `lootcheck-complete-library-${result.payload.exportedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return result.payload.games.length;
}

function renderProviderCard(status: ProviderStatus, onStatus: StatusCallback, onDataChanged?: DataChangedCallback): HTMLElement {
  const card = document.createElement("article");
  card.className = status.authState.status === "not_supported" ? "provider-card muted" : "provider-card";

  const heading = document.createElement("h3");
  heading.textContent = status.displayName;

  const details = document.createElement("dl");
  const rows: Array<[string, string]> = [
    ["Auth", statusText(status)],
    ["Last sync", status.latestSyncRun ? `${status.latestSyncRun.status} at ${formatDate(status.latestSyncRun.finishedAt)}` : "Never"],
    ["Imported", String(status.importedGameCount)],
    ["Stale", String(status.staleGameCount ?? 0)]
  ];
  if (status.authState.accountName) {
    rows.splice(1, 0, ["Account", status.authState.accountName]);
  }
  const warningText = status.id === "gog" ? latestWarningText(status.latestWarnings?.[0]) : undefined;
  if (warningText) {
    rows.push(["Latest warning", warningText]);
  }
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    details.append(term, description);
  }

  const actions = document.createElement("div");
  actions.className = "filter-actions";

  if (status.supportsAuth && !["steam", "gog", "epic"].includes(status.id)) {
    const connect = document.createElement("button");
    connect.type = "button";
    connect.textContent = status.id === "amazon" ? "Amazon Games direct login not implemented yet" : "Connect";
    connect.disabled = status.authState.status === "not_supported";
    connect.title = status.authState.status === "not_supported" ? "Direct login is not implemented yet." : "Connect provider";
    actions.append(connect);
  }

  if (status.authState.status === "connected" && status.supportsAuth) {
    const disconnect = document.createElement("button");
    disconnect.type = "button";
    disconnect.textContent = "Disconnect";
    actions.append(disconnect);
  }

  if (status.supportsBackgroundSync) {
    const sync = document.createElement("button");
    sync.type = "button";
    sync.textContent = "Sync now";
    sync.addEventListener("click", async () => {
      onStatus(`Syncing ${status.displayName}...`);
      const result = await sendMessage<{ payload: { syncRun: SyncRun } }>({ type: "SYNC_PROVIDER", payload: { providerId: status.id } });
      await refreshProviderSettings(onStatus);
      onStatus(syncRunStatusMessage(result.payload.syncRun));
    });
    actions.append(sync);
  }

  card.append(heading, details);
  if (status.id === "steam") {
    const steamSettingsHost = document.createElement("div");
    steamSettingsHost.className = "provider-settings-form";
    void renderSteamSettings(steamSettingsHost, onStatus, onDataChanged);
    card.append(steamSettingsHost);
  }
  if (status.id === "gog") {
    const gogSettingsHost = document.createElement("div");
    gogSettingsHost.className = "provider-settings-form";
    void renderGogSettings(gogSettingsHost, status, onStatus);
    card.append(gogSettingsHost);
  }
  if (status.id === "epic") {
    const epicSettingsHost = document.createElement("div");
    epicSettingsHost.className = "provider-settings-form";
    void renderEpicSettings(epicSettingsHost, status, onStatus, onDataChanged);
    card.append(epicSettingsHost);
  }
  if (status.id === "amazon") {
    const amazonSettingsHost = document.createElement("div");
    amazonSettingsHost.className = "provider-settings-form";
    void renderAmazonSettings(amazonSettingsHost, status, onStatus, onDataChanged);
    card.append(amazonSettingsHost);
  }
  card.append(actions);
  return card;
}

function inputField(labelText: string, type: string, value = ""): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  label.append(input);
  return { label, input };
}

async function renderSteamSettings(host: HTMLElement, onStatus: StatusCallback, onDataChanged?: DataChangedCallback): Promise<void> {
  const response = await sendMessage<{ payload: { settings: SteamProviderSettings } }>({ type: "GET_STEAM_SETTINGS" });
  const settings = response.payload.settings;
  host.replaceChildren();

  const identity = inputField("Steam profile / SteamID", "text", settings.profileUrl ?? settings.steamId64 ?? settings.vanityName ?? "");
  identity.input.placeholder = "7656119..., profile URL, or vanity";

  const apiKey = inputField("Steam Web API key", "password");
  apiKey.input.placeholder = settings.apiKeyStored ? "API key saved" : "Optional API key";

  const freeLabel = document.createElement("label");
  freeLabel.className = "checkbox-label";
  const freeInput = document.createElement("input");
  freeInput.type = "checkbox";
  freeInput.checked = settings.includeFreeGames;
  freeLabel.append(freeInput, "Include played free games");

  const appInfoLabel = document.createElement("label");
  appInfoLabel.className = "checkbox-label";
  const appInfoInput = document.createElement("input");
  appInfoInput.type = "checkbox";
  appInfoInput.checked = settings.includeAppInfo;
  appInfoLabel.append(appInfoInput, "Include app info");

  const help = document.createElement("p");
  help.textContent = `SteamID64: ${settings.steamId64 ?? "not resolved"}. API key saved: ${settings.apiKeyStored ? "yes" : "no"}. Use browser-session import to import without a Steam Web API key. The API key path remains available for background sync and is stored locally.`;

  const actions = document.createElement("div");
  actions.className = "filter-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save Steam settings";
  save.addEventListener("click", async () => {
    onStatus("Saving Steam settings...");
    await sendMessage({
      type: "SAVE_STEAM_SETTINGS",
      payload: {
        identityInput: identity.input.value,
        apiKey: apiKey.input.value || undefined,
        includeFreeGames: freeInput.checked,
        includeAppInfo: appInfoInput.checked
      }
    });
    await refreshProviderSettings(onStatus);
    onStatus("Saved Steam settings.");
  });

  const clearKey = document.createElement("button");
  clearKey.type = "button";
  clearKey.textContent = "Clear saved API key";
  clearKey.disabled = !settings.apiKeyStored;
  clearKey.addEventListener("click", async () => {
    await sendMessage({ type: "CLEAR_STEAM_API_KEY" });
    await refreshProviderSettings(onStatus);
    onStatus("Cleared saved Steam API key.");
  });

  const test = document.createElement("button");
  test.type = "button";
  test.textContent = "Test Steam settings";
  test.addEventListener("click", async () => {
    onStatus("Testing Steam settings...");
    await sendMessage({
      type: "TEST_STEAM_SETTINGS",
      payload: {
        identityInput: identity.input.value,
        apiKey: apiKey.input.value || undefined,
        includeFreeGames: freeInput.checked,
        includeAppInfo: appInfoInput.checked
      }
    });
    onStatus("Steam settings test succeeded.");
  });

  const clearSettings = document.createElement("button");
  clearSettings.type = "button";
  clearSettings.textContent = "Clear Steam settings";
  clearSettings.addEventListener("click", async () => {
    await sendMessage({ type: "CLEAR_STEAM_SETTINGS" });
    await refreshProviderSettings(onStatus);
    onStatus("Cleared Steam settings.");
  });

  const rebuildCache = document.createElement("button");
  rebuildCache.type = "button";
  rebuildCache.textContent = "Rebuild Steam metadata cache";
  rebuildCache.addEventListener("click", async () => {
    await sendMessage({ type: "REBUILD_STEAM_METADATA_CACHE" });
    onStatus("Cleared Steam metadata cache. It will rebuild on the next Steam sync.");
  });

  const openSteam = document.createElement("button");
  openSteam.type = "button";
  openSteam.textContent = "Open Steam login / library";
  openSteam.addEventListener("click", async () => {
    const result = await sendMessage<{ payload: { message: string } }>({ type: "OPEN_STEAM_LOGIN_OR_LIBRARY" });
    onStatus(result.payload.message);
  });

  const importSteamSession = document.createElement("button");
  importSteamSession.type = "button";
  importSteamSession.textContent = "Import from current Steam session";
  importSteamSession.addEventListener("click", async () => {
    onStatus("Importing Steam games from the current browser session...");
    const result = await sendMessage<{ payload: { syncRun: SyncRun } }>({ type: "START_STEAM_ASSISTED_IMPORT" });
    await onDataChanged?.();
    await refreshProviderSettings(onStatus, onDataChanged);
    onStatus(syncRunStatusMessage(result.payload.syncRun));
  });

  actions.append(save, openSteam, importSteamSession, test, clearKey, clearSettings, rebuildCache);
  host.append(identity.label, apiKey.label, freeLabel, appInfoLabel, help, actions);
}

async function renderGogSettings(host: HTMLElement, status: ProviderStatus, onStatus: StatusCallback): Promise<void> {
  const response = await sendMessage<{ payload: { settings: GogProviderSettings } }>({ type: "GET_GOG_SETTINGS" });
  const settings = response.payload.settings;
  host.replaceChildren();

  const help = document.createElement("p");
  help.textContent = settings.directAuthSupported
    ? "Open GOG in a browser tab, sign in there, then return here and check the login. LootCheck never asks for your GOG password or reads browser cookies directly."
    : "Direct GOG login is not available in this Firefox extension yet. Use manual import for now.";

  const extrasLabel = document.createElement("label");
  extrasLabel.className = "checkbox-label";
  const extrasInput = document.createElement("input");
  extrasInput.type = "checkbox";
  extrasInput.checked = settings.importExtras;
  extrasLabel.append(extrasInput, "Import GOG extras");

  const legacyLabel = document.createElement("label");
  legacyLabel.className = "checkbox-label";
  const legacyInput = document.createElement("input");
  legacyInput.type = "checkbox";
  legacyInput.checked = settings.useLegacyFallback;
  legacyLabel.append(legacyInput, "Use legacy fallback");

  const rawLabel = document.createElement("label");
  rawLabel.className = "checkbox-label";
  const rawInput = document.createElement("input");
  rawInput.type = "checkbox";
  rawInput.checked = settings.allowRawProviderResponses;
  rawLabel.append(rawInput, "Store raw GOG responses for debugging");

  const actions = document.createElement("div");
  actions.className = "filter-actions";

  const openLogin = document.createElement("button");
  openLogin.type = "button";
  openLogin.textContent = "Connect / Open GOG login";
  openLogin.addEventListener("click", async () => {
    const result = await sendMessage<{ payload: { loginUrl: string } }>({ type: "OPEN_GOG_LOGIN" });
    window.open(result.payload.loginUrl, "_blank", "noopener");
    onStatus("Opened GOG login. Sign in there, then click Check GOG login.");
  });

  const checkLogin = document.createElement("button");
  checkLogin.type = "button";
  checkLogin.textContent = "Check GOG login";
  checkLogin.addEventListener("click", async () => {
    onStatus("Checking GOG login...");
    const result = await sendMessage<{ payload: { authState: ProviderStatus["authState"] } }>({ type: "CHECK_GOG_LOGIN" });
    if (result.payload.authState.error?.code === "AUTH_REQUIRED" && result.payload.authState.error.message.includes("different GOG account")) {
      const keep = window.confirm(
        "A different GOG account is signed in. Press OK to replace and keep existing imported games as stale, or Cancel to replace and remove old GOG games."
      );
      await sendMessage({ type: "CHECK_GOG_LOGIN", payload: { replaceExisting: keep ? "keep" : "remove" } });
    }
    await refreshProviderSettings(onStatus);
    onStatus("Finished GOG login check.");
  });

  const testEndpoints = document.createElement("button");
  testEndpoints.type = "button";
  testEndpoints.textContent = "Test GOG library endpoints";
  testEndpoints.addEventListener("click", async () => {
    onStatus("Testing GOG library endpoints...");
    const result = await sendMessage<{
      payload: {
        warnings: Array<{ code: string; message: string }>;
        endpointTrace: Array<{ endpointKey: string; result: string; httpStatus?: number; contentType?: string; itemCount?: number }>;
        newApiItemCount: number;
        legacyItemCount: number;
      };
    }>({ type: "TEST_GOG_LIBRARY_ENDPOINTS" });
    const warning = result.payload.warnings[0];
    const traceSummary = result.payload.endpointTrace
      .map((trace) => `${trace.endpointKey}: ${trace.result}${trace.httpStatus ? ` ${trace.httpStatus}` : ""}${trace.itemCount !== undefined ? ` (${trace.itemCount} items)` : ""}`)
      .join("; ");
    onStatus(
      warning
        ? `GOG endpoint test warning ${warning.code}: ${warning.message}`
        : `GOG endpoint test finished. New API items: ${result.payload.newApiItemCount}. Legacy items: ${result.payload.legacyItemCount}. ${traceSummary}`
    );
    await refreshProviderSettings(onStatus);
  });

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save GOG settings";
  save.addEventListener("click", async () => {
    await sendMessage({
      type: "SAVE_GOG_SETTINGS",
      payload: {
        importExtras: extrasInput.checked,
        useLegacyFallback: legacyInput.checked,
        allowRawProviderResponses: rawInput.checked
      }
    });
    await refreshProviderSettings(onStatus);
    onStatus("Saved GOG settings.");
  });

  const disconnect = document.createElement("button");
  disconnect.type = "button";
  disconnect.textContent = "Disconnect GOG";
  disconnect.disabled = status.authState.status === "not_connected";
  disconnect.addEventListener("click", async () => {
    await sendMessage({ type: "DISCONNECT_GOG" });
    await refreshProviderSettings(onStatus);
    onStatus("Disconnected GOG.");
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove GOG imported games";
  remove.disabled = status.importedGameCount === 0 && (status.staleGameCount ?? 0) === 0;
  remove.addEventListener("click", async () => {
    if (!window.confirm("Remove all imported GOG games from the local library?")) {
      return;
    }
    await sendMessage({ type: "REMOVE_GOG_IMPORTED_GAMES" });
    await refreshProviderSettings(onStatus);
    onStatus("Removed imported GOG games.");
  });

  const exportDiagnostics = document.createElement("button");
  exportDiagnostics.type = "button";
  exportDiagnostics.textContent = "Export sanitized GOG diagnostics";
  exportDiagnostics.addEventListener("click", async () => {
    const result = await sendMessage<{ payload: { diagnostics: unknown } }>({ type: "EXPORT_GOG_DIAGNOSTICS" });
    const blob = new Blob([JSON.stringify(result.payload.diagnostics, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lootcheck-gog-diagnostics.json";
    link.click();
    URL.revokeObjectURL(url);
    onStatus("Exported GOG diagnostics.");
  });

  actions.append(openLogin, checkLogin, testEndpoints, save, disconnect, remove, exportDiagnostics);
  host.append(help, extrasLabel, legacyLabel, rawLabel, actions);
}

async function renderEpicSettings(
  host: HTMLElement,
  status: ProviderStatus,
  onStatus: StatusCallback,
  onDataChanged?: DataChangedCallback
): Promise<void> {
  const response = await sendMessage<{ payload: { settings: EpicProviderSettings } }>({ type: "GET_EPIC_SETTINGS" });
  const settings = response.payload.settings;
  host.replaceChildren();

  const help = document.createElement("p");
  help.textContent =
    "Connect Epic using the same browser authorization-code pattern Legendary uses, but entirely inside LootCheck. You sign in on Epic's site; LootCheck never asks for your Epic password and never reads browser cookies.";

  const steps = document.createElement("ol");
  for (const text of [
    "Click Open Epic authorization page.",
    "Log into Epic in the browser if prompted.",
    "Copy the displayed authorizationCode value.",
    "Paste it below and click Connect Epic."
  ]) {
    const item = document.createElement("li");
    item.textContent = text;
    steps.append(item);
  }

  const eaLabel = document.createElement("label");
  eaLabel.className = "checkbox-label";
  const eaInput = document.createElement("input");
  eaInput.type = "checkbox";
  eaInput.checked = settings.includeEaManagedGames;
  eaLabel.append(eaInput, "Include EA-managed games");

  const ubisoftLabel = document.createElement("label");
  ubisoftLabel.className = "checkbox-label";
  const ubisoftInput = document.createElement("input");
  ubisoftInput.type = "checkbox";
  ubisoftInput.checked = settings.includeUbisoftLinkedGames;
  ubisoftLabel.append(ubisoftInput, "Include Ubisoft-linked games");

  const playtimeLabel = document.createElement("label");
  playtimeLabel.className = "checkbox-label";
  const playtimeInput = document.createElement("input");
  playtimeInput.type = "checkbox";
  playtimeInput.checked = settings.includePlaytime;
  playtimeLabel.append(playtimeInput, "Include playtime");

  const catalogLabel = document.createElement("label");
  catalogLabel.className = "checkbox-label";
  const catalogInput = document.createElement("input");
  catalogInput.type = "checkbox";
  catalogInput.checked = settings.includeCatalogMetadata;
  catalogLabel.append(catalogInput, "Include catalog metadata");

  const clientIdLabel = document.createElement("label");
  clientIdLabel.textContent = "Epic OAuth client ID";
  const clientIdInput = document.createElement("input");
  clientIdInput.type = "password";
  clientIdInput.autocomplete = "off";
  clientIdInput.spellcheck = false;
  clientIdInput.placeholder = settings.oauthClientId ? "Saved locally" : "Client ID";
  clientIdLabel.append(clientIdInput);

  const tokenHeaderLabel = document.createElement("label");
  tokenHeaderLabel.textContent = "Epic token authorization header";
  const tokenHeaderInput = document.createElement("input");
  tokenHeaderInput.type = "password";
  tokenHeaderInput.autocomplete = "off";
  tokenHeaderInput.spellcheck = false;
  tokenHeaderInput.placeholder = settings.tokenAuthorizationHeader ? "Saved locally" : "Basic ...";
  tokenHeaderLabel.append(tokenHeaderInput);

  const codeLabel = document.createElement("label");
  codeLabel.textContent = "Epic authorization code";
  const codeInput = document.createElement("textarea");
  codeInput.rows = 4;
  codeInput.autocomplete = "off";
  codeInput.spellcheck = false;
  codeInput.placeholder = "Paste the authorizationCode page text or code value here";
  codeLabel.append(codeInput);

  const actions = document.createElement("div");
  actions.className = "filter-actions";

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save Epic settings";
  save.addEventListener("click", async () => {
    await sendMessage({
      type: "SAVE_EPIC_SETTINGS",
      payload: {
        includeEaManagedGames: eaInput.checked,
        includeUbisoftLinkedGames: ubisoftInput.checked,
        includePlaytime: playtimeInput.checked,
        includeCatalogMetadata: catalogInput.checked,
        oauthClientId: clientIdInput.value.trim() || settings.oauthClientId,
        tokenAuthorizationHeader: tokenHeaderInput.value.trim() || settings.tokenAuthorizationHeader
      }
    });
    await refreshProviderSettings(onStatus);
    onStatus("Saved Epic settings.");
  });

  const openAuth = document.createElement("button");
  openAuth.type = "button";
  openAuth.textContent = "Open Epic authorization page";
  openAuth.addEventListener("click", async () => {
    const result = await sendMessage<{ payload: { message: string } }>({ type: "OPEN_EPIC_AUTHORIZATION_PAGE" });
    onStatus(result.payload.message);
  });

  const connect = document.createElement("button");
  connect.type = "button";
  connect.textContent = "Connect Epic";
  connect.addEventListener("click", async () => {
    onStatus("Checking Epic authorization code...");
    const result = await sendMessage<{ payload: { authState: ProviderStatus["authState"] } }>({
      type: "CONNECT_EPIC_WITH_AUTHORIZATION_CODE",
      payload: { authorizationCode: codeInput.value }
    });
    let authState = result.payload.authState;
    if (result.payload.authState.error?.message.includes("different Epic account")) {
      const keep = window.confirm(
        "A different Epic account was authorized. Press OK to replace and keep existing imported games as stale, or Cancel to replace and remove old Epic games."
      );
      const replacementResult = await sendMessage<{ payload: { authState: ProviderStatus["authState"] } }>({
        type: "CONNECT_EPIC_WITH_AUTHORIZATION_CODE",
        payload: { authorizationCode: codeInput.value, replaceExisting: keep ? "keep" : "remove" }
      });
      authState = replacementResult.payload.authState;
    }
    if (authState.status !== "connected") {
      await refreshProviderSettings(onStatus, onDataChanged);
      onStatus(epicAuthStatusMessage(authState));
      return;
    }
    codeInput.value = "";
    await refreshProviderSettings(onStatus, onDataChanged);
    onStatus(epicAuthStatusMessage(authState));
  });

  const checkAuth = document.createElement("button");
  checkAuth.type = "button";
  checkAuth.textContent = "Check Epic auth";
  checkAuth.addEventListener("click", async () => {
    const result = await sendMessage<{ payload: { authState: ProviderStatus["authState"] } }>({ type: "CHECK_EPIC_AUTH" });
    await refreshProviderSettings(onStatus, onDataChanged);
    onStatus(epicAuthStatusMessage(result.payload.authState));
  });

  const sync = document.createElement("button");
  sync.type = "button";
  sync.textContent = "Sync Epic now";
  sync.disabled = status.authState.status !== "connected";
  sync.title = sync.disabled ? "Connect Epic before syncing." : "Sync Epic now";
  sync.addEventListener("click", async () => {
    onStatus("Syncing Epic...");
    const result = await sendMessage<{ payload: { syncRun: SyncRun } }>({
      type: "SYNC_PROVIDER",
      payload: { providerId: "epic", force: true }
    });
    await onDataChanged?.();
    await refreshProviderSettings(onStatus, onDataChanged);
    onStatus(syncRunStatusMessage(result.payload.syncRun));
  });

  const disconnect = document.createElement("button");
  disconnect.type = "button";
  disconnect.textContent = "Disconnect Epic";
  disconnect.disabled = status.authState.status === "not_connected";
  disconnect.addEventListener("click", async () => {
    await sendMessage({ type: "DISCONNECT_PROVIDER", payload: { providerId: "epic" } });
    await refreshProviderSettings(onStatus, onDataChanged);
    onStatus("Disconnected Epic and cleared stored Epic tokens.");
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove Epic imported games";
  remove.disabled = status.importedGameCount === 0 && (status.staleGameCount ?? 0) === 0;
  remove.addEventListener("click", async () => {
    if (!window.confirm("Remove all imported Epic games from the local library? Manual, Steam, and GOG entries will remain.")) {
      return;
    }
    await sendMessage({ type: "REMOVE_PROVIDER_GAMES", payload: { providerId: "epic" } });
    await onDataChanged?.();
    await refreshProviderSettings(onStatus, onDataChanged);
    onStatus("Removed imported Epic games.");
  });

  const rebuildCache = document.createElement("button");
  rebuildCache.type = "button";
  rebuildCache.textContent = "Rebuild Epic catalog cache";
  rebuildCache.addEventListener("click", async () => {
    await sendMessage({ type: "REBUILD_EPIC_CATALOG_CACHE" });
    onStatus("Cleared Epic catalog cache. It will rebuild on the next Epic sync.");
  });

  const exportDiagnostics = document.createElement("button");
  exportDiagnostics.type = "button";
  exportDiagnostics.textContent = "Export Epic diagnostics";
  exportDiagnostics.addEventListener("click", async () => {
    const result = await sendMessage<{ payload: { diagnostics: unknown } }>({ type: "GET_EPIC_DIAGNOSTICS" });
    const blob = new Blob([JSON.stringify(result.payload.diagnostics, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lootcheck-epic-diagnostics.json";
    link.click();
    URL.revokeObjectURL(url);
    onStatus("Exported Epic diagnostics.");
  });

  actions.append(save, openAuth, connect, checkAuth, sync, disconnect, remove, rebuildCache, exportDiagnostics);
  host.append(help, steps, eaLabel, ubisoftLabel, playtimeLabel, catalogLabel, clientIdLabel, tokenHeaderLabel, codeLabel, actions);
}

async function renderAmazonSettings(
  host: HTMLElement,
  status: ProviderStatus,
  onStatus: StatusCallback,
  onDataChanged?: DataChangedCallback
): Promise<void> {
  host.replaceChildren();

  const help = document.createElement("p");
  help.textContent =
    "Use Amazon Games in this browser. Open Amazon Games, sign in normally, make sure your games/library page is visible, then import from the current browser session. LootCheck never asks for your Amazon password or reads browser cookies directly.";

  const actions = document.createElement("div");
  actions.className = "filter-actions";

  const openAmazon = document.createElement("button");
  openAmazon.type = "button";
  openAmazon.textContent = "Open Amazon Games login / library";
  openAmazon.addEventListener("click", async () => {
    const result = await sendMessage<{ payload: { message: string } }>({ type: "OPEN_AMAZON_LOGIN_OR_LIBRARY" });
    onStatus(result.payload.message);
  });

  const importAmazonSession = document.createElement("button");
  importAmazonSession.type = "button";
  importAmazonSession.textContent = "Import from current Amazon session";
  importAmazonSession.addEventListener("click", async () => {
    onStatus("Importing Amazon Games from the current browser session...");
    const result = await sendMessage<{ payload: { syncRun: SyncRun } }>({ type: "START_AMAZON_ASSISTED_IMPORT" });
    await onDataChanged?.();
    await refreshProviderSettings(onStatus, onDataChanged);
    const exportedCount = await exportCompleteLibraryJson();
    onStatus(`${syncRunStatusMessage(result.payload.syncRun)} Exported complete library JSON with ${exportedCount} games.`);
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove Amazon imported games";
  remove.disabled = status.importedGameCount === 0 && (status.staleGameCount ?? 0) === 0;
  remove.addEventListener("click", async () => {
    if (!window.confirm("Remove all imported Amazon Games entries from the local library? Manual, Steam, GOG, and Epic entries will remain.")) {
      return;
    }
    await sendMessage({ type: "REMOVE_PROVIDER_GAMES", payload: { providerId: "amazon" } });
    await onDataChanged?.();
    await refreshProviderSettings(onStatus, onDataChanged);
    onStatus("Removed imported Amazon games.");
  });

  actions.append(openAmazon, importAmazonSession, remove);
  host.append(help, actions);
}

function renderSyncProviderCheckboxes(providers: ProviderSummary[], settings: SyncSettings): void {
  scheduledSyncProviders.replaceChildren();
  const selected = new Set(settings.providerIds);
  for (const provider of providers.filter((candidate) => candidate.id !== "manual" && candidate.supportsBackgroundSync)) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = provider.id;
    input.checked = selected.has(provider.id);
    label.append(input, provider.displayName);
    scheduledSyncProviders.append(label);
  }
}

function readSyncSettings(): SyncSettings {
  return {
    scheduledSyncEnabled: scheduledSyncEnabledInput.checked,
    scheduledSyncIntervalHours: Number(scheduledSyncIntervalInput.value) || 24,
    providerIds: Array.from(scheduledSyncProviders.querySelectorAll<HTMLInputElement>("input:checked")).map(
      (input) => input.value as StoreId
    )
  };
}

async function loadProviderData(): Promise<{ providers: ProviderSummary[]; statuses: ProviderStatus[]; settings: SyncSettings }> {
  const providerResult = await sendMessage<{ payload: { providers: ProviderSummary[] } }>({ type: "GET_PROVIDERS" });
  const statusResult = await sendMessage<{ payload: { statuses: ProviderStatus[] } }>({ type: "GET_PROVIDER_STATUS" });
  const settingsResult = await sendMessage<{ payload: { settings: SyncSettings } }>({ type: "GET_SYNC_SETTINGS" });
  return {
    providers: providerResult.payload.providers,
    statuses: statusResult.payload.statuses,
    settings: settingsResult.payload.settings
  };
}

export async function refreshProviderSettings(onStatus: StatusCallback, onDataChanged?: DataChangedCallback): Promise<void> {
  const { providers, statuses, settings } = await loadProviderData();
  providerGrid.replaceChildren(...statuses.map((status) => renderProviderCard(status, onStatus, onDataChanged)));
  scheduledSyncEnabledInput.checked = settings.scheduledSyncEnabled;
  scheduledSyncIntervalInput.value = String(settings.scheduledSyncIntervalHours);
  renderSyncProviderCheckboxes(providers, settings);
}

export async function initializeProviderSettings(onStatus: StatusCallback, onDataChanged?: DataChangedCallback): Promise<void> {
  await refreshProviderSettings(onStatus, onDataChanged);
  saveSyncSettingsButton.addEventListener("click", async () => {
    const result = await sendMessage<{ payload: { settings: SyncSettings } }>({
      type: "SAVE_SYNC_SETTINGS",
      payload: readSyncSettings()
    });
    scheduledSyncEnabledInput.checked = result.payload.settings.scheduledSyncEnabled;
    scheduledSyncIntervalInput.value = String(result.payload.settings.scheduledSyncIntervalHours);
    onStatus("Saved scheduled sync settings.");
  });
}
