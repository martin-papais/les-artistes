import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Basket } from '@/components/minijeux/Basket';
import { Classement, ClassementErreur } from '@/components/minijeux/Classement';
import { Flappy } from '@/components/minijeux/Flappy';
import { Reflexes } from '@/components/minijeux/Reflexes';
import { Stack } from '@/components/minijeux/Stack';
import { Stop10 } from '@/components/minijeux/Stop10';
import { Button, EmptyState, IconButton } from '@/components/ui/kit';
import {
  beats,
  classementsGardes,
  commencerPartie,
  type Envoi,
  fetchClassements,
  formatScore,
  invalidateClassements,
  type JeuId,
  jeuMeta,
  type Ligne,
  LOGOS,
  renvoyerScores,
  saveScore,
  scoresEnAttente,
  verdict,
} from '@/lib/minijeux';
import { sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

type Phase = 'intro' | 'playing' | 'over';
/** horsligne : la partie n'a pas pu être ouverte côté serveur, elle ne compte pas */
type Sauvegarde = 'saving' | Envoi | 'horsligne';

// Une session ouverte d'avance sert si elle a moins de 5 minutes (le serveur en accepte 30)
const SESSION_FRAICHE = 5 * 60_000;

/** Attend la session au plus 4 s ; null si le serveur ne répond pas */
const attendre = (p: Promise<string>) =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 4000))]).catch(() => null);

const GAMES: Record<JeuId, (p: { onEnd: (score: number) => void }) => React.ReactNode> = {
  reflexes: Reflexes,
  flappy: Flappy,
  basket: Basket,
  stack: Stack,
  stop10: Stop10,
};

