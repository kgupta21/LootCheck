import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { renderEpicFeasibilityDetails, renderEpicManualImportHelp } from "../../src/options/epicProviderPanel";

describe("Epic provider panel", () => {
  it("renders feasibility details visibly in the card", () => {
    const window = new Window();
    const host = window.document.createElement("div") as unknown as HTMLElement;

    renderEpicFeasibilityDetails(host, "DEFERRED_UNTIL_SAFE_AUTH_PATH_EXISTS", "docs/providers/epic-feasibility.md");

    expect(host.textContent).toContain("Epic feasibility");
    expect(host.textContent).toContain("DEFERRED_UNTIL_SAFE_AUTH_PATH_EXISTS");
    expect(host.textContent).toContain("docs/providers/epic-feasibility.md");
  });

  it("renders manual import help visibly in the card", () => {
    const window = new Window();
    const host = window.document.createElement("div") as unknown as HTMLElement;

    renderEpicManualImportHelp(host);

    expect(host.textContent).toContain("Manual import help");
    expect(host.textContent).toContain("JSON or CSV");
    expect(host.textContent).toContain("title column");
  });
});
