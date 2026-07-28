export const NEW_PASSWORD_REQUIREMENTS_MESSAGE =
  "Use at least 8 characters with uppercase, lowercase, a number and a special character.";

export const NEW_PASSWORD_POLICY_ERROR =
  "Password must use at least 8 characters with uppercase, lowercase, a number and a special character.";

// Supabase's native symbols policy accepts normal ASCII punctuation.
const SUPABASE_PASSWORD_SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

export function newPasswordValidationError(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(password)) return "Password must include a number.";
  if (![...password].some((character) => SUPABASE_PASSWORD_SYMBOLS.includes(character))) {
    return "Password must include a special character.";
  }
  return null;
}

export function newPasswordAuthErrorMessage(error: { code?: string; message: string }): string | null {
  const code = error.code?.toLowerCase() ?? "";
  const message = error.message.toLowerCase();
  const isPasswordPolicyError =
    code === "weak_password" ||
    message.includes("weak password") ||
    message.includes("password should") ||
    message.includes("password must") ||
    message.includes("password is too short") ||
    (message.includes("password") &&
      ["uppercase", "lowercase", "character", "digit", "number", "symbol"].some((term) =>
        message.includes(term),
      ));

  return isPasswordPolicyError ? NEW_PASSWORD_POLICY_ERROR : null;
}
