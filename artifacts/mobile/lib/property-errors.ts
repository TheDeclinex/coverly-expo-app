const UNSUPPORTED_PROPERTY_TYPE_MESSAGE =
  "This property type is not currently supported. Please choose another type or update the app.";

export type PropertyCreationErrorCode =
  | "PROPERTY_LIMIT_REACHED"
  | "PROPERTY_ALLOWANCE_UNAVAILABLE"
  | "PROPERTY_CREATION_FAILED";

export class PropertyCreationError extends Error {
  readonly errorCode: PropertyCreationErrorCode;
  readonly details: { propertyCount?: number; propertyLimit?: number; requiredPlan?: string };

  constructor(
    errorCode: PropertyCreationErrorCode,
    message: string,
    details: { propertyCount?: number; propertyLimit?: number; requiredPlan?: string } = {},
  ) {
    super(message);
    this.name = "PropertyCreationError";
    this.errorCode = errorCode;
    this.details = details;
  }
}

function errorField(error: unknown, field: "message" | "details") {
  if (typeof error !== "object" || error === null) return null;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function structuredDetails(error: unknown) {
  const value = errorField(error, "details");
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      propertyCount: typeof parsed.propertyCount === "number" ? parsed.propertyCount : undefined,
      propertyLimit: typeof parsed.propertyLimit === "number" ? parsed.propertyLimit : undefined,
      requiredPlan: typeof parsed.requiredPlan === "string" ? parsed.requiredPlan : undefined,
    };
  } catch {
    return {};
  }
}

export function formatPropertySaveError(error: unknown): string {
  const message = errorField(error, "message") ?? (error instanceof Error ? error.message : String(error ?? ""));
  if (/inventory_files_property_type_check/i.test(message) || /property_type/i.test(message)) {
    return UNSUPPORTED_PROPERTY_TYPE_MESSAGE;
  }
  return "Could not create property. Please try again.";
}

export function normalizePropertyCreationError(error: unknown): PropertyCreationError {
  const message = errorField(error, "message") ?? (error instanceof Error ? error.message : "");
  if (/PROPERTY_LIMIT_REACHED/i.test(message)) {
    return new PropertyCreationError(
      "PROPERTY_LIMIT_REACHED",
      "You've reached your property limit.",
      structuredDetails(error),
    );
  }
  if (/PROPERTY_ALLOWANCE_UNAVAILABLE/i.test(message)) {
    return new PropertyCreationError(
      "PROPERTY_ALLOWANCE_UNAVAILABLE",
      "We couldn't check your plan. Check your connection and try again.",
    );
  }
  return new PropertyCreationError("PROPERTY_CREATION_FAILED", formatPropertySaveError(error));
}
