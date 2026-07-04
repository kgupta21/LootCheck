const ROMAN_NUMERALS: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10"
};

const EDITION_SUFFIXES = [
  "complete edition",
  "definitive edition",
  "deluxe edition",
  "ultimate edition",
  "game of the year edition",
  "goty edition",
  "standard edition",
  "collector's edition",
  "collectors edition"
];

const STORE_NOISE = [
  "steam",
  "epic games store",
  "epic games",
  "gog.com",
  "gog",
  "pc",
  "windows",
  "mac",
  "linux"
];

function normalizePunctuation(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[®™©]/g, "");
}

function stripTrailingParentheticalNoise(value: string): string {
  return value.replace(/\s*\((?:pc|steam|epic games store|gog|windows|mac|linux)\)\s*$/i, "");
}

function stripStoreNoise(value: string): string {
  let output = value;
  for (const noise of STORE_NOISE) {
    output = output.replace(new RegExp(`\\b${escapeRegExp(noise)}\\b`, "gi"), " ");
  }
  return output;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeTitle(title: string): string {
  const punctuationNormalized = normalizePunctuation(title);
  const withoutParenthetical = stripTrailingParentheticalNoise(punctuationNormalized);
  const withoutNoise = stripStoreNoise(withoutParenthetical);

  return withoutNoise
    .toLowerCase()
    .replace(/[':]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => ROMAN_NUMERALS[part] ?? part)
    .join(" ")
    .trim();
}

export function titleAliases(title: string, explicitAliases: string[] = []): string[] {
  const aliases = new Set<string>();
  const normalized = normalizePunctuation(title).toLowerCase();

  for (const suffix of EDITION_SUFFIXES) {
    const stripped = normalized
      .replace(new RegExp(`\\s*[-:–—]?\\s*${escapeRegExp(suffix)}\\s*$`, "i"), "")
      .trim();
    if (stripped && stripped !== normalized) {
      aliases.add(stripped);
    }
  }

  for (const alias of explicitAliases) {
    if (alias.trim()) {
      aliases.add(alias.trim());
    }
  }

  return [...aliases];
}

export function makeSortTitle(title: string): string {
  return title.replace(/^(the|a|an)\s+/i, "").trim().toLocaleLowerCase();
}
