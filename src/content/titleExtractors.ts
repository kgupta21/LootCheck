import { extractTitleCandidatesFromPage, getPageContext as getContextFromInput } from "../matching/candidateExtractor";
import type { PageContext, TitleCandidate } from "../shared/types";

function metaContent(selector: string): string | undefined {
  return document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || undefined;
}

function jsonLdNames(): string[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'))
    .flatMap((script) => {
      try {
        const parsed = JSON.parse(script.textContent ?? "{}");
        const values = Array.isArray(parsed) ? parsed : [parsed];
        return values.flatMap((value) => {
          if (typeof value?.name === "string") {
            return value.name;
          }
          if (Array.isArray(value?.itemListElement)) {
            return value.itemListElement.map((item: unknown) =>
              typeof (item as { name?: unknown })?.name === "string" ? (item as { name: string }).name : undefined
            );
          }
          return undefined;
        });
      } catch {
        return [];
      }
    })
    .filter((value): value is string => Boolean(value));
}

function h1Texts(): string[] {
  return Array.from(document.querySelectorAll<HTMLHeadingElement>("main h1, h1"))
    .map((heading) => heading.textContent?.trim())
    .filter((value): value is string => Boolean(value));
}

export function extractTitleCandidates(location: Location = window.location): TitleCandidate[] {
  const input = {
    url: location.href,
    documentTitle: document.title,
    jsonLdNames: jsonLdNames(),
    h1Texts: h1Texts()
  };
  const ogTitle = metaContent('meta[property="og:title"]');
  const twitterTitle = metaContent('meta[name="twitter:title"]');
  if (ogTitle) Object.assign(input, { ogTitle });
  if (twitterTitle) Object.assign(input, { twitterTitle });
  return extractTitleCandidatesFromPage(input);
}

export function getPageContext(location: Location = window.location): PageContext {
  return getContextFromInput({ url: location.href, documentTitle: document.title });
}
