import { extractAmazonGamesViaGraphql, extractAssistedGamesFromPage, uniqueAssistedGames } from "../providers/assisted/assistedPageExtractors";
import type { AssistedProviderId, AssistedSessionGame } from "../providers/assisted/assistedTypes";

function providerForCurrentPage(): AssistedProviderId | undefined {
  const hostname = location.hostname.toLowerCase();
  if (hostname === "steamcommunity.com" || hostname.endsWith(".steamcommunity.com") || hostname === "store.steampowered.com") {
    return "steam";
  }
  if (hostname === "gaming.amazon.com" || hostname.startsWith("luna.amazon.") || /(^|\.)amazon\./i.test(hostname)) {
    return "amazon";
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function visibleText(element: Element): string {
  return [
    element.textContent,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("data-testid"),
    element.getAttribute("data-a-target")
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isVisibleElement(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

export function isAmazonLoadMoreText(text: string): boolean {
  return (
    /(load more|show more|view more|more games|see\s+\d+\s+more|next page|next)/i.test(text) &&
    !/(claim|claimed|install|download|play)/i.test(text)
  );
}

export function isAmazonCollectionYearText(text: string): boolean {
  return /^(20\d{2}|past\s+\d+\s+months)$/i.test(text.trim());
}

function clickAmazonLoadMoreControl(): boolean {
  const controls = Array.from(document.querySelectorAll<HTMLElement>("button, a, [role='button'], [tabindex]"));
  for (const control of controls) {
    if (!isVisibleElement(control)) {
      continue;
    }
    const text = visibleText(control);
    if (!text) {
      continue;
    }
    if (isAmazonLoadMoreText(text)) {
      control.click();
      return true;
    }
  }
  return false;
}

function findAmazonCollectionFilterControl(): HTMLElement | undefined {
  const controls = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], [tabindex]"));
  return controls.find((control) => isVisibleElement(control) && /collected in/i.test(visibleText(control)));
}

function visibleYearOptions(): HTMLElement[] {
  const controls = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], [tabindex], li, div"));
  const byText = new Map<string, HTMLElement>();
  for (const control of controls) {
    if (!isVisibleElement(control)) {
      continue;
    }
    const text = visibleText(control);
    if (!isAmazonCollectionYearText(text)) {
      continue;
    }
    if (!byText.has(text)) {
      byText.set(text, control);
    }
  }
  return [...byText.values()];
}

function countAmazonTitleCandidates(): number {
  return document.querySelectorAll("h1, h2, h3, [aria-label], [title], img[alt], [data-a-target], [data-testid]").length;
}

function scrollAmazonLibraryContainers(): number {
  let largestScrollHeight = document.scrollingElement?.scrollHeight ?? 0;
  window.scrollTo(0, largestScrollHeight);
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("main, section, div"))) {
    if (element.scrollHeight > element.clientHeight + 100 && element.clientHeight > 100) {
      element.scrollTop = element.scrollHeight;
      largestScrollHeight = Math.max(largestScrollHeight, element.scrollHeight);
    }
  }
  return largestScrollHeight;
}

async function prepareAmazonLibraryPageForExtraction(): Promise<void> {
  let stablePasses = 0;
  let previousHeight = 0;
  let previousCount = 0;

  for (let pass = 0; pass < 14; pass += 1) {
    const clicked = clickAmazonLoadMoreControl();
    const height = scrollAmazonLibraryContainers();
    await delay(clicked ? 800 : 500);
    const nextHeight = document.scrollingElement?.scrollHeight ?? height;
    const nextCount = countAmazonTitleCandidates();
    if (!clicked && nextHeight === previousHeight && nextCount === previousCount) {
      stablePasses += 1;
    } else {
      stablePasses = 0;
    }
    previousHeight = nextHeight;
    previousCount = nextCount;
    if (stablePasses >= 2) {
      break;
    }
  }
}

function extractAmazonGamesFromPreparedPage(): AssistedSessionGame[] {
  const pageResult = extractAssistedGamesFromPage("amazon", document);
  return pageResult.games;
}

async function importAmazonCollectionBatch(batchLabel: string, games: AssistedSessionGame[]): Promise<void> {
  if (games.length === 0) {
    return;
  }
  try {
    await browser.runtime.sendMessage({
      type: "AMAZON_ASSISTED_IMPORT_BATCH",
      payload: {
        batchLabel,
        games
      }
    });
  } catch {
    // The final import result still returns all games if an incremental batch write fails.
  }
}

async function collectAmazonGamesAcrossCollectionFilters(): Promise<AssistedSessionGame[]> {
  const games: AssistedSessionGame[] = [];
  await prepareAmazonLibraryPageForExtraction();
  const currentGames = extractAmazonGamesFromPreparedPage();
  games.push(...currentGames);
  await importAmazonCollectionBatch("current collection view", currentGames);

  const filterControl = findAmazonCollectionFilterControl();
  if (!filterControl) {
    return uniqueAssistedGames(games);
  }

  filterControl.click();
  await delay(300);
  const optionTexts = visibleYearOptions()
    .map((option) => visibleText(option))
    .filter((text, index, all) => all.indexOf(text) === index);

  for (const optionText of optionTexts) {
    const freshFilterControl = findAmazonCollectionFilterControl();
    freshFilterControl?.click();
    await delay(250);
    const option = visibleYearOptions().find((candidate) => visibleText(candidate) === optionText);
    if (!option) {
      continue;
    }
    option.click();
    await delay(900);
    await prepareAmazonLibraryPageForExtraction();
    const optionGames = extractAmazonGamesFromPreparedPage();
    games.push(...optionGames);
    await importAmazonCollectionBatch(optionText, optionGames);
  }

  return uniqueAssistedGames(games);
}

if (typeof browser !== "undefined" && browser.runtime?.onMessage) {
  browser.runtime.onMessage.addListener((message: unknown) => {
  if (!message || typeof message !== "object" || (message as { type?: string }).type !== "EXTRACT_ASSISTED_PROVIDER_LIBRARY") {
    return undefined;
  }

  const requestedProviderId = (message as { payload?: { providerId?: AssistedProviderId } }).payload?.providerId;
  const pageProviderId = providerForCurrentPage();
  if (!requestedProviderId || !pageProviderId || requestedProviderId !== pageProviderId) {
    return Promise.resolve({
      type: "ASSISTED_PROVIDER_LIBRARY_RESULT",
      payload: {
        providerId: requestedProviderId ?? pageProviderId ?? "steam",
        games: [],
        source: "visible",
        warnings: [
          {
            code: "ASSISTED_IMPORT_WRONG_PAGE",
            message: "The active page does not match the requested provider."
          }
        ]
      }
    });
  }

  return (async () => {
    if (requestedProviderId !== "amazon") {
      const pageResult = extractAssistedGamesFromPage(requestedProviderId, document);
      return {
        type: "ASSISTED_PROVIDER_LIBRARY_RESULT",
        payload: pageResult
      };
    }

    let pageResult = extractAssistedGamesFromPage(requestedProviderId, document);
    let collectionGames: AssistedSessionGame[] = [];
    let graphqlGames: AssistedSessionGame[] = [];
    try {
      collectionGames = await collectAmazonGamesAcrossCollectionFilters();
      graphqlGames = await extractAmazonGamesViaGraphql(document);
      pageResult = extractAssistedGamesFromPage(requestedProviderId, document);
    } catch {
      return {
        type: "ASSISTED_PROVIDER_LIBRARY_RESULT",
        payload: {
          ...pageResult,
          games: pageResult.games,
          warnings: [
            ...pageResult.warnings,
            {
              code: "AMAZON_PAGE_EXTRACTION_INTERRUPTED",
              message: "Amazon page extraction was interrupted before all collection filters could be read."
            }
          ]
        }
      };
    }
    const games = uniqueAssistedGames([...graphqlGames, ...collectionGames]);
    return {
      type: "ASSISTED_PROVIDER_LIBRARY_RESULT",
      payload: {
        ...pageResult,
        games,
        source: graphqlGames.length > 0 && pageResult.games.length > 0 ? "combined" : graphqlGames.length > 0 ? "graphql" : pageResult.source,
        warnings: games.length === 0 ? pageResult.warnings : pageResult.warnings.filter((warning) => !warning.code.endsWith("_ASSISTED_IMPORT_EMPTY"))
      }
    };
  })();
  });
}
