export const DUPLICATE_ROOM_NAME_MESSAGE =
  "A room with this name already exists in this property. Please choose another name.";

const ROOM_NAME_UNIQUE_CONSTRAINT = "idx_inventory_rooms_file_name_unique";

export type ActiveRoomName = {
  name: string;
  archived_at?: string | null;
};

export function normalizeRoomName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function hasActiveRoomNameDuplicate(
  rooms: readonly ActiveRoomName[],
  candidateName: string,
): boolean {
  const normalizedCandidate = normalizeRoomName(candidateName);
  return rooms.some(
    (room) =>
      room.archived_at == null && normalizeRoomName(room.name) === normalizedCandidate,
  );
}

type DatabaseError = Record<string, unknown> & {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  constraint?: unknown;
  constraint_name?: unknown;
  cause?: unknown;
};

function asDatabaseError(error: unknown): DatabaseError | null {
  return typeof error === "object" && error !== null ? (error as DatabaseError) : null;
}

function errorText(error: DatabaseError): string {
  return [error.message, error.details, error.hint, error.constraint, error.constraint_name]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function isRoomNameDuplicateError(error: unknown): boolean {
  const databaseError = asDatabaseError(error);
  if (!databaseError) return false;

  const text = errorText(databaseError);
  const namesRoomConstraint = text.includes(ROOM_NAME_UNIQUE_CONSTRAINT);
  const namesDifferentConstraint = /(?:constraint|index)\s+["']?([\w.-]+)["']?/i.exec(text)?.[1]
    ?.toLowerCase();
  const isUniqueViolation = String(databaseError.code ?? "") === "23505";

  if (namesRoomConstraint) return true;
  if (isUniqueViolation && !namesDifferentConstraint) return true;
  if (isUniqueViolation && namesDifferentConstraint === ROOM_NAME_UNIQUE_CONSTRAINT) return true;

  return databaseError.cause !== databaseError && isRoomNameDuplicateError(databaseError.cause);
}

export function formatRoomCreationError(error: unknown): string {
  if (isRoomNameDuplicateError(error)) {
    return DUPLICATE_ROOM_NAME_MESSAGE;
  }

  return "We couldn't create this room. Please try again.";
}
