import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef } from 'react';

import { alerteChargement } from '@/lib/serveur';

// Dernier contenu chargé de chaque page, gardé sur le téléphone : la page l'affiche tout de
// suite, puis le remplace par celui du serveur (la base gratuite répond lentement, 22/10/2026).
// Vidé à la déconnexion (viderCache) : un autre compte ne voit jamais les données du précédent.

const PREFIXE = 'page:';
// À monter quand la forme des données gardées change : l'ancien contenu est alors ignoré
const VERSION = 1;

export async function lireCache<T>(cle: string): Promise<T | null> {
  try {
    const s = await AsyncStorage.getItem(`${PREFIXE}${VERSION}:${cle}`);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function ecrireCache(cle: string, valeur: unknown) {
  AsyncStorage.setItem(`${PREFIXE}${VERSION}:${cle}`, JSON.stringify(valeur)).catch(() => {});
}

export async function viderCache() {
  try {
    const cles = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIXE));
    if (cles.length) await AsyncStorage.multiRemove(cles);
  } catch {}
}

/**
 * Au montage, `montrer` reçoit le contenu gardé (s'il existe et que le serveur n'a pas déjà
 * répondu). `garder(d)` montre la réponse du serveur et la garde ; `aGarder` permet d'en
 * retirer ce qui ne doit pas rester sur le téléphone. `echec()` n'alerte que si la page n'a
 * rien à montrer.
 */
export function usePageCache<T>(cle: string, montrer: (d: T) => void) {
  const frais = useRef(false);
  const affiche = useRef(false);
  const montrerRef = useRef(montrer);
  montrerRef.current = montrer;

  useEffect(() => {
    lireCache<T>(cle).then((d) => {
      if (!d || frais.current) return;
      affiche.current = true;
      montrerRef.current(d);
    });
  }, [cle]);

  const garder = useCallback(
    (d: T, aGarder: T = d) => {
      frais.current = true;
      affiche.current = true;
      montrerRef.current(d);
      ecrireCache(cle, aGarder);
    },
    [cle],
  );

  const echec = useCallback(() => {
    if (!affiche.current) alerteChargement();
  }, []);

  return { garder, echec };
}
