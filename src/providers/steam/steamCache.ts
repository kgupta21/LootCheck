import { SteamAppCacheRepository } from "../../db/repositories";
import type { SteamAppCacheRecord } from "../../shared/types";
import type { SteamAppDetails } from "./steamTypes";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoAfter(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function cacheRecordFromDetails(details: SteamAppDetails): SteamAppCacheRecord {
  const record: SteamAppCacheRecord = {
    appId: details.appId,
    storeUrl: details.storeUrl,
    fetchedAt: new Date().toISOString(),
    status: details.title ? "ok" : "missing",
    expiresAt: isoAfter(details.title ? 30 * DAY_MS : 7 * DAY_MS),
    raw: details.raw
  };
  if (details.title) {
    record.title = details.title;
  }
  return record;
}

export function failedCacheRecord(appId: number, errorCode: string): SteamAppCacheRecord {
  return {
    appId,
    storeUrl: `https://store.steampowered.com/app/${appId}`,
    fetchedAt: new Date().toISOString(),
    status: "failed",
    errorCode,
    expiresAt: isoAfter(DAY_MS)
  };
}

export interface SteamCacheStats {
  total: number;
  ok: number;
  missing: number;
  failed: number;
  expired: number;
}

export function steamCacheStats(records: SteamAppCacheRecord[]): SteamCacheStats {
  const now = Date.now();
  return {
    total: records.length,
    ok: records.filter((record) => record.status === "ok").length,
    missing: records.filter((record) => record.status === "missing").length,
    failed: records.filter((record) => record.status === "failed").length,
    expired: records.filter((record) => Date.parse(record.expiresAt) < now).length
  };
}

export async function clearSteamMetadataCache(): Promise<void> {
  await new SteamAppCacheRepository().clearAppDetails();
}
