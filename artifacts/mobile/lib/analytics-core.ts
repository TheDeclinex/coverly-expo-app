export const ANALYTICS_INSTALLATION_ID_KEY =
  "coverly:analytics:installation_id";
export const ANALYTICS_HAS_OPENED_KEY = "coverly:analytics:has_opened";
export const ANALYTICS_LAST_ACTIVE_PREFIX = "coverly:analytics:last_active";
export const LAST_ACTIVE_THROTTLE_MS = 15 * 60 * 1000;

export type AnalyticsFailureCategory =
  | "network"
  | "timeout"
  | "upload"
  | "authentication"
  | "usage_limit"
  | "processing"
  | "configuration"
  | "store"
  | "cancelled"
  | "unknown";

export type AnalyticsScanMode =
  | "single_photo"
  | "multi_photo"
  | "video"
  | "single_item";

export type AnalyticsSourceScreen =
  | "account"
  | "property_limit"
  | "claim_pack"
  | "ai_scan"
  | "replacement_pricing"
  | "upgrade"
  | "unknown";

type AppActivityProperties = {
  is_first_open?: boolean;
  authenticated?: boolean;
};

type InventoryProperties = {
  property_count?: number;
  room_count?: number;
  entry_method?: "manual";
};

type ScanProperties = {
  scan_mode?: AnalyticsScanMode;
  image_count?: number;
  items_detected_count?: number;
  duration_ms?: number;
  failure_category?: AnalyticsFailureCategory;
  credit_cost?: number;
};

type ReplacementSearchProperties = {
  result_count?: number;
  duration_ms?: number;
  refined_search_used?: boolean;
  failure_category?: AnalyticsFailureCategory;
  credit_refunded?: boolean;
};

type ClaimPackProperties = {
  room_count?: number;
  item_count?: number;
  evidence_file_count?: number;
  duration_ms?: number;
  delivery_method?: "in_app" | "email" | "share" | "download" | "unknown";
  failure_category?: AnalyticsFailureCategory;
};

type BillingProperties = {
  plan?: "plus" | "family";
  billing_period?: "monthly" | "annual";
  product_identifier?: string;
  source_screen?: AnalyticsSourceScreen;
  failure_category?: AnalyticsFailureCategory;
};

type ReviewProperties = {
  trigger?: "third_successful_ai_scan";
  successful_scan_count?: number;
  source_screen?: "account";
  store_platform?: "ios" | "android";
};

export interface AnalyticsEventProperties {
  app_opened: AppActivityProperties;
  app_foregrounded: AppActivityProperties;
  property_created: InventoryProperties;
  room_created: InventoryProperties;
  item_created_manually: InventoryProperties;
  scan_started: ScanProperties;
  scan_completed: ScanProperties;
  scan_failed: ScanProperties;
  replacement_search_started: ReplacementSearchProperties;
  replacement_search_completed: ReplacementSearchProperties;
  replacement_search_failed: ReplacementSearchProperties;
  claim_pack_started: ClaimPackProperties;
  claim_pack_completed: ClaimPackProperties;
  claim_pack_failed: ClaimPackProperties;
  paywall_viewed: BillingProperties;
  purchase_started: BillingProperties;
  purchase_completed: BillingProperties;
  purchase_failed: BillingProperties;
  purchase_restored: BillingProperties;
  review_prompt_eligible: ReviewProperties;
  review_prompt_requested: ReviewProperties;
  review_store_link_opened: ReviewProperties;
}

export type AnalyticsEventName = keyof AnalyticsEventProperties;

export interface AnalyticsEventInsert {
  user_id: string;
  installation_id: string;
  session_id: string;
  event_name: AnalyticsEventName;
  platform: string;
  app_version: string;
  build_number: string;
  properties: Record<string, boolean | number | string>;
}