export default function MiniJeuScreen() {
  const { jeu: id } = useLocalSearchParams<{ jeu: string }>();
  const jeu = jeuMeta(id ?? '');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('intro');
  const [run, setRun] = useState(0);
  const [me, setMe] = useState<string | null>(null);
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [record, setRecord] = useState(false);
  const [saved, setSaved] = useState<Sauvegarde>('ok');
  const [erreur, setErreur] = useState(false);
  const [attente, setAttente] = useState<number[]>([]);
  const [starting, setStarting] = useState(false);
  // Session de la partie en cours, celle de la dernière partie (son score peut être en attente)
  // et celle ouverte d'avance pour la suivante
  const session = useRef<string | null>(null);
  const derniere = useRef<string | null>(null);
  const prochaine = useRef<{ at: number; p: Promise<string> } | null>(null);

  const load = useCallback(async () => {
    if (!jeu) return;
    // Les scores restés en attente repartent d'abord
    const { restants, refuses } = await renvoyerScores();
    const d = derniere.current;
    if (d && !restants.includes(d)) setSaved((s) => (s === 'attente' ? (refuses.includes(d) ? 'refuse' : 'ok') : s));
    setAttente((await scoresEnAttente())[jeu.id] ?? []);
    try {
      setLignes((await fetchClassements()).scores[jeu.id]);
      setErreur(false);
    } catch {
      setErreur(true);
    }
  }, [jeu]);

  const preparer = useCallback(() => {
    if (!jeu) return;
    const p = commencerPartie(jeu.id);
    p.catch(() => {});
    prochaine.current = { at: Date.now(), p };
  }, [jeu]);

  useEffect(() => {
    sessionUser().then((u) => setMe(u?.id ?? null));
    preparer();
  }, [preparer]);

  // Dernier classement gardé sur le téléphone, en attendant celui du serveur
  useEffect(() => {
    if (!jeu) return;
    classementsGardes().then((cl) => {
      if (cl) setLignes((l) => l ?? cl.scores[jeu.id] ?? null);
    });
  }, [jeu]);

  // Au montage, au retour sur l'écran et au retour au premier plan
  useRefreshOnFocus(load, 0);

  if (!jeu) {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <EmptyState icon="alert-triangle" title="Ce jeu n’existe pas" action={<Button label="Retour" onPress={() => router.back()} />} />
      </View>
    );
  }

  const myBest = lignes?.find((l) => l.user_id === me)?.best;
  // Meilleur score pas encore parti
  const bestAttente = attente.reduce<number | undefined>((b, x) => (b === undefined || beats(jeu, x, b) ? x : b), undefined);
  const recordAttente = bestAttente !== undefined && (myBest === undefined || beats(jeu, bestAttente, myBest)) ? bestAttente : undefined;
  const monMeilleur = recordAttente ?? myBest;

  async function onEnd(score: number) {
    if (!jeu) return;
    const sid = session.current;
    session.current = null;
    derniere.current = sid;
    setLast(score);
    // Zéro tuyau ou zéro panier n'est pas un record, même à la première partie
    setRecord(monMeilleur === undefined ? jeu.lowerIsBetter || score > 0 : beats(jeu, score, monMeilleur));
    setPhase('over');
    if (!sid) {
      setSaved('horsligne');
      preparer();
      return;
    }
    setSaved('saving');
    const r = await saveScore(sid, jeu.id, score);
    setSaved(r);
    preparer();
    if (r === 'attente') setAttente((a) => [...a, Math.round(score)]);
    else load();
  }

  async function play() {
    if (!jeu || starting) return;
    setStarting(true);
    const pre = prochaine.current;
    prochaine.current = null;
    let sid = pre && Date.now() - pre.at < SESSION_FRAICHE ? await attendre(pre.p) : null;
    // Préparée hors connexion ou trop vieille : on en redemande une
    sid ??= await attendre(commencerPartie(jeu.id));
    session.current = sid;
    setStarting(false);
    setRun((r) => r + 1);
    setPhase('playing');
  }

  function retry() {
    invalidateClassements();
    load();
  }

  const mine = lignes?.find((l) => l.user_id === me);
  const rank = mine?.rang ?? 0;
  const exAequo = rank > 0 && (lignes?.filter((l) => l.rang === rank).length ?? 0) > 1;
  const Game = GAMES[jeu.id];

  return (
    <GestureHandlerRootView style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <IconButton
          name="x"
          label="Quitter"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/minijeux'))}
        />
        <Text style={styles.title}>{jeu.nom}</Text>
        <View style={{ width: 44 }} />
      </View>

      {phase === 'playing' ? (
        <View style={[styles.flex, { paddingBottom: insets.bottom }]}>
          <Game key={run} onEnd={onEnd} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
          {phase === 'intro' ? (
            <View style={styles.hero}>
              <Image source={LOGOS[jeu.id]} style={styles.logo} />
              <Text style={styles.pitch}>{jeu.pitch}</Text>
              {myBest !== undefined && <Text style={styles.best}>Ton record : {formatScore(jeu, myBest)}</Text>}
              {recordAttente !== undefined && (
                <Text style={styles.wait}>Record en attente d’envoi : {formatScore(jeu, recordAttente)}</Text>
              )}
            </View>
          ) : (
            <View style={styles.hero}>
              {record && <Text style={[styles.kicker, { color: c.yellow }]}>Nouveau record !</Text>}
              <Text style={styles.score}>{last !== null ? formatScore(jeu, last) : ''}</Text>
              {last !== null && <Text style={[styles.verdict, { color: jeu.color }]}>{verdict(jeu, last)}</Text>}
              {saved === 'saving' && <ActivityIndicator color={c.teal} />}
              {saved === 'attente' && (
                <Text style={styles.wait}>
                  {record ? 'Record en attente d’envoi' : 'Score en attente d’envoi'} : il partira tout seul dès que la connexion revient.
                </Text>
              )}
              {saved === 'refuse' && <Text style={styles.warn}>Score refusé par le serveur : cette partie ne compte pas.</Text>}
              {saved === 'horsligne' && <Text style={styles.warn}>Partie lancée hors connexion : elle ne compte pas au classement.</Text>}
              {saved === 'ok' && rank > 0 && (
                <Text style={styles.best}>
                  {rank === 1 ? `Tu es en tête du groupe${exAequo ? ', ex æquo' : ''}` : `${rank}e place${exAequo ? ' ex æquo' : ''} sur ${lignes?.length}`}
                </Text>
              )}
            </View>
          )}

          <Button label={phase === 'intro' ? 'Jouer' : 'Rejouer'} icon="play" onPress={play} loading={starting} style={styles.cta} />

          <Text style={styles.section}>Classement</Text>
          {lignes && <Classement lignes={lignes} me={me} value={(l) => formatScore(jeu, l.best)} />}
          {erreur ? <ClassementErreur onRetry={retry} stale={!!lignes} /> : !lignes && <ActivityIndicator color={c.teal} />}
        </ScrollView>
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6 },
  title: { color: c.text, fontFamily: f.serif, fontSize: 20 },
  body: { paddingHorizontal: theme.gutter },
  hero: { alignItems: 'center', gap: 12, paddingTop: 24, paddingBottom: 8 },
  logo: { width: 140, height: 140 },
  pitch: { color: c.text, fontFamily: f.body, fontSize: 17, lineHeight: 24, textAlign: 'center', maxWidth: 320 },
  best: { color: c.muted, fontFamily: f.bodyMedium, fontSize: 15 },
  kicker: { fontFamily: f.bodyBold, fontSize: 13, letterSpacing: 2.5, textTransform: 'uppercase' },
  score: { color: c.text, fontFamily: f.serifBlack, fontSize: 52, lineHeight: 60 },
  verdict: { fontFamily: f.serif, fontSize: 20, marginTop: -4 },
  warn: { color: c.coralSoft, fontFamily: f.bodyBold, fontSize: 14, textAlign: 'center' },
  wait: { color: c.yellow, fontFamily: f.bodyBold, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
  cta: { marginTop: 20 },
  section: { color: c.text, fontFamily: f.bodyBold, fontSize: 18, marginTop: 32, marginBottom: 8 },
});
