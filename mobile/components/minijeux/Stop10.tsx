import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { gameStyles } from '@/components/minijeux/GameArea';
import { secondes } from '@/lib/minijeux';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

const TARGET = 10_000;
const VISIBLE = 3_000; // le chrono s'efface au bout de 3 s
// L'essai s'arrête seul à 20 s : l'écart affiché et l'écart enregistré restent sous 10 s
const LIMITE = TARGET * 2;
// Le chiffre grossit avec la taille du texte du téléphone, jusqu'à ×1,4
const ZOOM_MAX = 1.4;

type Phase = 'ready' | 'running' | 'stopped';

/** Un seul essai : arrêter le chrono le plus près possible de 10,00 s. Score = écart en ms. */
export function Stop10({ onEnd }: { onEnd: (ecartMs: number) => void }) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [shown, setShown] = useState(0);
  const [final, setFinal] = useState<number | null>(null);
  const start = useRef(0);
  const fade = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const { width, fontScale } = useWindowDimensions();
  // Cadran à la taille du chiffre, sans dépasser la carte
  const dial = Math.min(width - 64, Math.round(240 * Math.min(ZOOM_MAX, Math.max(1, fontScale))));

  function stop(t: number) {
    setFinal(t);
    setPhase('stopped');
    fade.set(withTiming(1, { duration: 150 }));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const ecart = t - TARGET;
    AccessibilityInfo.announceForAccessibility(
      t >= LIMITE
        ? 'Temps écoulé : 20 secondes, 10 secondes d’écart'
        : `Arrêté à ${secondes(t)} secondes, ${Math.round(ecart / 10) === 0 ? 'pile' : `${secondes(Math.abs(ecart))} secondes trop ${ecart > 0 ? 'tard' : 'tôt'}`}`,
    );
    setTimeout(() => onEnd(Math.min(TARGET, Math.abs(ecart))), 1800);
  }

  useEffect(() => {
    if (phase !== 'running') return;
    // L'affichage suit le temps tant qu'il est visible, puis ne bouge plus ; à 20 s, l'essai s'arrête
    let annonce = false;
    const id = setInterval(() => {
      const t = performance.now() - start.current;
      setShown(Math.min(t, VISIBLE));
      if (t >= VISIBLE && !annonce) {
        annonce = true;
        AccessibilityInfo.announceForAccessibility('Chrono masqué');
      }
      if (t >= LIMITE) {
        clearInterval(id);
        stop(LIMITE);
      }
    }, 33);
    fade.set(withDelay(VISIBLE - 900, withTiming(0, { duration: 900 })));
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, fade]);

  function press() {
    if (phase === 'ready') {
      start.current = performance.now();
      fade.set(1);
      setPhase('running');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      AccessibilityInfo.announceForAccessibility('Chrono lancé');
      return;
    }
    if (phase === 'running') stop(Math.min(LIMITE, Math.round(performance.now() - start.current)));
  }

  const ecart = final !== null ? final - TARGET : 0;
  const value = phase === 'stopped' && final !== null ? final : shown;
  return (
    // Le doigt agit dès qu'il touche ; le lecteur d'écran passe par l'action « activer »
    <Pressable
      onPressIn={press}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && press()}
      style={[gameStyles.card, styles.area]}
      accessibilityRole="button"
      accessibilityLabel={phase === 'ready' ? 'Démarrer le chrono' : phase === 'running' ? 'Arrêter le chrono' : 'Essai terminé'}
    >
      <Text style={styles.kicker} maxFontSizeMultiplier={1.5}>
        Objectif 10,00 s
      </Text>
      <View style={[styles.dial, { width: dial, height: dial, borderRadius: dial / 2 }]}>
        <Animated.View style={fadeStyle}>
          <Text style={styles.time} maxFontSizeMultiplier={ZOOM_MAX} numberOfLines={1} adjustsFontSizeToFit>
            {secondes(value)}
          </Text>
        </Animated.View>
        {phase === 'running' && shown >= VISIBLE && (
          <Text style={styles.hidden} maxFontSizeMultiplier={1}>
            ?
          </Text>
        )}
      </View>

      {phase === 'ready' && <Text style={styles.cta}>Touche pour lancer le chrono</Text>}
      {phase === 'running' && <Text style={styles.cta}>{shown < VISIBLE ? 'Compte dans ta tête…' : 'Touche quand tu penses être à 10 s'}</Text>}
      {phase === 'stopped' && final !== null && (
        <View style={{ alignItems: 'center', gap: 6 }}>
          <Text
            style={[styles.ecart, { color: Math.abs(ecart) <= 200 ? c.teal : Math.abs(ecart) <= 1000 ? c.yellow : c.coral }]}
            maxFontSizeMultiplier={1.5}
          >
            {Math.round(ecart / 10) === 0 ? 'Pile !' : `${ecart > 0 ? '+' : '−'}${secondes(Math.abs(ecart))} s`}
          </Text>
          <Text style={styles.cta}>
            {final >= LIMITE ? 'Temps écoulé : arrêté à 20 s' : ecart > 0 ? 'Un peu trop tard' : ecart < 0 ? 'Un peu trop tôt' : 'Exactement 10 secondes'}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  area: { gap: 28, backgroundColor: '#1F1430' },
  kicker: { color: c.pink, fontFamily: f.bodyBold, fontSize: 13, letterSpacing: 2.5, textTransform: 'uppercase' },
  dial: {
    borderWidth: 3,
    borderColor: 'rgba(255,158,188,0.35)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  time: { color: '#fff', fontFamily: f.serifBlack, fontSize: 64, lineHeight: 72, fontVariant: ['tabular-nums'] },
  hidden: { position: 'absolute', color: 'rgba(255,255,255,0.25)', fontFamily: f.serifBlack, fontSize: 96 },
  cta: { color: c.muted, fontFamily: f.bodyMedium, fontSize: 16, textAlign: 'center', paddingHorizontal: 24 },
  ecart: { fontFamily: f.serifBlack, fontSize: 40, lineHeight: 46 },
});
