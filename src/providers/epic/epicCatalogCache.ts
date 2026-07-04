import { EpicCatalogCacheRepository } from "../../db/repositories";
import type { EpicCatalogCacheRecord } from "../../shared/types";
import type { EpicCatalogItem } from "./epicTypes";

const DAY_MS = 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function expiresIn(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

export function epicCatalogCacheKey(namespace: string, catalogItemId: string, buildVersion?: string): string {
  return [namespace, catalogItemId, buildVersion ?? "no-build"].map((part) => encodeURIComponent(part)).join(":");
}

export function okEpicCatalogCacheRecord(
  namespace: string,
  catalogItemId: string,
  item: EpicCatalogItem,
  buildVersion?: string
): EpicCatalogCacheRecord {
  return {
    key: epicCatalogCacheKey(namespace, catalogItemId, buildVersion),
    namespace,
    catalogItemId,
    ...(buildVersion ? { buildVersion } : {}),
    status: "ok",
    item,
    fetchedAt: nowIso(),
    expiresAt: expiresIn(30)
  };
}

export function missingEpicCatalogCacheRecord(
  namespace: string,
  catalogItemId: string,
  buildVersion?: string
): EpicCatalogCacheRecord {
  return {
    key: epicCatalogCacheKey(namespace, catalogItemId, buildVersion),
    namespace,
    catalogItemId,
    ...(buildVersion ? { buildVersion } : {}),
    status: "missing",
    fetchedAt: nowIso(),
    expiresAt: expiresIn(7)
  };
}

export function failedEpicCatalogCacheRecord(
  namespace: string,
  catalogItemId: string,
  errorCode: string,
  buildVersion?: string
): EpicCatalogCacheRecord {
  return {
    key: epicCatalogCacheKey(namespace, catalogItemId, buildVersion),
    namespace,
    catalogItemId,
    ...(buildVersion ? { buildVersion } : {}),
    status: "failed",
    errorCode,
    fetchedAt: nowIso(),
    expiresAt: expiresIn(1)
  };
}

export async function getEpicCatalogCacheStats(repository = new EpicCatalogCacheRepository()) {
  const records = await repository.listRecords();
  const now = Date.now();
  return {
    total: records.length,
    ok: records.filter((record) => record.status === "ok").length,
    missing: records.filter((record) => record.status === "missing").length,
    failed: records.filter((record) => record.status === "failed").length,
    expired: records.filter((record) => {
      const expiresAt = Date.parse(record.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt < now;
    }).length
  };
}
