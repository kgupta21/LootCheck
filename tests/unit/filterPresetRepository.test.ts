import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER_PRESET_IDS } from "../../src/filters/filterPreset";
import { FilterPresetRepository } from "../../src/db/repositories";

describe("FilterPresetRepository", () => {
  it("creates default presets idempotently", async () => {
    const repository = new FilterPresetRepository();

    await repository.ensureDefaultFilterPresets();
    await repository.ensureDefaultFilterPresets();

    const presets = await repository.listFilterPresets();
    expect(presets).toHaveLength(4);
    expect(presets.map((preset) => preset.id).sort()).toEqual(Object.values(DEFAULT_FILTER_PRESET_IDS).sort());
  });
});
