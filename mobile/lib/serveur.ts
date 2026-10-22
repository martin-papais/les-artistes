import * as Updates from 'expo-updates';
import { useSyncExternalStore } from 'react';
import { Alert, DevSettings } from 'react-native';

// La base tourne sur l'offre gratuite de Supabase : quand son quota d'accès disque est épuisé,
// elle est bridée et les requêtes ne reviennent plus (nuit du 21/10/2026, appli bloquée sur le
// chargement de 00 h 40 à 11 h). Les requêtes à la base sont abandonnées au bout de 15 s ;
// si Internet répond ailleurs, c'est la base : écran « Serveur plein » (components/ServeurSature).

const DELAI_MS = 15_000;
// Connexion (mot de passe, inscription) : plus d'écritures côté serveur, et un abandon trop tôt
// empêcherait de se connecter quand la base est lente sans être bloquée (22/10/2026).
// Le renouvellement de session, lui, bloque l'ouverture de l'appli : délai intermédiaire.
const DELAI_CONNEXION_MS = 45_000;
const DELAI_SESSION_MS = 25_000;

function delaiDe(url: string) {
  if (!url.includes('/auth/v1/')) return DELAI_MS;
  return /grant_type=password|\/signup/.test(url) ? DELAI_CONNEXION_MS : DELAI_SESSION_MS;
}
// Page du site du groupe (GitHub Pages) : elle répond = le téléphone a Internet
const TEMOIN = 'https://les--artistes.fr/index.html';

let sature = false;
const listeners = new Set<() => void>();

function setSature(v: boolean) {
  if (sature === v) return;
  sature = v;
  listeners.forEach((l) => l());
}

async function internetRepond() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    return (await fetch(TEMOIN, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal })).ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** fetch du client Supabase (lib/supabase.ts) */
export async function fetchAvecDelai(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  // Données et connexion seulement : un envoi de photo peut durer, la base n'y est pour rien
  if (!/\/(rest|auth)\/v1\//.test(url)) return fetch(input, init);
  const ctrl = new AbortController();
  const appelant = init?.signal;
  if (appelant?.aborted) ctrl.abort();
  appelant?.addEventListener('abort', () => ctrl.abort());
  let expire = false;
  const t = setTimeout(
    () => {
      expire = true;
      ctrl.abort();
    },
    delaiDe(url),
  );
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (e) {
    // Avant de rendre l'erreur : l'écran qui la reçoit sait déjà si c'est la base
    if (expire && !sature && (await internetRepond())) setSature(true);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useServeurSature() {
  return useSyncExternalStore(subscribe, () => sature);
}

/** Chargement d'un écran raté ; rien si l'écran « Serveur plein » le dit déjà */
export function alerteChargement() {
  if (sature) return;
  Alert.alert('Chargement impossible', 'Vérifie ta connexion puis tire vers le bas pour réessayer.');
}

/** « Réessayer » : l'appli redémarre et chaque écran recharge ses données */
export function relancerAppli() {
  if (__DEV__) DevSettings.reload();
  else Updates.reloadAsync().catch(() => setSature(false));
}
