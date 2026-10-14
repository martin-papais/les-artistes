import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { sb, type EventCoursesVote, type EventFoodVote, type EventRow } from '@/lib/supabase';
import { theme } from '@/lib/theme';

type Poll =
  | { kind: 'food'; meal: string; title: string; yes: string; no: string }
  | { kind: 'courses'; title: string; yes: string; no: string };

// Libellés courts : deux boutons côte à côte sur un petit écran
const EAT = { yes: 'Je mange', no: 'Non' };

/** Mêmes règles que events.html (site) : quels sondages pour quel événement. */
export function pollsFor(e: EventRow): Poll[] {
  const polls: Poll[] = [];
  switch (e.categorie) {
    case 'Olympiade':
      polls.push({ kind: 'food', meal: 'midi', title: 'Qui mange le midi ?', ...EAT });
      polls.push({ kind: 'food', meal: 'soir', title: 'Qui mange le soir ?', ...EAT });
      break;
    case 'Nouvel an':
      if (e.manger_soir === 'oui') {
        polls.push({ kind: 'food', meal: 'soir', title: 'Qui mange le soir ensemble ?', ...EAT });
      }
      break;
    case 'Anniversaire':
    case 'Soirée':
      if (e.manger === 'non') {
        polls.push({ kind: 'food', meal: 'ensemble', title: 'Qui mange ensemble ?', ...EAT });
      }
      break;
    case 'Soirée jeux de société':
      if (e.manger === 'oui') {
        polls.push({ kind: 'food', meal: 'ensemble', title: 'Qui mange ensemble ?', ...EAT });
      }
      break;
    case 'Barathon':
      polls.push({ kind: 'food', meal: 'vendredi', title: 'Présent vendredi ?', yes: 'Présent', no: 'Absent' });
      polls.push({ kind: 'food', meal: 'samedi', title: 'Présent samedi ?', yes: 'Présent', no: 'Absent' });
      break;
    case 'Barbecue':
      polls.push({ kind: 'food', meal: 'barbecue', title: 'Qui mange au barbecue ?', ...EAT });
      if (e.courses === 'oui') {
        polls.push({ kind: 'courses', title: 'Qui vient faire les courses ?', yes: 'Je viens', no: 'Non' });
      }
      break;
  }
  return polls;
}

const YES_NO: Record<string, string> = { oui: 'Oui', non: 'Non', nsp: 'Je ne sais pas' };

/** Infos pratiques saisies à la création (alcool, jeux, dodo, courses…). */
export function EventInfos({ event }: { event: EventRow }) {
  const rows: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }[] = [];
  if (event.dormir && event.dormir !== 'nsp') {
    rows.push({ icon: 'bed-outline', text: `Dormir sur place : ${YES_NO[event.dormir] ?? event.dormir}` });
  }
  if (event.budget) rows.push({ icon: 'wallet-outline', text: `Budget : ${event.budget}` });
  if (event.courses === 'oui') {
    const parts = [event.heure_courses && `à ${event.heure_courses.slice(0, 5)}`, event.lieu_courses]
      .filter(Boolean)
      .join(' · ');
    rows.push({ icon: 'cart-outline', text: `Courses${parts ? ` : ${parts}` : ' prévues'}` });
  }
  if (event.alcool) rows.push({ icon: 'beer-outline', text: `Déjà là : ${event.alcool}` });
  if (event.jeux_liste) rows.push({ icon: 'dice-outline', text: `Jeux dispo : ${event.jeux_liste}` });
  if (rows.length === 0) return null;
  return (
    <View style={styles.infos}>
      {rows.map((r) => (
        <View key={r.text} style={styles.infoRow}>
          <Ionicons name={r.icon} size={15} color={theme.colors.muted} />
          <Text style={styles.infoText}>{r.text}</Text>
        </View>
      ))}
    </View>
  );
}

