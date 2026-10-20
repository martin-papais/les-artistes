import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Alert, Linking, Platform } from 'react-native';

import { sb, type EventRow } from '@/lib/supabase';

// Ajout d'un événement à l'agenda du téléphone.
// Avec le module d'agenda (builds du 21/10/2026 et suivants) : l'événement est enregistré
// directement dans l'agenda par défaut, et mis à jour au lieu d'être doublé si on rappuie.
// Sans lui (versions installées avant, qui reçoivent ce code par mise à jour à distance) :
// - Google Agenda : lien « créer un événement » prérempli ;
// - agenda de l'iPhone : fichier .ics déposé dans le bucket public `media`,
//   ouvert dans Safari qui propose « Ajouter au calendrier ».

type CalendarModule = typeof import('expo-calendar');
const Calendar: CalendarModule | null = requireOptionalNativeModule('ExpoCalendar')
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('expo-calendar')
  : null;

const DURATION_H = 3;

type Slot = { allDay: true; start: string; end: string } | { allDay: false; start: string; end: string };

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const ymdhm = (d: Date) => `${ymd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

/** Heure locale « flottante » (pas de fuseau) : 20:30 reste 20:30 où qu'on soit. */
function slotOf(e: EventRow): Slot {
  const [y, m, d] = e.date_event.slice(0, 10).split('-').map(Number);
  const hm = /^(\d{1,2})[:hH](\d{2})?/.exec(e.heure ?? '');
  if (!hm) {
    return { allDay: true, start: ymd(new Date(y, m - 1, d)), end: ymd(new Date(y, m - 1, d + 1)) };
  }
  const start = new Date(y, m - 1, d, Number(hm[1]), Number(hm[2] ?? 0));
  const end = new Date(start.getTime() + DURATION_H * 3600_000);
  return { allDay: false, start: ymdhm(start), end: ymdhm(end) };
}

function placeOf(e: EventRow) {
  return [e.lieu, e.chez_qui && `chez ${e.chez_qui}`].filter(Boolean).join(', ');
}

function googleUrl(e: EventRow, title: string) {
  const s = slotOf(e);
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${s.start}/${s.end}`,
    details: [e.note, 'Les Artistes'].filter(Boolean).join('\n\n'),
    location: placeOf(e),
  });
  if (!s.allDay) q.set('ctz', 'Europe/Paris');
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

