import { type ReactNode, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { theme } from '@/lib/theme';

const f = theme.fonts;

/** Aire de jeu : mesurée une fois, puis le jeu reçoit sa largeur et sa hauteur */
export function GameArea({ background, children }: { background: string; children: (w: number, h: number) => ReactNode }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      style={[styles.area, { backgroundColor: background }]}
      onLayout={(e: LayoutChangeEvent) => setSize((s) => s ?? { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size && children(size.w, size.h)}
    </View>
  );
}

/** Consigne de départ, posée sur le jeu sans bloquer les touches */
export function HintPill({ text, at }: { text: string; at: Pick<ViewStyle, 'top' | 'bottom'> }) {
  return (
    <View style={[styles.hintBox, at]} pointerEvents="none">
      <Text style={styles.hint}>{text}</Text>
    </View>
  );
}

export const gameStyles = StyleSheet.create({
  /** Gros score en haut de l'écran, ombré pour rester lisible sur le décor */
  score: {
    position: 'absolute',
    top: 28,
    alignSelf: 'center',
    color: '#fff',
    fontFamily: f.serifBlack,
    fontSize: 60,
    lineHeight: 68,
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 0,
  },
  /** Carte de jeu des jeux sans décor (Réflexes, Stop à 10 s) */
  card: { flex: 1, alignItems: 'center', justifyContent: 'center', margin: 16, borderRadius: 28 },
});

const styles = StyleSheet.create({
  area: { flex: 1, overflow: 'hidden' },
  hintBox: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 4 },
  hint: {
    color: '#fff',
    fontFamily: f.bodyBold,
    fontSize: 17,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
});
