import { renderOwnershipBanner } from "./ownershipBanner";
import { extractTitleCandidates, getPageContext } from "./titleExtractors";
import type { CheckOwnershipMessage, OwnershipResultMessage } from "../shared/types";

async function runPageCheck(): Promise<void> {
  if (window.top !== window || location.protocol === "about:" || location.protocol === "moz-extension:") {
    return;
  }

  const message: CheckOwnershipMessage = {
    type: "CHECK_OWNERSHIP",
    payload: {
      url: location.href,
      titleCandidates: extractTitleCandidates(),
      pageContext: getPageContext()
    }
  };

  const response = (await browser.runtime.sendMessage(message)) as OwnershipResultMessage | undefined;
  if (response?.type === "OWNERSHIP_RESULT" && response.payload.matches.length > 0) {
    renderOwnershipBanner(response.payload.matches);
  }
}

runPageCheck().catch(() => undefined);
