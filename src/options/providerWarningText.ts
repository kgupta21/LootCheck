import type { SyncRunWarning } from "../shared/types";

export function latestWarningText(warning: SyncRunWarning | undefined): string | undefined {
  return warning ? `${warning.code}: ${warning.message}` : undefined;
}