export interface AnalyticsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface AnalyticsClientDependencies {
  storage: AnalyticsStorage;
  getUserId(): Promise<string | null>;
  insertEvent(event: AnalyticsEventInsert): Promise<void>;
  touchLastActive(): Promise<void>;
  getAppMetadata(): {
    platform: string;
    appVersion: string | null;
    buildNumber: string | null;
  };
  createUuid?: () => string;
  now?: () => number;
  development?: boolean;
  log?: (message: string, properties?: Record<string, unknown>) => void;
  warn?: (message: string) => void;
}

const EVENT_PROPERTY_KEYS: Record<AnalyticsEventName, readonly string[]> = {
  app_opened: ["is_first_open", "authenticated"],
  app_foregrounded: ["authenticated"],
  property_created: ["property_count"],
  room_created: ["room_count"],
  item_created_manually: ["entry_method"],
  scan_started: ["scan_mode", "image_count", "credit_cost"],
  scan_completed: [
    "scan_mode",
    "image_count",
    "items_detected_count",
    "duration_ms",
    "credit_cost",
  ],
  scan_failed: [
    "scan_mode",
    "image_count",
    "duration_ms",
    "failure_category",
    "credit_cost",
  ],
  replacement_search_started: ["refined_search_used"],
  replacement_search_completed: [
    "result_count",
    "duration_ms",
    "refined_search_used",
    "credit_refunded",
  ],
  replacement_search_failed: [
    "duration_ms",
    "refined_search_used",
    "failure_category",
    "credit_refunded",
  ],
  claim_pack_started: ["room_count", "item_count", "evidence_file_count"],
  claim_pack_completed: [
    "room_count",
    "item_count",
    "evidence_file_count",
    "duration_ms",
    "delivery_method",
  ],
  claim_pack_failed: [
    "room_count",
    "item_count",
    "evidence_file_count",
    "duration_ms",
    "failure_category",
  ],
  paywall_viewed: ["source_screen"],
  purchase_started: [
    "plan",
    "billing_period",
    "product_identifier",
    "source_screen",
  ],
  purchase_completed: [
    "plan",
    "billing_period",
    "product_identifier",
    "source_screen",
  ],
  purchase_failed: [
    "plan",
    "billing_period",
    "product_identifier",
    "source_screen",
    "failure_category",
  ],
  purchase_restored: ["source_screen"],
  review_prompt_eligible: ["trigger", "successful_scan_count"],
  review_prompt_requested: ["trigger", "successful_scan_count"],
  review_store_link_opened: ["source_screen", "store_platform"],
};

const BOOLEAN_KEYS = new Set([
  "authenticated",
  "is_first_open",
  "refined_search_used",
  "credit_refunded",
]);
const NUMBER_KEYS = new Set([
  "property_count",
  "room_count",
  "image_count",
  "items_detected_count",
  "duration_ms",
  "credit_cost",
  "result_count",
  "item_count",
  "evidence_file_count",
  "successful_scan_count",
]);
const FAILURE_CATEGORIES = new Set<AnalyticsFailureCategory>([
  "network",
  "timeout",
  "upload",
  "authentication",
  "usage_limit",
  "processing",
  "configuration",
  "store",
  "cancelled",
  "unknown",
]);
const SCAN_MODES = new Set<AnalyticsScanMode>([
  "single_photo",
  "multi_photo",
  "video",
  "single_item",
]);
const SOURCE_SCREENS = new Set<AnalyticsSourceScreen>([
  "account",
  "property_limit",
  "claim_pack",
  "ai_scan",
  "replacement_pricing",
  "upgrade",
  "unknown",
]);

function allowedStringValue(key: string, value: string): boolean {
  if (key === "entry_method") return value === "manual";
  if (key === "scan_mode") return SCAN_MODES.has(value as AnalyticsScanMode);
  if (key === "failure_category")
    return FAILURE_CATEGORIES.has(value as AnalyticsFailureCategory);
  if (key === "plan") return value === "plus" || value === "family";
  if (key === "billing_period")
    return value === "monthly" || value === "annual";
  if (key === "source_screen")
    return SOURCE_SCREENS.has(value as AnalyticsSourceScreen);
  if (key === "delivery_method")
    return ["in_app", "email", "share", "download", "unknown"].includes(value);
  if (key === "product_identifier")
    return /^[A-Za-z0-9._:$-]{1,160}$/.test(value);
  if (key === "trigger") return value === "third_successful_ai_scan";
  if (key === "store_platform") return value === "ios" || value === "android";
  return false;
}

