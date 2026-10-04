import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { sb } from './supabase';

// Affichage des notifs même quand l'app est en foreground (sinon iOS les avale).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Demande la permission, récupère le token Expo, et l'upsert dans Supabase.
 * À appeler après que l'user soit authentifié.
 * Retourne le token (ou null si refusé / pas dispo).
 */
export async function registerPushToken(userId: string): Promise<string | null> {
  if (!Device.isDevice) {
    // Simulateur : pas de token possible
    return null;
  }

  // Channel Android : à créer AVANT la demande de permission, sinon Android 13+
  // peut répondre « refusé » sans jamais afficher la fenêtre système.
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6B6B',
    });
  }

  // Permission
  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final !== 'granted') {
    return null;
  }

  // ProjectId (généré par eas init, présent dans Constants une fois EAS configuré)
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (!projectId) {
    console.warn('[push] No EAS projectId — skip token registration. Run `eas init`.');
    return null;
  }

  let token: string;
  try {
    const tokenRes = await Notifications.getExpoPushTokenAsync({ projectId });
    token = tokenRes.data;
  } catch (e) {
    console.warn('[push] getExpoPushTokenAsync failed:', e);
    return null;
  }

  // Upsert (unique sur user_id+token)
  const { error } = await sb.from('push_tokens').upsert(
    {
      user_id: userId,
      token,
      platform: Platform.OS,
      device_name: Device.deviceName ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,token' },
  );
  if (error) {
    console.warn('[push] upsert push_tokens failed:', error.message);
    return null;
  }
  return token;
}

/**
 * Supprime le token de cet appareil. Doit tourner AVANT signOut : après, la requête
 * part sans session et la RLS (auth.uid() = user_id) ne supprime rien.
 */
export async function unregisterPushToken() {
  if (!Device.isDevice) return;
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (!projectId) return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (token) await sb.from('push_tokens').delete().eq('token', token);
  } catch {}
}

/** Déconnexion propre : retire le token push tant que la session existe encore. */
export async function signOutAndUnregister() {
  await unregisterPushToken();
  await sb.auth.signOut();
}

export type DeeplinkPayload = { route?: string; [k: string]: unknown };

// Identifiant de la dernière notification déjà routée (évite de naviguer deux fois)
let handledNotificationId: string | null = null;

/**
 * Route à ouvrir pour ce tap de notification, ou null si déjà traitée / sans route.
 * Marque la notification comme traitée.
 */
export function takeNotificationRoute(
  response: Notifications.NotificationResponse | null,
): string | null {
  if (!response) return null;
  const id = response.notification.request.identifier;
  if (id === handledNotificationId) return null;
  const route = extractPayload(response)?.route;
  if (typeof route !== 'string' || !route) return null;
  handledNotificationId = id;
  return route;
}

/**
 * Extrait le payload data d'une notification (pour deeplink).
 */
export function extractPayload(
  response: Notifications.NotificationResponse | null,
): DeeplinkPayload | null {
  const data = response?.notification.request.content.data;
  if (!data || typeof data !== 'object') return null;
  return data as DeeplinkPayload;
}
