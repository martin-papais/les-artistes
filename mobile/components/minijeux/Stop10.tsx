import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { gameStyles } from '@/components/minijeux/GameArea';
import { secondes } from '@/lib/minijeux';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

const TARGET = 10_000;
const VISIBLE = 3_000; // le chrono s'efface au bout de 3 s

type Phase = 'ready' | 'running' | 'stopped';


/** Un seul essai : arrêter le chrono le plus près possible de 10,00 s. Score = écart en ms. */
export function Stop10({ onEnd }: { onEnd: (ecartMs: number) => void }) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [shown, setShown] = useState(0);
  const [final, setFinal] = useState<number | null>(null);
  const start = useRef(0);
  const fade = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));

  useEffect(() => {
    if (phase !== 'running') return;
    // L'affichage suit le temps tant qu'il est visible, puis ne bouge plus
    const id = setInterval(() => {
      const t = performance.now() - start.current;
      setShown(Math.min(t, VISIBLE));
      if (t >= VISIBLE) clearInterval(id);
    }, 33);
    fade.set(withDelay(VISIBLE - 900, withTiming(0, { duration: 900 })));
    return () => clearInterval(id);
  }, [phase, fade]);

  function press() {
    if (phase === 'ready') {
      start.current = performance.now();
      fade.set(1);
      setPhase('running');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      return;
    }
    if (phase === 'running') {
      const t = Math.round(performance.now() - start.current);
      setFinal(t);
      setPhase('stopped');
      fade.set(withTiming(1, { duration: 150 }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setTimeout(() => onEnd(Math.min(TARGET, Math.abs(t - TARGET))), 1800);
    }
  }

  const ecart = final !== null ? final - TARGET : 0;
  const value = phase === 'stopped' && final !== null ? final : shown;
  return (
    <Pressable onPressIn={press} style={[gameStyles.card, styles.area]} accessibilityRole="button" accessibilityLabel={phase === 'ready' ? 'Démarrer' : 'Arrêter'}>
      <Text style={styles.kicker}>Objectif 10,00 s</Text>
      <View style={styles.dial}>
        <Animated.View style={fadeStyle}>
          <Text style={styles.time}>{secondes(value)}</Text>
        </Animated.View>
        {phase === 'running' && shown >= VISIBLE && <Text style={styles.hidden}>?</Text>}
      </View>

      {phase === 'ready' && <Text style={styles.cta}>Touche pour lancer le chrono</Text>}
      {phase === 'running' && <Text style={styles.cta}>{shown < VISIBLE ? 'Compte dans ta tête…' : 'Touche quand tu penses être à 10\u00a0s'}</Text>}
      {phase === 'stopped' && final !== null && (
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Text style={[styles.ecart, { color: Math.abs(ecart) <= 200 ? c.teal : Math.abs(ecart) <= 1000 ? c.yellow : c.coral }]}>
            {ecart === 0 ? 'Pile !' : `${ecart > 0 ? '+' : '−'}${secondes(Math.abs(ecart))} s`}
          </Text>
          <Text style={styles.cta}>{ecart > 0 ? 'Un peu trop tard' : ecart < 0 ? 'Un peu trop tôt' : 'Exactement 10 secondes'}</Text>
        </View>
      )}
    </Pressable>
  );
}

const DIAL = 240;

const styles = StyleSheet.create({
  area: { gap: 28, backgroundColor: '#1F1430' },
  kicker: { color: c.pink, fontFamily: f.bodyBold, fontSize: 13, letterSpacing: 2.5, textTransform: 'uppercase' },
  dial: {
    width: DIAL,
    height: DIAL,
    borderRadius: DIAL / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,158,188,0.35)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: { color: '#fff', fontFamily: f.serifBlack, fontSize: 64, lineHeight: 72, fontVariant: ['tabular-nums'] },
  hidden: { position: 'absolute', color: 'rgba(255,255,255,0.25)', fontFamily: f.serifBlack, fontSize: 96 },
  cta: { color: c.muted, fontFamily: f.bodyMedium, fontSize: 16, textAlign: 'center', paddingHorizontal: 24 },
  ecart: { fontFamily: f.serifBlack, fontSize: 40, lineHeight: 46 },
});
