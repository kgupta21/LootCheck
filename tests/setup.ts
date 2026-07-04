import "fake-indexeddb/auto";
import { afterEach } from "vitest";
import { deleteOwnCheckDb, resetDatabaseConnectionForTests } from "../src/db/indexedDb";

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      randomUUID: () => `test-${Math.random().toString(16).slice(2)}`
    }
  });
}

afterEach(async () => {
  await deleteOwnCheckDb().catch(() => undefined);
  resetDatabaseConnectionForTests();
});
