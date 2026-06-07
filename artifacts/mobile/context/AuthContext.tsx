import AsyncStorage from "@react-native-async-storage/async-storage";
import { Session } from "@supabase/supabase-js";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

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
    AsyncStorage.getItem(`onboarding:${userId}`).then((val) => {
      setHasSeenOnboarding(val !== null);
    });
  }, [userId]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const markOnboardingComplete = useCallback(async () => {
    if (!userId) return;
    await AsyncStorage.setItem(`onboarding:${userId}`, "1");
    setHasSeenOnboarding(true);
  }, [userId]);

  return (
    <AuthContext.Provider value={{ session, loading, signOut, hasSeenOnboarding, markOnboardingComplete }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
