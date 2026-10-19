/**
 * Cartes de la liste des jeux, jauge d'ivresse et champ de recherche.
 */
import { Feather, Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Badge } from '@/components/ui/kit';
import type { JeuAlcool, JeuSociete, JeuSocieteVote } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

// Mêmes valeurs que games.html et JeuForm
export const CATEGORIES = ['Cartes', 'Dés', 'Oral', 'Balle', 'Autre'];
export const NIVEAUX = ['Soft', 'Medium', 'Hard', 'Destruction'];

export type SocieteCard = JeuSociete & {
  votes: JeuSocieteVote[];
  myVote: JeuSocieteVote | null;
  avg: number;
};

/** Note moyenne au format français : 3,0 */
export function formatNote(avg: number) {
  return avg.toFixed(1).replace('.', ',');
}

/** « 4-8 » devient « 4-8 joueurs », « 1 » devient « 1 joueur ». */
export function joueursLabel(raw: string) {
  const t = raw.trim();
  if (/joueu/i.test(t)) return t;
  return /^1$/.test(t) ? '1 joueur' : `${t} joueurs`;
}

/** Jauge d'ivresse : un point par niveau, de Soft à Destruction. */
export function NiveauGauge({ niveau, size = 8 }: { niveau: string; size?: number }) {
  const idx = NIVEAUX.indexOf(niveau);
  if (idx < 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: Math.round(size * 0.4) }} accessible={false}>
      {NIVEAUX.map((n, i) => (
        <View
          key={n}
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: i <= idx ? c.coral : c.rail }}
        />
      ))}
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder = 'Chercher un jeu',
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={s.search}>
      <Feather name="search" size={18} color={c.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        selectionColor={c.coral}
        accessibilityLabel={placeholder}
        returnKeyType="search"
        autoCorrect={false}
        style={s.searchInput}
      />
      {!!value && (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Effacer la recherche"
          style={s.searchClear}
        >
          <Feather name="x" size={18} color={c.muted} />
        </Pressable>
      )}
    </View>
  );
}

export function AlcoolCard({ jeu, onPress }: { jeu: JeuAlcool; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${jeu.nom}, ${jeu.categorie}${jeu.niveau ? `, niveau ${jeu.niveau}` : ''}`}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
    >
      <View style={s.topRow}>
        <Text style={[s.kicker, { color: c.coralSoft }]} numberOfLines={1}>
          {jeu.categorie}
        </Text>
        {!!jeu.niveau && (
          <View style={s.level}>
            <Text style={s.meta}>{jeu.niveau}</Text>
            <NiveauGauge niveau={jeu.niveau} />
          </View>
        )}
      </View>
      <Text style={s.title} numberOfLines={2}>
        {jeu.nom}
      </Text>
      {!!jeu.regles && (
        <Text style={s.excerpt} numberOfLines={2}>
          {jeu.regles}
        </Text>
      )}
      {!!jeu.joueurs && <Text style={[s.meta, { marginTop: 10 }]}>{joueursLabel(jeu.joueurs)}</Text>}
    </Pressable>
  );
}

export function SocieteCardView({ card, onPress }: { card: SocieteCard; onPress: () => void }) {
  const meta = [
    card.joueurs_max ? `${card.joueurs_max} joueurs max` : null,
    card.duree || null,
    card.a_acheter !== 'oui' && card.detenteur ? `chez ${card.detenteur}` : null,
  ].filter(Boolean);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${card.nom}, ${card.votes.length ? `note ${formatNote(card.avg)} sur 5` : 'pas encore noté'}`}
      style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}
    >
      <View style={s.topRow}>
        <View style={s.level}>
          <Ionicons name={card.votes.length ? 'star' : 'star-outline'} size={15} color={card.votes.length ? c.yellow : c.muted} />
          <Text style={[s.kicker, { color: card.votes.length ? c.yellow : c.muted }]}>
            {card.votes.length ? formatNote(card.avg) : 'Pas encore noté'}
          </Text>
          {!!card.votes.length && <Text style={s.meta}>{card.votes.length} avis</Text>}
        </View>
        {card.a_acheter === 'oui' && <Badge label="À acheter" color={c.teal} textColor={c.tealInk} />}
      </View>
      <Text style={s.title} numberOfLines={2}>
        {card.nom}
      </Text>
      {!!card.regles && (
        <Text style={s.excerpt} numberOfLines={2}>
          {card.regles}
        </Text>
      )}
      {meta.length > 0 && (
        <Text style={[s.meta, { marginTop: 10 }]} numberOfLines={1}>
          {meta.join(' · ')}
        </Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  search: {
    height: 48,
    borderRadius: 24,
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 6,
  },
  searchInput: { flex: 1, height: 48, color: c.text, fontFamily: f.body, fontSize: 15, paddingVertical: 0 },
  searchClear: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 16, borderRadius: theme.radius.card, backgroundColor: c.card },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 26 },
  kicker: { fontFamily: f.bodyBold, fontSize: 13, flexShrink: 1 },
  level: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontFamily: f.body, fontSize: 13, color: c.muted },
  title: { fontFamily: f.serif, fontSize: 20, lineHeight: 25, color: c.text, marginTop: 6 },
  excerpt: { fontFamily: f.body, fontSize: 14, lineHeight: 20, color: c.muted, marginTop: 4 },
});
