import * as Haptics from 'expo-haptics';
import { useIsFocused } from '@react-navigation/native';
import { useFocusEffect, useRouter } from 'expo-router';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatBubble, ChatButton, ChatPanel, useChat } from '@/components/minijeux/Chat';
import { Button, EmptyState, IconButton, Pastille } from '@/components/ui/kit';
import {
  ABSENCE_ALERTE_MS,
  ABSENCE_MS,
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
  pendules,
  present,
  seat,
} from '@/lib/duel';
import { KeyboardAware } from '@/lib/keyboard';
import { displayName, fetchElo, fetchProfiles } from '@/lib/minijeux';
import { setVisibleRoute } from '@/lib/notifications';
import { setEtat, useEnLigne } from '@/lib/presence';
import { sessionUser, type ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

// Écran d'une partie à deux (Puissance 4, échecs) : chargement, suivi en direct, pendules,
// signes de vie, fin de partie, joueurs, état, boutons (répondre, abandonner, revanche).
// Chaque jeu ne dessine que son plateau.

// Signe de vie envoyé au serveur tant que l'écran de la partie est ouvert (éliminé après 60 s sans)
const PING_MS = 15_000;

export function useDuel<P extends DuelPartie>(id: string | undefined, api: DuelApi<P>, jeu: DuelJeu) {
  const [me, setMe] = useState<string | null>(null);
  const [p, setP] = useState<P | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [elo, setElo] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  // Écart entre l'heure du serveur et celle du téléphone : les pendules suivent le serveur
  const [offset, setOffset] = useState(0);
  const lastStatus = useRef<string | null>(null);

  /**
   * Une lecture plus ancienne que ce qui est affiché est écartée (rev du serveur), et un état
   * reçu ne défait pas un coup joué à l'instant (coups) ; une fin de partie passe toujours.
   */
  const accept = useCallback(
    (np: P) => setP((cur) => (!cur || isOver(np) || (np.rev >= cur.rev && np.coups >= cur.coups) ? np : cur)),
    [],
  );

  const load = useCallback(async () => {
    if (!id) return;
    const [user, res] = await Promise.all([sessionUser(), api.fetchPartie(id).then((partie) => ({ partie }), () => null)]);
    setMe(user?.id ?? null);
    // Réseau coupé : on garde ce qui est affiché, sinon on le dit (et pas « Partie introuvable »)
    if (!res) return setFailed(true);
    setFailed(false);
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

  // Les coups de l'adversaire arrivent en direct ; après une coupure, on relit la partie
  useEffect(() => {
    if (!id) return;
    return api.suivre(id, accept, load);
  }, [accept, api, id, load]);

  // Signe de vie : tant que l'écran est ouvert, l'appli au premier plan et la partie en cours
  const enCours = p?.statut === 'en_cours' && p.tour_depuis !== null && seat(p, me) > 0;
  const lastPing = useRef(0);
  const ping = useCallback(() => {
    if (!id) return;
    lastPing.current = Date.now();
    const sent = Date.now();
    present(jeu, id).then(
      (server) => setOffset(server - (sent + Date.now()) / 2),
      () => {},
    );
  }, [id, jeu]);
  useFocusEffect(
    useCallback(() => {
      if (!enCours) return;
      ping();
      const t = setInterval(() => AppState.currentState === 'active' && ping(), PING_MS);
      const sub = AppState.addEventListener('change', (st) => {
        if (st !== 'active') return;
        ping();
        load();
      });
      return () => {
        clearInterval(t);
        sub.remove();
      };
    }, [enCours, load, ping]),
  );

  /** Pendule à zéro ou adversaire parti depuis une minute : le serveur tranche tout de suite */
  const verifier = useCallback(() => {
    if (Date.now() - lastPing.current > 3000) ping();
  }, [ping]);

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
  /** Heure du serveur ; `tick` (useTick) force le calcul à chaque battement : sans lui, le React Compiler garde la première valeur */
  const now = (tick: number) => Date.now() + offset + tick * 0;

  return { api, jeu, me, p, setP, accept, rollback, elo, busy, setBusy, act, refresh, load, failed, name, now, verifier };
}

export type Duel<P extends DuelPartie> = ReturnType<typeof useDuel<P>>;

/** Hauteur disponible pour le plateau quand le chat est ouvert (null sinon) */
const BoardSpace = createContext<number | null>(null);
export const useBoardMax = () => useContext(BoardSpace);

/** « de Lucas », « d’Apple » */
const de = (nom: string) => (/^[aeiouyhàâéèêîïôûAEIOUYHÀÂÉÈÊÎÏÔÛ]/.test(nom) ? `d’${nom}` : `de ${nom}`);

/** État de la partie en une ligne ; `fini` donne le texte d'une fin propre au jeu (nulle, mat…) */
export function statusText<P extends DuelPartie>(d: Duel<P>, p: P, enCours?: string, fini?: string) {
  const mySeat = seat(p, d.me);
  const opp = d.name(opponentOf(p, d.me));
  const won = isOver(p) && p.gagnant === mySeat;
  if (p.statut === 'invitation') return mySeat === 2 ? `${d.name(p.joueur1)} te défie` : `En attente ${de(d.name(p.joueur2))}`;
  if (p.statut === 'refusee') return p.fin === 'expire' ? 'Défi expiré' : 'Défi refusé';
  if (p.statut === 'en_cours') return enCours ?? (p.tour === mySeat ? 'À toi de jouer' : `Au tour ${de(opp)}`);
  if (p.fin === 'temps') {
    if (p.gagnant === 0) return 'Temps écoulé : partie nulle';
    return won ? `Plus de temps pour ${opp} : gagné !` : `Plus de temps : ${opp} gagne`;
  }
  if (p.fin === 'absence') return won ? `${opp} a quitté la partie : gagné !` : 'Tu as quitté la partie : perdu';
  if (fini) return fini;
  if (p.statut === 'abandon') return won ? `${opp} abandonne : gagné !` : 'Tu as abandonné';
  if (p.gagnant === 0) return 'Match nul';
  return won ? 'Tu as gagné !' : `${opp} gagne`;
}

/** Un battement toutes les `ms` tant que `on` (pendules, comptes à rebours) ; renvoie son numéro */
function useTick(on: boolean, ms = 250) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setT((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms, on]);
  return t;
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

/** Cadre commun : barre, joueurs et pendules, état, gain d'Elo, plateau, boutons, chat */
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
  const chat = useChat(duel.jeu, p?.id, me);
  const enLigne = useEnLigne();
  const [viewH, setViewH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [headH, setHeadH] = useState(0);
  const overflow = viewH > 0 && contentH > viewH + 1;

  // Tant que la partie est à l'écran : « en partie » pour les autres, et pas de notification
  // par-dessus pour cette partie (coups, messages). En la quittant, le chat se ferme.
  const pid = p?.id;
  const hideChat = chat.hide;
  useFocusEffect(
    useCallback(() => {
      if (!pid) return;
      setEtat('partie');
      setVisibleRoute(route.replace('[id]', pid));
      return () => {
        setEtat('appli');
        setVisibleRoute(null);
        hideChat();
      };
    }, [hideChat, pid, route]),
  );

  const running = p?.statut === 'en_cours' && !!p.tour_depuis;
  const waiting = p?.statut === 'invitation';
  const tick = useTick(running || waiting, running ? 250 : 1000);

  // Pendule à zéro, adversaire parti depuis une minute : le serveur tranche sans attendre
  const now = duel.now(tick);
  const times = p ? pendules(p, now) : null;
  const oppSeat = p && me ? (seat(p, me) === 1 ? 2 : 1) : 0;
  const oppVu = p && oppSeat ? (oppSeat === 1 ? p.vu1 : p.vu2) : null;
  const absentMs = running && oppVu ? now - new Date(oppVu).getTime() : 0;
  const timeUp = running && !!times && times[(p?.tour ?? 1) - 1] <= 0;
  const gone = absentMs >= ABSENCE_MS;
  const { verifier } = duel;
  const focused = useIsFocused();
  useEffect(() => {
    // Un écran caché sous un autre ne se déclare pas présent à la place de son joueur
    if ((timeUp || gone) && focused && AppState.currentState === 'active') verifier();
  }, [focused, gone, timeUp, verifier, now]);

  if (p === undefined) {
    return (
      <View style={[styles.flex, styles.center, { paddingTop: insets.top }]}>
        {duel.failed ? (
          <EmptyState
            icon="wifi-off"
            title="Pas de connexion"
            text="La partie n’a pas pu être chargée."
            action={<Button label="Réessayer" onPress={duel.load} />}
          />
        ) : (
          <ActivityIndicator color={c.teal} />
        )}
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
  const delta = monDelta(partie, me);
  const expireDans = waiting ? new Date(partie.created_at).getTime() + DEFI_MS - now : 0;

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
    const turn = partie.statut === 'en_cours' && partie.tour === n;
    return (
      <PlayerChip
        uid={uid}
        label={duel.name(uid)}
        sub={[String(duel.elo[uid] ?? ELO_DEPART), chipExtra?.(n)].filter(Boolean).join(' · ')}
        color={colors[n - 1]}
        activeColor={activeColor ?? colors[n - 1]}
        active={turn}
        online={uid !== me && !!enLigne[uid]}
        clock={times ? times[n - 1] : null}
        running={turn && running}
      />
    );
  };

  // Chat ouvert : le plateau prend la place qui reste sous les joueurs, sans défilement
  const boardMax = chat.open && viewH > 0 ? Math.max(120, viewH - headH - 40) : null;

  return (
    // Chat ouvert : le plateau garde le haut de l'écran, le chat le bas, le clavier pousse les deux
    <KeyboardAware style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <IconButton name="chevron-left" label="Retour" onPress={() => (router.canGoBack() ? router.back() : router.replace(lobby))} />
        <Text style={styles.title}>{titre}</Text>
        {mySeat > 0 ? <ChatButton chat={chat} /> : <View style={{ width: 44 }} />}
      </View>

      {/* Le plateau ne doit pas bouger sous le doigt : défilement seulement si l'écran est trop petit */}
      <ScrollView
        scrollEnabled={overflow && !chat.open}
        bounces={false}
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_, h) => setContentH(h)}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: chat.open ? 8 : insets.bottom + 24, alignItems: 'center' }}
      >
        <View style={{ alignSelf: 'stretch', alignItems: 'center' }} onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
          <View style={styles.players}>
            {chip(1)}
            {chip(2)}
          </View>
          <ChatBubble chat={chat} name={duel.name} />

          <Text
            style={[styles.status, chat.open && styles.statusSmall, statusColor ? { color: statusColor } : null, won && { color: c.teal }]}
            accessibilityLiveRegion="polite"
          >
            {status}
          </Text>
          {absentMs >= ABSENCE_ALERTE_MS && (
            <Text style={styles.alert} accessibilityLiveRegion="polite">
              {duel.name(opponentOf(partie, me))} a quitté la partie · éliminé dans {chrono(Math.max(0, ABSENCE_MS - absentMs))}
            </Text>
          )}
          {waiting && expireDans > 0 && (
            <Text style={styles.note}>
              Le défi expire dans {chrono(expireDans)} · {chrono(PENDULE[duel.jeu])} chacun à la pendule
            </Text>
          )}
          {finished && delta !== null && (
            <Text style={[styles.delta, { color: delta > 0 ? c.teal : delta < 0 ? c.coralSoft : c.muted }]}>
              {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
              {Math.abs(delta)} Elo
            </Text>
          )}
        </View>

        <BoardSpace.Provider value={boardMax}>{children}</BoardSpace.Provider>

        {!chat.open && actions}
        {!chat.open && (
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
        )}
      </ScrollView>
      {mySeat > 0 && <ChatPanel chat={chat} autres={[partie.joueur1, partie.joueur2].filter((u) => u !== me)} name={duel.name} />}
    </KeyboardAware>
  );
}

function PlayerChip({
  uid,
  label,
  sub,
  color,
  activeColor,
  active,
  online,
  clock,
  running,
}: {
  uid: string;
  label: string;
  sub: string;
  color: string;
  activeColor: string;
  active: boolean;
  online: boolean;
  clock: number | null;
  running: boolean;
}) {
  const low = clock !== null && clock < 30_000;
  return (
    <View
      style={[styles.chip, active && { borderColor: activeColor }]}
      accessible
      accessibilityLabel={`${label}, Elo ${sub}${clock !== null ? `, ${chrono(clock)} restantes` : ''}${active ? ', au trait' : ''}`}
    >
      <View style={styles.chipTop}>
        <View>
          <Pastille id={uid} name={label} size={30} />
          {online && <OnlineDot ring={c.card} />}
          <View style={[styles.token, { backgroundColor: color }]} />
        </View>
        <View style={{ minWidth: 0, flex: 1 }}>
          <Text style={styles.chipName} numberOfLines={1}>
            {label}
          </Text>
          <Text style={styles.chipSub} numberOfLines={1}>
            {sub}
          </Text>
        </View>
      </View>
      {clock !== null && (
        <View style={[styles.clock, running && styles.clockOn, running && low && styles.clockLow]}>
          <Text
            style={[styles.clockText, running && { color: c.ink }, running && low && { color: '#fff' }]}
            maxFontSizeMultiplier={1.2}
          >
            {chrono(clock)}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Point vert posé sur une pastille : la personne a l'appli ouverte */
export function OnlineDot({ ring, size = 12 }: { ring: string; size?: number }) {
  return (
    <View
      accessibilityLabel="En ligne"
      style={{
        position: 'absolute',
        right: -1,
        bottom: -1,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: ONLINE,
        borderWidth: 2,
        borderColor: ring,
      }}
    />
  );
}

export const ONLINE = '#5BE37D';

export const duelStyles = StyleSheet.create({
  tip: { color: c.muted, fontFamily: f.body, fontSize: 14, marginTop: 6, textAlign: 'center', paddingHorizontal: 16 },
});

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  center: { alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6 },
  title: { color: c.text, fontFamily: f.serif, fontSize: 20 },
  players: { flexDirection: 'row', alignItems: 'stretch', gap: 8, paddingHorizontal: 12, marginTop: 8, alignSelf: 'stretch' },
  chip: {
    flex: 1,
    gap: 8,
    padding: 8,
    borderRadius: 18,
    backgroundColor: c.card,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chipTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  token: {
    position: 'absolute',
    left: -3,
    top: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  chipName: { color: c.text, fontFamily: f.bodyBold, fontSize: 14 },
  chipSub: { color: c.muted, fontFamily: f.body, fontSize: 12 },
  clock: { borderRadius: 10, paddingVertical: 4, alignItems: 'center', backgroundColor: c.raised },
  clockOn: { backgroundColor: c.text },
  clockLow: { backgroundColor: c.coral },
  clockText: { color: c.muted, fontFamily: f.bodyBold, fontSize: 20, fontVariant: ['tabular-nums'] },
  status: {
    alignSelf: 'stretch',
    color: c.text,
    fontFamily: f.serif,
    fontSize: 24,
    lineHeight: 30,
    marginTop: 18,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  statusSmall: { fontSize: 18, lineHeight: 23, marginTop: 10 },
  alert: { color: c.yellow, fontFamily: f.bodyBold, fontSize: 14, marginTop: 6, textAlign: 'center', paddingHorizontal: 16 },
  note: { color: c.muted, fontFamily: f.body, fontSize: 14, marginTop: 6, textAlign: 'center', paddingHorizontal: 16 },
  delta: { fontFamily: f.bodyBold, fontSize: 16, marginTop: 4 },
  footer: { flexDirection: 'row', gap: 10, width: '100%', paddingHorizontal: 20, marginTop: 24 },
});
