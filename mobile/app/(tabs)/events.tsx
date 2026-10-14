import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CreateSheet } from '@/components/events/CreateSheet';
import { DateSondagesSection, loadOpenSondages, type SondageFull } from '@/components/events/DateSondages';
import { BirthdayBubbles, BirthdaysSheet, EventTicket, FeaturedBadge, FeaturedTicket } from '@/components/events/EventCards';
import { EventDetail } from '@/components/events/EventDetail';
import { EventForm } from '@/components/events/EventForm';
import {
  CATEGORIES,
  daysBetween,
  monthShort,
  nextBirthday,
  tap,
  voteEvent,
  type Birthday,
  type EventCard,
} from '@/components/events/shared';
import { EmptyState, Fab, Pastille, ScreenHeader, SectionTitle } from '@/components/ui/kit';
import { sb, sessionUser, type EventRow, type EventVote, type ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

type Compose =
  | 'new'
  | EventCard
  // Événement créé depuis un sondage de date : le sondage est clos à l'enregistrement
  | { prefill: Partial<EventRow>; sondageId: string }
  | null;

export default function EventsScreen() {
  const [events, setEvents] = useState<EventCard[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [compose, setCompose] = useState<Compose>(null);
  const [sondages, setSondages] = useState<SondageFull[]>([]);
  const [newSondage, setNewSondage] = useState(false);
  const [createSheet, setCreateSheet] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [showBirthdays, setShowBirthdays] = useState(false);
  const voting = useRef(false);
  // Choix fait dans la feuille : ouvert une fois la feuille fermée (iOS refuse d'empiler)
  const pendingCreate = useRef<'event' | 'sondage' | null>(null);
  function flushPendingCreate() {
    const p = pendingCreate.current;
    pendingCreate.current = null;
    if (p === 'event') setCompose('new');
    if (p === 'sondage') setNewSondage(true);
  }
  function pickCreate(kind: 'event' | 'sondage') {
    tap();
    pendingCreate.current = kind;
    setCreateSheet(false);
    if (Platform.OS !== 'ios') setTimeout(flushPendingCreate, 250);
  }
  // Tap sur une notification : « Quelle date ? » → ?sondage=<id>, rappel de la veille → ?event=<id>
  const { sondage: sondageParam, event: eventParam } = useLocalSearchParams<{
    sondage?: string;
    event?: string;
  }>();
  // iOS refuse d'ouvrir une fiche pendant qu'une autre se ferme : le formulaire
  // d'édition attend la fin de la fermeture du détail (onDismiss)
  const pendingEdit = useRef<Compose>(null);
  function flushPendingEdit() {
    if (pendingEdit.current) {
      setCompose(pendingEdit.current);
      pendingEdit.current = null;
    }
  }

  const loadAll = useCallback(async () => {
    const user = await sessionUser();
    setUserId(user?.id ?? null);

    const [eventsRes, allProfilesRes, sondagesRes] = await Promise.all([
      sb.from('events').select('*').order('date_event', { ascending: true }),
      sb.from('profiles').select('id,prenom,nom,pseudo,dob'),
      loadOpenSondages(),
    ]);
    // null = erreur (table absente, réseau) : on garde les sondages déjà affichés
    if (sondagesRes) setSondages(sondagesRes);
    // Sans profils, « Qui vient ? » afficherait des « ? » et personne en attente de réponse
    if (eventsRes.error || allProfilesRes.error) {
      // Sans ça, une erreur réseau ressemble à « aucun événement »
      setLoading(false);
      Alert.alert('Chargement impossible', 'Vérifie ta connexion puis tire vers le bas pour réessayer.');
      return;
    }
    const rows = (eventsRes.data ?? []) as EventRow[];

    const ids = rows.map((r) => r.id);
    const voteRes = ids.length
      ? await sb.from('event_votes').select('id,event_id,user_id,present').in('event_id', ids)
      : { data: [] as (EventVote & { id: string })[] };

    const allProfiles = (allProfilesRes.data ?? []) as (ProfileMini & { dob: string | null })[];
    const pmap: Record<string, ProfileMini> = {};
    allProfiles.forEach((p) => {
      pmap[p.id] = p;
    });
    setProfiles(pmap);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Tous les anniversaires de l'année : les 4 premiers en bulles, le reste dans « Tous »
    const annivs: Birthday[] = allProfiles
      .filter((p) => !!p.dob)
      .map((p) => {
        const nb = nextBirthday(p.dob!);
        if (!nb) return null;
        const days = daysBetween(nb.date, today);
        const age = nb.date.getFullYear() - nb.dob.getFullYear();
        const name = p.pseudo || `${p.prenom ?? ''} ${p.nom ?? ''}`.trim() || '?';
        return {
          id: p.id,
          name,
          monthDay: `${nb.date.getDate()} ${monthShort(nb.date.getMonth())}`,
          daysUntil: days,
          age,
        };
      })
      .filter((x): x is Birthday => !!x)
      .sort((a, b) => a.daysUntil - b.daysUntil);
    setBirthdays(annivs);

    const vmap: Record<string, (EventVote & { id: string })[]> = {};
    (voteRes.data ?? []).forEach((v) => {
      const list = vmap[v.event_id] ?? (vmap[v.event_id] = []);
      list.push(v as EventVote & { id: string });
    });

    const cards: EventCard[] = rows.map((e) => ({
      ...e,
      author: pmap[e.created_by] ?? null,
      votes: vmap[e.id] ?? [],
      isPast: new Date(e.date_event) < today,
    }));
    setEvents(cards);
    setLoading(false);
  }, []);

  useRefreshOnFocus(loadAll);

  // Sondage de la notification absent de la liste (créé après le dernier chargement,
  // rechargement bridé à une fois par minute) : on recharge les sondages, une fois par id
  const fetchedSondage = useRef<string | null>(null);
  useEffect(() => {
    if (typeof sondageParam !== 'string' || loading) return;
    if (sondages.some((s) => s.id === sondageParam) || fetchedSondage.current === sondageParam) return;
    fetchedSondage.current = sondageParam;
    loadOpenSondages().then((res) => {
      if (!res) return;
      setSondages(res);
      if (!res.some((s) => s.id === sondageParam)) {
        Alert.alert('Sondage terminé', 'Ce sondage est clos ou toutes ses dates sont passées.');
      }
    });
  }, [sondageParam, sondages, loading]);

  // Rappel de la veille : ouvre l'événement, puis efface le paramètre pour qu'un
  // nouveau tap sur la même notification le rouvre. Une seule fiche à la fois sur iOS.
  const router = useRouter();
  useEffect(() => {
    if (typeof eventParam !== 'string' || loading) return;
    if (openId || compose || createSheet || newSondage) return;
    if (!events.some((e) => e.id === eventParam)) return;
    setOpenId(eventParam);
    router.setParams({ event: undefined });
  }, [eventParam, events, loading, openId, compose, createSheet, newSondage, router]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }

  // Réponse directe depuis la carte « À la une »
  async function quickVote(e: EventCard, present: 'oui' | 'non') {
    if (!userId || voting.current) return;
    voting.current = true;
    try {
      const error = await voteEvent(e, userId, present);
      if (error) Alert.alert('Erreur', error.message);
      await loadAll();
    } finally {
      voting.current = false;
    }
  }

  const upcoming = useMemo(() => events.filter((e) => !e.isPast), [events]);
  const past = useMemo(() => events.filter((e) => e.isPast).reverse(), [events]);
  const eventDays = useMemo(() => events.filter((e) => !e.isPast).map((e) => e.date_event.slice(0, 10)), [events]);
  const featured = upcoming[0];
  const restUpcoming = upcoming.slice(1);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.teal} />
      </View>
    );
  }

  const openEvent = events.find((e) => e.id === openId) ?? null;
  const me = userId ? profiles[userId] : undefined;
  const myVoteFeatured = featured && userId ? (featured.votes.find((v) => v.user_id === userId)?.present ?? null) : null;

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 104 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} colors={[c.teal]} />}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title="Événements"
          sub={
            upcoming.length === 0
              ? 'Aucun rendez-vous prévu'
              : `${upcoming.length} ${upcoming.length > 1 ? 'rendez-vous prévus' : 'rendez-vous prévu'}`
          }
          right={
            <Pressable
              onPress={() => router.push('/profil')}
              accessibilityRole="button"
              accessibilityLabel="Mon profil"
              hitSlop={4}
              style={({ pressed }) => pressed && { opacity: 0.8 }}
            >
              <Pastille id={userId} name={me?.prenom || me?.pseudo} size={44} />
            </Pressable>
          }
        />

        {!!userId && (
          <DateSondagesSection
            sondages={sondages}
            currentUserId={userId}
            profiles={profiles}
            categories={CATEGORIES}
            onChanged={async () => {
              const res = await loadOpenSondages();
              if (res) setSondages(res);
            }}
            onCreateEvent={(sd, date) => {
              const cat = sd.categorie ?? 'Autre';
              setCompose({
                sondageId: sd.id,
                prefill: {
                  categorie: cat,
                  date_event: date,
                  note: sd.note,
                  raison: cat === 'Autre' ? sd.titre : null,
                },
              });
            }}
            openNew={newSondage}
            // Une seule fiche à la fois sur iOS : on attend que les autres soient fermées
            focusId={typeof sondageParam === 'string' && !openId && !compose && !createSheet && !newSondage ? sondageParam : null}
            onNewClosed={() => setNewSondage(false)}
            eventDays={eventDays}
          />
        )}

        {birthdays.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <BirthdayBubbles
              birthdays={birthdays}
              onOpenAll={() => {
                tap();
                setShowBirthdays(true);
              }}
            />
          </View>
        )}

        {!!featured && (
          <>
            <SectionTitle right={<FeaturedBadge mine={myVoteFeatured} />} style={styles.sectionTitle}>
              À la une
            </SectionTitle>
            <FeaturedTicket
              event={featured}
              currentUserId={userId}
              profiles={profiles}
              onPress={() => {
                tap();
                setOpenId(featured.id);
              }}
              onVote={(v) => quickVote(featured, v)}
            />
          </>
        )}

        {restUpcoming.length > 0 && (
          <>
            <SectionTitle count={restUpcoming.length} style={styles.sectionTitle}>
              Et ensuite
            </SectionTitle>
            {restUpcoming.map((e) => (
              <EventTicket
                key={e.id}
                event={e}
                currentUserId={userId}
                onPress={() => {
                  tap();
                  setOpenId(e.id);
                }}
              />
            ))}
          </>
        )}

        {upcoming.length === 0 && (
          <EmptyState
            icon="calendar"
            title="Aucun événement à venir"
            text="Lance le prochain avec le bouton Créer."
            style={{ paddingVertical: 32 }}
          />
        )}

        {past.length > 0 && (
          <>
            <Pressable
              onPress={() => {
                tap();
                setShowPast((v) => !v);
              }}
              accessibilityRole="button"
              accessibilityState={{ expanded: showPast }}
              accessibilityLabel={`Événements passés, ${past.length}`}
              style={({ pressed }) => [styles.pastToggle, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.pastText}>
                Événements passés <Text style={{ fontFamily: f.body }}>{past.length}</Text>
              </Text>
              <Feather name={showPast ? 'chevron-up' : 'chevron-down'} size={18} color={c.muted} />
            </Pressable>
            {showPast &&
              past.map((e) => (
                <EventTicket
                  key={e.id}
                  event={e}
                  currentUserId={userId}
                  onPress={() => {
                    tap();
                    setOpenId(e.id);
                  }}
                  muted
                />
              ))}
          </>
        )}
      </ScrollView>

      <Fab
        label="Créer"
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          setCreateSheet(true);
        }}
      />

      <CreateSheet
        visible={createSheet}
        onClose={() => setCreateSheet(false)}
        onDismiss={flushPendingCreate}
        onPick={pickCreate}
      />

      <BirthdaysSheet visible={showBirthdays} onClose={() => setShowBirthdays(false)} birthdays={birthdays} />

      <Modal
        visible={!!openEvent}
        animationType="slide"
        presentationStyle="pageSheet"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setOpenId(null)}
        onDismiss={flushPendingEdit}
      >
        {openEvent && userId && (
          <EventDetail
            event={openEvent}
            currentUserId={userId}
            profiles={profiles}
            onClose={() => setOpenId(null)}
            onVoteChange={loadAll}
            onEdit={() => {
              pendingEdit.current = openEvent;
              setOpenId(null);
              // onDismiss n'existe que sur iOS (RN 0.81) : sans ça, « Modifier » ne faisait rien sur Android
              if (Platform.OS !== 'ios') setTimeout(flushPendingEdit, 300);
            }}
            onDeleted={() => {
              setOpenId(null);
              loadAll();
            }}
          />
        )}
      </Modal>
      <Modal
        statusBarTranslucent
        navigationBarTranslucent
        visible={!!compose}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCompose(null)}
      >
        {compose !== null && userId && (
          <EventForm
            eventDays={compose !== 'new' && !('prefill' in compose) ? eventDays.filter((d) => d !== compose.date_event.slice(0, 10)) : eventDays}
            initial={compose === 'new' || 'prefill' in compose ? null : compose}
            prefill={compose !== 'new' && 'prefill' in compose ? compose.prefill : null}
            currentUserId={userId}
            onClose={() => setCompose(null)}
            onSaved={async (eventId) => {
              if (compose !== 'new' && 'sondageId' in compose) {
                const { error } = await sb
                  .from('date_sondages')
                  .update({ closed: true, event_id: eventId })
                  .eq('id', compose.sondageId);
                // Resté ouvert, le sondage proposerait encore « Créer l'événement » : doublon
                if (error) {
                  Alert.alert(
                    'Événement créé',
                    'Mais le sondage n’a pas pu être fermé. Supprime-le depuis sa fiche pour éviter un doublon.',
                  );
                }
              }
              setCompose(null);
              loadAll();
            }}
          />
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.deep },
  sectionTitle: { marginTop: 24, marginBottom: 10, paddingHorizontal: theme.gutter },
  pastToggle: {
    marginTop: 10,
    marginHorizontal: theme.gutter,
    marginBottom: 6,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pastText: { color: c.muted, fontFamily: f.bodyMedium, fontSize: 15 },
});
