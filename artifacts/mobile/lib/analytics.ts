import AsyncStorage from "@react-native-async-storage/async-storage";

import { getInstalledAppContext } from "@/lib/app-build-context";
import { createAnalyticsClient } from "@/lib/analytics-core";
import { supabase } from "@/lib/supabase";

const analyticsClient = createAnalyticsClient({
  storage: AsyncStorage,
  getUserId: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.user.id ?? null;
  },
  insertEvent: async (event) => {
    const { error } = await supabase.from("app_analytics_events").insert(event);
    if (error) throw error;
  },
  touchLastActive: async () => {
    const { error } = await supabase.rpc("touch_my_last_active");
    if (error) throw error;
  },
  getAppMetadata: () => {
    const context = getInstalledAppContext();
    return {
      platform: context.platform,
      appVersion: context.appVersion,
      buildNumber: context.buildNumber,
    };
  },
  development: __DEV__,
  log: (message, properties) => console.info(message, properties),
  warn: (message) => console.warn(message),
});

export const trackEvent = analyticsClient.trackEvent;
export const recordAppOpened = analyticsClient.recordAppOpened;
export const updateLastActive = analyticsClient.updateLastActive;
