import { SettingsRepository } from "../../db/repositories";
import type { GogProviderSettings } from "../../shared/types";

const GOG_SETTINGS_KEY = "gogProviderSettings";

function nowIso(): string {
  return new Date().toISOString();
}

export function defaultGogSettings(): GogProviderSettings {
  return {
    providerId: "gog",
    importExtras: false,
    useLegacyFallback: true,
    allowRawProviderResponses: false,
    directAuthSupported: true,
    updatedAt: nowIso()
  };
}

export class GogSettingsRepository {
  private readonly settingsRepository = new SettingsRepository();

  async getSettings(): Promise<GogProviderSettings> {
    const settings = await this.settingsRepository.getSetting<GogProviderSettings>(GOG_SETTINGS_KEY);
    return {
      ...defaultGogSettings(),
      ...settings
    };
  }

  async saveSettings(settings: Partial<GogProviderSettings>): Promise<GogProviderSettings> {
    const existing = await this.getSettings();
    const next: GogProviderSettings = {
      ...existing,
      ...settings,
      providerId: "gog",
      importExtras: settings.importExtras ?? existing.importExtras,
      useLegacyFallback: settings.useLegacyFallback ?? existing.useLegacyFallback,
      allowRawProviderResponses: settings.allowRawProviderResponses ?? existing.allowRawProviderResponses,
      directAuthSupported: settings.directAuthSupported ?? existing.directAuthSupported,
      updatedAt: nowIso()
    };
    await this.settingsRepository.saveSetting(GOG_SETTINGS_KEY, next);
    return next;
  }

  async clearSettings(): Promise<void> {
    await this.settingsRepository.deleteSetting(GOG_SETTINGS_KEY);
  }
}
