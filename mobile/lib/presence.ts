import type { RealtimeChannel } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { sb } from '@/lib/supabase';

// Qui a l'appli ouverte en ce moment : présence du temps réel de Supabase, sans table.
// Chacun annonce son état tant que l'appli est au premier plan ; il disparaît de la liste
// quand il la quitte (ou quelques secondes après une coupure réseau).
// vu_le (profiles) garde la date de la dernière ouverture pour « vu il y a 3 h ».

export type Etat = 'appli' | 'partie';

let me: string | null = null;
let channel: RealtimeChannel | null = null;
let etat: Etat = 'appli';
let enLigne: Record<string, Etat> = {};
const listeners = new Set<() => void>();
let lastSeenWrite = 0;
// Fermeture en cours de l'ancien canal : le SDK rendrait l'ancien objet au même nom
let closing: Promise<unknown> | null = null;

const emit = () => listeners.forEach((l) => l());

function read(ch: RealtimeChannel) {
  const next: Record<string, Etat> = {};
  for (const [uid, metas] of Object.entries(ch.presenceState<{ etat: Etat }>())) {
    // Deux téléphones du même membre : « en partie » l'emporte
    next[uid] = metas.some((m) => m.etat === 'partie') ? 'partie' : 'appli';
  }
  enLigne = next;
  emit();
}

/** Date de dernière présence ; pas plus d'une écriture toutes les 5 minutes, sauf en partant */
function touchVu(force = false) {
  if (!me || (!force && Date.now() - lastSeenWrite < 5 * 60_000)) return;
  lastSeenWrite = Date.now();
  sb.from('profiles')
    .update({ vu_le: new Date().toISOString() })
    .eq('id', me)
    .then(
      () => {},
      () => {},
    );
}

function join() {
  if (!me || channel) return;
  if (closing) {
    closing.then(join);
    return;
  }
  const ch = sb.channel('en-ligne', { config: { presence: { key: me } } });
  channel = ch;
  ch.on('presence', { event: 'sync' }, () => channel === ch && read(ch)).subscribe((status) => {
    if (channel !== ch) return;
    if (status === 'SUBSCRIBED') ch.track({ etat });
    // Coupure : on ne sait plus qui est là ; la prochaine synchronisation remplira la liste
    else if (channel === ch) {
      enLigne = {};
      emit();
    }
  });
  touchVu();
}

function leave() {
  if (!channel) return;
  const ch = channel;
  channel = null;
  touchVu(true);
  const done = ch
    .untrack()
    .catch(() => {})
    .then(() => sb.removeChannel(ch))
    .catch(() => {})
    .finally(() => {
      if (closing === done) closing = null;
    });
  closing = done;
  enLigne = {};
  emit();
}

AppState.addEventListener('change', (st) => {
  if (st === 'active') join();
  else if (st === 'background') leave();
});

/** À la connexion (et au lancement si une session existe) */
export function startPresence(userId: string) {
  if (me === userId && channel) return;
  leave();
  me = userId;
  join();
}

/** À la déconnexion */
export function stopPresence() {
  leave();
  me = null;
}

/** « en partie » tant qu'un écran de partie est ouvert */
export function setEtat(e: Etat) {
  etat = e;
  channel?.track({ etat });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Membres connectés en ce moment, avec ce qu'ils font */
export function useEnLigne() {
  return useSyncExternalStore(subscribe, () => enLigne);
}

/** « vu il y a 3 h » ; rien si la date est inconnue */
export function vuIlYa(iso: string | null | undefined) {
  if (!iso) return null;
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 2) return 'vu à l’instant';
  if (min < 60) return `vu il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vu il y a ${h} h`;
  const j = Math.round(h / 24);
  return j === 1 ? 'vu hier' : j < 30 ? `vu il y a ${j} jours` : 'vu il y a longtemps';
}
