import * as Notifications from 'expo-notifications';
import { Redirect, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { takeNotificationRoute } from '@/lib/notifications';
import { sb } from '@/lib/supabase';
import { theme } from '@/lib/theme';

export default function Index() {
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [deeplink, setDeeplink] = useState<string | null>(null);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      // App lancée par un tap sur une notification : on ouvre directement la bonne page
      if (data.session) setDeeplink(takeNotificationRoute(Notifications.getLastNotificationResponse()));
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.deep,
        }}
      >
        <ActivityIndicator color={theme.colors.teal} />
      </View>
    );
  }

  if (!hasSession) return <Redirect href="/(auth)/login" />;
  return <Redirect href={(deeplink ?? '/(tabs)/events') as Href} />;
}
