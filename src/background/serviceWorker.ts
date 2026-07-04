import { routeMessage } from "./messageRouter";
import { initializeSyncScheduler } from "./syncScheduler";

void initializeSyncScheduler();

browser.runtime.onMessage.addListener((message) => {
  return routeMessage(message);
});

browser.action?.onClicked.addListener(() => {
  void browser.runtime.openOptionsPage();
});
