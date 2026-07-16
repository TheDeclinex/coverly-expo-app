import { router } from "expo-router";
import React from "react";

import { LimitReachedModal } from "@/components/LimitReachedModal";
import {
  propertyAllowanceCopy,
  type PropertyAllowance,
} from "@/lib/property-allowance";

export function PropertyAllowanceModal({
  visible,
  allowance,
  onDismiss,
  onRetry,
}: {
  visible: boolean;
  allowance: PropertyAllowance;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  const copy = propertyAllowanceCopy(allowance);
  const unavailable = allowance.blockReason === "entitlement_unavailable";
  const content = {
    feature: "property" as const,
    title: copy.title,
    body: copy.body,
    benefit: copy.benefit,
    primaryCta: copy.primaryCta,
    secondaryCta: copy.secondaryCta,
  };

  return (
    <LimitReachedModal
      visible={visible}
      content={content}
      onPrimary={() => {
        if (unavailable) {
          onRetry();
          return;
        }
        onDismiss();
        router.push({ pathname: "/upgrade", params: { feature: "property" } });
      }}
      onSecondary={onDismiss}
      onDismiss={onDismiss}
    />
  );
}
