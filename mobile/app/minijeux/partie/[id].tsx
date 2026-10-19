import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, IconButton, Pastille } from '@/components/ui/kit';
import { displayName, fetchElo, fetchProfiles } from '@/lib/minijeux';
import {
  abandonner,
  COLS,
  defier,
  fetchPartie,
  ELO_DEPART,
  jouer,
  landingRow,
  opponentOf,
  type Partie,
  repondre,
  ROWS,
  seat,
  suivre,
} from '@/lib/puissance4';
import { sessionUser, type ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

const COLOR: Record<string, string> = { '1': c.coral, '2': c.yellow };
const DARK: Record<string, string> = { '1': '#B84545', '2': '#C9A21E' };

export default function PartieScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [me, setMe] = useState<string | null>(null);
  const [p, setP] = useState<Partie | null | undefined>(undefined);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [elo, setElo] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const lastStatus = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [user, partie] = await Promise.all([sessionUser(), fetchPartie(id).catch(() => null)]);
    setMe(user?.id ?? null);
    setP(partie);
    if (partie) {
      const ids = [partie.joueur1, partie.joueur2];
      const [profs, elos] = await Promise.all([fetchProfiles(ids), fetchElo(ids)]);
      setProfiles(profs);
      setElo(elos);
    }
  }, [id]);

  useRefreshOnFocus(load, 0);

  // Les coups de l'adversaire arrivent en direct
  useEffect(() => {
    if (!id) return;
    return suivre(id, (np) => setP((cur) => (cur && np.coups < cur.coups ? cur : np)));
  }, [id]);

  // Fin de partie : vibration et Elo à jour (les profils, eux, ne changent pas)
  useEffect(() => {
    if (!p || !me) return;
    if (lastStatus.current === 'en_cours' && (p.statut === 'finie' || p.statut === 'abandon')) {
      const won = p.gagnant === seat(p, me);
      Haptics.notificationAsync(won ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
      fetchElo([p.joueur1, p.joueur2]).then(setElo, () => {});
    }
    lastStatus.current = p.statut;
  }, [p, me]);

  if (p === undefined) {
    return (
      <View style={[styles.flex, styles.center]}>
        <ActivityIndicator color={c.teal} />
      </View>
    );
  }
  if (p === null) {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <EmptyState icon="alert-triangle" title="Partie introuvable" action={<Button label="Retour" onPress={() => router.back()} />} />
      </View>
    );
  }

  const partie = p;
  const mySeat = seat(partie, me);
  const opp = opponentOf(partie, me);
  const myTurn = partie.statut === 'en_cours' && partie.tour === mySeat;
  const finished = partie.statut === 'finie' || partie.statut === 'abandon';
  const won = finished && partie.gagnant === mySeat;
  const draw = finished && partie.gagnant === 0;

  async function play(col: number) {
    if (!myTurn || busy) return;
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
      const fresh = await fetchPartie(partie.id);
      if (fresh) setP((cur) => (cur && fresh.coups < cur.coups ? cur : fresh));
    } catch (e) {
      setP(before);
      Alert.alert('Coup refusé', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, title = 'Oups') {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert(title, (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Après une réponse ou un abandon, la partie relue suffit
  const refresh = async () => setP((await fetchPartie(partie.id)) ?? partie);

  function giveUp() {
    Alert.alert('Abandonner ?', 'La partie compte comme perdue, Elo compris.', [
      { text: 'Continuer', style: 'cancel' },
      { text: 'Abandonner', style: 'destructive', onPress: () => act(async () => {
        await abandonner(partie.id);
        await refresh();
      }) },
    ]);
  }

  const rematch = () =>
    act(async () => {
      const nid = await defier(opp);
      router.replace({ pathname: '/minijeux/partie/[id]', params: { id: nid } });
    }, 'Revanche impossible');

  const boardW = Math.min(width - 24, 460);
  const cell = (boardW - 12) / COLS; // 6 px de bord de chaque côté
  const name = (uid: string) => (uid === me ? 'Toi' : displayName(profiles[uid]));

  let status = '';
  if (partie.statut === 'invitation') status = mySeat === 2 ? `${name(partie.joueur1)} te défie` : `En attente de ${name(partie.joueur2)}`;
  else if (partie.statut === 'refusee') status = 'Défi refusé';
  else if (partie.statut === 'en_cours') status = myTurn ? 'À toi de jouer' : `Au tour de ${name(opp)}`;
  else if (draw) status = 'Match nul';
  else if (won) status = partie.statut === 'abandon' ? `${name(opp)} abandonne : gagné !` : 'Tu as gagné !';
  else status = partie.statut === 'abandon' ? 'Tu as abandonné' : `${name(opp)} gagne`;

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <IconButton name="chevron-left" label="Retour" onPress={() => (router.canGoBack() ? router.back() : router.replace('/minijeux/puissance4'))} />
        <Text style={styles.title}>Puissance 4</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, alignItems: 'center' }}>
        <View style={styles.players}>
          <PlayerChip uid={partie.joueur1} label={name(partie.joueur1)} elo={elo[partie.joueur1]} color={COLOR['1']} active={partie.statut === 'en_cours' && partie.tour === 1} />
          <Text style={styles.vs}>contre</Text>
          <PlayerChip uid={partie.joueur2} label={name(partie.joueur2)} elo={elo[partie.joueur2]} color={COLOR['2']} active={partie.statut === 'en_cours' && partie.tour === 2} />
        </View>

        <Text style={[styles.status, myTurn && { color: COLOR[String(mySeat)] }, won && { color: c.teal }]}>{status}</Text>
        {finished && partie.elo_delta !== null && !draw && (
          <Text style={[styles.delta, { color: won ? c.teal : c.coralSoft }]}>
            {won ? '+' : '−'}
            {Math.abs(partie.elo_delta)} Elo
          </Text>
        )}

        {myTurn && partie.coups < 2 && <Text style={styles.tip}>Touche une colonne pour y lâcher ton jeton</Text>}
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

        <View style={styles.footer}>
          {partie.statut === 'invitation' && mySeat === 2 && (
            <>
              <Button label="Refuser" variant="raised" onPress={() => act(async () => {
                    await repondre(partie.id, false);
                    await refresh();
                  })} disabled={busy} style={{ flex: 1 }} />
              <Button label="Jouer" variant="yes" onPress={() => act(async () => {
                    await repondre(partie.id, true);
                    await refresh();
                  })} disabled={busy} style={{ flex: 1 }} />
            </>
          )}
          {partie.statut === 'invitation' && mySeat === 1 && (
            <Button label="Annuler le défi" variant="raised" onPress={() => act(async () => {
        await abandonner(partie.id);
        await refresh();
      })} disabled={busy} style={{ flex: 1 }} />
          )}
          {partie.statut === 'en_cours' && mySeat > 0 && (
            <Button label="Abandonner" variant="ghost" onPress={giveUp} disabled={busy} style={{ flex: 1 }} />
          )}
          {(finished || partie.statut === 'refusee') && mySeat > 0 && (
            <Button label="Revanche" icon="rotate-cw" onPress={rematch} loading={busy} style={{ flex: 1 }} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function PlayerChip({ uid, label, elo, color, active }: { uid: string; label: string; elo?: number; color: string; active: boolean }) {
  return (
    <View style={[styles.chip, active && { borderColor: color }]}>
      <View style={[styles.token, { backgroundColor: color }]} />
      <Pastille id={uid} name={label} size={30} />
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <Text style={styles.chipName} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.chipElo}>{elo ?? ELO_DEPART}</Text>
      </View>
    </View>
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
    <Animated.View style={[styles.piece, { width: d, height: d, borderRadius: d / 2, backgroundColor: COLOR[v], borderColor: DARK[v] }, style]}>
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
  flex: { flex: 1, backgroundColor: c.deep },
  center: { alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6 },
  title: { color: c.text, fontFamily: f.serif, fontSize: 20 },
  players: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, marginTop: 8 },
  vs: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    borderRadius: 18,
    backgroundColor: c.card,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  token: { width: 12, height: 12, borderRadius: 6 },
  chipName: { color: c.text, fontFamily: f.bodyBold, fontSize: 14 },
  chipElo: { color: c.muted, fontFamily: f.body, fontSize: 12 },
  status: { alignSelf: 'stretch', color: c.text, fontFamily: f.serif, fontSize: 24, lineHeight: 30, marginTop: 20, textAlign: 'center', paddingHorizontal: 16 },
  delta: { fontFamily: f.bodyBold, fontSize: 16, marginTop: 4 },
  tip: { color: c.muted, fontFamily: f.body, fontSize: 14, marginTop: 6 },
  board: { marginTop: 18, borderRadius: 22, backgroundColor: '#3B2C8C', borderBottomWidth: 8, borderBottomColor: '#2A1F66', overflow: 'hidden' },
  cell: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  hole: { position: 'absolute', backgroundColor: '#1A1025', borderWidth: 3, borderColor: '#2A1F66' },
  piece: { position: 'absolute', borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  shine: { borderWidth: 3, borderColor: 'rgba(255,255,255,0.35)' },
  winRing: { position: 'absolute', borderWidth: 4, borderColor: '#fff' },
  footer: { flexDirection: 'row', gap: 10, width: '100%', paddingHorizontal: 20, marginTop: 24 },
});
