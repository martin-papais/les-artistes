import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SearchField } from '@/components/jeux/JeuCards';
import { Classement } from '@/components/minijeux/Classement';
import { ONLINE, OnlineDot } from '@/components/minijeux/Duel';
import { Button, Card, Icon, Pastille, ScreenHeader, SectionTitle, Sheet } from '@/components/ui/kit';
import * as Haptics from 'expo-haptics';

import {
  chrono,
  DEFI_MS,
  type DuelApi,
  type DuelJeu,
  type DuelPartie,
  ELO_DEPART,
  isOver,
  monDelta,
  opponentOf,
  PENDULE,
  seat,
} from '@/lib/duel';
import { usePageCache } from '@/lib/cache';
import { defaites, displayName, type EloLigne, fetchClassements, invalidateClassements, LOGOS, plural } from '@/lib/minijeux';
import { useEnLigne, vuIlYa } from '@/lib/presence';
import { plain, sb, sessionUser, type ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { usePullRefresh, useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

type Membre = ProfileMini & { vu_le: string | null };

// Relu à chaque visite : « vu il y a » doit rester juste
async function fetchMembres() {
  const { data, error } = await sb.from('profiles').select('id,prenom,nom,pseudo,vu_le').order('prenom');
  if (error) throw error;
  return (data ?? []) as Membre[];
}

type Props<P extends DuelPartie> = {
  jeu: DuelJeu;
  titre: string;
  sub: string;
  api: DuelApi<P>;
  /** Écran d'une partie */
  route: '/minijeux/partie/[id]' | '/minijeux/echiquier/[id]';
  /** Précision ajoutée à une ligne de « Dernières parties » (« mat », « abandon »…) */
  finLabel?: (p: P) => string;
};

/** Accueil d'un jeu à deux : invitations, parties en cours, défier quelqu'un, classement Elo. */
export function DuelLobby<P extends DuelPartie>({ jeu, titre, sub, api, route, finLabel }: Props<P>) {
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [parties, setParties] = useState<P[] | null>(null);
  const [elo, setElo] = useState<EloLigne[]>([]);
  const [members, setMembers] = useState<Membre[]>([]);
  const enLigne = useEnLigne();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const montrer = useCallback((d: { me: string; parties: P[]; elo: EloLigne[]; members: Membre[] }) => {
    setMe(d.me);
    setParties(d.parties);
    setElo(d.elo);
    setMembers(d.members);
  }, []);
  const { garder } = usePageCache(`duel-${jeu}`, montrer);

  const load = useCallback(async () => {
    const user = await sessionUser();
    if (!user) return;
    setMe(user.id);
    try {
      const [ps, cl, all] = await Promise.all([api.fetchMesParties(user.id), fetchClassements(), fetchMembres()]);
      garder({ me: user.id, parties: ps, elo: cl.elo[jeu], members: all });
      setFailed(false);
    } catch {
      // Hors ligne : on garde ce qui est affiché et on le dit
      setFailed(true);
    }
  }, [api, jeu, garder]);

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
      return api.suivreMesParties(
        me,
        (np) => {
          setParties((ps) => {
            const old = (ps ?? []).find((p) => p.id === np.id);
            // Mon défi vient d'être accepté : la pendule tourne, on rejoint la partie
            if (old?.statut === 'invitation' && np.statut === 'en_cours' && np.joueur1 === me) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              setTimeout(() => router.push({ pathname: route, params: { id: np.id } }), 0);
            }
            return [np, ...(ps ?? []).filter((p) => p.id !== np.id)];
          });
          if (isOver(np)) {
            invalidateClassements();
            fetchClassements().then((cl) => setElo(cl.elo[jeu]), () => {});
          }
        },
        load,
      );
    }, [api, jeu, load, me, route, router]),
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
      const id = await api.defier(p.id);
      setPicking(false);
      router.push({ pathname: route, params: { id } });
    });

  const answer = (p: P, ok: boolean) =>
    act(p.id, 'Oups', async () => {
      await api.repondre(p.id, ok);
      if (ok) router.push({ pathname: route, params: { id: p.id } });
      else setParties((ps) => (ps ?? []).filter((x) => x.id !== p.id));
    });

  const mine = elo.find((e) => e.user_id === me);
  const eloOf = Object.fromEntries(elo.map((e) => [e.user_id, e.elo]));
  const profiles = Object.fromEntries(members.map((m) => [m.id, m]));
  // Un défi expire au bout de 10 minutes (le serveur le ferme aussi)
  const now = Date.now();
  const restant = (p: P) => new Date(p.created_at).getTime() + DEFI_MS - now;
  const recues = (parties ?? []).filter((p) => p.statut === 'invitation' && p.joueur2 === me && restant(p) > 0);
  const envoyees = (parties ?? []).filter((p) => p.statut === 'invitation' && p.joueur1 === me && restant(p) > 0);
  const enCours = (parties ?? []).filter((p) => p.statut === 'en_cours');
  const finies = (parties ?? []).filter(isOver).slice(0, 8);
  const q = plain(query.trim());
  // Ceux qui ont l'appli ouverte d'abord (libres avant ceux déjà en partie), puis les plus récemment vus
  const rang = (m: Membre) => (enLigne[m.id] === 'appli' ? 0 : enLigne[m.id] === 'partie' ? 1 : 2);
  const vu = (m: Membre) => (m.vu_le ? new Date(m.vu_le).getTime() : 0);
  const filtered = members
    .filter((m) => m.id !== me && plain(`${m.prenom ?? ''} ${m.nom ?? ''} ${m.pseudo ?? ''}`).includes(q))
    .sort((a, b) => rang(a) - rang(b) || vu(b) - vu(a));
  const online = members.filter((m) => m.id !== me && enLigne[m.id]).sort((a, b) => rang(a) - rang(b));
  const presence = (m: Membre) => (enLigne[m.id] === 'partie' ? 'en partie' : enLigne[m.id] ? 'en ligne' : vuIlYa(m.vu_le));

  const askChallenge = (m: Membre) =>
    Alert.alert(`Défier ${displayName(m)} ?`, enLigne[m.id] === 'partie' ? `${displayName(m)} joue déjà une partie : le défi l’attendra à la sortie.` : undefined, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Défier', onPress: () => challenge(m) },
    ]);

  const open = (p: P) => router.push({ pathname: route, params: { id: p.id } });

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
      >
        <ScreenHeader
          back
          title={titre}
          sub={sub}
          right={<Image source={LOGOS[jeu]} style={{ width: 64, height: 64 }} />}
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

        {online.length > 0 && (
          <View>
            <SectionTitle count={online.length} style={[styles.heading, { marginHorizontal: theme.gutter, marginTop: 22 }]}>
              En ligne maintenant
            </SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.onlineRow}>
              {online.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => askChallenge(m)}
                  disabled={!!busy}
                  style={({ pressed }) => [styles.onlineItem, pressed && { opacity: 0.7 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Défier ${displayName(m)}, ${presence(m)}`}
                >
                  <View>
                    <Pastille id={m.id} name={displayName(m)} size={52} />
                    <OnlineDot ring={c.deep} size={16} />
                  </View>
                  <Text style={styles.onlineName} numberOfLines={1}>
                    {displayName(m)}
                  </Text>
                  <Text style={[styles.onlineSub, enLigne[m.id] === 'partie' && { color: c.yellow }]} numberOfLines={1}>
                    {enLigne[m.id] === 'partie' ? 'en partie' : `Elo ${eloOf[m.id] ?? ELO_DEPART}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {failed && (
          <Card style={styles.offline}>
            <Icon name="wifi-off" size={18} color={c.muted} />
            <Text style={[styles.small, { flex: 1 }]}>{parties ? 'Hors connexion : liste peut-être pas à jour.' : 'Pas de connexion.'}</Text>
            <Button label="Réessayer" variant="raised" height={40} onPress={load} />
          </Card>
        )}
        {parties === null ? (
          !failed && <ActivityIndicator color={c.teal} style={{ marginTop: 24 }} />
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
                      <Text style={styles.small}>
                        Elo {eloOf[p.joueur1] ?? ELO_DEPART} · expire dans {Math.ceil(restant(p) / 60_000)} min
                      </Text>
                    </View>
                    {busy === p.id ? (
                      <ActivityIndicator color={c.teal} />
                    ) : (
                      <View style={styles.actions}>
                        <Button label="Non" variant="raised" onPress={() => answer(p, false)} height={44} />
                        <Button label="Jouer" variant="yes" onPress={() => answer(p, true)} height={44} />
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
                    <Text style={styles.small}>{chrono(restant(p))}</Text>
                  </Card>
                ))}
              </>
            )}

            {!recues.length && !enCours.length && !envoyees.length && (
              <Card style={styles.empty}>
                <Icon name={jeu === 'echecs' ? 'award' : 'grid'} size={28} color={c.yellow} />
                <Text style={styles.emptyText}>Aucune partie en cours. Défie quelqu’un d’en ligne : la partie se joue en direct, à la pendule.</Text>
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
                  const delta = monDelta(p, me);
                  return (
                    <Pressable key={p.id} onPress={() => open(p)} style={({ pressed }) => [styles.finRow, pressed && { opacity: 0.7 }]}>
                      <View style={[styles.result, { backgroundColor: draw ? c.rail : won ? c.teal : c.coral }]}>
                        <Text style={[styles.resultText, { color: draw ? c.text : won ? c.tealInk : '#fff' }]}>
                          {draw ? 'N' : won ? 'V' : 'D'}
                        </Text>
                      </View>
                      <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
                        contre {displayName(profiles[opp])}
                        {p.fin === 'temps' ? ' (au temps)' : p.fin === 'absence' ? ' (partie quittée)' : finLabel ? finLabel(p) : p.statut === 'abandon' ? ' (abandon)' : ''}
                      </Text>
                      {delta !== null && (
                        <Text style={[styles.small, { color: delta > 0 ? c.teal : delta < 0 ? c.coralSoft : c.muted }]}>
                          {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
                          {Math.abs(delta)}
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

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Défier quelqu’un"
        sub={`Partie en direct, ${chrono(PENDULE[jeu])} chacun à la pendule. Ton adversaire a 10 minutes pour accepter ; ensuite, quitter la partie plus d’une minute fait perdre.`}
      >
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
            <View>
              <Pastille id={m.id} name={displayName(m)} size={40} />
              {!!enLigne[m.id] && <OnlineDot ring={c.card} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {`${m.prenom ?? ''} ${m.nom ?? ''}`.trim() || m.pseudo}
              </Text>
              {!!presence(m) && (
                <Text style={[styles.small, { fontSize: 13 }, !!enLigne[m.id] && { color: enLigne[m.id] === 'partie' ? c.yellow : ONLINE }]}>
                  {presence(m)}
                </Text>
              )}
            </View>
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
  onlineRow: { paddingHorizontal: theme.gutter, gap: 14 },
  onlineItem: { width: 64, alignItems: 'center' },
  onlineName: { color: c.text, fontFamily: f.bodyBold, fontSize: 13, marginTop: 6 },
  onlineSub: { color: c.muted, fontFamily: f.body, fontSize: 11 },
  offline: { marginHorizontal: theme.gutter, marginTop: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 8, borderRadius: 14 },
});
