import type { GameRecord, SortDirection, SortOrder } from "../shared/types";

function titleValue(game: GameRecord): string {
  return (game.sortTitle || game.canonicalTitle).toLocaleLowerCase();
}

function valueForSort(game: GameRecord, sortOrder: SortOrder): string | number | boolean | undefined {
  switch (sortOrder) {
    case "provider":
      return game.providerEntries[0]?.providerId ?? "";
    case "platform":
      return game.platforms[0] ?? "";
    case "releaseYear":
      return game.releaseYear;
    case "dateAdded":
      return game.addedAt;
    case "dateModified":
      return game.updatedAt;
    case "lastPlayed":
      return game.lastPlayedAt;
    case "playtime":
      return game.playtimeMinutes;
    case "installed":
      return game.isInstalled;
    case "title":
    default:
      return titleValue(game);
  }
}

function comparePrimitive(left: string | number | boolean, right: string | number | boolean): number {
  if (typeof left === "boolean" || typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function isMissingForSort(value: string | number | boolean | undefined, order: SortOrder): boolean {
  if (value === undefined || value === "") {
    return true;
  }
  return order === "playtime" && Number(value) === 0;
}

export function sortGames(games: GameRecord[], sortOrder: SortOrder, direction: SortDirection = "asc"): GameRecord[] {
  const modifier = direction === "asc" ? 1 : -1;
  return [...games].sort((a, b) => {
    const left = valueForSort(a, sortOrder);
    const right = valueForSort(b, sortOrder);
    const leftMissing = isMissingForSort(left, sortOrder);
    const rightMissing = isMissingForSort(right, sortOrder);
    if (leftMissing && !rightMissing) return 1;
    if (!leftMissing && rightMissing) return -1;

    let primary = 0;
    if (!leftMissing && !rightMissing && left !== undefined && right !== undefined) {
      primary = comparePrimitive(left, right) * modifier;
    }

    if (primary !== 0) {
      return primary;
    }

    if (sortOrder === "title") {
      return 0;
    }

    return titleValue(a).localeCompare(titleValue(b), undefined, { numeric: true, sensitivity: "base" });
  });
}
