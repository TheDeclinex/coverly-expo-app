import { Redirect, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function AppLayout() {
  const { session, loading, hasSeenOnboarding } = useAuth();
  const colors = useColors();

  if (!loading && !session) {
    return <Redirect href="/login" />;
  }

  // Belt-and-suspenders: if the user lands on a tab route without completing
  // onboarding (e.g. restored session from a previous interrupted session),
  // redirect back to the onboarding wizard.
  if (!loading && session && hasSeenOnboarding === false) {
    return <Redirect href="/onboarding" />;
  }

  return (
    <>
      {/* Ensure proper status bar styling for dynamic island and notch */}
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerShadowVisible: false,
          headerTintColor: colors.primary,
          headerTitleStyle: {
            fontFamily: "Inter_600SemiBold",
            fontSize: 17,
            color: colors.foreground,
          },
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </>
  );
}