export function sanitizeEventProperties(
  eventName: AnalyticsEventName,
  properties: unknown,
): Record<string, boolean | number | string> {
  if (
    !properties ||
    typeof properties !== "object" ||
    Array.isArray(properties)
  )
    return {};
  const input = properties as Record<string, unknown>;
  const allowedKeys = new Set(EVENT_PROPERTY_KEYS[eventName]);
  const sanitized: Record<string, boolean | number | string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!allowedKeys.has(key)) continue;
    if (BOOLEAN_KEYS.has(key) && typeof value === "boolean") {
      sanitized[key] = value;
    } else if (
      NUMBER_KEYS.has(key) &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0
    ) {
      sanitized[key] = Math.round(value);
    } else if (typeof value === "string" && allowedStringValue(key, value)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function analyticsScanMode(mode: string): AnalyticsScanMode {
  if (mode === "multi_photo_room") return "multi_photo";
  if (mode === "video_room") return "video";
  if (mode === "single_item") return "single_item";
  return "single_photo";
}

export function analyticsSourceScreen(
  source: string | null | undefined,
): AnalyticsSourceScreen {
  if (source === "property") return "property_limit";
  if (
    source === "claim_pack" ||
    source === "ai_scan" ||
    source === "replacement_pricing"
  )
    return source;
  if (source === "account") return "account";
  if (source === "upgrade") return "upgrade";
  return "unknown";
}

export function categorizeAnalyticsFailure(input: {
  status?: number | null;
  code?: string | null;
  message?: string | null;
}): AnalyticsFailureCategory {
  const code = input.code?.toLowerCase() ?? "";
  const message = input.message?.toLowerCase() ?? "";
  const combined = `${code} ${message}`;
  if (
    input.status === 401 ||
    input.status === 403 ||
    /auth|session|jwt|unauthor/.test(combined)
  )
    return "authentication";
  if (input.status === 402 || /limit|allowance|usage|credit/.test(combined))
    return "usage_limit";
  if (/timeout|timed out|abort/.test(combined)) return "timeout";
  if (/upload/.test(combined)) return "upload";
  if (/network|offline|fetch|connection/.test(combined)) return "network";
  if (
    /config|not configured|missing product|unavailable in this build/.test(
      combined,
    )
  )
    return "configuration";
  if (/purchase|billing|revenuecat|store|product/.test(combined))
    return "store";
  if (
    (input.status != null && input.status >= 500) ||
    /processing|service|edge.function|scan|claim|pdf/.test(combined)
  )
    return "processing";
  return "unknown";
}

export function createAnalyticsUuid(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (character) => {
      const random = (Math.random() * 16) | 0;
      return (character === "x" ? random : (random & 0x3) | 0x8).toString(16);
    },
  );
}

