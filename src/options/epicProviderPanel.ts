export function renderEpicFeasibilityDetails(host: HTMLElement, decision: string, notesDocumentPath: string): void {
  host.replaceChildren();
  const title = host.ownerDocument.createElement("strong");
  title.textContent = "Epic feasibility";
  const summary = host.ownerDocument.createElement("p");
  summary.textContent = `Decision: ${decision}. Notes: ${notesDocumentPath}. Direct Epic import remains disabled until a safe Firefox-compatible auth path is confirmed.`;
  host.append(title, summary);
}

export function renderEpicManualImportHelp(host: HTMLElement): void {
  host.replaceChildren();
  const title = host.ownerDocument.createElement("strong");
  title.textContent = "Manual import help";
  const summary = host.ownerDocument.createElement("p");
  summary.textContent = "Use Manual Import with a JSON or CSV list of Epic-owned games. CSV needs a title column; JSON can be an array of objects with title, aliases, platforms, and tags.";
  host.append(title, summary);
}
