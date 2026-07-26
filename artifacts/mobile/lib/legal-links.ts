export const COVERLY_PRIVACY_POLICY_URL = "https://www.coverly.nz/privacy-policy";
export const COVERLY_TERMS_URL = "https://www.coverly.nz/terms";

export interface CoverlyLegalDocument {
  title: "Privacy policy" | "Terms";
  url: string;
}

export const COVERLY_LEGAL_DOCUMENTS = {
  privacy: {
    title: "Privacy policy",
    url: COVERLY_PRIVACY_POLICY_URL,
  },
  terms: {
    title: "Terms",
    url: COVERLY_TERMS_URL,
  },
} as const satisfies Record<"privacy" | "terms", CoverlyLegalDocument>;

/**
 * Legal pages use the Coverly marketing homepage as their website-only
 * "Back to Coverly" destination. In the native legal viewer that navigation
 * means close the viewer and return to the app.
 */
export function shouldCloseLegalViewerNavigation(
  requestedUrl: string,
  documentUrl: string,
): boolean {
  try {
    const requested = new URL(requestedUrl);
    const document = new URL(documentUrl);
    return requested.origin === document.origin && requested.pathname === "/";
  } catch {
    return false;
  }
}
