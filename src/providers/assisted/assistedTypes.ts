import type { StoreId } from "../../shared/types";

export type AssistedProviderId = Extract<StoreId, "steam" | "amazon">;

export interface AssistedSessionGame {
  providerGameId: string;
  title: string;
  sourceUrl?: string;
  playtimeMinutes?: number;
  isInstalled?: boolean;
}

export interface AssistedSessionWarning {
  code: string;
  message: string;
  providerGameId?: string;
}

export interface AssistedSessionExtractionResult {
  providerId: AssistedProviderId;
  games: AssistedSessionGame[];
  accountMarker?: string;
  source: "visible" | "embeddedJson" | "graphql" | "combined";
  warnings: AssistedSessionWarning[];
}
