import { useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";

import { LoadingState } from "@/components/LoadingState";
import { useAuth } from "@/context/AuthContext";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { useColors } from "@/hooks/useColors";
import { isAdminQueryKey, isAdminRoutePath } from "@/lib/admin-access";

export default function AppLayout() {
  const { session, loading, hasSeenOnboarding } = useAuth();
  const colors = useColors();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { isAdmin, isLoading: isProfileLoading } = useAccountProfile();
  const userId = session?.user.id ?? null;
  const previousUserId = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    const userChanged = previousUserId.current !== undefined && previousUserId.current !== userId;
    if (userChanged || (!isProfileLoading && !isAdmin)) {
      queryClient.removeQueries({ predicate: (query) => isAdminQueryKey(query.queryKey) });
    }
    previousUserId.current = userId;
  }, [isAdmin, isProfileLoading, queryClient, userId]);

  if (!loading && !session) {
    return <Redirect href="/login" />;
  }

  // Belt-and-suspenders: if the user lands on a tab route without completing
  // onboarding (e.g. restored session from a previous interrupted session),
  // redirect back to the onboarding wizard.
  if (!loading && session && hasSeenOnboarding === false) {
    return <Redirect href="/onboarding" />;
  }

  if (!loading && session && isAdminRoutePath(pathname)) {
    if (isProfileLoading) return <LoadingState />;
    if (!isAdmin) return <Redirect href="/account" />;
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
      >
        <Stack.Screen name="account" options={{ title: "Account" }} />
        <Stack.Screen name="user-guide" options={{ title: "User guide" }} />
        <Stack.Screen name="profile-settings" options={{ title: "Profile & Preferences" }} />
        <Stack.Screen name="feedback" options={{ title: "Feedback & Support" }} />
        <Stack.Screen name="account-deletion" options={{ title: "Account deletion" }} />
        <Stack.Screen name="admin" options={{ title: "Admin" }} />
        <Stack.Screen name="admin-users" options={{ title: "User lookup" }} />
        <Stack.Screen name="admin-user/[id]" options={{ title: "User detail" }} />
        <Stack.Screen name="admin-user-files/[id]" options={{ title: "User properties" }} />
        <Stack.Screen name="admin-access" options={{ title: "Access grants" }} />
        <Stack.Screen name="admin-entitlements" options={{ title: "Entitlement debug" }} />
        <Stack.Screen name="admin-claim-packs" options={{ title: "Claim packs" }} />
        <Stack.Screen name="admin-claim-pack/[id]" options={{ title: "Claim pack detail" }} />
        <Stack.Screen name="admin-errors" options={{ title: "Recent errors" }} />
        <Stack.Screen name="admin-support" options={{ title: "Support inbox" }} />
      </Stack>
    </>
  );
}
