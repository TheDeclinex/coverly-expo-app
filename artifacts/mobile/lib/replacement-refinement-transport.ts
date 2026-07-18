export interface CurrentSessionResult {
  data: { session: { access_token?: string | null } | null };
  error: unknown;
}

export class RefinementSessionError extends Error {
  readonly code: "MISSING_SESSION" | "SESSION_UNAVAILABLE";

  constructor(code: "MISSING_SESSION" | "SESSION_UNAVAILABLE") {
    super(code);
    this.name = "RefinementSessionError";
    this.code = code;
  }
}

export async function postRefinementWithCurrentSession<T>(options: {
  getSession: () => Promise<CurrentSessionResult>;
  fetcher: typeof fetch;
  functionUrl: string;
  anonKey: string;
  body: unknown;
}): Promise<{ status: number; ok: boolean; data: T | null }> {
  // Read for every deliberate AI action. Supabase refreshes an expired session here
  // when autoRefreshToken is enabled; no token is retained by this transport.
  const { data, error } = await options.getSession();
  if (error) throw new RefinementSessionError("SESSION_UNAVAILABLE");
  const accessToken = data.session?.access_token?.trim();
  if (!accessToken) throw new RefinementSessionError("MISSING_SESSION");

  const response = await options.fetcher(options.functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: options.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(options.body),
  });
  const responseText = await response.text();
  let responseData: T | null = null;
  try {
    responseData = responseText ? JSON.parse(responseText) as T : null;
  } catch {
    // Gateway HTML/text is deliberately not exposed to the UI.
  }
  return { status: response.status, ok: response.ok, data: responseData };
}
