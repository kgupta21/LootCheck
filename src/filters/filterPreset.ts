import type { FilterPreset, FilterPresetSettings, SortDirection, SortOrder } from "../shared/types";

export const DEFAULT_FILTER_PRESET_IDS = {
  all: "default-all",
  recentlyAdded: "default-recently-added",
  mostPlayed: "default-most-played",
  installed: "default-installed"
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

export function emptyFilterSettings(): FilterPresetSettings {
  return { useAndFilteringStyle: false };
}

export function createFilterPreset(
  name: string,
  settings: FilterPresetSettings,
  sortingOrder: SortOrder,
  sortingDirection: SortDirection,
  id = crypto.randomUUID()
): FilterPreset {
  const timestamp = nowIso();
  return {
    id,
    name,
    settings,
    sortingOrder,
    sortingDirection,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function defaultFilterPresets(): FilterPreset[] {
  const timestamp = nowIso();
  return [
    {
      id: DEFAULT_FILTER_PRESET_IDS.all,
      name: "All",
      settings: emptyFilterSettings(),
      sortingOrder: "title",
      sortingDirection: "asc",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: DEFAULT_FILTER_PRESET_IDS.recentlyAdded,
      name: "Recently Added",
      settings: emptyFilterSettings(),
      sortingOrder: "dateAdded",
      sortingDirection: "desc",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: DEFAULT_FILTER_PRESET_IDS.mostPlayed,
      name: "Most Played",
      settings: emptyFilterSettings(),
      sortingOrder: "playtime",
      sortingDirection: "desc",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: DEFAULT_FILTER_PRESET_IDS.installed,
      name: "Installed",
      settings: { useAndFilteringStyle: false, isInstalled: true },
      sortingOrder: "title",
      sortingDirection: "asc",
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
}

export function isDefaultFilterPreset(id: string): boolean {
  return Object.values(DEFAULT_FILTER_PRESET_IDS).includes(id as (typeof DEFAULT_FILTER_PRESET_IDS)[keyof typeof DEFAULT_FILTER_PRESET_IDS]);
}
