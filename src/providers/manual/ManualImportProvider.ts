import { MANUAL_PROVIDER_ID } from "../../shared/constants";
import type { AuthState, ImportWarning, ProviderGame, ProviderImportResult } from "../../shared/types";
import type { GameStoreProvider } from "../Provider";

type ManualJsonRecord = {
  title?: unknown;
  source?: unknown;
  aliases?: unknown;
  platforms?: unknown;
  platform?: unknown;
  tags?: unknown;
  isInstalled?: unknown;
  playtimeMinutes?: unknown;
  lastPlayedAt?: unknown;
};

function splitList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(";").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (/^(true|yes|1)$/i.test(value)) return true;
    if (/^(false|no|0)$/i.test(value)) return false;
  }
  return undefined;
}

function parseNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return [];
  }
  const [headerLine, ...rows] = lines;
  const headers = parseCsvLine(headerLine ?? "").map((header) => header.trim());
  return rows.map((row) => {
    const values = parseCsvLine(row);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function toProviderGame(record: ManualJsonRecord | Record<string, string>, index: number, warnings: ImportWarning[]): ProviderGame | undefined {
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title) {
    warnings.push({ code: "MISSING_TITLE", message: "Skipped a manual import row without a title.", row: index + 1 });
    return undefined;
  }

  const game: ProviderGame = {
    providerGameId: `${title.toLowerCase()}:${index}`,
    title,
    aliases: splitList(record.aliases),
    platform: splitList(record.platforms ?? record.platform),
    tags: splitList(record.tags),
    raw: record
  };

  const isInstalled = parseBoolean(record.isInstalled);
  const playtimeMinutes = parseNumber(record.playtimeMinutes);
  if (isInstalled !== undefined) game.isInstalled = isInstalled;
  if (playtimeMinutes !== undefined) game.playtimeMinutes = playtimeMinutes;
  if (typeof record.lastPlayedAt === "string" && record.lastPlayedAt) game.lastPlayedAt = record.lastPlayedAt;

  return game;
}

export function parseManualImportText(text: string, fileName = "manual-import"): ProviderImportResult {
  const warnings: ImportWarning[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      providerId: MANUAL_PROVIDER_ID,
      importedAt: new Date().toISOString(),
      games: [],
      warnings: [{ code: "EMPTY_FILE", message: "The selected file is empty." }]
    };
  }

  const records: Array<ManualJsonRecord | Record<string, string>> =
    fileName.toLowerCase().endsWith(".csv") || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))
      ? parseCsv(trimmed)
      : JSON.parse(trimmed);

  const arrayRecords = Array.isArray(records) ? records : [records];
  const games = arrayRecords
    .map((record, index) => toProviderGame(record, index, warnings))
    .filter((game): game is ProviderGame => Boolean(game));

  return {
    providerId: MANUAL_PROVIDER_ID,
    importedAt: new Date().toISOString(),
    games,
    warnings
  };
}

export class ManualImportProvider implements GameStoreProvider {
  id = MANUAL_PROVIDER_ID;
  displayName = "Manual Import";
  supportsAuth = false;
  supportsManualImport = true;
  supportsBackgroundSync = false;
  accountPolicy = "multiple_accounts_unsupported" as const;

  async getAuthState(): Promise<AuthState> {
    return {
      providerId: this.id,
      status: "connected",
      accountName: "Manual library",
      lastCheckedAt: new Date().toISOString()
    };
  }

  async login(): Promise<AuthState> {
    return this.getAuthState();
  }

  async logout(): Promise<void> {
    return undefined;
  }

  async refreshAuthIfNeeded(): Promise<AuthState> {
    return this.getAuthState();
  }

  async importOwnedGames(): Promise<ProviderImportResult> {
    return {
      providerId: this.id,
      importedAt: new Date().toISOString(),
      games: [],
      warnings: [{ code: "FILE_REQUIRED", message: "Choose a JSON or CSV file to import manual games." }]
    };
  }
}
