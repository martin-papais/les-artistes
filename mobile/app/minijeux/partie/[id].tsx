import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { DuelScreen, duelStyles, statusText, useDuel } from '@/components/minijeux/Duel';
import { seat } from '@/lib/duel';
import { COLS, jouer, landingRow, p4, ROWS } from '@/lib/puissance4';
import { theme } from '@/lib/theme';

const c = theme.colors;

const COLOR: Record<string, string> = { '1': c.coral, '2': c.yellow };
const DARK: Record<string, string> = { '1': '#B84545', '2': '#C9A21E' };

export default function PartieScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const duel = useDuel(id, p4, 'puissance4');
  const { p: partie, me, busy, setBusy, setP, accept, rollback } = duel;

  const mySeat = partie ? seat(partie, me) : 0;
  const myTurn = partie?.statut === 'en_cours' && partie.tour === mySeat;

  async function play(col: number) {
    if (!partie || !myTurn || busy) return;
    const r = landingRow(partie.plateau, col);
    if (r < 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Le jeton tombe tout de suite ; le serveur confirme
    const idx = r * COLS + col;
    const before = partie;
    setP({
      ...partie,
      plateau: partie.plateau.slice(0, idx) + String(mySeat) + partie.plateau.slice(idx + 1),
      dernier_coup: idx,
      coups: partie.coups + 1,
      tour: mySeat === 1 ? 2 : 1,
    });
    setBusy(true);
    try {
      await jouer(partie.id, col);
      const fresh = await p4.fetchPartie(partie.id);
      if (fresh) accept(fresh);
    } catch (e) {
      await rollback(before);
      Alert.alert('Coup refusé', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const boardW = Math.min(width - 24, 460);
  const cell = (boardW - 12) / COLS; // 6 px de bord de chaque côté

  return (
    <DuelScreen
      duel={duel}
      titre="Puissance 4"
      lobby="/minijeux/puissance4"
      route="/minijeux/partie/[id]"
      colors={[COLOR['1'], COLOR['2']]}
      status={partie ? statusText(duel, partie) : ''}
      statusColor={myTurn ? COLOR[String(mySeat)] : undefined}
    >
      {/* La consigne garde sa place quand c'est à l'adversaire : le plateau ne saute pas */}
      {partie?.statut === 'en_cours' && partie.coups < 2 && (
        <Text style={[duelStyles.tip, !myTurn && { opacity: 0 }]}>Touche une colonne pour y lâcher ton jeton</Text>
      )}
      {partie && (
        <View style={[styles.board, { width: boardW, height: cell * ROWS + 12 }]}>
          {Array.from({ length: ROWS * COLS }, (_, i) => (
            <Cell
              key={`${i}-${partie.plateau[i]}`}
              i={i}
              v={partie.plateau[i]}
              size={cell}
              drop={i === partie.dernier_coup}
              win={!!partie.ligne_gagnante?.includes(i)}
            />
          ))}
          {/* Une colonne entière se touche pour jouer */}
          <View style={StyleSheet.absoluteFill} pointerEvents={myTurn ? 'auto' : 'none'}>
            <View style={{ flexDirection: 'row', flex: 1, paddingHorizontal: 6 }}>
              {Array.from({ length: COLS }, (_, col) => (
                <Pressable
                  key={col}
                  onPress={() => play(col)}
                  style={({ pressed }) => [{ flex: 1 }, pressed && { backgroundColor: 'rgba(255,255,255,0.08)' }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Jouer colonne ${col + 1}`}
                />
              ))}
            </View>
          </View>
        </View>
      )}
    </DuelScreen>
  );
}

/** Une case : trou, jeton éventuel. Seuls le dernier jeton et la ligne gagnante sont animés. */
function Cell({ i, v, size, drop, win }: { i: number; v: string; size: number; drop: boolean; win: boolean }) {
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  const d = size * 0.8;
  return (
    <View style={[styles.cell, { left: col * size + 6, top: row * size + 6, width: size, height: size }]}>
      <View style={[styles.hole, { width: d, height: d, borderRadius: d / 2 }]} />
      {v !== '0' && (drop ? <DropToken v={v} d={d} from={-(row + 1) * size} row={row} /> : <Token v={v} d={d} />)}
      {win && <WinRing d={d} />}
    </View>
  );
}

function Token({ v, d, style }: { v: string; d: number; style?: object }) {
  return (
    <Animated.View
      style={[styles.piece, { width: d, height: d, borderRadius: d / 2, backgroundColor: COLOR[v], borderColor: DARK[v] }, style]}
    >
      <View style={[styles.shine, { width: d * 0.55, height: d * 0.55, borderRadius: d }]} />
    </Animated.View>
  );
}

/** Le dernier jeton joué tombe depuis le haut du plateau */
function DropToken({ v, d, from, row }: { v: string; d: number; from: number; row: number }) {
  const y = useSharedValue(from);
  useEffect(() => {
    y.set(withTiming(0, { duration: 160 + row * 55, easing: Easing.bounce }));
  }, [row, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  return <Token v={v} d={d} style={style} />;
}

function WinRing({ d }: { d: number }) {
  const glow = useSharedValue(0);
  useEffect(() => {
    glow.set(withRepeat(withSequence(withTiming(1, { duration: 450 }), withTiming(0.3, { duration: 450 })), -1));
  }, [glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.get() }));
  return <Animated.View style={[styles.winRing, { width: d + 8, height: d + 8, borderRadius: d }, style]} />;
}

const styles = StyleSheet.create({
  board: {
    marginTop: 18,
    borderRadius: 22,
    backgroundColor: '#3B2C8C',
    borderBottomWidth: 8,
    borderBottomColor: '#2A1F66',
    overflow: 'hidden',
  },
  cell: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  hole: { position: 'absolute', backgroundColor: '#1A1025', borderWidth: 3, borderColor: '#2A1F66' },
  piece: { position: 'absolute', borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  shine: { borderWidth: 3, borderColor: 'rgba(255,255,255,0.35)' },
  winRing: { position: 'absolute', borderWidth: 4, borderColor: '#fff' },
});