export function EventPolls({
  event,
  currentUserId,
  nameOf,
}: {
  event: EventRow;
  currentUserId: string;
  nameOf: (uid: string) => string;
}) {
  const polls = pollsFor(event);
  const hasFood = polls.some((p) => p.kind === 'food');
  const hasCourses = polls.some((p) => p.kind === 'courses');
  const [food, setFood] = useState<EventFoodVote[]>([]);
  const [courses, setCourses] = useState<EventCoursesVote[]>([]);
  const busy = useRef(false);

  const load = useCallback(async () => {
    const [f, c] = await Promise.all([
      hasFood
        ? sb.from('event_food_votes').select('id,event_id,user_id,meal,repas,mange').eq('event_id', event.id)
        : Promise.resolve({ data: [] }),
      hasCourses
        ? sb.from('event_courses_votes').select('id,event_id,user_id,vient').eq('event_id', event.id)
        : Promise.resolve({ data: [] }),
    ]);
    setFood((f.data ?? []) as EventFoodVote[]);
    setCourses((c.data ?? []) as EventCoursesVote[]);
  }, [event.id, hasFood, hasCourses]);

  useEffect(() => {
    load();
  }, [load]);

  if (polls.length === 0) return null;

  async function vote(poll: Poll, val: 'oui' | 'non') {
    // Un double appui insérait deux votes : on bloque jusqu'au rechargement
    if (busy.current) return;
    busy.current = true;
    Haptics.selectionAsync().catch(() => {});
    try {
      let error: { message: string } | null = null;
      // Relu en base au moment du vote (comme le site) : la liste affichée peut dater,
      // et un vote fait entre-temps ailleurs donnerait une 2e ligne
      if (poll.kind === 'food') {
        const { data } = await sb
          .from('event_food_votes')
          .select('id,repas,mange')
          .eq('event_id', event.id)
          .eq('user_id', currentUserId)
          .eq('meal', poll.meal);
        const rows = (data ?? []) as { id: string; repas: string | null; mange: string | null }[];
        const [mine, ...dupes] = rows;
        if (dupes.length) await sb.from('event_food_votes').delete().in('id', dupes.map((d) => d.id));
        const cur = mine ? mine.repas || mine.mange : null;
        if (mine && cur === val) {
          ({ error } = await sb.from('event_food_votes').delete().eq('id', mine.id));
        } else if (mine) {
          ({ error } = await sb.from('event_food_votes').update({ repas: val, mange: val }).eq('id', mine.id));
        } else {
          ({ error } = await sb.from('event_food_votes').insert({
            event_id: event.id,
            user_id: currentUserId,
            meal: poll.meal,
            repas: val,
            mange: val,
          }));
        }
      } else {
        const { data } = await sb
          .from('event_courses_votes')
          .select('id,vient')
          .eq('event_id', event.id)
          .eq('user_id', currentUserId);
        const rows = (data ?? []) as { id: string; vient: string }[];
        const [mine, ...dupes] = rows;
        if (dupes.length) await sb.from('event_courses_votes').delete().in('id', dupes.map((d) => d.id));
        if (mine && mine.vient === val) {
          ({ error } = await sb.from('event_courses_votes').delete().eq('id', mine.id));
        } else if (mine) {
          ({ error } = await sb.from('event_courses_votes').update({ vient: val }).eq('id', mine.id));
        } else {
          ({ error } = await sb
            .from('event_courses_votes')
            .insert({ event_id: event.id, user_id: currentUserId, vient: val }));
        }
      }
      if (error) Alert.alert('Erreur', error.message);
      await load();
    } finally {
      busy.current = false;
    }
  }

  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Repas & organisation</Text>
      {polls.map((poll, idx) => {
        const votes =
          poll.kind === 'food'
            ? food
                .filter((v) => v.meal === poll.meal)
                .map((v) => ({ user_id: v.user_id, val: v.repas || v.mange }))
            : courses.map((v) => ({ user_id: v.user_id, val: v.vient as string | null }));
        const mine = votes.find((v) => v.user_id === currentUserId)?.val ?? null;
        const yes = votes.filter((v) => v.val === 'oui');
        const no = votes.filter((v) => v.val === 'non');
        return (
          <View key={poll.title} style={[styles.poll, idx > 0 && styles.pollSep]}>
            <Text style={styles.pollTitle}>{poll.title}</Text>
            <View style={styles.choiceRow}>
              {(['oui', 'non'] as const).map((val) => {
                const active = mine === val;
                const tone = val === 'oui' ? theme.colors.teal : theme.colors.coral;
                const count = (val === 'oui' ? yes : no).length;
                return (
                  <Pressable
                    key={val}
                    onPress={() => vote(poll, val)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [
                      styles.choice,
                      { borderColor: active ? tone : tone + '55' },
                      active && { backgroundColor: tone },
                      pressed && { transform: [{ scale: 0.97 }] },
                    ]}
                  >
                    <Ionicons
                      name={val === 'oui' ? 'checkmark-circle' : 'close-circle'}
                      size={17}
                      color={active ? theme.colors.deep : tone}
                    />
                    <Text
                      style={[styles.choiceText, { color: active ? theme.colors.deep : tone }]}
                      numberOfLines={1}
                    >
                      {val === 'oui' ? poll.yes : poll.no} · {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {yes.length + no.length > 0 && (
              <Text style={styles.names}>
                {yes.length > 0 && (
                  <>
                    <Text style={{ color: theme.colors.teal }}>Oui : </Text>
                    {yes.map((v) => nameOf(v.user_id)).join(', ')}
                  </>
                )}
                {yes.length > 0 && no.length > 0 && '   '}
                {no.length > 0 && (
                  <>
                    <Text style={{ color: theme.colors.coral }}>Non : </Text>
                    {no.map((v) => nameOf(v.user_id)).join(', ')}
                  </>
                )}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  infos: {
    marginTop: theme.s(4),
    gap: 8,
    padding: theme.s(3),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  infoText: { flex: 1, color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 19 },
  block: {
    marginTop: theme.s(6),
    padding: theme.s(4),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  blockTitle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: theme.s(3),
  },
  poll: {},
  pollSep: {
    marginTop: theme.s(4),
    paddingTop: theme.s(4),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  pollTitle: { color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 15, marginBottom: theme.s(2) },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
  },
  choiceText: { fontFamily: theme.fonts.bodyBold, fontSize: 14, flexShrink: 1 },
  names: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 18, marginTop: 8 },
});
