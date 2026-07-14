export const REPLACEMENT_PRICE_CLIENT_TIMEOUT_MS = 60_000;

export class ReplacementPriceClientTimeoutError extends Error {
  constructor() {
    super("The replacement price search timed out. Please try again.");
    this.name = "ReplacementPriceClientTimeoutError";
  }
}

type TimeoutHandle = ReturnType<typeof setTimeout>;

interface ReplacementPriceFetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  setTimeoutImpl?: (callback: () => void, delay: number) => TimeoutHandle;
  clearTimeoutImpl?: (handle: TimeoutHandle) => void;
}

export async function fetchReplacementPriceFunction(
  input: RequestInfo | URL,
  init: RequestInit,
  options: ReplacementPriceFetchOptions = {},
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = options.signal;
  const fetchImpl = options.fetchImpl ?? fetch;
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  let timedOut = false;

  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeout = setTimeoutImpl(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? REPLACEMENT_PRICE_CLIENT_TIMEOUT_MS);

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new ReplacementPriceClientTimeoutError();
    throw error;
  } finally {
    clearTimeoutImpl(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
