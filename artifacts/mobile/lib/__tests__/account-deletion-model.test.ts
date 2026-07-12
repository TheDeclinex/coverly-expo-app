import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_DELETION_ROUTE,
  accountDeletionDataTypes,
  canSubmitAccountDeletion,
  createAccountDeletionFeedbackForm,
} from "../account-deletion-model.ts";

test("deletion requests use fixed metadata for the existing feedback backend", () => {
  assert.deepEqual(createAccountDeletionFeedbackForm(), {
    type: "issue",
    category: "account",
    priority: "normal",
    message: "Account deletion request: I am requesting permanent deletion of my Coverly account and associated inventory data. Please contact me to verify this request and confirm the next steps.",
  });
  assert.equal(ACCOUNT_DELETION_ROUTE, "/account-deletion");
  assert.ok(accountDeletionDataTypes.some((item) => item.includes("inventory items")));
});

test("explicit confirmation is required and loading prevents duplicate submission", () => {
  assert.equal(canSubmitAccountDeletion(false, false), false);
  assert.equal(canSubmitAccountDeletion(true, false), true);
  assert.equal(canSubmitAccountDeletion(true, true), false);
});
