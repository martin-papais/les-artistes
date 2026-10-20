import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Classement } from '@/components/minijeux/Classement';
import { Badge, Button, Card, Icon, Pastille, ScreenHeader } from '@/components/ui/kit';
import {
  classementGeneral,
  type Classements,
  displayName,
  fetchClassements,
  formatScore,
  invalidateClassements,
  JEUX,
  LOGOS,
  MEDALS,
} from '@/lib/minijeux';
import { aFaire, type DuelJeu, type DuelPartie, ELO_DEPART } from '@/lib/duel';
import { echecs } from '@/lib/echecs';
import { p4 } from '@/lib/puissance4';
import { sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { usePullRefresh, useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

// Jeux à deux, en tête de l'onglet
const DUELS = [
  { jeu: 'echecs', nom: 'Échecs', pitch: 'Défie un membre en direct, même sur plusieurs jours.', api: echecs, route: '/minijeux/echecs' },
  { jeu: 'puissance4', nom: 'Puissance 4', pitch: 'Défie un membre en direct. Chaque partie fait bouger ton Elo.', api: p4, route: '/minijeux/puissance4' },
] as const;

export default function MiniJeuxScreen() {
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [ranks, setRanks] = useState<Classements | null>(null);
  const [parties, setParties] = useState<Record<DuelJeu, DuelPartie[]>>({ puissance4: [], echecs: [] });

  const load = useCallback(async () => {
    const user = await sessionUser();
    setMe(user?.id ?? null);
    try {
      const [cl, ps4, pse] = await Promise.all([
        fetchClassements(),
        user ? p4.fetchMesParties(user.id) : [],
        user ? echecs.fetchMesParties(user.id) : [],
      ]);
      setRanks(cl);
      setParties({ puissance4: ps4, echecs: pse });
    } catch {
      // Hors connexion : les jeux solo restent jouables, sans classement
    }
  }, []);

  // Revenir d'une partie montre le nouveau classement (les classements sont en cache 20 s,
  // vidé dès qu'un score ou un Elo change : pas de requête inutile)
  useRefreshOnFocus(load, 0);
  const { refreshing, onRefresh } = usePullRefresh(
    useCallback(async () => {
      invalidateClassements();
      await load();
    }, [load]),
  );

  // Un défi ou un coup reçu met le badge à jour sans recharger, tant que l'onglet est affiché
  useFocusEffect(
    useCallback(() => {
      if (!me) return;
      const stops = DUELS.map(({ jeu, api }) =>
        api.suivreMesParties(me, (np: DuelPartie) =>
          setParties((all) => ({ ...all, [jeu]: [np, ...all[jeu].filter((p) => p.id !== np.id)] })),
        ),
      );
      return () => stops.forEach((stop) => stop());
    }, [me]),
  );

  const general = ranks ? classementGeneral(ranks) : [];
  const myGeneral = general.findIndex((g) => g.user_id === me);

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
    >
      <ScreenHeader
        title="Mini-jeux"
        sub="Records, défis en direct et classement général"
        right={
          me ? (
            <Pressable onPress={() => router.push('/profil')} accessibilityRole="button" accessibilityLabel="Mon profil" hitSlop={4}>
              <Pastille id={me} name={null} />
            </Pressable>
          ) : null
        }
      />

      {/* Classement général : des points de place sur chaque jeu */}
      <Card style={[styles.card, styles.general]} onPress={() => router.push('/minijeux/classement')} accessibilityLabel="Classement général">
        <View style={styles.head}>
          <Image source={LOGOS.classement} style={styles.logo} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>Classement général</Text>
            <Text style={styles.pitch}>
              {myGeneral >= 0 ? `Tu es ${myGeneral === 0 ? 'en tête' : `${myGeneral + 1}e`} avec ${general[myGeneral].points} pts` : 'Tous les jeux comptent'}
            </Text>
          </View>
          <Icon name="chevron-right" size={20} color={c.muted} />
        </View>
        {general.length > 0 && (
          <View style={styles.podium}>
            {general.slice(0, 3).map((g, i) => (
              <View key={g.user_id} style={styles.podiumItem}>
                <Text style={[styles.podiumRank, { color: MEDALS[i] }]}>{i + 1}</Text>
                <Pastille id={g.user_id} name={displayName(g.profile)} size={36} />
                <Text style={styles.podiumName} numberOfLines={1}>
                  {g.user_id === me ? 'Toi' : displayName(g.profile)}
                </Text>
                <Text style={styles.podiumPts}>{g.points} pts</Text>
              </View>
            ))}
          </View>
        )}
      </Card>

      {/* Jeux à deux : Elo */}
      {DUELS.map((d) => {
        const todo = aFaire(parties[d.jeu], me).length;
        const myElo = ranks?.elo[d.jeu].find((e) => e.user_id === me)?.elo;
        const open = () => router.push(d.route);
        return (
          <Card key={d.jeu} style={styles.card} onPress={open} accessibilityLabel={d.nom}>
            <View style={styles.head}>
              <Image source={LOGOS[d.jeu]} style={styles.logo} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.name}>{d.nom}</Text>
                  {todo > 0 && <Badge label={String(todo)} color={c.coral} textColor="#fff" />}
                </View>
                <Text style={styles.pitch}>{d.pitch}</Text>
              </View>
            </View>
            <View style={styles.foot}>
              <Text style={styles.mine}>{myElo ? `Ton Elo : ${myElo}` : `Elo de départ : ${ELO_DEPART}`}</Text>
              <Button label={todo > 0 ? 'À toi' : 'Jouer'} icon="users" onPress={open} height={44} style={styles.play} />
            </View>
          </Card>
        );
      })}

      {JEUX.map((j) => {
        const lignes = ranks?.scores[j.id] ?? [];
        const mine = lignes.find((l) => l.user_id === me);
        const play = () => router.push({ pathname: '/minijeux/[jeu]', params: { jeu: j.id } });
        return (
          <Card key={j.id} style={styles.card}>
            <Pressable onPress={play} accessibilityRole="button" accessibilityLabel={`Jouer à ${j.nom}`} style={styles.head}>
              <Image source={LOGOS[j.id]} style={styles.logo} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{j.nom}</Text>
                <Text style={styles.pitch}>{j.pitch}</Text>
              </View>
            </Pressable>

            {ranks && (
              <View style={styles.ranks}>
                <Classement lignes={lignes} me={me} max={3} value={(l) => formatScore(j, l.best)} />
              </View>
            )}

            <View style={styles.foot}>
              <Text style={styles.mine}>{mine ? `Ton record : ${formatScore(j, mine.best)}` : 'Pas encore joué'}</Text>
              <Button label="Jouer" icon="play" onPress={play} height={44} style={styles.play} />
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  card: { marginHorizontal: theme.gutter, marginTop: 16, padding: 16 },
  general: { borderWidth: 1, borderColor: 'rgba(255,217,61,0.35)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logo: { width: 64, height: 64 },
  name: { color: c.text, fontFamily: f.serif, fontSize: 22, lineHeight: 28 },
  pitch: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 19 },
  podium: { flexDirection: 'row', gap: 8, marginTop: 14 },
  podiumItem: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRadius: 16, backgroundColor: c.raised },
  podiumRank: { fontFamily: f.serifBlack, fontSize: 18 },
  podiumName: { color: c.text, fontFamily: f.bodyBold, fontSize: 14, maxWidth: '90%' },
  podiumPts: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  ranks: { marginTop: 12, marginHorizontal: -6 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  mine: { flex: 1, color: c.text, fontFamily: f.bodyMedium, fontSize: 14 },
  play: { paddingHorizontal: 22 },
});
