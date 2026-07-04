import { SettingsRepository, normalizeSyncSettings } from "../db/repositories";
import { getProvider } from "../providers/providerRegistry";
import { syncProvider } from "./providerSync";
import type { StoreId, SyncSettings } from "../shared/types";

const ALARM_NAME = "owncheck-scheduled-sync";
const settingsRepository = new SettingsRepository();
let scheduledSyncRunning = false;

export function syncProviderIdsForSchedule(settings: SyncSettings): StoreId[] {
  return normalizeSyncSettings(settings).providerIds.filter((providerId) => providerId !== "manual" && getProvider(providerId)?.supportsBackgroundSync);
}

export async function updateSyncSchedule(settings: SyncSettings): Promise<void> {
  const normalized = normalizeSyncSettings(settings);
  await settingsRepository.saveSyncSettings(normalized);

  if (typeof browser === "undefined" || !browser.alarms) {
    return;
  }

  await browser.alarms.clear(ALARM_NAME);
  if (!normalized.scheduledSyncEnabled) {
    return;
  }

  browser.alarms.create(ALARM_NAME, {
    periodInMinutes: Math.max(60, normalized.scheduledSyncIntervalHours * 60)
  });
}

export async function handleScheduledSyncAlarm(): Promise<void> {
  if (scheduledSyncRunning) {
    return;
  }
  scheduledSyncRunning = true;
  try {
    const settings = await settingsRepository.getSyncSettings();
    if (!settings.scheduledSyncEnabled) {
      return;
    }
    for (const providerId of syncProviderIdsForSchedule(settings)) {
      await syncProvider(providerId, { interactive: false });
    }
  } finally {
    scheduledSyncRunning = false;
  }
}

export async function initializeSyncScheduler(): Promise<void> {
  const settings = await settingsRepository.getSyncSettings();
  await updateSyncSchedule(settings);

  if (typeof browser === "undefined" || !browser.alarms) {
    return;
  }

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      void handleScheduledSyncAlarm();
    }
  });
}
