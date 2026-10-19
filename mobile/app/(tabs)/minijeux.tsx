import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Classement } from '@/components/minijeux/Classement';
import { Button, Card, Icon, Pastille, ScreenHeader } from '@/components/ui/kit';
import { fetchClassements, formatScore, JEUX, type JeuId, type Ligne } from '@/lib/minijeux';
import { sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

export default function MiniJeuxScreen() {
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [ranks, setRanks] = useState<Record<JeuId, Ligne[]> | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const user = await sessionUser();
    setMe(user?.id ?? null);
    try {
      setRanks(await fetchClassements());
    } catch {
      // Hors connexion : les jeux restent jouables, sans classement
    }
  }, []);

  // Revenir d'une partie montre tout de suite le nouveau classement
  useRefreshOnFocus(load, 0);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
    >
      <ScreenHeader
        title="Mini-jeux"
        sub="Le meilleur score du groupe gagne"
        right={
          me ? (
            <Pressable onPress={() => router.push('/profil')} accessibilityRole="button" accessibilityLabel="Mon profil" hitSlop={4}>
              <Pastille id={me} name={null} />
            </Pressable>
          ) : null
        }
      />

      {JEUX.map((j) => {
        const lignes = ranks?.[j.id] ?? [];
        const mine = lignes.find((l) => l.user_id === me);
        const play = () => router.push({ pathname: '/minijeux/[jeu]', params: { jeu: j.id } });
        return (
          <Card key={j.id} style={styles.card}>
            <Pressable onPress={play} accessibilityRole="button" accessibilityLabel={`Jouer à ${j.nom}`} style={styles.head}>
              <View style={[styles.icon, { backgroundColor: j.color }]}>
                <Icon name={j.icon} size={26} color={j.ink} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{j.nom}</Text>
                <Text style={styles.pitch}>{j.pitch}</Text>
              </View>
            </Pressable>

            {ranks && (
              <View style={styles.ranks}>
                <Classement jeu={j} lignes={lignes} me={me} max={3} />
              </View>
            )}

            <View style={styles.foot}>
              <Text style={styles.mine}>
                {mine ? `Ton record : ${formatScore(j, mine.best)}` : 'Pas encore joué'}
              </Text>
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
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  icon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  name: { color: c.text, fontFamily: f.serif, fontSize: 22, lineHeight: 28 },
  pitch: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 19 },
  ranks: { marginTop: 12, marginHorizontal: -6 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  mine: { flex: 1, color: c.text, fontFamily: f.bodyMedium, fontSize: 14 },
  play: { paddingHorizontal: 22 },
});