function icsEscape(t: string) {
  return t.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

/** RFC 5545 : lignes de 75 octets max, suite précédée d'un espace (sans couper un caractère). */
function fold(line: string) {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const c = ch.codePointAt(0) ?? 0;
    const b = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; // octets en UTF-8
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function icsOf(e: EventRow, title: string) {
  const s = slotOf(e);
  const when = s.allDay
    ? [`DTSTART;VALUE=DATE:${s.start}`, `DTEND;VALUE=DATE:${s.end}`]
    : [`DTSTART:${s.start}`, `DTEND:${s.end}`];
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Les Artistes//FR',
    'BEGIN:VEVENT',
    `UID:${e.id}@les-artistes`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${icsEscape(title)}`,
    placeOf(e) && `LOCATION:${icsEscape(placeOf(e))}`,
    e.note && `DESCRIPTION:${icsEscape(e.note)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter((l): l is string => !!l)
    .map(fold)
    .join('\r\n');
}

async function openIcs(e: EventRow, title: string, userId: string) {
  // Nom unique : la policy du bucket n'autorise pas l'écrasement
  const path = `${userId}/agenda/${e.id}-${Date.now()}.ics`;
  const { error } = await sb.storage
    .from('media')
    .upload(path, icsOf(e, title), { contentType: 'text/calendar; charset=utf-8', upsert: false });
  if (error) throw error;
  await Linking.openURL(sb.storage.from('media').getPublicUrl(path).data.publicUrl);
}

/** Dates réelles de l'événement (même règle que le .ics : 3 h, ou la journée entière) */
function datesOf(e: EventRow) {
  const [y, m, d] = e.date_event.slice(0, 10).split('-').map(Number);
  const hm = /^(\d{1,2})[:hH](\d{2})?/.exec(e.heure ?? '');
  if (!hm) {
    // Android range les journées entières en heure universelle : minuit local décalerait d'un jour
    if (Platform.OS === 'android') {
      return { allDay: true, startDate: new Date(Date.UTC(y, m - 1, d)), endDate: new Date(Date.UTC(y, m - 1, d + 1)), timeZone: 'UTC' };
    }
    return { allDay: true, startDate: new Date(y, m - 1, d), endDate: new Date(y, m - 1, d + 1) };
  }
  const startDate = new Date(y, m - 1, d, Number(hm[1]), Number(hm[2] ?? 0));
  return { allDay: false, startDate, endDate: new Date(startDate.getTime() + DURATION_H * 3600_000) };
}

/** Agenda où écrire : celui par défaut sur iPhone ; sur Android, le principal modifiable */
async function calendrier(C: CalendarModule): Promise<string> {
  if (Platform.OS === 'ios') return (await C.getDefaultCalendarAsync()).id;
  const all = await C.getCalendarsAsync(C.EntityTypes.EVENT);
  const ok = all.filter((c) => c.allowsModifications);
  const found = ok.find((c) => c.isPrimary) ?? ok.find((c) => c.source?.type === 'com.google') ?? ok[0];
  if (found) return found.id;
  // Aucun compte d'agenda sur le téléphone : un agenda local, visible dans l'appli Agenda
  return C.createCalendarAsync({
    title: 'Les Artistes',
    name: 'les-artistes',
    color: '#FF6B6B',
    entityType: C.EntityTypes.EVENT,
    source: { isLocalAccount: true, name: 'Les Artistes', type: 'LOCAL' },
    ownerAccount: 'Les Artistes',
    accessLevel: C.CalendarAccessLevel.OWNER,
  });
}

const CLE = (eventId: string) => `agenda:${eventId}`;

/** Enregistre (ou met à jour) l'événement dans l'agenda du téléphone, sans autre écran */
async function ajouterDirect(C: CalendarModule, e: EventRow, title: string) {
  const perm = await C.requestCalendarPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      'Accès à l’agenda refusé',
      'Autorise Les Artistes à utiliser ton agenda dans les réglages du téléphone.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Réglages', onPress: () => Linking.openSettings().catch(() => {}) },
      ],
    );
    return;
  }
  const calendarId = await calendrier(C);
  const details = {
    title,
    location: placeOf(e) || undefined,
    notes: [e.note, 'Les Artistes'].filter(Boolean).join('\n\n'),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...datesOf(e),
  };
  // Déjà ajouté : on le met à jour (heure ou lieu changés) au lieu d'en créer un second
  const known = await AsyncStorage.getItem(CLE(e.id)).catch(() => null);
  let id: string | null = null;
  if (known) {
    try {
      await C.getEventAsync(known);
      await C.updateEventAsync(known, details);
      id = known;
    } catch {
      // Supprimé de l'agenda entre-temps : on le recrée
    }
  }
  const updated = !!id;
  id ??= await C.createEventAsync(calendarId, details);
  await AsyncStorage.setItem(CLE(e.id), id).catch(() => {});
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  const saved = id;
  Alert.alert(updated ? 'Agenda mis à jour' : 'Ajouté à ton agenda', title, [
    { text: 'Voir', onPress: () => C.openEventInCalendarAsync({ id: saved }).catch(() => {}) },
    { text: 'OK', style: 'cancel' },
  ]);
}

export function addToAgenda(e: EventRow, title: string, userId: string) {
  if (Calendar) {
    ajouterDirect(Calendar, e, title).catch(() =>
      Alert.alert('Impossible d’ajouter à l’agenda', 'Réessaie, ou ajoute-le par Google Agenda.', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Google Agenda', onPress: () => Linking.openURL(googleUrl(e, title)).catch(() => {}) },
      ]),
    );
    return;
  }
  const google = () => Linking.openURL(googleUrl(e, title)).catch(() => {});
  // Android : 3 boutons au plus dans une Alert, on en a 3. Le .ics s'ouvre dans
  // le navigateur, qui le passe à l'agenda du téléphone (Samsung, etc.)
  Alert.alert('Ajouter à mon agenda', undefined, [
    {
      text: Platform.OS === 'ios' ? 'Agenda de l’iPhone' : 'Agenda du téléphone',
      onPress: () =>
        openIcs(e, title, userId).catch(() =>
          Alert.alert('Impossible', 'Vérifie ta connexion puis réessaie.'),
        ),
    },
    { text: 'Google Agenda', onPress: google },
    { text: 'Annuler', style: 'cancel' },
  ]);
}
