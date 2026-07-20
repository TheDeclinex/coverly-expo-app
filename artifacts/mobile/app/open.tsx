import { Redirect } from "expo-router";

import { useAuth } from "@/context/AuthContext";

export default function OpenCoverlyScreen() {
  const { loading, session, hasSeenOnboarding } = useAuth();

  if (loading || (session && hasSeenOnboarding === null)) return null;
  if (!session) return <Redirect href="/login" />;
  if (hasSeenOnboarding === false) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}
