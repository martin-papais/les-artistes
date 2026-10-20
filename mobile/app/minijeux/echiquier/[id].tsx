import type { Move, Square } from 'chess.js';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { DuelScreen, duelStyles, statusText, useBoardMax, useDuel } from '@/components/minijeux/Duel';
import { Button } from '@/components/ui/kit';
import { apresCoup, opponentOf, seat } from '@/lib/duel';
import { echecs, enFrancais, FIN_TEXTE, jouer, nulle, parse, PIECES, rejouer, VALEUR } from '@/lib/echecs';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

const LIGHT = '#EEE7FA';
const DARK = '#8E7CC9';
const FILES = 'abcdefgh';
const PROMOTIONS = ['q', 'r', 'b', 'n'] as const;
const NOMS: Record<string, string> = { k: 'Roi', q: 'Dame', r: 'Tour', b: 'Fou', n: 'Cavalier', p: 'Pion' };

export default function EchiquierScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const duel = useDuel(id, echecs, 'echecs');
  const { p: partie, me, busy, setBusy, setP, accept, rollback, act, refresh } = duel;
  const [sel, setSel] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const moves = useRef<ScrollView>(null);

  // La partie rejouée : coups légaux, échec, historique en notation
  const historique = partie?.historique;
  const game = useMemo(() => rejouer(historique ?? []), [historique]);

  const mySeat = partie ? seat(partie, me) : 0;
  const myColor = mySeat === 2 ? 'b' : 'w';
  const myTurn = partie?.statut === 'en_cours' && partie.tour === mySeat;
  const targets: Move[] = sel && myTurn ? game.moves({ square: sel, verbose: true }) : [];

  async function play(uci: string) {
    if (!partie || busy) return;
    const g = rejouer(partie.historique);
    let m: Move;
    try {
      m = g.move(parse(uci));
    } catch {
      return;
    }
    setSel(null);
    setPromo(null);
    Haptics.impactAsync(m.captured ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // La pièce bouge tout de suite ; le serveur vérifie et confirme
    const before = partie;
    setP({
      ...partie,
      fen: g.fen(),
      historique: [...partie.historique, m.lan],
      dernier_coup: m.lan,
      coups: partie.coups + 1,
      tour: mySeat === 1 ? 2 : 1,
      nulle_proposee: partie.nulle_proposee === mySeat ? mySeat : null,
      ...apresCoup(partie, duel.now(0)),
    });
    setBusy(true);
    try {
      await jouer(partie.id, m.lan);
      const fresh = await echecs.fetchPartie(partie.id);
      if (fresh) accept(fresh);
    } catch (e) {
      await rollback(before);
      Alert.alert('Coup refusé', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onSquare(sq: Square) {
    if (!myTurn || busy) return;
    const to = targets.find((m) => m.to === sq);
    if (sel && to) {
      if (to.promotion) setPromo({ from: sel, to: sq });
      else play(sel + sq);
      return;
    }
    const pc = game.get(sq);
    if (pc?.color === myColor && sq !== sel) {
      Haptics.selectionAsync().catch(() => {});
      setSel(sq);
    } else setSel(null);
  }

  // Chat ouvert : l'échiquier rétrécit pour tenir sous les joueurs, sans la liste des coups
  const maxH = useBoardMax();
  const boardW = Math.min(width - 24, 460, maxH ? maxH - 10 : Infinity);
  const size = (boardW - 8) / 8; // 4 px de cadre
  const flipped = mySeat === 2;
  const last = partie?.dernier_coup ? parse(partie.dernier_coup) : null;
  const check = game.inCheck() ? game.findPiece({ type: 'k', color: game.turn() })[0] : null;
  const san = game.history().map(enFrancais);
  const grid = game.board();

  // Avance matérielle des blancs (négative si les noirs mènent)
  let material = 0;
  for (const row of grid) for (const pc of row) if (pc) material += (pc.color === 'w' ? 1 : -1) * VALEUR[pc.type];

  let status = '';
  if (partie) {
    const opp = duel.name(opponentOf(partie, me));
    const won = partie.gagnant === mySeat;
    const enCours = check ? (myTurn ? 'Échec ! À toi de jouer' : `Échec · au tour de ${opp}`) : undefined;
    const fini =
      partie.fin === 'mat'
        ? won
          ? 'Échec et mat : tu gagnes !'
          : `Échec et mat : ${opp} gagne`
        : partie.fin
          ? FIN_TEXTE[partie.fin]
          : undefined;
    status = statusText(duel, partie, enCours, fini);
  }

  // Nulle : proposer, ou répondre à celle de l'adversaire
  let actions = null;
  if (partie?.statut === 'en_cours' && mySeat > 0) {
    const offre = partie.nulle_proposee;
    actions =
      offre && offre !== mySeat ? (
        <View style={styles.offer}>
          <Text style={styles.offerText}>{duel.name(opponentOf(partie, me))} propose la nulle</Text>
          <View style={styles.offerRow}>
            <Button
              label="Refuser"
              variant="raised"
              height={44}
              disabled={busy}
              onPress={() => act(() => nulle(partie.id, 'refuser').then(refresh))}
              style={{ flex: 1 }}
            />
            <Button
              label="Accepter"
              variant="yes"
              height={44}
              disabled={busy}
              onPress={() => act(() => nulle(partie.id, 'accepter').then(refresh))}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : (
        <View style={styles.offer}>
          <Button
            label={offre ? 'Nulle proposée' : 'Proposer la nulle'}
            icon="flag"
            variant="raised"
            height={44}
            disabled={busy || !!offre}
            onPress={() => act(() => nulle(partie.id, 'proposer').then(refresh))}
          />
        </View>
      );
  }

  return (
    <DuelScreen
      duel={duel}
      titre="Échecs"
      lobby="/minijeux/echecs"
      route="/minijeux/echiquier/[id]"
      colors={['#F4EEFF', '#1A1025']}
      activeColor={c.teal}
      chipExtra={(n) => {
        const adv = n === 1 ? material : -material;
        return adv > 0 ? `+${adv}` : null;
      }}
      status={status}
      statusColor={myTurn ? c.teal : undefined}
      actions={actions}
    >
      {/* La consigne garde sa place quand c'est à l'adversaire : le plateau ne saute pas */}
      {partie?.statut === 'en_cours' && partie.coups < 2 && !maxH && (
        <Text style={[duelStyles.tip, !myTurn && { opacity: 0 }]}>Touche une pièce, puis une des cases marquées</Text>
      )}
      {partie && (
        <View style={[styles.board, { width: boardW, height: boardW }]}>
          {Array.from({ length: 64 }, (_, i) => {
            const r = Math.floor(i / 8);
            const col = i % 8;
            const file = flipped ? 7 - col : col;
            const rank = flipped ? r + 1 : 8 - r;
            const sq = `${FILES[file]}${rank}` as Square;
            const pc = grid[8 - rank][file];
            const light = (file + rank) % 2 === 0;
            const target = targets.find((m) => m.to === sq);
            const moved = last?.to === sq;
            return (
              <Pressable
                key={sq}
                onPress={() => onSquare(sq)}
                // La case d'arrivée passe au-dessus des autres : la pièce glisse par-dessus
                style={[
                  styles.square,
                  {
                    left: col * size + 4,
                    top: r * size + 4,
                    width: size,
                    height: size,
                    backgroundColor: light ? LIGHT : DARK,
                    zIndex: moved ? 2 : 0,
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel={[
                  pc ? `${NOMS[pc.type]} ${pc.color === 'w' ? 'blanc' : 'noir'} en ${sq}` : `${sq}, vide`,
                  sel === sq && 'sélectionné',
                  target && (pc ? 'prise possible' : 'coup possible'),
                  moved && 'dernier coup',
                ]
                  .filter(Boolean)
                  .join(', ')}
              >
                {(moved || last?.from === sq) && <View style={[StyleSheet.absoluteFill, styles.last]} />}
                {sel === sq && <View style={[StyleSheet.absoluteFill, styles.selected]} />}
                {check === sq && <View style={[styles.check, { width: size * 0.9, height: size * 0.9, borderRadius: size }]} />}
                {pc &&
                  (moved && last ? (
                    <SlidingPiece
                      key={partie.coups}
                      src={PIECES[pc.color + pc.type]}
                      size={size}
                      dx={(FILES.indexOf(last.from[0]) - file) * size * (flipped ? -1 : 1)}
                      dy={(Number(last.from[1]) - rank) * size * (flipped ? 1 : -1)}
                    />
                  ) : (
                    <Image source={PIECES[pc.color + pc.type]} style={{ width: size, height: size }} />
                  ))}
                {target &&
                  (pc || target.isEnPassant() ? (
                    <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderWidth: size * 0.08 }]} />
                  ) : (
                    <View style={[styles.dot, { width: size * 0.3, height: size * 0.3, borderRadius: size }]} />
                  ))}
                {col === 0 && <Text style={[styles.coord, styles.rank, { color: light ? DARK : LIGHT }]}>{rank}</Text>}
                {r === 7 && <Text style={[styles.coord, styles.file, { color: light ? DARK : LIGHT }]}>{FILES[file]}</Text>}
              </Pressable>
            );
          })}

          {promo && (
            <View style={styles.promo}>
              <Text style={styles.promoTitle}>Promotion</Text>
              <View style={styles.promoRow}>
                {PROMOTIONS.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => play(promo.from + promo.to + t)}
                    style={({ pressed }) => [styles.promoBtn, pressed && { backgroundColor: c.raised }]}
                    accessibilityRole="button"
                    accessibilityLabel={{ q: 'Dame', r: 'Tour', b: 'Fou', n: 'Cavalier' }[t]}
                  >
                    <Image source={PIECES[myColor + t]} style={{ width: 56, height: 56 }} />
                  </Pressable>
                ))}
              </View>
              <Button label="Annuler" variant="ghost" height={40} onPress={() => setPromo(null)} />
            </View>
          )}
        </View>
      )}

      {san.length > 0 && !maxH && (
        <ScrollView
          ref={moves}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ width: boardW, marginTop: 12 }}
          contentContainerStyle={styles.moves}
          onContentSizeChange={() => moves.current?.scrollToEnd({ animated: true })}
        >
          {san.map((m, i) => (
            <Text key={i} style={[styles.move, i === san.length - 1 && styles.moveLast]}>
              {i % 2 === 0 ? `${i / 2 + 1}. ` : ''}
              {m}
            </Text>
          ))}
        </ScrollView>
      )}
    </DuelScreen>
  );
}

