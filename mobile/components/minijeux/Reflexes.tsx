import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/ui/kit';
import { gameStyles } from '@/components/minijeux/GameArea';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

const ROUNDS = 5;
// Sous 100 ms, personne ne réagit : c'est qu'on a deviné le moment
const HUMAN_MIN = 100;

type Phase = 'wait' | 'go' | 'early' | 'shown';

/** Cinq essais : l'écran passe au vert après un délai au hasard, on touche le plus vite possible. */
export function Reflexes({ onEnd }: { onEnd: (avgMs: number) => void }) {
  const [phase, setPhase] = useState<Phase>('wait');
  const [times, setTimes] = useState<number[]>([]);
  const startedAt = useRef(0);
  // L'état lu au toucher : le bouton ne reçoit le nouvel état qu'un instant après l'affichage
  // du vert, et un toucher rapide dans cet intervalle était compté « trop tôt »
  const phaseNow = useRef<Phase>('wait');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(p: Phase) {
    phaseNow.current = p;
    setPhase(p);
  }

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function arm() {
    clear();
    go('wait');
    timer.current = setTimeout(
      () => {
        startedAt.current = performance.now();
        go('go');
        AccessibilityInfo.announceForAccessibility('Touche !');
      },
      1200 + Math.random() * 2800,
    );
  }

  useEffect(() => {
    arm();
    return clear;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPressIn() {
    const phase = phaseNow.current;
    if (phase === 'wait') {
      clear();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      go('early');
      AccessibilityInfo.announceForAccessibility('Trop tôt, on recommence cet essai');
      timer.current = setTimeout(arm, 1100);
      return;
    }
    if (phase !== 'go') return;
    const ms = Math.round(performance.now() - startedAt.current);
    if (ms < HUMAN_MIN) {
      go('early');
      AccessibilityInfo.announceForAccessibility('Trop tôt, on recommence cet essai');
      timer.current = setTimeout(arm, 1100);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const next = [...times, Math.min(ms, 5000)];
    setTimes(next);
    go('shown');
    AccessibilityInfo.announceForAccessibility(`${Math.min(ms, 5000)} millisecondes, essai ${next.length} sur ${ROUNDS}`);
    timer.current = setTimeout(() => {
      if (next.length >= ROUNDS) {
        const avg = Math.round(next.reduce((a, b) => a + b, 0) / next.length);
        AccessibilityInfo.announceForAccessibility(`Moyenne : ${avg} millisecondes`);
        onEnd(avg);
      } else arm();
    }, 900);
  }

  const last = times[times.length - 1];
  const bg = phase === 'go' ? c.teal : phase === 'early' ? c.coral : c.card;
  return (
    // Le doigt agit dès qu'il touche ; le lecteur d'écran passe par l'action « activer »
    <Pressable
      onPressIn={onPressIn}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && onPressIn()}
      style={[gameStyles.card, styles.area, { backgroundColor: bg }]}
      accessibilityRole="button"
      accessibilityLabel={phase === 'go' ? 'Touche maintenant' : 'Attends que l’écran passe au vert'}
    >
      <View style={styles.dots}>
        {Array.from({ length: ROUNDS }, (_, i) => (
          <View key={i} style={[styles.dot, i < times.length && { backgroundColor: phase === 'go' ? c.tealInk : c.teal }]} />
        ))}
      </View>
      {phase === 'wait' && (
        <>
          <Icon name="clock" size={44} color={c.muted} />
          <Text style={styles.big}>Attends le vert…</Text>
        </>
      )}
      {phase === 'go' && (
        <Text style={[styles.huge, { color: c.tealInk }]} maxFontSizeMultiplier={1.4}>
          Touche !
        </Text>
      )}
      {phase === 'early' && (
        <>
          <Text style={[styles.big, { color: '#fff' }]}>Trop tôt !</Text>
          <Text style={[styles.small, { color: '#fff' }]}>On recommence cet essai</Text>
        </>
      )}
      {phase === 'shown' && last !== undefined && (
        <>
          <Text style={styles.huge} maxFontSizeMultiplier={1.4}>
            {last} ms
          </Text>
          <Text style={styles.small}>
            Essai {times.length} sur {ROUNDS}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  area: { gap: 12 },
  dots: { position: 'absolute', top: 24, flexDirection: 'row', gap: 8 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.rail },
  big: { color: c.text, fontFamily: f.serif, fontSize: 30, lineHeight: 36 },
  huge: { color: c.text, fontFamily: f.serifBlack, fontSize: 52, lineHeight: 60 },
  small: { color: c.muted, fontFamily: f.body, fontSize: 15 },
});
