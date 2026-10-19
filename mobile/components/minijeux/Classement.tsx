import { StyleSheet, Text, View } from 'react-native';

import { Pastille } from '@/components/ui/kit';
import { displayName, formatScore, type JeuMeta, type Ligne } from '@/lib/minijeux';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

/** Records d'un jeu ; la ligne du joueur est surlignée, et ajoutée en bas s'il est hors du top. */
export function Classement({ jeu, lignes, me, max }: { jeu: JeuMeta; lignes: Ligne[]; me: string | null; max?: number }) {
  if (!lignes.length) return <Text style={styles.empty}>Personne n’a encore joué. À toi d’ouvrir le bal.</Text>;
  const shown = max ? lignes.slice(0, max) : lignes;
  const mine = lignes.findIndex((l) => l.user_id === me);
  const extra = max && mine >= max ? lignes[mine] : null;
  return (
    <View>
      {shown.map((l, i) => (
        <Row key={l.user_id} jeu={jeu} l={l} rank={i + 1} mine={l.user_id === me} />
      ))}
      {extra && (
        <>
          <Text style={styles.ellipsis}>…</Text>
          <Row jeu={jeu} l={extra} rank={mine + 1} mine />
        </>
      )}
    </View>
  );
}

function Row({ jeu, l, rank, mine }: { jeu: JeuMeta; l: Ligne; rank: number; mine: boolean }) {
  const medal = rank === 1 ? c.yellow : rank === 2 ? '#D9D4E2' : rank === 3 ? '#E0A070' : null;
  return (
    <View style={[styles.row, mine && { backgroundColor: c.raised }]}>
      <Text style={[styles.rank, medal && { color: medal }]}>{rank}</Text>
      <Pastille id={l.user_id} name={displayName(l.profile)} size={32} />
      <Text style={[styles.name, mine && { fontFamily: f.bodyBold }]} numberOfLines={1}>
        {mine ? 'Toi' : displayName(l.profile)}
      </Text>
      <Text style={styles.score}>{formatScore(jeu, l.best)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { color: c.muted, fontFamily: f.body, fontSize: 15, lineHeight: 21, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 10, borderRadius: 14 },
  rank: { width: 22, textAlign: 'center', color: c.muted, fontFamily: f.serifBlack, fontSize: 17 },
  name: { flex: 1, color: c.text, fontFamily: f.bodyMedium, fontSize: 15 },
  score: { color: c.text, fontFamily: f.bodyBold, fontSize: 15 },
  ellipsis: { color: c.muted, textAlign: 'center', lineHeight: 14 },
});
