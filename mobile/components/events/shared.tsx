/**
 * Pièces communes à l'onglet Événements : catégories, titres, dates, vote.
 */
import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { ComponentProps } from 'react';

import { parseDay } from '@/components/ui/CalendarPicker';
import { sb, type EventRow, type EventVote, type ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const c = theme.colors;

export type EventCard = EventRow & {
  author?: ProfileMini | null;
  votes: (EventVote & { id: string })[];
  isPast: boolean;
};

export type Birthday = {
  id: string;
  name: string;
  monthDay: string;
  daysUntil: number;
  age: number;
};

// Mêmes catégories que le site (+ Restaurant, propre à l'appli)
export const CATEGORIES = [
  'Soirée',
  'Anniversaire',
  'Barbecue',
  'Soirée jeux de société',
  'Nouvel an',
  'Olympiade',
  'Barathon',
  'Sport',
  'Féria',
  'Vacances',
  'Restaurant',
  'Autre',
];
export const WITH_ALCOOL = ['Olympiade', 'Nouvel an', 'Anniversaire', 'Soirée'];
export const WITH_DORMIR = ['Olympiade', 'Nouvel an', 'Anniversaire', 'Soirée'];
export const CHEZ_QUI_REQUIS = ['Olympiade', 'Anniversaire', 'Soirée', 'Barbecue', 'Soirée jeux de société', 'Autre', 'Nouvel an'];
export const YES_NO_NSP = [
  { v: 'oui', l: 'Oui' },
  { v: 'non', l: 'Non' },
  { v: 'nsp', l: 'Je ne sais pas' },
];

// Orange des maquettes (barbecue, barathon) : absent des tokens, propre à cet onglet
const ORANGE = '#FF9E5E';

export type CatIconName =
  | { lib: 'f'; name: ComponentProps<typeof Feather>['name'] }
  | { lib: 'i'; name: ComponentProps<typeof Ionicons>['name'] };

type CatMeta = { short: string; color: string; icon: CatIconName };

const CAT_META: Record<string, CatMeta> = {
  Soirée: { short: 'Soirée', color: c.coral, icon: { lib: 'f', name: 'music' } },
  Anniversaire: { short: 'Anniv.', color: c.violet, icon: { lib: 'f', name: 'gift' } },
  Barbecue: { short: 'Barbecue', color: ORANGE, icon: { lib: 'i', name: 'flame-outline' } },
  'Soirée jeux de société': { short: 'Jeux', color: c.teal, icon: { lib: 'i', name: 'dice-outline' } },
  'Nouvel an': { short: 'Nouvel an', color: c.yellow, icon: { lib: 'f', name: 'star' } },
  Olympiade: { short: 'Olympiade', color: c.yellow, icon: { lib: 'f', name: 'award' } },
  Barathon: { short: 'Barathon', color: ORANGE, icon: { lib: 'i', name: 'beer-outline' } },
  Sport: { short: 'Sport', color: c.teal, icon: { lib: 'i', name: 'football-outline' } },
  Féria: { short: 'Féria', color: c.coral, icon: { lib: 'f', name: 'flag' } },
  Vacances: { short: 'Vacances', color: c.yellow, icon: { lib: 'f', name: 'sun' } },
  Restaurant: { short: 'Resto', color: c.pink, icon: { lib: 'i', name: 'restaurant-outline' } },
  Autre: { short: 'Autre', color: c.muted, icon: { lib: 'f', name: 'more-horizontal' } },
};

export function catMeta(cat: string | null | undefined): CatMeta {
  return (cat && CAT_META[cat]) || CAT_META.Autre;
}

export function CatIcon({ icon, size = 22, color }: { icon: CatIconName; size?: number; color: string }) {
  return icon.lib === 'f' ? (
    <Feather name={icon.name} size={size} color={color} />
  ) : (
    <Ionicons name={icon.name} size={size} color={color} />
  );
}

export function buildEventTitle(e: EventRow): string {
  const cat = e.categorie ?? 'Événement';
  switch (cat) {
    case 'Anniversaire':
      return ['Anniversaire', e.anniversaire_qui ? `de ${e.anniversaire_qui}` : null, e.chez_qui ? `chez ${e.chez_qui}` : null]
        .filter(Boolean)
        .join(' ');
    case 'Vacances':
      return e.lieu ? `Vacances à ${e.lieu}` : 'Vacances';
    case 'Féria':
      return e.feria_ville ? `Féria de ${e.feria_ville}` : 'Féria';
    case 'Sport':
      return e.sport_type || 'Sport';
    case 'Barathon':
      return e.lieu ? `Barathon à ${e.lieu}` : 'Barathon';
    case 'Autre':
      return e.raison || 'Autre';
    default:
      return e.chez_qui ? `${cat} chez ${e.chez_qui}` : cat;
  }
}

export function capFirst(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** '20h30', '20:30', '20:30:00', '20h', '9:05' → 'HH:MM' ; '' → null ; illisible → undefined */
export function normalizeTime(raw: string): string | null | undefined {
  const t = raw.trim();
  if (!t) return null;
  const m = /^(\d{1,2})(?:\s*[:hH]\s*(\d{2})?(?::\d{2})?)?$/.exec(t);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2] ?? '0');
  if (hh > 23 || mm > 59) return undefined;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** '20:00' → '20 h', '20:30' → '20 h 30' ; saisie libre ancienne : telle quelle */
export function heureLabel(h: string | null | undefined) {
  if (!h) return '';
  const n = normalizeTime(h);
  if (!n) return h;
  const [hh, mm] = n.split(':');
  return mm === '00' ? `${Number(hh)} h` : `${Number(hh)} h ${mm}`;
}

const WD_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Morceaux de la date d'un événement, en heure locale */
export function dateParts(dateEvent: string) {
  const d = parseDay(dateEvent.slice(0, 10));
  return { wd: WD_SHORT[d.getDay()], day: d.getDate(), month: MONTHS_SHORT[d.getMonth()], year: d.getFullYear() };
}

/** « sam. 21 nov. » */
export function shortDate(dateEvent: string) {
  const p = dateParts(dateEvent);
  return `${p.wd} ${p.day} ${p.month}`;
}

export function monthShort(m: number) {
  return MONTHS_SHORT[m];
}

export function nextBirthday(dob: string) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidate = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (candidate < today) candidate.setFullYear(today.getFullYear() + 1);
  return { date: candidate, dob: d };
}

