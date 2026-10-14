import { Alert, Linking, Platform } from 'react-native';

import { sb, type EventRow } from '@/lib/supabase';

// Ajout d'un événement à l'agenda du téléphone, sans module natif (part en
// mise à jour à distance) :
// - Google Agenda : lien « créer un événement » prérempli ;
// - agenda de l'iPhone : fichier .ics déposé dans le bucket public `media`,
//   ouvert dans Safari qui propose « Ajouter au calendrier ».

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

export function addToAgenda(e: EventRow, title: string, userId: string) {
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
