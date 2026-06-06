import { Redirect, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function AppLayout() {
  const { session, loading } = useAuth();
  const colors = useColors();

  if (!loading && !session) {
    return <Redirect href="/login" />;
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
