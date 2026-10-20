import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, IconButton, Pastille } from '@/components/ui/kit';
import { type DuelApi, type DuelJeu, type DuelPartie, ELO_DEPART, isOver, opponentOf, seat } from '@/lib/duel';
import { displayName, fetchElo, fetchProfiles } from '@/lib/minijeux';
import { sessionUser, type ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

// Écran d'une partie à deux (Puissance 4, échecs) : chargement, suivi en direct, fin de partie,
// joueurs, état, boutons (répondre, abandonner, revanche). Chaque jeu ne dessine que son plateau.

export function useDuel<P extends DuelPartie>(id: string | undefined, api: DuelApi<P>, jeu: DuelJeu) {
  const [me, setMe] = useState<string | null>(null);
  const [p, setP] = useState<P | null | undefined>(undefined);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [elo, setElo] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const lastStatus = useRef<string | null>(null);

  /** Une partie relue ne remplace pas une version plus avancée déjà reçue en direct */
  const accept = useCallback((np: P) => setP((cur) => (cur && np.coups < cur.coups ? cur : np)), []);

  const load = useCallback(async () => {
    if (!id) return;
    const [user, res] = await Promise.all([sessionUser(), api.fetchPartie(id).then((partie) => ({ partie }), () => null)]);
    setMe(user?.id ?? null);
    // Réseau coupé : on garde ce qui est affiché plutôt que « Partie introuvable »
    if (!res) return setP((cur) => cur ?? null);
    const { partie } = res;
    if (partie) accept(partie);
    else setP(null);
    if (partie) {
      const ids = [partie.joueur1, partie.joueur2];
      const [profs, elos] = await Promise.all([fetchProfiles(ids), fetchElo(jeu, ids)]);
      setProfiles(profs);
      setElo(elos);
    }
  }, [accept, api, id, jeu]);

  useRefreshOnFocus(load, 0);


  // Les coups de l'adversaire arrivent en direct
  useEffect(() => {
    if (!id) return;
    return api.suivre(id, accept);
  }, [accept, api, id]);

  // Fin de partie : vibration et Elo à jour (les profils, eux, ne changent pas)
  useEffect(() => {
    if (!p || !me) return;
    if (lastStatus.current === 'en_cours' && isOver(p)) {
      const won = p.gagnant === seat(p, me);
      Haptics.notificationAsync(won ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {});
      fetchElo(jeu, [p.joueur1, p.joueur2]).then(setElo, () => {});
    }
    lastStatus.current = p.statut;
  }, [jeu, me, p]);

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

  // Après une réponse, un abandon ou un coup, la partie relue suffit
  const refresh = async () => {
    if (!p) return;
    const fresh = await api.fetchPartie(p.id);
    if (fresh) accept(fresh);
  };

  /** Coup refusé : l'état du serveur fait foi (l'adversaire a pu abandonner entre-temps) */
  const rollback = async (before: P) => setP((await api.fetchPartie(before.id).catch(() => null)) ?? before);

  const name = (uid: string) => (uid === me ? 'Toi' : displayName(profiles[uid]));

  return { api, me, p, setP, accept, rollback, elo, busy, setBusy, act, refresh, name };
}

export type Duel<P extends DuelPartie> = ReturnType<typeof useDuel<P>>;

/** État de la partie en une ligne ; `fini` donne le texte d'une fin propre au jeu (nulle, mat…) */
export function statusText<P extends DuelPartie>(d: Duel<P>, p: P, enCours?: string, fini?: string) {
  const mySeat = seat(p, d.me);
  const opp = opponentOf(p, d.me);
  const won = isOver(p) && p.gagnant === mySeat;
  if (p.statut === 'invitation') return mySeat === 2 ? `${d.name(p.joueur1)} te défie` : `En attente de ${d.name(p.joueur2)}`;
  if (p.statut === 'refusee') return 'Défi refusé';
  if (p.statut === 'en_cours') return enCours ?? (p.tour === mySeat ? 'À toi de jouer' : `Au tour de ${d.name(opp)}`);
  if (fini) return fini;
  if (p.statut === 'abandon') return won ? `${d.name(opp)} abandonne : gagné !` : 'Tu as abandonné';
  if (p.gagnant === 0) return 'Match nul';
  return won ? 'Tu as gagné !' : `${d.name(opp)} gagne`;
}

type ScreenProps<P extends DuelPartie> = {
  duel: Duel<P>;
  titre: string;
  lobby: '/minijeux/puissance4' | '/minijeux/echecs';
  route: '/minijeux/partie/[id]' | '/minijeux/echiquier/[id]';
  /** Couleur de chaque joueur (jeton, camp) */
  colors: [string, string];
  /** Bordure du joueur dont c'est le tour, sinon sa couleur */
  activeColor?: string;
  /** Ce qui s'affiche sous le nom de chaque joueur, après son Elo */
  chipExtra?: (n: 1 | 2) => string | null;
  status: string;
  statusColor?: string;
  /** Plateau, puis éventuels boutons propres au jeu au-dessus des boutons communs */
  children: ReactNode;
  actions?: ReactNode;
};

/** Cadre commun : barre, joueurs, état, gain d'Elo, plateau, boutons */
export function DuelScreen<P extends DuelPartie>({
  duel,
  titre,
  lobby,
  route,
  colors,
  activeColor,
  chipExtra,
  status,
  statusColor,
  children,
  actions,
}: ScreenProps<P>) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { p, me, busy, act, refresh, api } = duel;

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
  const finished = isOver(partie);
  const won = finished && partie.gagnant === mySeat;
  const draw = finished && partie.gagnant === 0;

  function giveUp() {
    Alert.alert('Abandonner ?', 'La partie compte comme perdue, Elo compris.', [
      { text: 'Continuer', style: 'cancel' },
      {
        text: 'Abandonner',
        style: 'destructive',
        onPress: () =>
          act(async () => {
            await api.abandonner(partie.id);
            await refresh();
          }),
      },
    ]);
  }

  const answer = (ok: boolean) =>
    act(async () => {
      await api.repondre(partie.id, ok);
      await refresh();
    });

  const cancel = () =>
    act(async () => {
      await api.abandonner(partie.id);
      await refresh();
    });

  const rematch = () =>
    act(async () => {
      const nid = await api.defier(opponentOf(partie, me));
      router.replace({ pathname: route, params: { id: nid } });
    }, 'Revanche impossible');

  const chip = (n: 1 | 2) => {
    const uid = n === 1 ? partie.joueur1 : partie.joueur2;
    return (
      <PlayerChip
        uid={uid}
        label={duel.name(uid)}
        sub={[String(duel.elo[uid] ?? ELO_DEPART), chipExtra?.(n)].filter(Boolean).join(' · ')}
        color={colors[n - 1]}
        activeColor={activeColor ?? colors[n - 1]}
        active={partie.statut === 'en_cours' && partie.tour === n}
      />
    );
  };

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <IconButton name="chevron-left" label="Retour" onPress={() => (router.canGoBack() ? router.back() : router.replace(lobby))} />
        <Text style={styles.title}>{titre}</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, alignItems: 'center' }}>
        <View style={styles.players}>
          {chip(1)}
          <Text style={styles.vs}>contre</Text>
          {chip(2)}
        </View>

        <Text style={[styles.status, statusColor ? { color: statusColor } : null, won && { color: c.teal }]}>{status}</Text>
        {finished && partie.elo_delta !== null && !draw && (
          <Text style={[styles.delta, { color: won ? c.teal : c.coralSoft }]}>
            {won ? '+' : '−'}
            {Math.abs(partie.elo_delta)} Elo
          </Text>
        )}

        {children}

        {actions}
        <View style={styles.footer}>
          {partie.statut === 'invitation' && mySeat === 2 && (
            <>
              <Button label="Refuser" variant="raised" onPress={() => answer(false)} disabled={busy} style={{ flex: 1 }} />
              <Button label="Jouer" variant="yes" onPress={() => answer(true)} disabled={busy} style={{ flex: 1 }} />
            </>
          )}
          {partie.statut === 'invitation' && mySeat === 1 && (
            <Button label="Annuler le défi" variant="raised" onPress={cancel} disabled={busy} style={{ flex: 1 }} />
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

function PlayerChip({
  uid,
  label,
  sub,
  color,
  activeColor,
  active,
}: {
  uid: string;
  label: string;
  sub: string;
  color: string;
  activeColor: string;
  active: boolean;
}) {
  return (
    <View style={[styles.chip, active && { borderColor: activeColor }]}>
      <View style={[styles.token, { backgroundColor: color }]} />
      <Pastille id={uid} name={label} size={30} />
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <Text style={styles.chipName} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.chipSub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
    </View>
  );
}

export const duelStyles = StyleSheet.create({
  tip: { color: c.muted, fontFamily: f.body, fontSize: 14, marginTop: 6, textAlign: 'center', paddingHorizontal: 16 },
});

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
  token: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  chipName: { color: c.text, fontFamily: f.bodyBold, fontSize: 14 },
  chipSub: { color: c.muted, fontFamily: f.body, fontSize: 12 },
  status: {
    alignSelf: 'stretch',
    color: c.text,
    fontFamily: f.serif,
    fontSize: 24,
    lineHeight: 30,
    marginTop: 20,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  delta: { fontFamily: f.bodyBold, fontSize: 16, marginTop: 4 },
  footer: { flexDirection: 'row', gap: 10, width: '100%', paddingHorizontal: 20, marginTop: 24 },
});
