import type { PageContext, TitleCandidate, TitleCandidateSource } from "../shared/types";

export interface CandidateExtractionInput {
  url: string;
  documentTitle?: string;
  ogTitle?: string;
  twitterTitle?: string;
  jsonLdNames?: string[];
  h1Texts?: string[];
}

const MAX_CANDIDATES = 16;

function cleanCandidate(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/\s+/g, " ")
    .replace(/\s+on Steam$/i, "")
    .replace(/\s+\|.*$/i, "")
    .replace(/\s+-\s+(Steam|GOG\.com|Epic Games Store|Epic Games|Official Site).*$/i, "")
    .trim();
  return cleaned && cleaned.length >= 2 ? cleaned : undefined;
}

function addCandidate(candidates: TitleCandidate[], value: string | undefined, source: TitleCandidateSource, weight: number): void {
  const cleaned = cleanCandidate(value);
  if (!cleaned) {
    return;
  }

  const duplicate = candidates.find((candidate) => candidate.value.toLocaleLowerCase() === cleaned.toLocaleLowerCase());
  if (duplicate) {
    duplicate.weight = Math.max(duplicate.weight, weight);
    if (duplicate.source !== "domainExtractor" && source === "domainExtractor") {
      duplicate.source = source;
    }
    return;
  }

  candidates.push({ value: cleaned, source, weight });
}

function titleFromSlugSegment(segment: string | undefined): string | undefined {
  if (!segment) {
    return undefined;
  }
  const decoded = decodeURIComponent(segment);
  if (/^\d+$/.test(decoded)) {
    return undefined;
  }
  return decoded.replace(/[-_]+/g, " ");
}

function slugCandidates(url: URL): string[] {
  const ignored = new Set(["app", "game", "games", "store", "p", "product", "en", "us"]);
  return url.pathname
    .split("/")
    .filter(Boolean)
    .filter((segment) => !ignored.has(segment.toLocaleLowerCase()))
    .slice(-3)
    .map(titleFromSlugSegment)
    .filter((value): value is string => Boolean(value));
}

function extractDomainCandidate(url: URL, input: CandidateExtractionInput): string | undefined {
  const hostname = url.hostname.replace(/^www\./, "");
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (hostname === "store.steampowered.com") {
    if (pathParts[0] === "app") {
      return titleFromSlugSegment(pathParts[2]) ?? cleanCandidate(input.ogTitle) ?? cleanCandidate(input.documentTitle);
    }
  }

  if (hostname === "gog.com" || hostname.endsWith(".gog.com")) {
    const gameIndex = pathParts.findIndex((part) => part === "game");
    if (gameIndex >= 0) {
      return titleFromSlugSegment(pathParts[gameIndex + 1]) ?? cleanCandidate(input.ogTitle);
    }
  }

  if (hostname === "epicgames.com" || hostname.endsWith(".epicgames.com")) {
    const productIndex = pathParts.findIndex((part) => part === "p" || part === "product");
    if (productIndex >= 0) {
      return titleFromSlugSegment(pathParts[productIndex + 1]) ?? cleanCandidate(input.ogTitle);
    }
  }

  return undefined;
}

export function getPageContext(input: Pick<CandidateExtractionInput, "url" | "documentTitle">): PageContext {
  const url = new URL(input.url);
  const hostname = url.hostname;
  const pathname = url.pathname;
  const productSignals = [
    hostname === "store.steampowered.com" && /^\/app\/\d+\//.test(pathname),
    (hostname === "gog.com" || hostname.endsWith(".gog.com")) && /\/game\//.test(pathname),
    (hostname === "epicgames.com" || hostname.endsWith(".epicgames.com")) && /\/(p|product)\//.test(pathname)
  ];

  return {
    hostname,
    pathname,
    documentTitle: input.documentTitle ?? "",
    isLikelyGameProductPage: productSignals.some(Boolean)
  };
}

export function extractTitleCandidatesFromPage(input: CandidateExtractionInput): TitleCandidate[] {
  const url = new URL(input.url);
  const candidates: TitleCandidate[] = [];

  addCandidate(candidates, extractDomainCandidate(url, input), "domainExtractor", 100);
  addCandidate(candidates, input.ogTitle, "ogTitle", 85);
  addCandidate(candidates, input.twitterTitle, "twitterTitle", 80);

  for (const name of input.jsonLdNames ?? []) {
    addCandidate(candidates, name, "jsonLd", 90);
  }

  for (const h1 of input.h1Texts ?? []) {
    addCandidate(candidates, h1, "h1", 75);
    if (candidates.some((candidate) => candidate.source === "h1")) {
      break;
    }
  }

  addCandidate(candidates, input.documentTitle, "documentTitle", 55);

  for (const slug of slugCandidates(url)) {
    addCandidate(candidates, slug, "urlSlug", 35);
  }

  return candidates.sort((a, b) => b.weight - a.weight).slice(0, MAX_CANDIDATES);
}
