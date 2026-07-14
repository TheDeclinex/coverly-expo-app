import assert from "node:assert/strict";
import test from "node:test";

import {
  ReplacementPriceClientTimeoutError,
  fetchReplacementPriceFunction,
} from "../replacement-pricing-transport.ts";

function pendingAbortableFetch(): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    })) as typeof fetch;
}

test("replacement search timeout aborts the request and reports a clear timeout", async () => {
  let timeoutCallback: (() => void) | null = null;
  let cleared = 0;
  const request = fetchReplacementPriceFunction(
    "https://example.test/search",
    { method: "POST" },
    {
      fetchImpl: pendingAbortableFetch(),
      setTimeoutImpl: (callback) => {
        timeoutCallback = callback;
        return 1 as ReturnType<typeof setTimeout>;
      },
      clearTimeoutImpl: () => {
        cleared += 1;
      },
    },
  );

  assert.ok(timeoutCallback);
  (timeoutCallback as unknown as () => void)();
  await assert.rejects(request, ReplacementPriceClientTimeoutError);
  assert.equal(cleared, 1);
});

test("caller abort is forwarded without being misreported as a timeout", async () => {
  const caller = new AbortController();
  let cleared = 0;
  const request = fetchReplacementPriceFunction(
    "https://example.test/search",
    {},
    {
      signal: caller.signal,
      fetchImpl: pendingAbortableFetch(),
      setTimeoutImpl: () => 1 as ReturnType<typeof setTimeout>,
      clearTimeoutImpl: () => {
        cleared += 1;
      },
    },
  );

  caller.abort();
  await assert.rejects(
    request,
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(cleared, 1);
});

test("successful completion clears timeout and removes the caller listener", async () => {
  const caller = new AbortController();
  const originalAdd = caller.signal.addEventListener.bind(caller.signal);
  const originalRemove = caller.signal.removeEventListener.bind(caller.signal);
  let added = 0;
  let removed = 0;
  let cleared = 0;
  caller.signal.addEventListener = ((
    ...args: Parameters<AbortSignal["addEventListener"]>
  ) => {
    added += 1;
    return originalAdd(...args);
  }) as AbortSignal["addEventListener"];
  caller.signal.removeEventListener = ((
    ...args: Parameters<AbortSignal["removeEventListener"]>
  ) => {
    removed += 1;
    return originalRemove(...args);
  }) as AbortSignal["removeEventListener"];

  const response = await fetchReplacementPriceFunction(
    "https://example.test/search",
    {},
    {
      signal: caller.signal,
      fetchImpl: (async () =>
        new Response("ok", { status: 200 })) as typeof fetch,
      setTimeoutImpl: () => 1 as ReturnType<typeof setTimeout>,
      clearTimeoutImpl: () => {
        cleared += 1;
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.equal(cleared, 1);
});
