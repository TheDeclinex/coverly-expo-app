import AsyncStorage from "@react-native-async-storage/async-storage";
import { Session } from "@supabase/supabase-js";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import { isServerOnboardingComplete } from "@/lib/profile-settings-model";
import { loadProfileSettings, markOnboardingCompleteOnServer } from "@/lib/profile-settings";

interface AuthContextType {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  hasSeenOnboarding: boolean | null;
  markOnboardingComplete: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  loading: true,
  signOut: async () => {},
  hasSeenOnboarding: null,
  markOnboardingComplete: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) {
      setHasSeenOnboarding(null);
      return;
    }
    // Never carry one account's resolved onboarding state into another account.
    setHasSeenOnboarding(null);
    let cancelled = false;
    const storageKey = `onboarding:${userId}`;

    const reconcileOnboarding = async () => {
      const localValue = await AsyncStorage.getItem(storageKey);
      if (cancelled) return;

      // Local completion wins immediately so an existing user is never sent
      // through onboarding again while the server migration catches up.
      if (localValue !== null) {
        setHasSeenOnboarding(true);
        try {
          await markOnboardingCompleteOnServer();
        } catch (error) {
          if (__DEV__) console.warn("[onboarding] server completion sync failed", error);
        }
        return;
      }

      try {
        const settings = await loadProfileSettings();
        if (cancelled) return;
        if (isServerOnboardingComplete(settings.onboardingStatus)) {
          await AsyncStorage.setItem(storageKey, "1");
          if (!cancelled) setHasSeenOnboarding(true);
        } else {
          setHasSeenOnboarding(false);
        }
      } catch (error) {
        if (__DEV__) console.warn("[onboarding] server status load failed", error);
        if (!cancelled) setHasSeenOnboarding(false);
      }
    };

    void reconcileOnboarding();
    return () => { cancelled = true; };
  }, [userId]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const markOnboardingComplete = useCallback(async () => {
    if (!userId) return;
    await AsyncStorage.setItem(`onboarding:${userId}`, "1");
    setHasSeenOnboarding(true);
    // Navigation must not wait on the network once local completion is saved.
    void markOnboardingCompleteOnServer().catch((error) => {
      // The next authenticated startup retries because the local flag exists.
      if (__DEV__) console.warn("[onboarding] completion save failed", error);
    });
  }, [userId]);

  return (
    <AuthContext.Provider value={{ session, loading, signOut, hasSeenOnboarding, markOnboardingComplete }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
