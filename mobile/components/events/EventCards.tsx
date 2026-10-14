/**
 * Cartes de la liste des événements : bulles d'anniversaires, billet « À la une »
 * avec réponse directe, lignes « Et ensuite » et passées.
 */
import { Feather } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Badge, Pastille, PastilleStack, Sheet } from '@/components/ui/kit';
import type { ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';

import {
  buildEventTitle,
  catMeta,
  countsLabel,
  dateParts,
  heureLabel,
  namesPreview,
  profileName,
  type Birthday,
  type EventCard,
} from './shared';

const c = theme.colors;
const f = theme.fonts;

/* ------------------------------------------------------------ anniversaires */

function whenLabel(b: Birthday, short: boolean) {
  if (b.daysUntil === 0) return short ? `${b.age} ans auj.` : `${b.age} ans aujourd'hui`;
  if (b.daysUntil === 1) return 'demain';
  return short ? `dans ${b.daysUntil} j` : `dans ${b.daysUntil} jours`;
}

export function BirthdayBubbles({ birthdays, onOpenAll }: { birthdays: Birthday[]; onOpenAll: () => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.bubbles}
      accessibilityLabel="Prochains anniversaires"
    >
      {birthdays.slice(0, 4).map((b) => {
        const today = b.daysUntil === 0;
        return (
          <Pressable
            key={b.id}
            onPress={onOpenAll}
            accessibilityRole="button"
            accessibilityLabel={`${b.name}, ${today ? `${b.age} ans aujourd'hui` : `anniversaire le ${b.monthDay}, ${whenLabel(b, false)}`}`}
            style={({ pressed }) => [styles.bubble, pressed && { opacity: 0.8 }]}
          >
            <View style={[styles.bubbleRing, { borderColor: today ? c.coral : c.rail }]}>
              <Pastille id={b.id} name={b.name} size={52} />
            </View>
            <Text style={styles.bubbleName} numberOfLines={1}>
              {b.name.split(' ')[0]}
            </Text>
            <Text style={[styles.bubbleWhen, today && { color: c.coralSoft, fontFamily: f.bodyBold }]} numberOfLines={1}>
              {whenLabel(b, true)}
            </Text>
          </Pressable>
        );
      })}
      <Pressable
        onPress={onOpenAll}
        accessibilityRole="button"
        accessibilityLabel="Tous les anniversaires de l'année"
        style={({ pressed }) => [styles.bubble, pressed && { opacity: 0.8 }]}
      >
        <View style={[styles.bubbleRing, { borderColor: 'transparent' }]}>
          <View style={styles.bubbleAll}>
            <Feather name="gift" size={24} color={c.violet} />
          </View>
        </View>
        <Text style={styles.bubbleName}>Tous</Text>
        <Text style={styles.bubbleWhen}>l&apos;année</Text>
      </Pressable>
    </ScrollView>
  );
}

export function BirthdaysSheet({ visible, onClose, birthdays }: { visible: boolean; onClose: () => void; birthdays: Birthday[] }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Anniversaires" sub="Du plus proche au plus lointain">
      {birthdays.length === 0 && <Text style={styles.muted}>Personne n&apos;a indiqué sa date de naissance.</Text>}
      {birthdays.map((b) => (
        <View key={b.id} style={styles.bdRow}>
          <Pastille id={b.id} name={b.name} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.bdName} numberOfLines={1}>
              {b.name}
            </Text>
            <Text style={styles.muted}>
              {b.monthDay} · {b.age} ans
            </Text>
          </View>
          <Text style={[styles.bdWhen, b.daysUntil === 0 && { color: c.coralSoft }]}>{whenLabel(b, false)}</Text>
        </View>
      ))}
    </Sheet>
  );
}

/** Pointillés du billet : iOS ne trace pas une bordure pointillée sur un seul côté */
function Dashes({ vertical }: { vertical?: boolean }) {
  return (
    <View style={vertical ? styles.dashesV : styles.dashesH} accessible={false}>
      {/* Hors du flux en vertical : la colonne de tirets ne doit pas agrandir le billet */}
      <View style={vertical ? styles.dashesVInner : styles.dashesHInner}>
        {Array.from({ length: vertical ? 30 : 50 }, (_, i) => (
          <View key={i} style={vertical ? styles.dashV : styles.dashH} />
        ))}
      </View>
    </View>
  );
}

/* --------------------------------------------------------- réponse directe */

