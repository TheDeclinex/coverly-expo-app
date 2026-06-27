import assert from "node:assert/strict";
import test from "node:test";

import { replacementVoiceTranscriptToQuery } from "../replacement-pricing-query.ts";

test("voice replacement search transcript is trimmed for editable query use", () => {
  assert.equal(
    replacementVoiceTranscriptToQuery("  Samsung   65 inch OLED television   NZ  "),
    "Samsung 65 inch OLED television NZ",
  );
});

test("empty replacement search transcript stays empty", () => {
  assert.equal(replacementVoiceTranscriptToQuery(null), "");
  assert.equal(replacementVoiceTranscriptToQuery("   "), "");
});
