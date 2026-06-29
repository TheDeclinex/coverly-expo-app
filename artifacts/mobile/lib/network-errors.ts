export const OFFLINE_RETRY_MESSAGE = "You appear to be offline. Check your connection and try again.";
export const NETWORK_RETRY_MESSAGE = "We couldn't complete that request. Check your connection and try again.";

export function friendlyNetworkErrorMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (
    normalized.includes("network request timed out") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return "The request timed out. Please try again.";
  }

  if (
    normalized.includes("network request failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized.includes("internet connection") ||
    normalized.includes("offline") ||
    normalized.includes("not connected")
  ) {
    return OFFLINE_RETRY_MESSAGE;
  }

  if (error instanceof TypeError && normalized.includes("network")) {
    return OFFLINE_RETRY_MESSAGE;
  }

  return null;
}

export function isLikelyNetworkError(error: unknown): boolean {
  return friendlyNetworkErrorMessage(error) !== null;
}