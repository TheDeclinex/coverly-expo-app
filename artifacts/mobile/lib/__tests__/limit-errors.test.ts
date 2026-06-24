import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLimitError } from "../limit-errors.ts";

test("normalises AI scan limit errors with manual-entry guidance", () => {
  const limit = normalizeLimitError({
    status: 402,
    errorCode: "AI_SCAN_LIMIT_REACHED",
    responseBody: {
      usage: {
        usedUnits: 10,
        limitUnits: 10,
        remainingUnits: 0,
      },
    },
  });

  assert.equal(limit?.feature, "ai_scan");
  assert.equal(limit?.secondaryCta, "Add item manually");
  assert.match(limit?.body ?? "", /10 of 10 AI scan credits/);
  assert.match(limit?.body ?? "", /add items manually for free/);
});

test("normalises replacement pricing limit errors with manual-value guidance", () => {
  const limit = normalizeLimitError({
    status: 402,
    errorCode: "REPLACEMENT_PRICING_LIMIT_REACHED",
    responseBody: {
      usage: {
        usedUnits: 5,
        limitUnits: 5,
        remainingUnits: 0,
      },
    },
  });

  assert.equal(limit?.feature, "replacement_pricing");
  assert.equal(limit?.secondaryCta, "Back to item");
  assert.match(limit?.body ?? "", /5 of 5 replacement price searches/);
  assert.match(limit?.body ?? "", /enter an item value manually/);
});
