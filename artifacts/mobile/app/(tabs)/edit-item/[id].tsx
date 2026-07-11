import { router, useLocalSearchParams } from "expo-router";
import React from "react";

import { LoadingState } from "@/components/LoadingState";

/** Compatibility route for stale links and restored navigation state. */
export default function EditItemRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();

  React.useEffect(() => {
    if (!id) return;
    router.replace({ pathname: "/(tabs)/item/[id]", params: { id } });
  }, [id]);

  return <LoadingState />;
}
