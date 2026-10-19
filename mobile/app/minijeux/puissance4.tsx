import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SearchField } from '@/components/jeux/JeuCards';
import { Classement } from '@/components/minijeux/Classement';
import { Button, Card, Icon, Pastille, ScreenHeader, SectionTitle, Sheet } from '@/components/ui/kit';
import { defaites, displayName, type EloLigne, fetchClassements, invalidateClassements, LOGOS, plural } from '@/lib/minijeux';
import { ELO_DEPART, fetchMesParties, opponentOf, type Partie, repondre, defier, seat, suivreMesParties } from '@/lib/puissance4';
import { plain, sb, sessionUser, type ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { usePullRefresh, useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

// Les membres changent rarement : une seule lecture par lancement de l'appli
let membres: Promise<ProfileMini[]> | null = null;
function fetchMembres() {
  membres ??= Promise.resolve(sb.from('profiles').select('id,prenom,nom,pseudo').order('prenom')).then(
    ({ data, error }) => {
      if (error) {
        membres = null;
        throw error;
      }
      return (data ?? []) as ProfileMini[];
    },
  );
  return membres;
}

/** Accueil de Puissance 4 : invitations, parties en cours, défier quelqu'un, classement Elo. */
export default function Puissance4Lobby() {
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [parties, setParties] = useState<Partie[] | null>(null);
  const [elo, setElo] = useState<EloLigne[]>([]);
  const [members, setMembers] = useState<ProfileMini[]>([]);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const user = await sessionUser();
    if (!user) return;
    setMe(user.id);
    try {
      const [ps, cl, all] = await Promise.all([fetchMesParties(user.id), fetchClassements(), fetchMembres()]);
      setParties(ps);
      setElo(cl.p4);
      setMembers(all);
    } catch {
      setParties((cur) => cur ?? []);
    }
  }, []);

  useRefreshOnFocus(load, 0);
  const { refreshing, onRefresh } = usePullRefresh(
    useCallback(async () => {
      invalidateClassements();
      await load();
    }, [load]),
  );

  // Une invitation ou un coup reçu met la liste à jour sans tout recharger ;
  // seule une partie terminée relit l'Elo
  useFocusEffect(
    useCallback(() => {
      if (!me) return;
      return suivreMesParties(me, (np) => {
        setParties((ps) => [np, ...(ps ?? []).filter((p) => p.id !== np.id)]);
        if (np.statut === 'finie' || np.statut === 'abandon') {
          invalidateClassements();
          fetchClassements().then((cl) => setElo(cl.p4), () => {});
        }
      });
    }, [me]),
  );

  async function act(key: string, title: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      Alert.alert(title, (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const challenge = (p: ProfileMini) =>
    act(p.id, 'Défi impossible', async () => {
      const id = await defier(p.id);
      setPicking(false);
      router.push({ pathname: '/minijeux/partie/[id]', params: { id } });
    });

  const answer = (p: Partie, ok: boolean) =>
    act(p.id, 'Oups', async () => {
      await repondre(p.id, ok);
      if (ok) router.push({ pathname: '/minijeux/partie/[id]', params: { id: p.id } });
      else setParties((ps) => (ps ?? []).filter((x) => x.id !== p.id));
    });

  const mine = elo.find((e) => e.user_id === me);
  const eloOf = Object.fromEntries(elo.map((e) => [e.user_id, e.elo]));
  const profiles = Object.fromEntries(members.map((m) => [m.id, m]));
  const recues = (parties ?? []).filter((p) => p.statut === 'invitation' && p.joueur2 === me);
  const envoyees = (parties ?? []).filter((p) => p.statut === 'invitation' && p.joueur1 === me);
  const enCours = (parties ?? []).filter((p) => p.statut === 'en_cours');
  const finies = (parties ?? []).filter((p) => p.statut === 'finie' || p.statut === 'abandon').slice(0, 8);
  const q = plain(query.trim());
  const filtered = members.filter((m) => m.id !== me && plain(`${m.prenom ?? ''} ${m.nom ?? ''} ${m.pseudo ?? ''}`).includes(q));

  const open = (p: Partie) => router.push({ pathname: '/minijeux/partie/[id]', params: { id: p.id } });

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
      >
        <ScreenHeader
          back
          title="Puissance 4"
          sub="À deux, en direct, classé à l’Elo"
          right={<Image source={LOGOS.puissance4} style={{ width: 64, height: 64 }} />}
        />

        <Card style={styles.me}>
          <View style={{ flex: 1 }}>
            <Text style={styles.meLabel}>Ton Elo</Text>
            <Text style={styles.meElo}>{mine?.elo ?? ELO_DEPART}</Text>
            <Text style={styles.small}>
              {mine
                ? [plural(mine.victoires, 'victoire'), plural(mine.nuls, 'nul'), plural(defaites(mine), 'défaite')].join(' · ')
                : `Tout le monde démarre à ${ELO_DEPART}`}
            </Text>
          </View>
          <Button label="Défier" icon="zap" onPress={() => setPicking(true)} height={48} />
        </Card>

        {parties === null ? (
          <ActivityIndicator color={c.teal} style={{ marginTop: 24 }} />
        ) : (
          <View style={styles.body}>
            {recues.length > 0 && (
              <>
                <SectionTitle count={recues.length} style={styles.heading}>
                  Défis reçus
                </SectionTitle>
                {recues.map((p) => (
                  <Card key={p.id} style={styles.row}>
                    <Pastille id={p.joueur1} name={displayName(profiles[p.joueur1])} size={40} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {displayName(profiles[p.joueur1])}
                      </Text>
                      <Text style={styles.small}>te défie · Elo {eloOf[p.joueur1] ?? ELO_DEPART}</Text>
                    </View>
                    {busy === p.id ? (
                      <ActivityIndicator color={c.teal} />
                    ) : (
                      <View style={styles.actions}>
                        <Button label="Non" variant="raised" onPress={() => answer(p, false)} height={40} />
                        <Button label="Jouer" variant="yes" onPress={() => answer(p, true)} height={40} />
                      </View>
                    )}
                  </Card>
                ))}
              </>
            )}

            {enCours.length > 0 && (
              <>
                <SectionTitle count={enCours.length} style={styles.heading}>
                  Parties en cours
                </SectionTitle>
                {enCours.map((p) => {
                  const myTurn = p.tour === seat(p, me);
                  const opp = opponentOf(p, me);
                  return (
                    <Card key={p.id} style={styles.row} onPress={() => open(p)}>
                      <Pastille id={opp} name={displayName(profiles[opp])} size={40} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          contre {displayName(profiles[opp])}
                        </Text>
                        <Text style={[styles.small, myTurn && { color: c.teal, fontFamily: f.bodyBold }]}>
                          {myTurn ? 'À toi de jouer' : 'À son tour'} · {p.coups} coup{p.coups > 1 ? 's' : ''}
                        </Text>
                      </View>
                      <Icon name="chevron-right" size={20} color={c.muted} />
                    </Card>
                  );
                })}
              </>
            )}

            {envoyees.length > 0 && (
              <>
                <SectionTitle count={envoyees.length} style={styles.heading}>
                  En attente de réponse
                </SectionTitle>
                {envoyees.map((p) => (
                  <Card key={p.id} style={styles.row} onPress={() => open(p)}>
                    <Pastille id={p.joueur2} name={displayName(profiles[p.joueur2])} size={40} />
                    <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
                      {displayName(profiles[p.joueur2])}
                    </Text>
                    <Text style={styles.small}>invité</Text>
                  </Card>
                ))}
              </>
            )}

            {!recues.length && !enCours.length && !envoyees.length && (
              <Card style={styles.empty}>
                <Icon name="grid" size={28} color={c.yellow} />
                <Text style={styles.emptyText}>Aucune partie en cours. Défie quelqu’un : il reçoit une notification.</Text>
              </Card>
            )}

            <SectionTitle style={styles.heading}>Classement Elo</SectionTitle>
            <Classement
              lignes={elo}
              me={me}
              value={(e) => String(e.elo)}
              sub={(e) => `${e.victoires} V · ${e.nuls} N · ${defaites(e)} D`}
              empty="Le classement apparaît après la première partie terminée."
            />

            {finies.length > 0 && (
              <>
                <SectionTitle style={styles.heading}>Dernières parties</SectionTitle>
                {finies.map((p) => {
                  const opp = opponentOf(p, me);
                  const won = p.gagnant === seat(p, me);
                  const draw = p.gagnant === 0;
                  return (
                    <Pressable key={p.id} onPress={() => open(p)} style={({ pressed }) => [styles.finRow, pressed && { opacity: 0.7 }]}>
                      <View style={[styles.result, { backgroundColor: draw ? c.rail : won ? c.teal : c.coral }]}>
                        <Text style={[styles.resultText, { color: draw ? c.text : won ? c.tealInk : '#fff' }]}>
                          {draw ? 'N' : won ? 'V' : 'D'}
                        </Text>
                      </View>
                      <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
                        contre {displayName(profiles[opp])}
                        {p.statut === 'abandon' ? ' (abandon)' : ''}
                      </Text>
                      {p.elo_delta !== null && !draw && (
                        <Text style={[styles.small, { color: won ? c.teal : c.coralSoft }]}>
                          {won ? '+' : '−'}
                          {Math.abs(p.elo_delta)}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </>
            )}
          </View>
        )}
      </ScrollView>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Défier quelqu’un" sub="Il reçoit une notification et la partie démarre quand il accepte.">
        <SearchField value={query} onChangeText={setQuery} placeholder="Chercher un membre" />
        {filtered.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => challenge(m)}
            disabled={!!busy}
            style={({ pressed }) => [styles.member, pressed && { backgroundColor: c.raised }]}
            accessibilityRole="button"
            accessibilityLabel={`Défier ${displayName(m)}`}
          >
            <Pastille id={m.id} name={displayName(m)} size={40} />
            <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
              {`${m.prenom ?? ''} ${m.nom ?? ''}`.trim() || m.pseudo}
            </Text>
            {busy === m.id ? <ActivityIndicator color={c.teal} /> : <Text style={styles.small}>{eloOf[m.id] ?? ELO_DEPART}</Text>}
          </Pressable>
        ))}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  body: { paddingHorizontal: theme.gutter },
  me: { marginHorizontal: theme.gutter, marginTop: 18, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  meLabel: { color: c.muted, fontFamily: f.bodyBold, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' },
  meElo: { color: c.text, fontFamily: f.serifBlack, fontSize: 40, lineHeight: 46 },
  heading: { marginTop: 28, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8 },
  rowTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 15 },
  small: { color: c.muted, fontFamily: f.body, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 6 },
  empty: { marginTop: 20, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  emptyText: { flex: 1, color: c.text, fontFamily: f.body, fontSize: 15, lineHeight: 21 },
  finRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 10, borderRadius: 14 },
  result: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  resultText: { fontFamily: f.bodyBold, fontSize: 13 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 8, borderRadius: 14 },
});
