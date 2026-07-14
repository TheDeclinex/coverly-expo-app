import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  refinementFailureMessage,
  safeFunctionFailure,
  validateRefinementFunctionEnvelope,
} from "../replacement-refinement-transport.ts";

const suggestion = {
  searchTerm: "Sony black powered subwoofer",
  brandMaker: "Sony",
  modelSeries: null,
  additionalDetails: "Black square subwoofer with front speaker grille",
  minPrice: null,
  maxPrice: null,
  rationale: "Removed scene narration.",
};

test("accepts a successful authenticated refinement envelope", () => {
  const result = validateRefinementFunctionEnvelope({
    success: true,
    suggestion,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.suggestion, suggestion);
});

test("distinguishes unavailable, authentication, timeout, and invalid response failures", () => {
  assert.match(refinementFailureMessage({ status: 404 }), /not available/i);
  assert.match(
    refinementFailureMessage({ status: 401 }),
    /session has expired/i,
  );
  assert.match(
    refinementFailureMessage({
      status: 504,
      errorCode: "AI_REFINEMENT_TIMEOUT",
    }),
    /took too long/i,
  );
  assert.match(
    refinementFailureMessage({ errorType: "SyntaxError" }),
    /invalid response/i,
  );
});

test("sanitises function error bodies and rejects invalid success JSON", () => {
  assert.deepEqual(
    safeFunctionFailure({
      errorCode: "UNAUTHORIZED",
      error: "Invalid or expired session",
      transcript: "private user content",
      authorization: "Bearer secret",
    }),
    { errorCode: "UNAUTHORIZED", message: "Invalid or expired session" },
  );
  assert.equal(validateRefinementFunctionEnvelope({ success: true }).ok, false);
  assert.equal(validateRefinementFunctionEnvelope("not json").ok, false);
});

test("missing-session guidance is explicit", () => {
  assert.equal(
    refinementFailureMessage({ status: 401, errorCode: "UNAUTHORIZED" }),
    "Your session has expired. Sign in again and retry.",
  );
});

test("the client invokes the authenticated function with safe diagnostic fields", () => {
  const servicePath = new URL(
    "../replacement-refinement-ai.ts",
    import.meta.url,
  ).pathname.replace(/^\/(?=[A-Za-z]:)/, "");
  const source = readFileSync(servicePath, "utf8");
  for (const expected of [
    "supabase.auth.getSession()",
    "supabase.functions.invoke(",
    "Authorization: `Bearer ${accessToken}`",
    "functionName: REPLACEMENT_REFINEMENT_FUNCTION_NAME",
    "functionsErrorType",
    "responseMessage",
    "hasAuthenticatedSession",
  ]) {
    assert.equal(source.includes(expected), true, expected);
  }
  assert.equal(source.includes("searchReplacementPrices"), false);
  assert.equal(source.includes("reserve_my_feature_usage"), false);
});
