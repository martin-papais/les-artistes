/**
 * Fiches d'un jeu (alcool et société), affichées dans la Modal de l'onglet Jeux.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/ui/kit';
import type { JeuAlcool } from '@/lib/supabase';
import { theme } from '@/lib/theme';

import { NiveauGauge, formatNote, type SocieteCard } from './JeuCards';

const c = theme.colors;
const f = theme.fonts;

type OwnerProps = { mine: boolean; onEdit: () => void; onDelete: () => void };

/** Modifier et Supprimer, pour l'auteur du jeu seulement. */
function OwnerActions({ mine, onEdit, onDelete }: OwnerProps) {
  if (!mine) return null;
  return (
    <View style={s.ownerRow}>
      <Button label="Modifier" icon="edit-2" variant="raised" onPress={onEdit} style={{ flex: 1 }} />
      <Button label="Supprimer" icon="trash-2" variant="danger" onPress={onDelete} style={[{ flex: 1 }, s.dangerBtn]} />
    </View>
  );
}

function DetailFrame({
  kicker,
  kickerColor,
  title,
  authorName,
  onClose,
  children,
}: {
  kicker: string;
  kickerColor: string;
  title: string;
  authorName: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <SafeAreaView style={s.flex} edges={['top', 'bottom', 'left', 'right']}>
      <View style={s.topBar}>
        <IconButton name="x" label="Fermer" onPress={onClose} bg="transparent" />
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <Text style={[s.kicker, { color: kickerColor }]}>{kicker}</Text>
        <Text style={s.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={s.author}>Ajouté par {authorName}</Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ value, label, extra }: { value: string; label: string; extra?: ReactNode }) {
  return (
    <View style={s.tile}>
      <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {value}
      </Text>
      {extra}
      <Text style={s.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Text style={s.section} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </>
  );
}

export function AlcoolDetail({
  jeu,
  authorName,
  onClose,
  ...owner
}: { jeu: JeuAlcool; authorName: string; onClose: () => void } & OwnerProps) {
  const hasTiles = !!jeu.joueurs || !!jeu.niveau;
  return (
    <DetailFrame
      kicker={`Jeu d’alcool · ${jeu.categorie}`}
      kickerColor={c.coralSoft}
      title={jeu.nom}
      authorName={authorName}
      onClose={onClose}
    >
      {hasTiles && (
        <View style={s.tiles}>
          {!!jeu.joueurs && <Tile value={jeu.joueurs} label={/joueu/i.test(jeu.joueurs) ? 'idéal' : 'joueurs idéal'} />}
          {!!jeu.niveau && (
            <Tile
              value={jeu.niveau}
              label="niveau d’ivresse"
              extra={<View style={{ marginTop: 6 }}><NiveauGauge niveau={jeu.niveau} size={9} /></View>}
            />
          )}
        </View>
      )}
      <Section title="Comment on joue">
        <Text style={s.text}>{jeu.regles}</Text>
      </Section>
      {!!jeu.materiel && (
        <Section title="Matériel">
          <Text style={s.text}>{jeu.materiel}</Text>
        </Section>
      )}
      <OwnerActions {...owner} />
    </DetailFrame>
  );
}

export function SocieteDetail({
  card,
  authorName,
  onClose,
  onRate,
  ...owner
}: { card: SocieteCard; authorName: string; onClose: () => void; onRate: (n: number) => void } & OwnerProps) {
  const myNote = card.myVote?.note ?? 0;
  const tiles: { value: string; label: string }[] = [];
  if (card.joueurs_max) tiles.push({ value: card.joueurs_max, label: 'joueurs max' });
  if (card.duree) tiles.push({ value: card.duree, label: 'par partie' });
  if (card.a_acheter === 'oui') tiles.push({ value: 'À acheter', label: 'personne ne l’a' });
  else if (card.detenteur) tiles.push({ value: card.detenteur, label: 'l’a chez lui' });
  return (
    <DetailFrame kicker="Jeu de société" kickerColor={c.teal} title={card.nom} authorName={authorName} onClose={onClose}>
      <View style={s.rating}>
        <View style={s.avg}>
          <Text style={[s.avgValue, !card.votes.length && { color: c.muted }]}>
            {card.votes.length ? formatNote(card.avg) : '0'}
          </Text>
          <Text style={s.tileLabel}>{card.votes.length ? `${card.votes.length} avis` : 'aucun avis'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.rateTitle}>Ta note</Text>
          <View style={s.stars} accessibilityRole="radiogroup" accessibilityLabel="Ta note">
            {[1, 2, 3, 4, 5].map((n) => {
              const on = myNote >= n;
              return (
                <Pressable
                  key={n}
                  onPress={() => onRate(n)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: myNote === n }}
                  accessibilityLabel={`${n} étoile${n > 1 ? 's' : ''}`}
                  style={({ pressed }) => [s.star, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name={on ? 'star' : 'star-outline'} size={28} color={on ? c.yellow : c.muted} />
                </Pressable>
              );
            })}
          </View>
          <Text style={s.tileLabel}>{myNote ? 'Touche ta note pour la retirer' : 'Touche une étoile pour noter'}</Text>
        </View>
      </View>

      {tiles.length > 0 && (
        <View style={[s.tiles, { marginTop: 10 }]}>
          {tiles.map((t) => (
            <Tile key={t.label} value={t.value} label={t.label} />
          ))}
        </View>
      )}

      <Section title="Comment on joue">
        <Text style={s.text}>{card.regles}</Text>
      </Section>
      {!!card.avis && (
        <Section title={`L’avis de ${authorName}`}>
          <Text style={s.text}>{card.avis}</Text>
        </Section>
      )}
      <OwnerActions {...owner} />
    </DetailFrame>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  topBar: { paddingHorizontal: 12, paddingTop: 4 },
  body: { paddingHorizontal: theme.gutter, paddingTop: 4, paddingBottom: 32 },
  kicker: { fontFamily: f.bodyBold, fontSize: 13 },
  title: { fontFamily: f.serifBlack, fontSize: 36, lineHeight: 42, color: c.text, marginTop: 4 },
  author: { fontFamily: f.body, fontSize: 14, color: c.muted, marginTop: 4 },
  rating: {
    marginTop: 18,
    padding: 16,
    borderRadius: 22,
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avg: { alignItems: 'center', paddingRight: 16, borderRightWidth: 1, borderRightColor: c.hairline, minWidth: 64 },
  avgValue: { fontFamily: f.serifBlack, fontSize: 44, lineHeight: 52, color: c.yellow },
  rateTitle: { fontFamily: f.bodyBold, fontSize: 15, color: c.text, marginBottom: 2 },
  stars: { flexDirection: 'row', marginLeft: -10 },
  star: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 18 },
  tile: { flex: 1, minWidth: 0, padding: 12, borderRadius: 18, backgroundColor: c.card },
  tileValue: { fontFamily: f.serifBlack, fontSize: 22, lineHeight: 28, color: c.text },
  tileLabel: { fontFamily: f.body, fontSize: 13, lineHeight: 18, color: c.muted, marginTop: 2 },
  section: { fontFamily: f.bodyBold, fontSize: 18, lineHeight: 24, color: c.text, marginTop: 22, marginBottom: 8 },
  text: { fontFamily: f.body, fontSize: 16, lineHeight: 24, color: c.text },
  ownerRow: { flexDirection: 'row', gap: 10, marginTop: 32 },
  dangerBtn: { backgroundColor: c.card },
});
