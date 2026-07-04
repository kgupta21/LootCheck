import type { StoreId } from "../shared/types";
import type { GameStoreProvider } from "./Provider";
import { AmazonProvider } from "./amazon/AmazonProvider";
import { EpicProvider } from "./epic/EpicProvider";
import { GogProvider } from "./gog/GogProvider";
import { ManualImportProvider } from "./manual/ManualImportProvider";
import { SteamProvider } from "./steam/SteamProvider";

const providers = new Map<StoreId, GameStoreProvider>();

export function registerProvider(provider: GameStoreProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: StoreId): GameStoreProvider | undefined {
  return providers.get(id);
}

export function listProviders(): GameStoreProvider[] {
  return [...providers.values()];
}

export function providerSummary(provider: GameStoreProvider) {
  return {
    id: provider.id,
    displayName: provider.displayName,
    supportsAuth: provider.supportsAuth,
    supportsManualImport: provider.supportsManualImport,
    supportsBackgroundSync: provider.supportsBackgroundSync,
    ...(provider.accountPolicy ? { accountPolicy: provider.accountPolicy } : {})
  };
}

export function resetProviderRegistryForTests(): void {
  providers.clear();
}

export function registerDefaultProviders(): void {
  if (providers.size > 0) {
    return;
  }
  registerProvider(new ManualImportProvider());
  registerProvider(new SteamProvider());
  registerProvider(new GogProvider());
  registerProvider(new EpicProvider());
  registerProvider(new AmazonProvider());
}

registerDefaultProviders();
