import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import {
  PlayfairDisplay_700Bold,
  PlayfairDisplay_900Black,
} from '@expo-google-fonts/playfair-display';
import { Ionicons } from '@expo/vector-icons';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, Pressable } from 'react-native';
import 'react-native-reanimated';

import { loadAvatars, resetAvatars } from '@/lib/avatars';
import { resetBlocked } from '@/lib/moderation';
import { registerPushToken, takeNotificationRoute } from '@/lib/notifications';
import { sb } from '@/lib/supabase';
import { theme } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router = useRouter();
  const initialized = useRef(false);
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_700Bold,
    PlayfairDisplay_900Black,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  // Auth state + push token registration
  useEffect(() => {
    // INITIAL_SESSION (premier événement ci-dessous) couvre la session restaurée au lancement
    const { data: sub } = sb.auth.onAuthStateChange(async (event, session) => {
      if (!initialized.current) {
        initialized.current = true;
        if (session?.user) {
          registerPushToken(session.user.id);
          loadAvatars();
        }
        return;
      }
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
        resetBlocked();
        resetAvatars();
      }
      if (event === 'SIGNED_OUT' || !session) {
        // Le token push est retiré avant signOut (signOutAndUnregister), plus ici :
        // à ce stade la session est déjà effacée et la RLS refuserait le delete.
        // On vide la pile : sinon « retour » depuis le login ramène aux onglets du compte précédent.
        if (router.canDismiss()) router.dismissAll();
        router.replace('/(auth)/login');
      } else if (event === 'SIGNED_IN') {
        if (session.user) registerPushToken(session.user.id);
        loadAvatars();
        router.replace('/(tabs)/events');
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  // Photos et couleurs des membres : rechargées au retour dans l'appli
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') loadAvatars();
    });
    return () => sub.remove();
  }, []);

  // Notification tap → deeplink. Couvre 2 cas :
  //   1. App ouverte (foreground/background) : le listener ci-dessous
  //   2. App tuée et lancée par tap : app/index.tsx lit getLastNotificationResponse()
  //      et redirige directement (le Stack n'est pas encore monté ici à ce moment-là)
  const navReady = useRef(false);
  useEffect(() => {
    navReady.current = fontsLoaded;
  }, [fontsLoaded]);
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!navReady.current) return; // lancement à froid : géré par index.tsx
      const route = takeNotificationRoute(response);
      if (!route) return;
      // Déconnecté : on reste sur le login au lieu d'empiler un écran vide par-dessus
      sb.auth.getSession().then(({ data }) => {
        // navigate : déjà sur l'écran visé (ex. Photos), on n'en empile pas un second
        if (!data.session) return;
        // Depuis un écran de pile (Photos, Profil…), navigate empilerait un second jeu
        // d'onglets : on revient d'abord aux onglets existants
        if (route.startsWith('/(tabs)') && router.canDismiss()) router.dismissAll();
        router.navigate(route as Href);
      });
    });
    return () => sub.remove();
  }, [router]);

  if (!fontsLoaded) return null;

  return (
    <ThemeProvider value={DarkTheme}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: theme.colors.deep },
          headerStyle: { backgroundColor: theme.colors.deep },
          headerTintColor: theme.colors.coral,
          headerTitleStyle: {
            fontFamily: theme.fonts.serif,
            color: theme.colors.text,
            fontSize: 17,
          },
          headerShadowVisible: false,
          headerBackTitle: '',
          headerBackButtonDisplayMode: 'minimal',
          // La flèche native ne répondait pas sur Boutique et Annuaire (le geste de retour, si)
          headerLeft: () => (
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/plus'))}
              hitSlop={12}
              accessibilityLabel="Retour"
            >
              <Ionicons name="chevron-back" size={28} color={theme.colors.coral} />
            </Pressable>
          ),
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="profil" options={{ title: 'Profil', headerShown: false }} />
        <Stack.Screen name="notes" options={{ title: 'Notes', headerShown: false }} />
        <Stack.Screen name="photos" options={{ title: 'Photos', headerShown: false }} />
        <Stack.Screen name="annuaire" options={{ title: 'Annuaire', headerShown: false }} />
        <Stack.Screen name="shop" options={{ title: 'Boutique', headerShown: false }} />
        <Stack.Screen name="olympiades" options={{ title: 'Olympiades', headerShown: false }} />
        <Stack.Screen name="jeux" options={{ title: 'Jeux', headerShown: false }} />
        <Stack.Screen name="minijeux/[jeu]" options={{ title: 'Mini-jeux', headerShown: false, gestureEnabled: false }} />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
