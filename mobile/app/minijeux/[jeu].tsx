import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Basket } from '@/components/minijeux/Basket';
import { Classement } from '@/components/minijeux/Classement';
import { Flappy } from '@/components/minijeux/Flappy';
import { Reflexes } from '@/components/minijeux/Reflexes';
import { Stack } from '@/components/minijeux/Stack';
import { Stop10 } from '@/components/minijeux/Stop10';
import { Button, EmptyState, IconButton } from '@/components/ui/kit';
import { beats, fetchClassements, formatScore, type JeuId, jeuMeta, type Ligne, LOGOS, saveScore, verdict } from '@/lib/minijeux';
import { sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

type Phase = 'intro' | 'playing' | 'over';

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
  const [saved, setSaved] = useState<'saving' | 'ok' | 'failed'>('ok');

  const load = useCallback(async () => {
    if (!jeu) return;
    try {
      setLignes((await fetchClassements()).scores[jeu.id]);
    } catch {
      setLignes((cur) => cur ?? []);
    }
  }, [jeu]);

  useEffect(() => {
    sessionUser().then((u) => setMe(u?.id ?? null));
    load();
  }, [load]);

  if (!jeu) {
    return (
      <View style={[styles.flex, { paddingTop: insets.top }]}>
        <EmptyState icon="alert-triangle" title="Ce jeu n’existe pas" action={<Button label="Retour" onPress={() => router.back()} />} />
      </View>
    );
  }

  const myBest = lignes?.find((l) => l.user_id === me)?.best;

  async function onEnd(score: number) {
    if (!jeu) return;
    setLast(score);
    // Zéro tuyau ou zéro panier n'est pas un record, même à la première partie
    setRecord(myBest === undefined ? jeu.lowerIsBetter || score > 0 : beats(jeu, score, myBest));
    setPhase('over');
    setSaved('saving');
    try {
      await saveScore(jeu.id, score);
      setSaved('ok');
    } catch {
      setSaved('failed');
    }
    load();
  }

  function play() {
    setRun((r) => r + 1);
    setPhase('playing');
  }

  const rank = lignes && me ? lignes.findIndex((l) => l.user_id === me) + 1 : 0;
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
            </View>
          ) : (
            <View style={styles.hero}>
              {record && <Text style={[styles.kicker, { color: c.yellow }]}>Nouveau record !</Text>}
              <Text style={styles.score}>{last !== null ? formatScore(jeu, last) : ''}</Text>
              {last !== null && <Text style={[styles.verdict, { color: jeu.color }]}>{verdict(jeu, last)}</Text>}
              {saved === 'saving' && <ActivityIndicator color={c.teal} />}
              {saved === 'failed' && <Text style={styles.warn}>Score non enregistré : vérifie ta connexion.</Text>}
              {saved === 'ok' && rank > 0 && (
                <Text style={styles.best}>
                  {rank === 1 ? 'Tu es en tête du groupe' : `${rank}e place sur ${lignes?.length}`}
                </Text>
              )}
            </View>
          )}

          <Button label={phase === 'intro' ? 'Jouer' : 'Rejouer'} icon="play" onPress={play} style={styles.cta} />

          <Text style={styles.section}>Classement</Text>
          {lignes ? (
            <Classement lignes={lignes} me={me} value={(l) => formatScore(jeu, l.best)} />
          ) : (
            <ActivityIndicator color={c.teal} />
          )}
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
  cta: { marginTop: 20 },
  section: { color: c.text, fontFamily: f.bodyBold, fontSize: 18, marginTop: 32, marginBottom: 8 },
});
