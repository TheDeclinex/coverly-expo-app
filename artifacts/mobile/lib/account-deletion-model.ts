import type { FeedbackFormState } from "@/lib/feedback-model";

export const ACCOUNT_DELETION_ROUTE = "/account-deletion";

export const accountDeletionDataTypes = [
  "Properties, rooms and inventory items",
  "Uploaded photos, receipts and other evidence",
  "Generated claim packs and claim-pack records",
  "Your profile and associated Coverly application data",
] as const;

export function createAccountDeletionFeedbackForm(): FeedbackFormState {
  return {
    type: "issue",
    category: "account",
    priority: "normal",
    message: "Account deletion request: I am requesting permanent deletion of my Coverly account and associated inventory data. Please contact me to verify this request and confirm the next steps.",
  };
}

export function canSubmitAccountDeletion(confirmed: boolean, isSubmitting: boolean) {
  return confirmed && !isSubmitting;
}
