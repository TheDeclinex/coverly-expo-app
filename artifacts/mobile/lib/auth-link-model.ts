export interface ParsedAuthLink {
  code: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenHash: string | null;
  type: string | null;
  errorDescription: string | null;
  hasCredentials: boolean;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

export function parseAuthLink(url: string): ParsedAuthLink {
  const hashStart = url.indexOf("#");
  const hash = hashStart >= 0 ? url.slice(hashStart + 1) : "";
  const withoutHash = hashStart >= 0 ? url.slice(0, hashStart) : url;
  const queryStart = withoutHash.indexOf("?");
  const query = queryStart >= 0 ? withoutHash.slice(queryStart + 1) : "";
  const params = new URLSearchParams(query);
  const fragmentParams = new URLSearchParams(hash);
  const get = (key: string) => fragmentParams.get(key) ?? params.get(key);

  const code = get("code");
  const accessToken = get("access_token");
  const refreshToken = get("refresh_token");
  const tokenHash = get("token_hash");
  const type = get("type");
  const rawError = get("error_description") ?? get("error");

  return {
    code,
    accessToken,
    refreshToken,
    tokenHash,
    type,
    errorDescription: rawError ? safeDecode(rawError) : null,
    hasCredentials: Boolean(code || tokenHash || (accessToken && refreshToken)),
  };
}

export function authLinkFingerprint(url: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function passwordValidationError(password: string, confirmation: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password !== confirmation) return "Passwords do not match.";
  return null;
}

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}
