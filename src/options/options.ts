import { DEFAULT_FILTER_PRESET_IDS, createFilterPreset, isDefaultFilterPreset } from "../filters/filterPreset";
import { gameMatchesFilter } from "../filters/filterEngine";
import { sortGames } from "../filters/sortEngine";
import { FilterPresetRepository, GameRepository, SyncRunRepository } from "../db/repositories";
import { parseManualImportText } from "../providers/manual/ManualImportProvider";
import {
  applyPresetToControls,
  bindFilterControls,
  facetsFromGames,
  readFilterState,
  renderFilterFacets,
  renderPresetOptions,
  selectedPresetId,
  selectedPresetIsDefault
} from "./filterControls";
import { renderLibrary } from "./libraryBrowser";
import { initializeProviderSettings } from "./providerSettings";
import type { BrowserFilterState } from "./filterControls";
import type { FilterPreset, GameRecord } from "../shared/types";

const gameRepository = new GameRepository();
const syncRunRepository = new SyncRunRepository();
const filterPresetRepository = new FilterPresetRepository();

const importInput = document.querySelector<HTMLInputElement>("#manual-import-input")!;
const statusElement = document.querySelector<HTMLElement>("#status")!;
const clearButton = document.querySelector<HTMLButtonElement>("#clear-data-button")!;
const savePresetButton = document.querySelector<HTMLButtonElement>("#save-preset-button")!;
const deletePresetButton = document.querySelector<HTMLButtonElement>("#delete-preset-button")!;
const resetFiltersButton = document.querySelector<HTMLButtonElement>("#reset-filters-button")!;

let allGames: GameRecord[] = [];
let presets: FilterPreset[] = [];
let filterState: BrowserFilterState;

function setStatus(message: string): void {
  statusElement.textContent = message;
}

function currentPreset(): FilterPreset {
  return presets.find((preset) => preset.id === selectedPresetId()) ?? presets.find((preset) => preset.id === DEFAULT_FILTER_PRESET_IDS.all)!;
}

function applyCurrentFilters(): void {
  const filtered = allGames.filter((game) => gameMatchesFilter(game, filterState.settings));
  renderLibrary(sortGames(filtered, filterState.sortingOrder, filterState.sortingDirection), allGames.length);
  deletePresetButton.disabled = selectedPresetIsDefault();
}

async function loadPresets(selectedId: string = DEFAULT_FILTER_PRESET_IDS.all): Promise<void> {
  await filterPresetRepository.ensureDefaultFilterPresets();
  presets = await filterPresetRepository.listFilterPresets();
  renderPresetOptions(presets, selectedId);
  filterState = applyPresetToControls(currentPreset());
}

async function refreshLibraryData(): Promise<void> {
  allGames = await gameRepository.getAllGames();
  renderFilterFacets(facetsFromGames(allGames));
  applyCurrentFilters();
}

async function initializeOptions(): Promise<void> {
  await loadPresets();
  await refreshLibraryData();
  await initializeProviderSettings(setStatus, refreshLibraryData);
}

bindFilterControls((changeType) => {
  if (changeType === "preset") {
    filterState = applyPresetToControls(currentPreset());
  } else {
    filterState = readFilterState(selectedPresetId(), true);
  }
  applyCurrentFilters();
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  if (!file) {
    return;
  }

  try {
    setStatus(`Importing ${file.name}...`);
    const result = parseManualImportText(await file.text(), file.name);
    const summary = await gameRepository.importProviderResult(result);
    await syncRunRepository.recordManualImport(result.providerId, summary.importedCount, summary.warningCount);
    setStatus(`Imported ${summary.importedCount} games with ${summary.warningCount} warnings.`);
    await refreshLibraryData();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown import error.";
    await syncRunRepository.recordManualImport("manual", 0, 0, message);
    setStatus(`Import failed: ${message}`);
  } finally {
    importInput.value = "";
  }
});

savePresetButton.addEventListener("click", async () => {
  const state = readFilterState(selectedPresetId(), false);
  const existing = presets.find((preset) => preset.id === selectedPresetId());
  const name =
    existing && !isDefaultFilterPreset(existing.id)
      ? existing.name
      : window.prompt("Preset name", existing && isDefaultFilterPreset(existing.id) ? `${existing.name} copy` : "Custom preset");

  if (!name?.trim()) {
    return;
  }

  const timestamp = new Date().toISOString();
  const preset =
    existing && !isDefaultFilterPreset(existing.id)
      ? {
          ...existing,
          settings: state.settings,
          sortingOrder: state.sortingOrder,
          sortingDirection: state.sortingDirection,
          updatedAt: timestamp
        }
      : createFilterPreset(name.trim(), state.settings, state.sortingOrder, state.sortingDirection);

  await filterPresetRepository.saveFilterPreset(preset);
  await loadPresets(preset.id);
  await refreshLibraryData();
  setStatus(`Saved preset "${preset.name}".`);
});

deletePresetButton.addEventListener("click", async () => {
  const id = selectedPresetId();
  if (isDefaultFilterPreset(id)) {
    return;
  }
  const preset = presets.find((candidate) => candidate.id === id);
  if (!preset || !window.confirm(`Delete preset "${preset.name}"?`)) {
    return;
  }
  await filterPresetRepository.deleteFilterPreset(id);
  await loadPresets(DEFAULT_FILTER_PRESET_IDS.all);
  await refreshLibraryData();
  setStatus(`Deleted preset "${preset.name}".`);
});

resetFiltersButton.addEventListener("click", async () => {
  await loadPresets(DEFAULT_FILTER_PRESET_IDS.all);
  await refreshLibraryData();
});

clearButton.addEventListener("click", async () => {
  const confirmed = confirm("Delete all local LootCheck data?");
  if (!confirmed) {
    return;
  }
  await gameRepository.clearAllData();
  await filterPresetRepository.ensureDefaultFilterPresets();
  await loadPresets(DEFAULT_FILTER_PRESET_IDS.all);
  await refreshLibraryData();
  setStatus("Deleted local LootCheck data.");
});

initializeOptions().catch((error) => setStatus(error instanceof Error ? error.message : "Failed to load options."));
