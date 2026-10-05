import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Charge l'écran au montage, puis le recharge quand on y revient (onglet,
 * retour d'un autre écran, tap sur une notification) ou que l'appli repasse
 * au premier plan. Pas plus d'une fois par minute : le plan gratuit de
 * Supabase compte chaque requête.
 */
export function useRefreshOnFocus(load: () => Promise<unknown> | void, minIntervalMs = 60_000) {
  const last = useRef(0);
  const focused = useRef(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(
    (force: boolean) => {
      if (!force && Date.now() - last.current < minIntervalMs) return;
      last.current = Date.now();
      loadRef.current();
    },
    [minIntervalMs],
  );

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      run(last.current === 0);
      return () => {
        focused.current = false;
      };
    }, [run]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && focused.current) run(false);
    });
    return () => sub.remove();
  }, [run]);
}