/** Je viens / Pas dispo. Retaper le choix retenu le retire. */
export function RsvpButtons({
  mine,
  onVote,
  height = 46,
}: {
  mine: 'oui' | 'non' | null;
  onVote: (v: 'oui' | 'non') => void;
  height?: number;
}) {
  const yesBg = mine === 'non' ? c.rail : c.teal;
  const yesFg = mine === 'non' ? c.text : c.tealInk;
  const noBg = mine === 'non' ? c.text : c.rail;
  const noFg = mine === 'non' ? c.ink : c.text;
  const btn = { height, borderRadius: height / 2 };
  return (
    <View style={styles.rsvpRow}>
      <Pressable
        onPress={() => onVote('oui')}
        accessibilityRole="button"
        accessibilityLabel={mine === 'oui' ? 'Je viens, choisi. Toucher pour retirer' : 'Je viens'}
        accessibilityState={{ selected: mine === 'oui' }}
        style={({ pressed }) => [styles.rsvpBtn, btn, { backgroundColor: yesBg }, pressed && styles.pressed]}
      >
        {mine === 'oui' && <Feather name="check" size={18} color={yesFg} />}
        <Text style={[styles.rsvpText, { color: yesFg }]}>Je viens</Text>
      </Pressable>
      <Pressable
        onPress={() => onVote('non')}
        accessibilityRole="button"
        accessibilityLabel={mine === 'non' ? 'Pas dispo, choisi. Toucher pour retirer' : 'Pas dispo'}
        accessibilityState={{ selected: mine === 'non' }}
        style={({ pressed }) => [styles.rsvpBtn, btn, { backgroundColor: noBg }, pressed && styles.pressed]}
      >
        {mine === 'non' && <Feather name="x" size={18} color={noFg} />}
        <Text style={[styles.rsvpText, { color: noFg }]}>Pas dispo</Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------- à la une */

export function FeaturedTicket({
  event,
  currentUserId,
  profiles,
  onPress,
  onVote,
}: {
  event: EventCard;
  currentUserId: string | null;
  profiles: Record<string, ProfileMini>;
  onPress: () => void;
  onVote: (v: 'oui' | 'non') => void;
}) {
  const presents = event.votes.filter((v) => v.present === 'oui');
  const absents = event.votes.filter((v) => v.present === 'non').length;
  const presentPeople = presents.map((v) => ({ id: v.user_id, name: profileName(profiles[v.user_id]) }));
  const myVote = currentUserId ? event.votes.find((v) => v.user_id === currentUserId) : undefined;
  const p = dateParts(event.date_event);
  const meta = catMeta(event.categorie);
  const title = buildEventTitle(event);
  const when = [heureLabel(event.heure), event.lieu].filter(Boolean).join(' · ');
  return (
    <View style={styles.ticket}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${p.wd} ${p.day} ${p.month}${when ? `, ${when}` : ''}. Ouvrir la fiche`}
        style={({ pressed }) => [styles.ticketTop, pressed && { opacity: 0.85 }]}
      >
        <View style={styles.ticketDate}>
          <Text style={styles.ticketWd}>{p.wd}</Text>
          <Text style={styles.ticketDay}>{p.day}</Text>
          <Text style={styles.ticketMonth}>{p.month}</Text>
        </View>
        <Dashes vertical />
        <View style={styles.ticketBody}>
          {!!event.categorie && <Text style={[styles.ticketCat, { color: meta.color }]}>{event.categorie}</Text>}
          <Text style={styles.ticketTitle} numberOfLines={3}>
            {title}
          </Text>
          {!!when && (
            <Text style={styles.ticketMeta} numberOfLines={2}>
              {when}
            </Text>
          )}
          {!!event.note && (
            <Text style={styles.ticketNote} numberOfLines={2}>
              {event.note}
            </Text>
          )}
        </View>
      </Pressable>
      <Dashes />
      <View style={styles.ticketFoot}>
        <View style={styles.countRow}>
          {presentPeople.length > 0 && <PastilleStack people={presentPeople} max={3} size={26} ring={c.card} />}
          <Text style={styles.countText} numberOfLines={1}>
            <Text style={{ color: presents.length ? c.teal : c.muted, fontFamily: f.bodyBold }}>
              {countsLabel(presents.length, 0)}
            </Text>
            {absents > 0 && <Text style={{ color: c.muted }}>, {absents} non</Text>}
          </Text>
        </View>
        {presentPeople.length > 0 && (
          <Text style={styles.names} numberOfLines={1}>
            {namesPreview(presentPeople.map((x) => x.name), 4)}
          </Text>
        )}
        <RsvpButtons mine={myVote?.present ?? null} onVote={onVote} />
      </View>
    </View>
  );
}

/** Étiquette à côté du titre « À la une » */
export function FeaturedBadge({ mine }: { mine: 'oui' | 'non' | null }) {
  if (mine === 'oui') return <Badge label="Tu viens" color={c.teal} textColor={c.tealInk} />;
  if (mine === 'non') return <Badge label="Pas dispo" color={c.rail} textColor={c.text} />;
  return <Badge label="À toi de répondre" />;
}

/* --------------------------------------------------------- et ensuite */

export function EventTicket({
  event,
  currentUserId,
  onPress,
  muted,
}: {
  event: EventCard;
  currentUserId: string | null;
  onPress: () => void;
  muted?: boolean;
}) {
  const p = dateParts(event.date_event);
  const title = buildEventTitle(event);
  const presents = event.votes.filter((v) => v.present === 'oui').length;
  const myVote = currentUserId ? event.votes.find((v) => v.user_id === currentUserId) : undefined;
  const sameYear = p.year === new Date().getFullYear();
  const sub = [event.lieu, presents > 0 ? countsLabel(presents, 0) : null].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${p.wd} ${p.day} ${p.month}${sameYear ? '' : ` ${p.year}`}${
        myVote ? (myVote.present === 'oui' ? ', tu viens' : ', pas dispo') : ''
      }`}
      style={({ pressed }) => [styles.row, muted && { opacity: 0.7 }, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.rowDate}>
        <Text style={styles.rowDay}>{p.day}</Text>
        <Text style={styles.rowMonth}>{sameYear ? p.month : `${p.month} ${String(p.year).slice(2)}`}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, muted && { color: c.muted }]} numberOfLines={2}>
          {title}
        </Text>
        {!!sub && (
          <Text style={styles.rowSub} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {myVote ? (
        <View style={[styles.myVote, { backgroundColor: myVote.present === 'oui' ? c.teal : c.rail }]}>
          <Feather name={myVote.present === 'oui' ? 'check' : 'x'} size={15} color={myVote.present === 'oui' ? c.tealInk : c.text} />
        </View>
      ) : (
        <Feather name="chevron-right" size={18} color={c.muted} style={{ marginRight: 14 }} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  muted: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 20 },

  bubbles: { paddingHorizontal: theme.gutter, gap: 12 },
  bubble: { width: 72, alignItems: 'center' },
  bubbleRing: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, padding: 3, alignItems: 'center', justifyContent: 'center' },
  bubbleAll: { width: 52, height: 52, borderRadius: 26, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  bubbleName: { color: c.text, fontFamily: f.bodyBold, fontSize: 13, marginTop: 6 },
  bubbleWhen: { color: c.muted, fontFamily: f.body, fontSize: 12, marginTop: 1 },

  bdRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, borderBottomWidth: 1, borderBottomColor: c.hairline },
  bdName: { color: c.text, fontFamily: f.bodyBold, fontSize: 16 },
  bdWhen: { color: c.muted, fontFamily: f.bodyBold, fontSize: 13 },

  rsvpRow: { flexDirection: 'row', gap: 8 },
  rsvpBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  rsvpText: { fontFamily: f.bodyBold, fontSize: 15 },

  ticket: { marginHorizontal: theme.gutter, borderRadius: 22, backgroundColor: c.card, overflow: 'hidden' },
  ticketTop: { flexDirection: 'row' },
  ticketDate: { width: 88, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.coral },
  ticketWd: { color: '#fff', fontFamily: f.bodyBold, fontSize: 13 },
  ticketDay: { color: '#fff', fontFamily: f.serifBlack, fontSize: 42, lineHeight: 50 },
  ticketMonth: { color: '#fff', fontFamily: f.bodyBold, fontSize: 14 },
  dashesV: { width: 2, overflow: 'hidden' },
  dashesVInner: { position: 'absolute', top: 0, left: 0, gap: 4 },
  dashesHInner: { flexDirection: 'row', gap: 4 },
  dashV: { width: 2, height: 6, backgroundColor: c.deep },
  dashesH: { height: 2, overflow: 'hidden' },
  dashH: { width: 6, height: 2, backgroundColor: c.deep },
  ticketBody: { flex: 1, minWidth: 0, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  ticketCat: { fontFamily: f.bodyBold, fontSize: 13 },
  ticketTitle: { color: c.text, fontFamily: f.serif, fontSize: 20, lineHeight: 25, marginTop: 3 },
  ticketMeta: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 19, marginTop: 6 },
  ticketNote: { color: c.text, fontFamily: f.body, fontSize: 14, lineHeight: 20, marginTop: 6 },
  ticketFoot: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countText: { flex: 1, fontFamily: f.body, fontSize: 14, color: c.text },
  names: { color: c.muted, fontFamily: f.body, fontSize: 13, marginTop: 4 },

  row: { flexDirection: 'row', alignItems: 'center', marginHorizontal: theme.gutter, marginBottom: 10, borderRadius: theme.radius.card, backgroundColor: c.card, overflow: 'hidden', minHeight: 64 },
  rowDate: { width: 64, alignSelf: 'stretch', paddingVertical: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.raised },
  rowDay: { color: c.text, fontFamily: f.serifBlack, fontSize: 26, lineHeight: 32 },
  rowMonth: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  rowBody: { flex: 1, minWidth: 0, paddingHorizontal: 14, paddingVertical: 12 },
  rowTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 16, lineHeight: 21 },
  rowSub: { color: c.muted, fontFamily: f.body, fontSize: 14, marginTop: 2 },
  myVote: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
});