/** La dernière pièce jouée glisse depuis sa case de départ */
function SlidingPiece({ src, size, dx, dy }: { src: number; size: number; dx: number; dy: number }) {
  const t = useSharedValue(1);
  useEffect(() => {
    t.set(withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) }));
  }, [t]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: dx * t.get() }, { translateY: dy * t.get() }] }));
  return (
    <Animated.View style={style}>
      <Image source={src} style={{ width: size, height: size }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  board: { marginTop: 18, borderRadius: 10, backgroundColor: '#2A1F66', borderBottomWidth: 6, borderBottomColor: '#1E1650' },
  square: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  last: { backgroundColor: 'rgba(255,217,61,0.45)' },
  selected: { backgroundColor: 'rgba(78,205,196,0.55)' },
  check: { position: 'absolute', backgroundColor: 'rgba(255,107,107,0.75)' },
  dot: { position: 'absolute', backgroundColor: 'rgba(26,16,37,0.35)' },
  ring: { position: 'absolute', borderColor: 'rgba(26,16,37,0.35)' },
  coord: { position: 'absolute', fontFamily: f.bodyBold, fontSize: 10 },
  rank: { top: 2, left: 3 },
  file: { bottom: 1, right: 3 },
  promo: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: '30%',
    padding: 14,
    borderRadius: 20,
    backgroundColor: c.card,
    alignItems: 'center',
    gap: 8,
    zIndex: 5,
  },
  promoTitle: { color: c.text, fontFamily: f.serif, fontSize: 18 },
  promoRow: { flexDirection: 'row', gap: 6 },
  promoBtn: { padding: 4, borderRadius: 14, backgroundColor: LIGHT },
  moves: { gap: 10, paddingHorizontal: 4, alignItems: 'center' },
  move: { color: c.muted, fontFamily: f.bodyMedium, fontSize: 14 },
  moveLast: { color: c.text, fontFamily: f.bodyBold },
  offer: { width: '100%', paddingHorizontal: 20, marginTop: 20, gap: 8 },
  offerText: { color: c.text, fontFamily: f.bodyBold, fontSize: 15, textAlign: 'center' },
  offerRow: { flexDirection: 'row', gap: 10 },
});
