import { StyleSheet, Text, View } from 'react-native';

import { Pastille } from '@/components/ui/kit';
import { displayName, MEDALS } from '@/lib/minijeux';
import type { ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

type Joueur = { user_id: string; profile?: ProfileMini };

/**
 * Classement d'un jeu (records ou Elo) ; la ligne du joueur est surlignée,
 * et ajoutée en bas s'il est hors du top.
 */
export function Classement<L extends Joueur>({
  lignes,
  me,
  max,
  value,
  sub,
  empty = 'Personne n’a encore joué. À toi d’ouvrir le bal.',
}: {
  lignes: L[];
  me: string | null;
  max?: number;
  value: (l: L) => string;
  sub?: (l: L) => string;
  empty?: string;
}) {
  if (!lignes.length) return <Text style={styles.empty}>{empty}</Text>;
  const shown = max ? lignes.slice(0, max) : lignes;
  const mine = lignes.findIndex((l) => l.user_id === me);
  const extra = max && mine >= max ? lignes[mine] : null;
  const row = (l: L, rank: number) => (
    <View key={l.user_id} style={[styles.row, l.user_id === me && { backgroundColor: c.raised }]}>
      <Text style={[styles.rank, rank <= 3 && { color: MEDALS[rank - 1] }]}>{rank}</Text>
      <Pastille id={l.user_id} name={displayName(l.profile)} size={32} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.name, l.user_id === me && { fontFamily: f.bodyBold }]} numberOfLines={1}>
          {l.user_id === me ? 'Toi' : displayName(l.profile)}
        </Text>
        {sub && <Text style={styles.sub}>{sub(l)}</Text>}
      </View>
      <Text style={styles.score}>{value(l)}</Text>
    </View>
  );
  return (
    <View>
      {shown.map((l, i) => row(l, i + 1))}
      {extra && (
        <>
          <Text style={styles.ellipsis}>…</Text>
          {row(extra, mine + 1)}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: c.muted, fontFamily: f.body, fontSize: 15, lineHeight: 21, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 10, borderRadius: 14 },
  rank: { width: 22, textAlign: 'center', color: c.muted, fontFamily: f.serifBlack, fontSize: 17 },
  name: { color: c.text, fontFamily: f.bodyMedium, fontSize: 15 },
  sub: { color: c.muted, fontFamily: f.body, fontSize: 12 },
  score: { color: c.text, fontFamily: f.bodyBold, fontSize: 15 },
  ellipsis: { color: c.muted, textAlign: 'center', lineHeight: 14 },
});
