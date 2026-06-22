/**
 * Native billing integration boundary.
 * RevenueCat is intentionally not connected yet; callers must present this
 * unavailable state rather than inferring purchases or entitlements locally.
 */
export const billingAvailability = {
  isConfigured: false,
  statusLabel: "Billing setup pending",
} as const;
