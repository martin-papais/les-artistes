import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';
import { Redirect, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';

import { Button, EmptyState } from '@/components/ui/kit';
import { takeNotificationRoute } from '@/lib/notifications';
import { sb } from '@/lib/supabase';
import { theme } from '@/lib/theme';

export default function Index() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [deeplink, setDeeplink] = useState<string | null>(null);
  const [injoignable, setInjoignable] = useState(false);
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    sb.auth.getSession().then(({ data, error }) => {
      // Jeton à renouveler et serveur injoignable : la session reste sur le téléphone,
      // ce n'est pas une déconnexion (sinon on renverrait vers l'écran de connexion)
      if (!data.session && isAuthRetryableFetchError(error)) {
        setInjoignable(true);
        return;
      }
      setHasSession(!!data.session);
      // App lancée par un tap sur une notification : on ouvre directement la bonne page
      // Pas de notifications push dans un navigateur (aperçu web) : la méthode y lève une erreur
      if (data.session && Platform.OS !== 'web') {
        setDeeplink(takeNotificationRoute(Notifications.getLastNotificationResponse()));
      }
      setReady(true);
    });
  }, [essai]);

  // Photos, Notes, Boutique… ne sont pas des onglets : on pose les onglets dessous,
  // sinon le retour (bouton Android, geste iOS) n'a rien sur quoi revenir
  const stackDeeplink = hasSession && !!deeplink && !deeplink.startsWith('/(tabs)');
  useEffect(() => {
    if (!ready || !stackDeeplink || !deeplink) return;
    router.replace('/(tabs)/events');
    router.push(deeplink as Href);
  }, [ready, stackDeeplink, deeplink, router]);

  if (injoignable) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.colors.deep }}>
        <EmptyState
          icon="wifi-off"
          title="Serveur injoignable"
          text="Vérifie ta connexion, puis réessaie."
          action={
            <Button
              label="Réessayer"
              height={48}
              onPress={() => {
                setInjoignable(false);
                setEssai((n) => n + 1);
              }}
            />
          }
        />
      </View>
    );
  }

  if (!ready || stackDeeplink) {
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