export function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export function tap() {
  Haptics.selectionAsync().catch(() => {});
}

export function profileName(p: ProfileMini | undefined) {
  if (!p) return '?';
  return p.pseudo || `${p.prenom ?? ''} ${p.nom ?? ''}`.trim() || '?';
}

// « Marie, Paul, Léa +4 » : les premiers noms, le reste en nombre
export function namesPreview(names: string[], max = 3) {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

/** « 12 viennent, 2 non » */
export function countsLabel(yes: number, no: number) {
  const y = yes === 0 ? 'Personne ne vient' : `${yes} ${yes > 1 ? 'viennent' : 'vient'}`;
  return no > 0 ? `${y}, ${no} non` : y;
}

/**
 * Vote présent / absent. Retaper le même choix retire le vote.
 * Le double appui est bloqué par l'appelant (ref) jusqu'au rechargement.
 */
export async function voteEvent(event: EventCard, userId: string, present: 'oui' | 'non' | null) {
  const myVote = event.votes.find((v) => v.user_id === userId);
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  let res: { error: { message: string } | null } = { error: null };
  if (myVote && (present === null || myVote.present === present)) {
    res = await sb.from('event_votes').delete().eq('id', myVote.id);
  } else if (myVote) {
    res = await sb.from('event_votes').update({ present }).eq('id', myVote.id);
  } else if (present !== null) {
    res = await sb.from('event_votes').insert({ event_id: event.id, user_id: userId, present });
  }
  return res.error;
}
