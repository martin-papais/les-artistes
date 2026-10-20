import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Pastille, ScreenHeader } from '@/components/ui/kit';
import { classementGeneral, displayName, fetchClassements, type General, invalidateClassements, JEUX, LOGOS, MEDALS, POINTS } from '@/lib/minijeux';
import { sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { usePullRefresh, useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

// Les jeux dans l'ordre de l'onglet, les jeux à deux en tête
const COLONNES = [
  { id: 'echecs' as const, nom: 'Échecs', color: '#4ECDC4' },
  { id: 'puissance4' as const, nom: 'Puissance 4', color: '#7B6CF0' },
  ...JEUX.map((j) => ({ id: j.id, nom: j.nom, color: j.color })),
];

/** Classement général : chaque jeu rapporte des points selon la place (10, 8, 6, 5, 4, 3, 2, 1). */
export default function ClassementGeneral() {
  const [me, setMe] = useState<string | null>(null);
  const [rows, setRows] = useState<General[] | null>(null);

  const load = useCallback(async () => {
    const user = await sessionUser();
    setMe(user?.id ?? null);
    try {
      setRows(classementGeneral(await fetchClassements()));
    } catch {
      setRows((cur) => cur ?? []);
    }
  }, []);

  useRefreshOnFocus(load, 0);

  const { refreshing, onRefresh } = usePullRefresh(
    useCallback(async () => {
      invalidateClassements();
      await load();
    }, [load]),
  );

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
    >
      <ScreenHeader
        back
        title="Classement général"
        sub="Tous les mini-jeux comptent"
        right={<Image source={LOGOS.classement} style={{ width: 64, height: 64 }} />}
      />

      <Card style={styles.rules}>
        <Text style={styles.rulesText}>
          Sur chaque jeu, ta place rapporte des points : {POINTS.slice(0, 4).join(', ')}… jusqu’à 1 point pour le 8e. Pour les échecs et
          Puissance 4, c’est la place au classement Elo.
        </Text>
      </Card>

      {rows === null ? (
        <ActivityIndicator color={c.teal} style={{ marginTop: 24 }} />
      ) : rows.length === 0 ? (
        <Text style={[styles.small, { paddingHorizontal: theme.gutter, marginTop: 20 }]}>Personne n’a encore joué.</Text>
      ) : (
        rows.map((g, i) => (
          <Card key={g.user_id} style={[styles.row, g.user_id === me && styles.mine]}>
            <View style={styles.top}>
              <Text style={[styles.rank, i < 3 && { color: MEDALS[i] }]}>{i + 1}</Text>
              <Pastille id={g.user_id} name={displayName(g.profile)} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {g.user_id === me ? 'Toi' : displayName(g.profile)}
                </Text>
                {g.titres > 0 && (
                  <Text style={styles.small}>
                    {g.titres} titre{g.titres > 1 ? 's' : ''}
                  </Text>
                )}
              </View>
              <Text style={styles.points}>
                {g.points}
                <Text style={styles.unit}> pts</Text>
              </Text>
            </View>
            {/* Place sur chaque jeu joué */}
            <View style={styles.places}>
              {COLONNES.filter((col) => g.places[col.id]).map((col) => (
                <View key={col.id} style={styles.place}>
                  <View style={[styles.dot, { backgroundColor: col.color }]} />
                  <Text style={styles.placeText}>
                    {col.nom} {g.places[col.id] === 1 ? '1er' : `${g.places[col.id]}e`}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  rules: { marginHorizontal: theme.gutter, marginTop: 16, marginBottom: 8, padding: 14 },
  rulesText: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 20 },
  row: { marginHorizontal: theme.gutter, marginTop: 10, padding: 14 },
  mine: { borderWidth: 1, borderColor: c.teal },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { width: 26, textAlign: 'center', color: c.muted, fontFamily: f.serifBlack, fontSize: 22 },
  name: { color: c.text, fontFamily: f.bodyBold, fontSize: 16 },
  small: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  points: { color: c.text, fontFamily: f.serifBlack, fontSize: 24 },
  unit: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  places: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, marginLeft: 38 },
  place: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, backgroundColor: c.raised },
  dot: { width: 8, height: 8, borderRadius: 4 },
  placeText: { color: c.text, fontFamily: f.bodyMedium, fontSize: 12 },
});