export function createAnalyticsClient(
  dependencies: AnalyticsClientDependencies,
) {
  const now = dependencies.now ?? Date.now;
  const createUuid = dependencies.createUuid ?? createAnalyticsUuid;
  const sessionId = createUuid();
  let installationPromise: Promise<{
    id: string;
    isFirstOpen: boolean;
  }> | null = null;
  let appOpenedPromise: Promise<boolean> | null = null;
  let appOpenedRecorded = false;
  let lastActivePromise: Promise<boolean> | null = null;

  const developmentLog = (
    eventName: AnalyticsEventName,
    properties: Record<string, boolean | number | string>,
  ) => {
    if (!dependencies.development) return;
    dependencies.log?.(`[analytics] ${eventName}`, properties);
  };

  const developmentWarning = (message: string) => {
    if (dependencies.development) dependencies.warn?.(`[analytics] ${message}`);
  };

  const installation = () => {
    if (installationPromise) return installationPromise;
    installationPromise = (async () => {
      try {
        let id = await dependencies.storage.getItem(
          ANALYTICS_INSTALLATION_ID_KEY,
        );
        if (!id) {
          id = createUuid();
          await dependencies.storage.setItem(ANALYTICS_INSTALLATION_ID_KEY, id);
        }
        const hasOpened = await dependencies.storage.getItem(
          ANALYTICS_HAS_OPENED_KEY,
        );
        if (hasOpened !== "1") {
          await dependencies.storage.setItem(ANALYTICS_HAS_OPENED_KEY, "1");
        }
        return { id, isFirstOpen: hasOpened !== "1" };
      } catch {
        developmentWarning(
          "local installation metadata could not be persisted",
        );
        return { id: createUuid(), isFirstOpen: true };
      }
    })();
    return installationPromise;
  };

  const sendEvent = async <EventName extends AnalyticsEventName>(
    eventName: EventName,
    properties?: AnalyticsEventProperties[EventName],
  ): Promise<boolean> => {
    try {
      const [installationContext, userId] = await Promise.all([
        installation(),
        dependencies.getUserId(),
      ]);
      if (!userId) return false;
      const sanitized = sanitizeEventProperties(eventName, properties);
      const metadata = dependencies.getAppMetadata();
      developmentLog(eventName, sanitized);
      await dependencies.insertEvent({
        user_id: userId,
        installation_id: installationContext.id,
        session_id: sessionId,
        event_name: eventName,
        platform: metadata.platform,
        app_version: metadata.appVersion ?? "unknown",
        build_number: metadata.buildNumber ?? "unknown",
        properties: sanitized,
      });
      return true;
    } catch {
      developmentWarning(`${eventName} could not be sent`);
      return false;
    }
  };

  const trackEvent = async <EventName extends AnalyticsEventName>(
    eventName: EventName,
    properties?: AnalyticsEventProperties[EventName],
  ): Promise<void> => {
    await sendEvent(eventName, properties);
  };

  const recordAppOpened = async (): Promise<void> => {
    if (appOpenedRecorded) return;
    if (appOpenedPromise) {
      await appOpenedPromise;
      return;
    }
    appOpenedPromise = (async () => {
      const [installationContext, userId] = await Promise.all([
        installation(),
        dependencies.getUserId(),
      ]);
      if (!userId) return false;
      const recorded = await sendEvent("app_opened", {
        is_first_open: installationContext.isFirstOpen,
        authenticated: true,
      });
      if (recorded) appOpenedRecorded = true;
      return recorded;
    })();
    try {
      await appOpenedPromise;
    } catch {
      developmentWarning("app_opened could not be sent");
    } finally {
      appOpenedPromise = null;
    }
  };

  const updateLastActive = async (): Promise<void> => {
    if (lastActivePromise) {
      await lastActivePromise;
      return;
    }
    lastActivePromise = (async () => {
      try {
        const [installationContext, userId] = await Promise.all([
          installation(),
          dependencies.getUserId(),
        ]);
        if (!userId) return false;
        const storageKey = `${ANALYTICS_LAST_ACTIVE_PREFIX}:${installationContext.id}:${userId}`;
        const lastWrite = Number(
          await dependencies.storage.getItem(storageKey),
        );
        const currentTime = now();
        if (
          Number.isFinite(lastWrite) &&
          currentTime - lastWrite < LAST_ACTIVE_THROTTLE_MS
        )
          return false;
        await dependencies.touchLastActive();
        await dependencies.storage.setItem(storageKey, String(currentTime));
        return true;
      } catch {
        developmentWarning("last-active update failed");
        return false;
      }
    })();
    try {
      await lastActivePromise;
    } finally {
      lastActivePromise = null;
    }
  };

  return {
    sessionId,
    trackEvent,
    recordAppOpened,
    updateLastActive,
  };
}
