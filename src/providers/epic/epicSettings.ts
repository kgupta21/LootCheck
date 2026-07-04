import { SettingsRepository } from "../../db/repositories";
import type { EpicProviderSettings } from "../../shared/types";
import type { EpicFeasibilityStatus } from "./epicTypes";

const EPIC_SETTINGS_KEY = "epicSettings";

export const EPIC_FEASIBILITY_DECISION = "LEGENDARY_COMPATIBLE_BROWSER_AUTH";
export const EPIC_FEASIBILITY_NOTES_PATH = "docs/providers/epic-feasibility.md";

export const DEFAULT_EPIC_SETTINGS: EpicProviderSettings = {
  providerId: "epic",
  includeEaManagedGames: false,
  includeUbisoftLinkedGames: false,
  includePlaytime: true,
  includeCatalogMetadata: true,
  authFlowMode: "legendary_compatible_authorization_code",
  updatedAt: new Date(0).toISOString()
};

function nowIso(): string {
  return new Date().toISOString();
}

export class EpicSettingsRepository {
  private readonly settingsRepository = new SettingsRepository();

  async getSettings(): Promise<EpicProviderSettings> {
    const settings = await this.settingsRepository.getSetting<Partial<EpicProviderSettings>>(EPIC_SETTINGS_KEY);
    return {
      ...DEFAULT_EPIC_SETTINGS,
      ...settings,
      providerId: "epic",
      authFlowMode: "legendary_compatible_authorization_code",
      updatedAt: settings?.updatedAt ?? nowIso()
    };
  }

  async saveSettings(update: Partial<Omit<EpicProviderSettings, "providerId">>): Promise<EpicProviderSettings> {
    const existing = await this.getSettings();
    const next: EpicProviderSettings = {
      ...existing,
      ...update,
      providerId: "epic",
      authFlowMode: "legendary_compatible_authorization_code",
      updatedAt: nowIso()
    };
    await this.settingsRepository.saveSetting(EPIC_SETTINGS_KEY, next);
    return next;
  }

  async clearSettings(): Promise<void> {
    await this.settingsRepository.deleteSetting(EPIC_SETTINGS_KEY);
  }
}

export function getEpicFeasibilityStatus(): EpicFeasibilityStatus {
  return {
    providerId: "epic",
    decision: EPIC_FEASIBILITY_DECISION,
    directImportImplemented: true,
    safeAuthPathConfirmed: true,
    authFlowMode: "legendary_compatible_authorization_code",
    notesDocumentPath: EPIC_FEASIBILITY_NOTES_PATH
  };
}
