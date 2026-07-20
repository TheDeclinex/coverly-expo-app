import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { CoverlyAuthBackground } from "@/components/auth/CoverlyAuthBrand";
import { coverlyBrand } from "@/constants/brand";
import { useAuth } from "@/context/AuthContext";
import {
  authLinkErrorMessage,
  authLinkFingerprint,
  establishAuthLinkSession,
  parseAuthLink,
} from "@/lib/auth-links";
import { supabase } from "@/lib/supabase";

const LAST_VERIFIED_LINK_KEY = "@coverly/last-verified-auth-link";

export default function EmailVerifiedScreen() {
  const incomingUrl = Linking.useLinkingURL();
  const router = useRouter();
  const { hasSeenOnboarding } = useAuth();
  const handledUrl = React.useRef<string | null>(null);
  const pendingDestination = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!incomingUrl || handledUrl.current === incomingUrl) return;
    handledUrl.current = incomingUrl;
    let active = true;

    const finish = async () => {
      try {
        const parsed = parseAuthLink(incomingUrl);
        if (parsed.hasCredentials) {
          const fingerprint = authLinkFingerprint(incomingUrl);
          const alreadyHandled = (await AsyncStorage.getItem(LAST_VERIFIED_LINK_KEY)) === fingerprint;
          if (!alreadyHandled) {
            await establishAuthLinkSession(incomingUrl, "verification");
            await AsyncStorage.setItem(LAST_VERIFIED_LINK_KEY, fingerprint);
          }
        }

        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (data.session?.user.email_confirmed_at) {
          if (hasSeenOnboarding === null) {
            pendingDestination.current = true;
            return;
          }
          router.replace(hasSeenOnboarding ? "/(tabs)" : "/onboarding");
        } else {
          router.replace({ pathname: "/login", params: { notice: "email-verified" } });
        }
      } catch {
        if (active) setError(authLinkErrorMessage("verification"));
      }
    };

    void finish();
    return () => {
      active = false;
    };
  }, [hasSeenOnboarding, incomingUrl, router]);

  React.useEffect(() => {
    if (!pendingDestination.current || hasSeenOnboarding === null) return;
    pendingDestination.current = false;
    router.replace(hasSeenOnboarding ? "/(tabs)" : "/onboarding");
  }, [hasSeenOnboarding, router]);

  return (
    <CoverlyAuthBackground style={styles.root}>
      <View style={styles.card}>
        {error ? (
          <>
            <Feather name="alert-circle" size={34} color="#DC2626" />
            <Text style={styles.title}>Verification link unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={coverlyBrand.teal} size="large" />
            <Text style={styles.title}>Confirming your email</Text>
            <Text style={styles.body}>This will only take a moment.</Text>
          </>
        )}
      </View>
    </CoverlyAuthBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: 14,
    padding: 28,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: coverlyBrand.border,
    backgroundColor: "rgba(255,255,255,0.97)",
  },
  title: { color: coverlyBrand.slate, fontFamily: "Inter_700Bold", fontSize: 23, textAlign: "center" },
  body: { color: coverlyBrand.mutedText, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center" },
});
