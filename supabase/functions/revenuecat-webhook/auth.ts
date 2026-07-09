const SIGNATURE_TOLERANCE_SECONDS = 300;

export type RevenueCatWebhookAuthConfig = {
  bearerSecret: string;
  signingSecret: string;
  allowInsecure?: boolean;
};

export type RevenueCatWebhookHeaders = {
  authorization: string | null;
  signature: string | null;
};

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export async function verifyRevenueCatSignature(rawBody: string, header: string | null, secret: string) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((part) => {
    const separator = part.indexOf("=");
    return separator === -1 ? [part.trim(), ""] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const computed = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`)));
  return constantTimeEqual(computed, expected);
}

export async function authorizeRevenueCatWebhook(
  headers: RevenueCatWebhookHeaders,
  rawBody: string,
  config: RevenueCatWebhookAuthConfig,
) {
  if (!config.bearerSecret && !config.signingSecret) return config.allowInsecure ? true : "server_not_configured";
  if (config.bearerSecret && headers.authorization !== `Bearer ${config.bearerSecret}`) return "unauthorized";
  if (config.signingSecret) {
    const ok = await verifyRevenueCatSignature(rawBody, headers.signature, config.signingSecret);
    if (!ok) return "invalid_signature";
  }
  return true;
}

export function revenueCatAuthHttpStatus(result: true | string) {
  if (result === true) return 200;
  return result === "server_not_configured" ? 500 : 401;
}
