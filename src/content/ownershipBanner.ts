import type { OwnershipMatch } from "../shared/types";

const BANNER_ID = "owncheck-games-banner";
const dismissedUrls = new Set<string>();

export function resetOwnershipBannerStateForTests(): void {
  dismissedUrls.clear();
  document.getElementById(BANNER_ID)?.remove();
}

export function renderOwnershipBanner(matches: OwnershipMatch[], pageUrl = window.location.href): void {
  if (matches.length === 0 || dismissedUrls.has(pageUrl)) {
    return;
  }
  if (document.getElementById(BANNER_ID)) {
    return;
  }

  const host = document.createElement("div");
  host.id = BANNER_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .bar {
      position: fixed;
      z-index: 2147483647;
      top: 0;
      left: 0;
      right: 0;
      min-height: 38px;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 8px 14px;
      background: #12312b;
      color: #f7fff9;
      font: 14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 3px 16px rgba(0, 0, 0, 0.22);
    }
    button {
      border: 1px solid rgba(255, 255, 255, 0.45);
      background: transparent;
      color: inherit;
      border-radius: 4px;
      min-height: 28px;
      padding: 2px 8px;
      cursor: pointer;
    }
    button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  `;

  const bar = document.createElement("div");
  bar.className = "bar";
  bar.role = "status";

  const text = document.createElement("span");
  if (matches.length === 1) {
    const match = matches[0]!;
    text.textContent = `You already own: ${match.canonicalTitle} · Source: ${match.providers.join(", ")}`;
  } else {
    text.textContent = `You already own ${matches.length} games on this page: ${matches
      .slice(0, 3)
      .map((match) => match.canonicalTitle)
      .join(", ")}`;
  }

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Dismiss";
  closeButton.setAttribute("aria-label", "Dismiss LootCheck ownership banner");
  closeButton.addEventListener("click", () => {
    dismissedUrls.add(pageUrl);
    host.remove();
  });

  bar.append(text, closeButton);
  shadow.append(style, bar);
  document.documentElement.append(host);
}
