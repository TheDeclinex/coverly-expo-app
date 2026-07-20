import type { EmailOtpType } from "@supabase/supabase-js";

import {
  authLinkFingerprint,
  normalizeAuthEmail,
  parseAuthLink,
  passwordValidationError,
  type ParsedAuthLink,
} from "@/lib/auth-link-model";
import { supabase } from "@/lib/supabase";

export {
  authLinkFingerprint,
  normalizeAuthEmail,
  parseAuthLink,
  passwordValidationError,
} from "@/lib/auth-link-model";
export type { ParsedAuthLink } from "@/lib/auth-link-model";

// The live marketing/auth-fallback host is currently www.coverly.nz. Keep this
// aligned with the deployed website until the apex hostname resolves and serves
// the same routes without redirecting association-file requests.
export const COVERLY_WEB_ORIGIN = "https://www.coverly.nz";
export const EMAIL_VERIFIED_URL = `${COVERLY_WEB_ORIGIN}/auth/verified`;
export const PASSWORD_RESET_URL = `${COVERLY_WEB_ORIGIN}/reset-password`;

const OTP_TYPES: ReadonlySet<string> = new Set([
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

export type AuthLinkKind = "verification" | "recovery";

export function isRecoveryLink(parsed: ParsedAuthLink): boolean {
  return parsed.type === "recovery";
}

export function authLinkErrorMessage(kind: AuthLinkKind): string {
  return kind === "recovery"
    ? "This password reset link is invalid, expired, or has already been used. Request a new link and try again."
    : "We couldn't confirm this verification link. It may be invalid or expired. Try signing in or request a new verification email.";
}

export async function establishAuthLinkSession(url: string, kind: AuthLinkKind): Promise<void> {
  const parsed = parseAuthLink(url);
  if (parsed.errorDescription || !parsed.hasCredentials) {
    throw new Error("AUTH_LINK_INVALID");
  }
  if (kind === "recovery" && parsed.type && !isRecoveryLink(parsed)) {
    throw new Error("AUTH_LINK_WRONG_TYPE");
  }
  if (kind === "verification" && parsed.type === "recovery") {
    throw new Error("AUTH_LINK_WRONG_TYPE");
  }

  if (parsed.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (error) throw new Error("AUTH_LINK_EXCHANGE_FAILED");
    return;
  }

  if (parsed.tokenHash) {
    if (!parsed.type || !OTP_TYPES.has(parsed.type)) throw new Error("AUTH_LINK_WRONG_TYPE");
    const { error } = await supabase.auth.verifyOtp({
      token_hash: parsed.tokenHash,
      type: parsed.type as EmailOtpType,
    });
    if (error) throw new Error("AUTH_LINK_VERIFY_FAILED");
    return;
  }

  if (parsed.accessToken && parsed.refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    });
    if (error) throw new Error("AUTH_LINK_SESSION_FAILED");
    return;
  }

  throw new Error("AUTH_LINK_INVALID");
}
