import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { sb, type EventCoursesVote, type EventFoodVote, type EventRow } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

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

type InfoIcon =
  | { lib: 'f'; name: React.ComponentProps<typeof Feather>['name'] }
  | { lib: 'i'; name: React.ComponentProps<typeof Ionicons>['name'] };

/** Infos pratiques en étiquettes : chez qui, lieu, et ce qui a été saisi à la création. */
export function EventInfos({ event }: { event: EventRow }) {
  const rows: { icon: InfoIcon; text: string }[] = [];
  if (event.chez_qui) rows.push({ icon: { lib: 'f', name: 'home' }, text: `Chez ${event.chez_qui}` });
  if (event.lieu) rows.push({ icon: { lib: 'f', name: 'map-pin' }, text: event.lieu });
  if (event.dormir && event.dormir !== 'nsp') {
    rows.push({ icon: { lib: 'i', name: 'bed-outline' }, text: `Dormir sur place : ${(YES_NO[event.dormir] ?? event.dormir).toLowerCase()}` });
  }
  if (event.budget) rows.push({ icon: { lib: 'f', name: 'credit-card' }, text: `Budget : ${event.budget}` });
  if (event.courses === 'oui') {
    const parts = [event.heure_courses && `à ${event.heure_courses.slice(0, 5)}`, event.lieu_courses]
      .filter(Boolean)
      .join(' · ');
    rows.push({ icon: { lib: 'f', name: 'shopping-cart' }, text: `Courses${parts ? ` : ${parts}` : ' prévues'}` });
  }
  if (event.alcool) rows.push({ icon: { lib: 'i', name: 'beer-outline' }, text: `Déjà là : ${event.alcool}` });
  if (event.jeux_liste) rows.push({ icon: { lib: 'i', name: 'dice-outline' }, text: `Jeux dispo : ${event.jeux_liste}` });
  if (rows.length === 0) return null;
  return (
    <View style={styles.infos}>
      {rows.map((r) => (
        <View key={r.text} style={styles.info}>
          {r.icon.lib === 'f' ? (
            <Feather name={r.icon.name} size={15} color={c.muted} />
          ) : (
            <Ionicons name={r.icon.name} size={15} color={c.muted} />
          )}
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
    const [fv, cv] = await Promise.all([
      hasFood
        ? sb.from('event_food_votes').select('id,event_id,user_id,meal,repas,mange').eq('event_id', event.id)
        : Promise.resolve({ data: [] }),
      hasCourses
        ? sb.from('event_courses_votes').select('id,event_id,user_id,vient').eq('event_id', event.id)
        : Promise.resolve({ data: [] }),
    ]);
    setFood((fv.data ?? []) as EventFoodVote[]);
    setCourses((cv.data ?? []) as EventCoursesVote[]);
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
      <Text style={styles.blockTitle} accessibilityRole="header">
        Repas et organisation
      </Text>
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
                const bg = active ? (val === 'oui' ? c.teal : c.text) : c.deep;
                const fg = active ? (val === 'oui' ? c.tealInk : c.ink) : c.text;
                const count = (val === 'oui' ? yes : no).length;
                const label = val === 'oui' ? poll.yes : poll.no;
                return (
                  <Pressable
                    key={val}
                    onPress={() => vote(poll, val)}
                    accessibilityRole="button"
                    accessibilityLabel={`${label}, ${count}${active ? ', choisi. Toucher pour retirer' : ''}`}
                    accessibilityState={{ selected: active }}
                    style={({ pressed }) => [styles.choice, { backgroundColor: bg }, pressed && { opacity: 0.8 }]}
                  >
                    {active && <Feather name={val === 'oui' ? 'check' : 'x'} size={16} color={fg} />}
                    <Text style={[styles.choiceText, { color: fg }]} numberOfLines={1}>
                      {label} · {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {yes.length + no.length > 0 && (
              <Text style={styles.names}>
                {yes.length > 0 && (
                  <>
                    <Text style={{ color: c.teal, fontFamily: f.bodyBold }}>Oui : </Text>
                    {yes.map((v) => nameOf(v.user_id)).join(', ')}
                  </>
                )}
                {yes.length > 0 && no.length > 0 && '\n'}
                {no.length > 0 && (
                  <>
                    <Text style={{ color: c.coralSoft, fontFamily: f.bodyBold }}>Non : </Text>
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
  infos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  info: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: c.card,
  },
  infoText: { flexShrink: 1, color: c.text, fontFamily: f.body, fontSize: 14, lineHeight: 19, marginTop: -1 },
  block: { padding: 14, borderRadius: theme.radius.card, backgroundColor: c.card },
  blockTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 18, lineHeight: 24, marginBottom: 12 },
  poll: {},
  pollSep: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.hairline },
  pollTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 15, marginBottom: 10 },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  choiceText: { fontFamily: f.bodyBold, fontSize: 14, flexShrink: 1 },
  names: { color: c.muted, fontFamily: f.body, fontSize: 13, lineHeight: 19, marginTop: 10 },
});
