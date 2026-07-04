import { DEFAULT_FILTER_PRESET_IDS, isDefaultFilterPreset } from "../filters/filterPreset";
import type { FilterPreset, FilterPresetSettings, GameRecord, SortDirection, SortOrder, StoreId } from "../shared/types";

export interface BrowserFilterState {
  selectedPresetId: string;
  settings: FilterPresetSettings;
  sortingOrder: SortOrder;
  sortingDirection: SortDirection;
  modified: boolean;
}

export interface FilterFacets {
  providers: FilterFacetOption[];
  platforms: FilterFacetOption[];
  tags: FilterFacetOption[];
  categories: FilterFacetOption[];
}

export interface FilterFacetOption {
  value: string;
  count: number;
}

const presetSelect = document.querySelector<HTMLSelectElement>("#filter-preset-select")!;
const searchInput = document.querySelector<HTMLInputElement>("#library-search")!;
const providerSelect = document.querySelector<HTMLSelectElement>("#provider-filter")!;
const platformSelect = document.querySelector<HTMLSelectElement>("#platform-filter")!;
const tagSelect = document.querySelector<HTMLSelectElement>("#tag-filter")!;
const categorySelect = document.querySelector<HTMLSelectElement>("#category-filter")!;
const installedSelect = document.querySelector<HTMLSelectElement>("#installed-filter")!;
const playtimeSelect = document.querySelector<HTMLSelectElement>("#playtime-filter")!;
const releaseYearsInput = document.querySelector<HTMLInputElement>("#release-years-filter")!;
const andFilteringInput = document.querySelector<HTMLInputElement>("#and-filtering")!;
const sortOrderSelect = document.querySelector<HTMLSelectElement>("#sort-order")!;
const sortDirectionSelect = document.querySelector<HTMLSelectElement>("#sort-direction")!;

function selectedValues(select: HTMLSelectElement): string[] {
  return Array.from(select.selectedOptions).map((option) => option.value).filter(Boolean);
}

function setSelectedValues(select: HTMLSelectElement, values: string[] | undefined): void {
  const selected = new Set(values ?? []);
  for (const option of Array.from(select.options)) {
    option.selected = selected.has(option.value);
  }
}

function parseBooleanSelect(value: string): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function setBooleanSelect(select: HTMLSelectElement, value: boolean | undefined): void {
  select.value = value === undefined ? "" : String(value);
}

function parseReleaseYears(value: string): number[] | undefined {
  const years = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((year) => Number.isInteger(year) && year > 0);
  return years.length ? years : undefined;
}

function setOptions(select: HTMLSelectElement, values: FilterFacetOption[]): void {
  const previous = selectedValues(select);
  select.replaceChildren(
    ...values.map(({ value, count }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${value} (${count})`;
      option.selected = previous.includes(value);
      return option;
    })
  );
}

export function facetsFromGames(games: GameRecord[]): FilterFacets {
  const providers = new Map<string, number>();
  const platforms = new Map<string, number>();
  const tags = new Map<string, number>();
  const categories = new Map<string, number>();

  const add = (map: Map<string, number>, value: string): void => {
    const trimmed = value.trim();
    if (trimmed) {
      map.set(trimmed, (map.get(trimmed) ?? 0) + 1);
    }
  };

  for (const game of games) {
    new Set(game.providerEntries.map((entry) => entry.providerId)).forEach((providerId) => add(providers, providerId));
    new Set(game.platforms).forEach((platform) => add(platforms, platform));
    new Set(game.tags).forEach((tag) => add(tags, tag));
    new Set(game.categories).forEach((category) => add(categories, category));
  }

  const sort = (values: Map<string, number>) =>
    [...values.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => a.value.localeCompare(b.value));
  return {
    providers: sort(providers),
    platforms: sort(platforms),
    tags: sort(tags),
    categories: sort(categories)
  };
}

export function renderFilterFacets(facets: FilterFacets): void {
  setOptions(providerSelect, facets.providers);
  setOptions(platformSelect, facets.platforms);
  setOptions(tagSelect, facets.tags);
  setOptions(categorySelect, facets.categories);
}

export function renderPresetOptions(presets: FilterPreset[], selectedId: string): void {
  presetSelect.replaceChildren(
    ...presets.map((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = isDefaultFilterPreset(preset.id) ? preset.name : `${preset.name} *`;
      option.selected = preset.id === selectedId;
      return option;
    })
  );
}

export function readFilterState(selectedPresetId = presetSelect.value, modified = true): BrowserFilterState {
  const settings: FilterPresetSettings = {
    useAndFilteringStyle: andFilteringInput.checked
  };
  if (searchInput.value.trim()) settings.titleText = searchInput.value.trim();
  const providers = selectedValues(providerSelect) as StoreId[];
  if (providers.length) settings.providers = providers;
  const platforms = selectedValues(platformSelect);
  if (platforms.length) settings.platforms = platforms;
  const tags = selectedValues(tagSelect);
  if (tags.length) settings.tags = tags;
  const categories = selectedValues(categorySelect);
  if (categories.length) settings.categories = categories;
  const isInstalled = parseBooleanSelect(installedSelect.value);
  if (isInstalled !== undefined) settings.isInstalled = isInstalled;
  const hasPlaytime = parseBooleanSelect(playtimeSelect.value);
  if (hasPlaytime !== undefined) settings.hasPlaytime = hasPlaytime;
  const releaseYears = parseReleaseYears(releaseYearsInput.value);
  if (releaseYears) settings.releaseYears = releaseYears;

  return {
    selectedPresetId,
    settings,
    sortingOrder: sortOrderSelect.value as SortOrder,
    sortingDirection: sortDirectionSelect.value as SortDirection,
    modified
  };
}

export function applyPresetToControls(preset: FilterPreset): BrowserFilterState {
  presetSelect.value = preset.id;
  searchInput.value = preset.settings.titleText ?? "";
  setSelectedValues(providerSelect, preset.settings.providers);
  setSelectedValues(platformSelect, preset.settings.platforms);
  setSelectedValues(tagSelect, preset.settings.tags);
  setSelectedValues(categorySelect, preset.settings.categories);
  setBooleanSelect(installedSelect, preset.settings.isInstalled);
  setBooleanSelect(playtimeSelect, preset.settings.hasPlaytime);
  releaseYearsInput.value = preset.settings.releaseYears?.join(", ") ?? "";
  andFilteringInput.checked = preset.settings.useAndFilteringStyle;
  sortOrderSelect.value = preset.sortingOrder;
  sortDirectionSelect.value = preset.sortingDirection;
  return readFilterState(preset.id, false);
}

export function selectedPresetId(): string {
  return presetSelect.value || DEFAULT_FILTER_PRESET_IDS.all;
}

export function selectedPresetIsDefault(): boolean {
  return isDefaultFilterPreset(selectedPresetId());
}

export function bindFilterControls(callback: (changeType: "preset" | "filter") => void): void {
  presetSelect.addEventListener("change", () => callback("preset"));

  let searchTimer: number | undefined;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => callback("filter"), 150);
  });

  const controls = [
    providerSelect,
    platformSelect,
    tagSelect,
    categorySelect,
    installedSelect,
    playtimeSelect,
    releaseYearsInput,
    andFilteringInput,
    sortOrderSelect,
    sortDirectionSelect
  ];
  for (const control of controls) {
    control.addEventListener("change", () => callback("filter"));
  }
}
