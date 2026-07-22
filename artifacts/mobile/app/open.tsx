import { Redirect, useLocalSearchParams } from "expo-router";

import { useAuth } from "@/context/AuthContext";

export default function OpenCoverlyScreen() {
  const { notice } = useLocalSearchParams<{ notice?: string }>();
  const { loading, session, hasSeenOnboarding } = useAuth();

  if (loading || (session && hasSeenOnboarding === null)) return null;
  if (!session) {
    return notice === "email-verified"
      ? <Redirect href={{ pathname: "/login", params: { notice: "email-verified" } }} />
      : <Redirect href="/login" />;
  }
  if (hasSeenOnboarding === false) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
