import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";

import {
  imageCacheBoundaryAction,
  type ImageCacheBoundaryAction,
} from "@/lib/image-cache-model";

const IMAGE_CACHE_ACCOUNT_KEY = "coverly:image-cache-account:v1";

export interface ImageCacheBoundaryResult {
  action: ImageCacheBoundaryAction;
  memoryCleared: boolean | null;
  diskCleared: boolean | null;
}

let boundaryQueue: Promise<void> = Promise.resolve();

async function applyImageCacheAccountBoundary(
  nextAccountId: string | null,
): Promise<ImageCacheBoundaryResult> {
  const previousAccountId = await AsyncStorage.getItem(IMAGE_CACHE_ACCOUNT_KEY);
  const action = imageCacheBoundaryAction(previousAccountId, nextAccountId);

  if (action === "keep") {
    return { action, memoryCleared: null, diskCleared: null };
  }

  const [memoryCleared, diskCleared] = await Promise.all([
    Image.clearMemoryCache().catch(() => false),
    Image.clearDiskCache().catch(() => false),
  ]);

  // Leave the previous owner marker intact when the disk clear fails. That
  // makes the next auth initialisation retry the boundary instead of treating
  // an incomplete privacy operation as successful.
  if (!diskCleared) {
    throw new Error("Could not clear the native image disk cache.");
  }

  if (nextAccountId) {
    await AsyncStorage.setItem(IMAGE_CACHE_ACCOUNT_KEY, nextAccountId);
  } else {
    await AsyncStorage.removeItem(IMAGE_CACHE_ACCOUNT_KEY);
  }

  return { action, memoryCleared, diskCleared };
}

/**
 * Serialises account-boundary cache work so a rapid A → signed-out → B auth
 * sequence cannot finish out of order. Stable account-scoped cache keys remain
 * the primary isolation guard while the native global cache clear is in flight.
 */
export function synchroniseImageCacheAccount(
  nextAccountId: string | null,
): Promise<ImageCacheBoundaryResult> {
  const result = boundaryQueue.then(() =>
    applyImageCacheAccountBoundary(nextAccountId),
  );
  boundaryQueue = result.then(() => undefined, () => undefined);
  return result;
}
