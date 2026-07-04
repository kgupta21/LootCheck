import type { GameRecord } from "../shared/types";

const tableBody = document.querySelector<HTMLTableSectionElement>("#library-table-body")!;
const resultCount = document.querySelector<HTMLElement>("#result-count")!;

function formatDate(value: string | undefined): string {
  return value ? new Date(value).toLocaleDateString() : "";
}

function formatPlaytime(minutes: number | undefined): string {
  if (!minutes) {
    return "";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

function providerIds(game: GameRecord): string[] {
  return [...new Set(game.providerEntries.map((entry) => entry.providerId))];
}

function tagsAndCategories(game: GameRecord): string {
  return [...game.tags, ...game.categories].join(", ");
}

export function renderLibrary(games: GameRecord[], totalGames: number): void {
  tableBody.replaceChildren();
  resultCount.textContent =
    games.length === totalGames
      ? `${totalGames} total ${totalGames === 1 ? "game" : "games"}`
      : `${games.length} matching ${games.length === 1 ? "game" : "games"} · ${totalGames} total`;

  if (totalGames === 0 || games.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent =
      totalGames === 0 ? "No games imported yet. Use Manual Import to add games." : "No games match the current filters.";
    row.append(cell);
    tableBody.append(row);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const game of games) {
    const row = document.createElement("tr");
    const cells = [
      game.canonicalTitle,
      undefined,
      game.platforms.join(", "),
      tagsAndCategories(game),
      game.isInstalled ? "Yes" : "No",
      formatPlaytime(game.playtimeMinutes),
      formatDate(game.lastPlayedAt),
      formatDate(game.updatedAt)
    ];
    for (const [index, value] of cells.entries()) {
      const cell = document.createElement("td");
      if (index === 1) {
        const badges = document.createElement("span");
        badges.className = "provider-badges";
        for (const providerId of providerIds(game)) {
          const badge = document.createElement("span");
          badge.className = `provider-badge provider-badge-${providerId}`;
          badge.textContent = providerId;
          badges.append(badge);
        }
        cell.append(badges);
      } else {
        cell.textContent = value ?? "";
      }
      row.append(cell);
    }
    fragment.append(row);
  }
  tableBody.append(fragment);
}
