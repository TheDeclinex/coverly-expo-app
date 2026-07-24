import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { Image } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ToastProvider } from "@/components/Toast";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { EntitlementsProvider } from "@/context/EntitlementsContext";
import { synchroniseImageCacheAccount } from "@/lib/image-cache";
import { isSignedImageQueryKey } from "@/lib/image-cache-model";

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 250, fade: true });

const queryClient = new QueryClient();

function RootLayoutNav() {
  const { loading, session, hasSeenOnboarding } = useAuth();
  const rootQueryClient = useQueryClient();
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [authAssetsReady, setAuthAssetsReady] = React.useState(false);

  useEffect(() => {
    let active = true;
    const authAssets = [
      require("../assets/brand/coverly-login-background.png"),
      require("../assets/brand/coverly-login-mark-tight.png"),
    ];
    void Promise.all(authAssets.map((asset) => Image.prefetch(Image.resolveAssetSource(asset).uri))).finally(() => {
      if (active) setAuthAssetsReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const accountId = session?.user.id ?? null;
    rootQueryClient.removeQueries({
      predicate: (query) => isSignedImageQueryKey(query.queryKey),
    });
    void synchroniseImageCacheAccount(accountId).catch((error: unknown) => {
      if (__DEV__) {
        console.warn(
          "[imageCache] account-boundary cache clear failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    });
  }, [loading, rootQueryClient, session?.user.id]);

  // Auth is settled when not loading AND (no session, OR the onboarding flag has resolved).
  // Waiting for hasSeenOnboarding prevents a flash of the wrong screen for authed users.
  const authSettled = !loading && (session === null || hasSeenOnboarding !== null);

  useEffect(() => {
    if ((fontsLoaded || fontError) && authSettled && authAssetsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, authSettled, authAssetsReady]);

  if ((!fontsLoaded && !fontError) || !authSettled || !authAssetsReady) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="open" options={{ headerShown: false }} />
      <Stack.Screen name="auth/verified" options={{ headerShown: false }} />
      <Stack.Screen name="reset-password" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="upgrade" options={{ headerShown: true, presentation: "modal" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <EntitlementsProvider><GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <ToastProvider>
                  <RootLayoutNav />
                </ToastProvider>
              </KeyboardProvider>
            </GestureHandlerRootView></EntitlementsProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </AuthProvider>
  );
}
