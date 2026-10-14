import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  sb,
  type EventComment,
  type EventRow,
  type EventVote,
  type ProfileMini, sessionUser } from '@/lib/supabase';
import {
  DateSondagesSection,
  loadOpenSondages,
  type SondageFull,
} from '@/components/events/DateSondages';
import { EventInfos, EventPolls } from '@/components/events/EventPolls';
import { addToAgenda } from '@/lib/agenda';
import { CalendarPicker, dayLabel } from '@/components/ui/CalendarPicker';
import { getBlocked, ModerationButton } from '@/lib/moderation';
import { KeyboardAware } from '@/lib/keyboard';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

type EventCard = EventRow & {
  author?: ProfileMini | null;
  votes: (EventVote & { id: string })[];
  isPast: boolean;
};

type Compose =
  | 'new'
  | EventCard
  // Événement créé depuis un sondage de date : le sondage est clos à l'enregistrement
  | { prefill: Partial<EventRow>; sondageId: string }
  | null;

type Birthday = {
  id: string;
  name: string;
  monthDay: string;
  daysUntil: number;
  age: number;
};

// Mêmes catégories que le site (+ Restaurant, propre à l'appli)
const CATEGORIES = [
  'Soirée',
  'Anniversaire',
  'Barbecue',
  'Soirée jeux de société',
  'Nouvel an',
  'Olympiade',
  'Barathon',
  'Sport',
  'Féria',
  'Vacances',
  'Restaurant',
  'Autre',
];
const WITH_ALCOOL = ['Olympiade', 'Nouvel an', 'Anniversaire', 'Soirée'];
const WITH_DORMIR = ['Olympiade', 'Nouvel an', 'Anniversaire', 'Soirée'];
const YES_NO_NSP = [
  { v: 'oui', l: 'Oui' },
  { v: 'non', l: 'Non' },
  { v: 'nsp', l: 'Je ne sais pas' },
];

const MONTHS_SHORT = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

function buildEventTitle(e: EventRow): string {
  const cat = e.categorie ?? 'Événement';
  switch (cat) {
    case 'Anniversaire':
      return [
        'Anniversaire',
        e.anniversaire_qui ? `de ${e.anniversaire_qui}` : null,
        e.chez_qui ? `chez ${e.chez_qui}` : null,
      ]
        .filter(Boolean)
        .join(' ');
    case 'Vacances':
      return e.lieu ? `Vacances — ${e.lieu}` : 'Vacances';
    case 'Féria':
      return e.feria_ville ? `Féria de ${e.feria_ville}` : 'Féria';
    case 'Sport':
      return e.sport_type || 'Sport';
    case 'Barathon':
      return e.lieu ? `Barathon — ${e.lieu}` : 'Barathon';
    case 'Autre':
      return e.raison || 'Autre';
    default:
      return e.chez_qui ? `${cat} chez ${e.chez_qui}` : cat;
  }
}

const CHEZ_QUI_REQUIS = ['Olympiade', 'Anniversaire', 'Soirée', 'Barbecue', 'Soirée jeux de société', 'Autre', 'Nouvel an'];

function capFirst(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** '20h30', '20:30', '20:30:00', '20h', '9:05' → 'HH:MM' ; '' → null ; illisible → undefined */
function normalizeTime(raw: string): string | null | undefined {
  const t = raw.trim();
  if (!t) return null;
  const m = /^(\d{1,2})(?:\s*[:hH]\s*(\d{2})?(?::\d{2})?)?$/.exec(t);
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2] ?? '0');
  if (hh > 23 || mm > 59) return undefined;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function nextBirthday(dob: string) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidate = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (candidate < today) candidate.setFullYear(today.getFullYear() + 1);
  return { date: candidate, dob: d };
}

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function tap() {
  Haptics.selectionAsync().catch(() => {});
}

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
  const insets = useSafeAreaInsets();
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
          monthDay: `${nb.date.getDate()} ${MONTHS_SHORT[nb.date.getMonth()]}`,
          daysUntil: days,
          age,
        };
      })
      .filter((x): x is Birthday => !!x)
      .sort((a, b) => a.daysUntil - b.daysUntil)
      .slice(0, 5);
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

  const upcoming = useMemo(() => events.filter((e) => !e.isPast), [events]);
  const past = useMemo(() => events.filter((e) => e.isPast).reverse(), [events]);
  const featured = upcoming[0];
  const restUpcoming = upcoming.slice(1);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={theme.colors.teal} />
      </SafeAreaView>
    );
  }

  const openEvent = events.find((e) => e.id === openId) ?? null;

  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: theme.s(24) }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.teal} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroBlock}>
          <Text style={styles.heroLabel}>Les Artistes</Text>
          <Text style={styles.heroTitle}>Événements</Text>
          <Text style={styles.heroSub}>
            {upcoming.length === 0
              ? 'Aucun événement à venir pour le moment.'
              : `${upcoming.length} ${upcoming.length > 1 ? 'rendez-vous prévus' : 'rendez-vous prévu'}.`}
          </Text>
        </View>

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
            focusId={
              typeof sondageParam === 'string' && !openId && !compose && !createSheet && !newSondage
                ? sondageParam
                : null
            }
            onNewClosed={() => setNewSondage(false)}
          />
        )}

        {birthdays.length > 0 && (
          <View style={styles.section}>
            <SectionHeader label="Prochains anniversaires" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.birthdayScroll}
            >
              {birthdays.slice(0, 4).map((b) => (
                <BirthdayCard key={b.id} birthday={b} />
              ))}
            </ScrollView>
          </View>
        )}

        {!!featured && (
          <View style={styles.section}>
            <SectionHeader label="À la une" />
            <FeaturedEventCard
              event={featured}
              currentUserId={userId}
              profiles={profiles}
              onPress={() => {
                tap();
                setOpenId(featured.id);
              }}
            />
          </View>
        )}

        {restUpcoming.length > 0 && (
          <View style={styles.section}>
            <SectionHeader label={`Et ensuite (${restUpcoming.length})`} />
            {restUpcoming.map((e) => (
              <EventCardView
                key={e.id}
                event={e}
                currentUserId={userId}
                profiles={profiles}
                onPress={() => {
                  tap();
                  setOpenId(e.id);
                }}
              />
            ))}
          </View>
        )}

        {upcoming.length === 0 && (
          <View style={styles.emptyHero}>
            <Ionicons name="calendar-outline" size={40} color={theme.colors.muted} />
            <Text style={styles.emptyHeroText}>Aucun événement à venir.</Text>
            <Text style={styles.emptyHeroSub}>Crée le premier en tapant sur le bouton +</Text>
          </View>
        )}

        {past.length > 0 && (
          <View style={styles.section}>
            <SectionHeader label={`Passés (${past.length})`} />
            {past.map((e) => (
              <EventCardView
                key={e.id}
                event={e}
                currentUserId={userId}
                profiles={profiles}
                onPress={() => {
                  tap();
                  setOpenId(e.id);
                }}
                muted
              />
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          setCreateSheet(true);
        }}
        style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.92 }] }]}
      >
        <Ionicons name="add" size={30} color="#fff" />
      </Pressable>

      <Modal
        visible={createSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setCreateSheet(false)}
        onDismiss={flushPendingCreate}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setCreateSheet(false)}>
          {/* Le toucher sur la feuille ne doit pas la fermer */}
          <Pressable style={[styles.sheet, { paddingBottom: theme.s(5) + insets.bottom }]} onPress={() => {}}>
            <View style={styles.sheetGrip} />
            <Text style={styles.sheetTitle}>Créer</Text>
            <CreateOption
              icon="calendar"
              color={theme.colors.coral}
              title="Un événement"
              sub="La date est fixée : chacun dit s’il vient"
              onPress={() => pickCreate('event')}
            />
            <CreateOption
              icon="calendar-number"
              color={theme.colors.yellow}
              title="Un sondage de date"
              sub="Tu proposes des dates, le groupe dit quand il est dispo"
              onPress={() => pickCreate('sondage')}
            />
            <Pressable onPress={() => setCreateSheet(false)} style={styles.sheetCancel}>
              <Text style={styles.sheetCancelText}>Annuler</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={!!openEvent}
        animationType="slide"
        presentationStyle="pageSheet"
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
        visible={!!compose}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCompose(null)}
      >
        {compose !== null && userId && (
          <EventForm
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
    </SafeAreaView>
  );
}

function profileName(p: ProfileMini | undefined) {
  if (!p) return '?';
  return p.pseudo || `${p.prenom ?? ''} ${p.nom ?? ''}`.trim() || '?';
}

// « Marie, Paul, Léa +4 » : les premiers noms, le reste en nombre
function namesPreview(names: string[], max = 3) {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

function CreateOption({
  icon,
  color,
  title,
  sub,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.createOption, pressed && { backgroundColor: theme.colors.surface2 }]}
    >
      <View style={[styles.createIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={22} color={theme.colors.deep} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.createTitle}>{title}</Text>
        <Text style={styles.createSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
    </Pressable>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeaderRow}>
      <View style={styles.sectionAccent} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function BirthdayCard({ birthday }: { birthday: Birthday }) {
  const when =
    birthday.daysUntil === 0
      ? "Aujourd'hui"
      : birthday.daysUntil === 1
        ? 'Demain'
        : `Dans ${birthday.daysUntil} jours`;
  const accent =
    birthday.daysUntil === 0
      ? theme.colors.coral
      : birthday.daysUntil <= 7
        ? theme.colors.yellow
        : theme.colors.teal;
  return (
    <View style={[styles.birthdayCard, { borderColor: accent }]}>
      <View style={[styles.birthdayIcon, { backgroundColor: accent }]}>
        <Ionicons name="gift" size={18} color={theme.colors.deep} />
      </View>
      <Text style={styles.birthdayName} numberOfLines={1}>
        {birthday.name}
      </Text>
      <Text style={[styles.birthdayWhen, { color: accent }]}>{when}</Text>
      <Text style={styles.birthdayDate}>
        {birthday.monthDay} · {birthday.age} ans
      </Text>
    </View>
  );
}

function FeaturedEventCard({
  event,
  currentUserId,
  profiles,
  onPress,
}: {
  event: EventCard;
  currentUserId: string | null;
  profiles: Record<string, ProfileMini>;
  onPress: () => void;
}) {
  const presentNames = event.votes
    .filter((v) => v.present === 'oui')
    .map((v) => profileName(profiles[v.user_id]));
  const presents = presentNames.length;
  const absents = event.votes.filter((v) => v.present === 'non').length;
  const date = new Date(event.date_event);
  const title = buildEventTitle(event);
  const myVote = currentUserId ? event.votes.find((v) => v.user_id === currentUserId) : undefined;
  const myColor =
    myVote?.present === 'oui'
      ? theme.colors.teal
      : myVote?.present === 'non'
        ? theme.colors.coral
        : null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.featured,
        myColor && { borderColor: myColor, borderWidth: 1.5 },
        pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
      ]}
    >
      <View style={styles.featuredHeader}>
        <View style={styles.featuredDateBox}>
          <Text style={styles.featuredDay}>{date.getDate()}</Text>
          <Text style={styles.featuredMonth}>{MONTHS_SHORT[date.getMonth()].toUpperCase()}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexShrink: 1 }}>
          {!!myVote && (
            <View
              style={[
                styles.myVotePill,
                myVote.present === 'oui' ? styles.myVotePillPresent : styles.myVotePillAbsent,
              ]}
            >
              <Ionicons
                name={myVote.present === 'oui' ? 'checkmark-circle' : 'close-circle'}
                size={14}
                color="#fff"
              />
              <Text style={styles.myVotePillText}>
                {myVote.present === 'oui' ? 'Tu y vas' : 'Tu n’y vas pas'}
              </Text>
            </View>
          )}
          {!!event.categorie && (
            <View style={styles.catPill}>
              <Text style={styles.catPillText}>{event.categorie}</Text>
            </View>
          )}
        </View>
      </View>
      <Text style={styles.featuredTitle}>{title}</Text>
      {(event.lieu || event.heure) && (
        <View style={styles.featuredMetaRow}>
          {!!event.heure && (
            <>
              <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
              <Text style={styles.featuredMetaText}>{event.heure}</Text>
            </>
          )}
          {event.heure && event.lieu && <Text style={styles.featuredMetaText}> · </Text>}
          {!!event.lieu && (
            <>
              <Ionicons name="location-outline" size={14} color={theme.colors.muted} />
              <Text style={styles.featuredMetaText}>{event.lieu}</Text>
            </>
          )}
        </View>
      )}
      {!!event.note && (
        <Text style={styles.featuredDesc} numberOfLines={2}>
          {event.note}
        </Text>
      )}
      <View style={styles.featuredFooter}>
        <View style={styles.statPill}>
          <View style={[styles.statDot, { backgroundColor: theme.colors.teal }]} />
          <Text style={styles.statText}>{presents} oui</Text>
        </View>
        <View style={styles.statPill}>
          <View style={[styles.statDot, { backgroundColor: theme.colors.coral }]} />
          <Text style={styles.statText}>{absents} non</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
      </View>
      {presents > 0 && (
        <Text style={styles.featuredNames} numberOfLines={1}>
          {namesPreview(presentNames, 4)}
        </Text>
      )}
    </Pressable>
  );
}

function EventCardView({
  event,
  currentUserId,
  profiles,
  onPress,
  muted,
}: {
  event: EventCard;
  currentUserId: string | null;
  profiles: Record<string, ProfileMini>;
  onPress: () => void;
  muted?: boolean;
}) {
  const presentNames = event.votes
    .filter((v) => v.present === 'oui')
    .map((v) => profileName(profiles[v.user_id]));
  const presents = presentNames.length;
  const date = new Date(event.date_event);
  const title = buildEventTitle(event);
  const myVote = currentUserId ? event.votes.find((v) => v.user_id === currentUserId) : undefined;
  const myColor =
    myVote?.present === 'oui'
      ? theme.colors.teal
      : myVote?.present === 'non'
        ? theme.colors.coral
        : null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        muted && styles.cardMuted,
        myColor && { borderLeftColor: myColor, borderLeftWidth: 3 },
        pressed && { backgroundColor: theme.colors.surface2 },
      ]}
    >
      <View style={styles.dateBox}>
        <Text style={styles.dateDay}>{date.getDate()}</Text>
        <Text style={styles.dateMonth}>{MONTHS_SHORT[date.getMonth()].toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, muted && { color: theme.colors.muted }]} numberOfLines={1}>
          {title}
        </Text>
        {!!event.lieu && (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={12} color={theme.colors.muted} />
            <Text style={styles.metaText} numberOfLines={1}>
              {event.lieu}
            </Text>
          </View>
        )}
        <View style={styles.metaRow}>
          <Ionicons name="people-outline" size={12} color={theme.colors.muted} />
          <Text style={styles.metaText} numberOfLines={1}>
            {presents === 0
              ? '0 présent·e'
              : `${presents} présent·e${presents > 1 ? 's' : ''} : ${namesPreview(presentNames)}`}
          </Text>
        </View>
      </View>
      {myVote ? (
        <View
          style={[
            styles.voteBadge,
            myVote.present === 'oui' ? styles.voteBadgePresent : styles.voteBadgeAbsent,
          ]}
        >
          <Ionicons
            name={myVote.present === 'oui' ? 'checkmark' : 'close'}
            size={16}
            color="#fff"
          />
        </View>
      ) : (
        <Ionicons name="chevron-forward" color={theme.colors.muted} size={18} />
      )}
    </Pressable>
  );
}

function EventDetail({
  event,
  currentUserId,
  profiles,
  onClose,
  onVoteChange,
  onEdit,
  onDeleted,
}: {
  event: EventCard;
  currentUserId: string;
  profiles: Record<string, ProfileMini>;
  onClose: () => void;
  onVoteChange: () => void | Promise<void>;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const [comments, setComments] = useState<EventComment[]>([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const voting = useRef(false);
  const [showAttendees, setShowAttendees] = useState(false);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const myVote = event.votes.find((v) => v.user_id === currentUserId);
  const isOwner = event.created_by === currentUserId;
  const title = buildEventTitle(event);

  const loadComments = useCallback(async () => {
    const [{ data }, blocked] = await Promise.all([
      sb
        .from('event_comments')
        .select('*')
        .eq('event_id', event.id)
        .order('created_at', { ascending: true }),
      getBlocked(),
    ]);
    setBlockedIds(blocked);
    setComments(((data as EventComment[] | null) ?? []).filter((c) => !blocked.has(c.user_id)));
  }, [event.id]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  async function setVote(present: 'oui' | 'non' | null) {
    // Un double appui insérait deux votes : on bloque jusqu'au rechargement
    if (voting.current) return;
    voting.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    try {
      let res: { error: { message: string } | null } = { error: null };
      if (myVote && (present === null || myVote.present === present)) {
        res = await sb.from('event_votes').delete().eq('id', myVote.id);
      } else if (myVote) {
        res = await sb.from('event_votes').update({ present }).eq('id', myVote.id);
      } else if (present !== null) {
        res = await sb.from('event_votes').insert({
          event_id: event.id,
          user_id: currentUserId,
          present,
        });
      }
      if (res.error) Alert.alert('Erreur', res.error.message);
      await onVoteChange();
    } finally {
      voting.current = false;
    }
  }

  async function postComment() {
    const t = text.trim();
    if (!t) return;
    setPosting(true);
    const { error } = await sb.from('event_comments').insert({
      event_id: event.id,
      user_id: currentUserId,
      contenu: t,
    });
    setPosting(false);
    if (error) {
      Alert.alert('Erreur', error.message);
      return;
    }
    setText('');
    loadComments();
  }

  function deleteEvent() {
    Alert.alert(
      'Supprimer cet événement ?',
      'Tous les commentaires et votes seront aussi supprimés.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            await sb.from('event_comments').delete().eq('event_id', event.id);
            await sb.from('event_votes').delete().eq('event_id', event.id);
            await sb.from('event_food_votes').delete().eq('event_id', event.id);
            try {
              await sb.from('event_courses_votes').delete().eq('event_id', event.id);
            } catch {}
            const { error } = await sb.from('events').delete().eq('id', event.id);
            if (error) {
              Alert.alert('Suppression impossible', error.message);
              return;
            }
            onDeleted();
          },
        },
      ],
    );
  }

  function nameOf(uid: string) {
    return profileName(profiles[uid]);
  }

  const presents = event.votes.filter((v) => v.present === 'oui');
  const absents = event.votes.filter((v) => v.present === 'non');
  const sortNames = (names: string[]) => names.sort((a, b) => a.localeCompare(b, 'fr'));
  const voterIds = new Set(event.votes.map((v) => v.user_id));
  const attendeeGroups = [
    { label: 'Présent·e·s', color: theme.colors.teal, names: sortNames(presents.map((v) => nameOf(v.user_id))) },
    { label: 'Absent·e·s', color: theme.colors.coral, names: sortNames(absents.map((v) => nameOf(v.user_id))) },
    {
      label: 'Pas encore répondu',
      color: theme.colors.muted,
      names: sortNames(
        Object.keys(profiles)
          .filter((id) => !voterIds.has(id) && !blockedIds.has(id))
          .map(nameOf),
      ),
    },
  ];

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.detailHeader}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.detailHeaderBtn}>
          <Ionicons name="close" size={26} color={theme.colors.text} />
        </Pressable>
        {!!isOwner && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={onEdit} hitSlop={10} style={styles.detailHeaderBtn}>
              <Ionicons name="create-outline" size={22} color={theme.colors.text} />
            </Pressable>
            <Pressable onPress={deleteEvent} hitSlop={10} style={styles.detailHeaderBtn}>
              <Ionicons name="trash-outline" size={22} color={theme.colors.danger} />
            </Pressable>
          </View>
        )}
      </View>
      <KeyboardAware>
        <ScrollView contentContainerStyle={{ padding: theme.s(5) }}>
          {!!event.categorie && (
            <View style={[styles.catPill, { alignSelf: 'flex-start' }]}>
              <Text style={styles.catPillText}>{event.categorie}</Text>
            </View>
          )}
          <Text style={styles.detailTitle}>{title}</Text>
          <View style={styles.detailMetaRow}>
            <Ionicons name="calendar-outline" size={14} color={theme.colors.muted} />
            <Text style={styles.detailMetaText}>
              {new Date(event.date_event).toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              {event.heure ? ` · ${event.heure}` : ''}
            </Text>
          </View>
          {!!event.lieu && (
            <View style={styles.detailMetaRow}>
              <Ionicons name="location-outline" size={14} color={theme.colors.muted} />
              <Text style={styles.detailMetaText}>{event.lieu}</Text>
            </View>
          )}
          {!!event.chez_qui && (
            <View style={styles.detailMetaRow}>
              <Ionicons name="home-outline" size={14} color={theme.colors.muted} />
              <Text style={styles.detailMetaText}>chez {event.chez_qui}</Text>
            </View>
          )}
          {!event.isPast && (
            <Pressable
              onPress={() => {
                tap();
                addToAgenda(event, title, currentUserId);
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.agendaBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="calendar-number-outline" size={16} color={theme.colors.teal} />
              <Text style={styles.agendaText}>Ajouter à mon agenda</Text>
            </Pressable>
          )}
          {!!event.note && <Text style={styles.detailDescription}>{event.note}</Text>}
          <EventInfos event={event} />

          <Text style={styles.detailSection}>Tu seras là ?</Text>
          <View style={styles.voteRow}>
            <VoteChoice
              label="Présent"
              icon="checkmark-circle"
              tone={theme.colors.teal}
              active={myVote?.present === 'oui'}
              onPress={() => setVote('oui')}
            />
            <VoteChoice
              label="Absent"
              icon="close-circle"
              tone={theme.colors.coral}
              active={myVote?.present === 'non'}
              onPress={() => setVote('non')}
            />
          </View>
          {!!myVote && (
            <Pressable onPress={() => setVote(null)} style={styles.cancelVote} hitSlop={6}>
              <Ionicons name="refresh-outline" size={14} color={theme.colors.muted} />
              <Text style={styles.cancelVoteText}>Retirer mon vote</Text>
            </Pressable>
          )}

          <Pressable
              onPress={() => setShowAttendees(true)}
              accessibilityRole="button"
              accessibilityLabel="Voir qui vient"
              style={({ pressed }) => [styles.attendeesBox, pressed && { opacity: 0.8 }]}
            >
              {presents.length === 0 && absents.length === 0 && (
                <Text style={styles.attendeesNames}>Personne n’a encore répondu.</Text>
              )}
              {presents.length > 0 && (
                <View style={styles.attendeesGroup}>
                  <Text style={styles.attendeesLabel}>{presents.length} présent·e·s</Text>
                  <Text style={styles.attendeesNames} numberOfLines={2}>
                    {presents.map((v) => nameOf(v.user_id)).join(' · ')}
                  </Text>
                </View>
              )}
              {absents.length > 0 && (
                <View style={styles.attendeesGroup}>
                  <Text style={[styles.attendeesLabel, { color: theme.colors.coral }]}>
                    {absents.length} absent·e·s
                  </Text>
                  <Text style={styles.attendeesNames} numberOfLines={2}>
                    {absents.map((v) => nameOf(v.user_id)).join(' · ')}
                  </Text>
                </View>
              )}
              <View style={styles.attendeesMore}>
                <Text style={styles.attendeesMoreText}>Voir tout le monde</Text>
                <Ionicons name="chevron-forward" size={14} color={theme.colors.teal} />
              </View>
            </Pressable>

          <EventPolls event={event} currentUserId={currentUserId} nameOf={nameOf} />

          <Text style={styles.detailSection}>Commentaires ({comments.length})</Text>
          {comments.length === 0 && (
            <Text style={styles.emptyText}>Personne n&apos;a encore commenté.</Text>
          )}
          {comments.map((c) => (
            <View key={c.id} style={styles.comment}>
              <View style={styles.commentHead}>
                <Text style={styles.commentAuthor}>{nameOf(c.user_id)}</Text>
                <ModerationButton
                  kind="event_comment"
                  itemId={c.id}
                  authorId={c.user_id}
                  authorName={nameOf(c.user_id)}
                  excerpt={c.contenu}
                  currentUserId={currentUserId}
                  onBlocked={() => setComments((prev) => prev.filter((x) => x.user_id !== c.user_id))}
                />
              </View>
              <Text style={styles.commentText}>{c.contenu}</Text>
            </View>
          ))}
        </ScrollView>
        <View style={styles.commentInputRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Écrire un commentaire…"
            placeholderTextColor={theme.colors.muted}
            style={styles.commentInput}
            multiline
          />
          <Pressable
            onPress={postComment}
            disabled={posting || !text.trim()}
            style={({ pressed }) => [
              styles.sendBtn,
              (pressed || posting || !text.trim()) && { opacity: 0.5 },
            ]}
          >
            {posting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      </KeyboardAware>
      <Modal
        visible={showAttendees}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAttendees(false)}
      >
        <SafeAreaView style={styles.flex}>
          <View style={styles.modalHeader}>
            <Pressable
              onPress={() => setShowAttendees(false)}
              hitSlop={10}
              style={styles.detailHeaderBtn}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
            >
              <Ionicons name="close" size={26} color={theme.colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>Qui vient ?</Text>
            <View style={{ width: 32 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: theme.s(5) }}>
            {attendeeGroups.map((g) => (
              <View key={g.label} style={{ marginBottom: theme.s(5) }}>
                <Text style={[styles.attendeesLabel, { color: g.color }]}>
                  {g.label} ({g.names.length})
                </Text>
                {g.names.length === 0 ? (
                  <Text style={styles.emptyText}>Personne</Text>
                ) : (
                  g.names.map((n, i) => (
                    <Text key={`${n}-${i}`} style={styles.attendeeRow}>
                      {n}
                    </Text>
                  ))
                )}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

export function EventForm({
  initial,
  prefill,
  currentUserId,
  onClose,
  onSaved,
}: {
  initial: EventCard | null;
  /** Création pré-remplie (ex. depuis un sondage de date) */
  prefill?: Partial<EventRow> | null;
  currentUserId: string;
  onClose: () => void;
  onSaved: (eventId: string | null) => void;
}) {
  const isEdit = !!initial;
  const init: Partial<EventRow> = initial ?? prefill ?? {};
  const [categorie, setCategorie] = useState(init.categorie ?? CATEGORIES[0]);
  // date_event peut revenir en timestamp : on garde AAAA-MM-JJ
  const [date, setDate] = useState((init.date_event ?? '').slice(0, 10));
  const [calendarOpen, setCalendarOpen] = useState(!init.date_event);
  const [heure, setHeure] = useState(init.heure ?? '');
  const [lieu, setLieu] = useState(init.lieu ?? '');
  const [chezQui, setChezQui] = useState(init.chez_qui ?? '');
  const [annivQui, setAnnivQui] = useState(init.anniversaire_qui ?? '');
  const [feriaVille, setFeriaVille] = useState(init.feria_ville ?? '');
  const [sportType, setSportType] = useState(init.sport_type ?? '');
  const [raison, setRaison] = useState(init.raison ?? '');
  const [note, setNote] = useState(init.note ?? '');
  // Champs du site qui déclenchent les sondages repas / courses
  const [manger, setManger] = useState(init.manger ?? 'nsp');
  const [mangerSoir, setMangerSoir] = useState(init.manger_soir ?? 'nsp');
  const [courses, setCourses] = useState(init.courses ?? 'non');
  const [heureCourses, setHeureCourses] = useState(init.heure_courses ?? '');
  const [lieuCourses, setLieuCourses] = useState(init.lieu_courses ?? '');
  const [dormir, setDormir] = useState(init.dormir ?? 'nsp');
  const [alcool, setAlcool] = useState(init.alcool ?? '');
  const [jeuxListe, setJeuxListe] = useState(init.jeux_liste ?? '');
  const [budget, setBudget] = useState(init.budget ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!date) {
      Alert.alert('Date requise', 'Choisis le jour dans le calendrier.');
      setCalendarOpen(true);
      return;
    }
    // Mêmes champs obligatoires que le site, sinon il refuse ensuite d'enregistrer une modification
    if (CHEZ_QUI_REQUIS.includes(categorie) && !chezQui.trim()) {
      Alert.alert('Champ requis', 'Indique chez qui ça se passe.');
      return;
    }
    if (categorie === 'Sport' && !sportType.trim()) {
      Alert.alert('Champ requis', 'Indique le sport.');
      return;
    }
    if (categorie === 'Anniversaire' && !annivQui.trim()) {
      Alert.alert('Champ requis', 'Indique de qui c’est l’anniversaire.');
      return;
    }
    // Le site lit ces heures avec un champ <input type="time"> : HH:MM uniquement
    // Une heure déjà en base et non retouchée passe telle quelle (anciennes saisies libres)
    const h = heure === (init.heure ?? '') && heure ? heure : normalizeTime(heure);
    const hc =
      heureCourses === (init.heure_courses ?? '') && heureCourses ? heureCourses : normalizeTime(heureCourses);
    if (h === undefined || (categorie === 'Barbecue' && courses === 'oui' && hc === undefined)) {
      Alert.alert('Format heure', 'Écris l’heure comme 20:30 ou 20h30.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        categorie,
        date_event: date,
        heure: h,
        lieu: lieu.trim() || null,
        chez_qui: chezQui.trim() || null,
        anniversaire_qui: annivQui.trim() || null,
        feria_ville: feriaVille.trim() || null,
        sport_type: sportType.trim() || null,
        raison: raison.trim() || null,
        note: note.trim() || null,
        // Comme le site : un champ hors de la catégorie choisie est remis à null
        manger:
          categorie === 'Soirée jeux de société'
            ? manger === 'oui'
              ? 'oui'
              : 'non'
            : ['Anniversaire', 'Soirée'].includes(categorie)
              ? manger
              : null,
        manger_soir: categorie === 'Nouvel an' ? mangerSoir : null,
        courses: categorie === 'Barbecue' ? courses : null,
        heure_courses: categorie === 'Barbecue' && courses === 'oui' ? (hc ?? null) : null,
        lieu_courses: categorie === 'Barbecue' && courses === 'oui' ? lieuCourses.trim() || null : null,
        dormir: WITH_DORMIR.includes(categorie) ? dormir : null,
        alcool: WITH_ALCOOL.includes(categorie) ? alcool.trim() || null : null,
        jeux_liste: categorie === 'Soirée jeux de société' ? jeuxListe.trim() || null : null,
        budget: categorie === 'Vacances' ? budget.trim() || null : null,
      };
      if (isEdit) {
        const r = await sb.from('events').update(payload).eq('id', initial!.id);
        if (r.error) throw r.error;
        onSaved(initial!.id);
      } else {
        const r = await sb
          .from('events')
          .insert({ ...payload, created_by: currentUserId })
          .select('id')
          .single();
        if (r.error) throw r.error;
        onSaved((r.data as { id: string } | null)?.id ?? null);
      }
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.modalHeader}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.detailHeaderBtn}>
          <Ionicons name="close" size={26} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.modalTitle}>{isEdit ? 'Modifier' : 'Nouvel événement'}</Text>
        <View style={{ width: 32 }} />
      </View>
      <KeyboardAware>
        <ScrollView
          contentContainerStyle={{ padding: theme.s(5) }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Catégorie</Text>
          <View style={styles.catRow}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c}
                onPress={() => {
                  tap();
                  // « Oui » ne veut pas dire la même chose d'une catégorie à l'autre
                  // (manger avant / manger ensemble) : on repart de « je ne sais pas »
                  if (c !== categorie) setManger(c === 'Soirée jeux de société' ? 'non' : 'nsp');
                  setCategorie(c);
                }}
                style={[styles.catChip, categorie === c && styles.catChipActive]}
              >
                <Text style={[styles.catChipText, categorie === c && styles.catChipTextActive]}>
                  {c}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Date</Text>
          <Pressable
            onPress={() => {
              tap();
              setCalendarOpen((o) => !o);
            }}
            accessibilityRole="button"
            style={[styles.input, styles.dateField, calendarOpen && { borderColor: theme.colors.coral }]}
          >
            <Ionicons name="calendar-outline" size={18} color={date ? theme.colors.text : theme.colors.muted} />
            <Text style={[styles.dateFieldText, !date && { color: 'rgba(255,255,255,0.3)' }]}>
              {date ? capFirst(dayLabel(date, true)) : 'Choisir le jour'}
            </Text>
            <Ionicons name={calendarOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.colors.muted} />
          </Pressable>
          {calendarOpen && (
            <View style={{ marginBottom: theme.s(4) }}>
              <CalendarPicker
                selected={date ? [date] : []}
                onToggle={(d) => {
                  setDate(d);
                  setCalendarOpen(false);
                }}
              />
            </View>
          )}
          <FormField
            label="Heure"
            value={heure}
            onChangeText={setHeure}
            placeholder="20h30"
            autoCapitalize="none"
          />

          {categorie === 'Anniversaire' && (
            <FormField
              label="Qui fête son anniversaire ?"
              value={annivQui}
              onChangeText={setAnnivQui}
              placeholder="Marie"
            />
          )}
          {categorie === 'Féria' && (
            <FormField
              label="Ville de la Féria"
              value={feriaVille}
              onChangeText={setFeriaVille}
              placeholder="Bayonne"
            />
          )}
          {categorie === 'Sport' && (
            <FormField
              label="Sport"
              value={sportType}
              onChangeText={setSportType}
              placeholder="Tennis, foot…"
            />
          )}
          {categorie === 'Autre' && (
            <FormField
              label="Raison"
              value={raison}
              onChangeText={setRaison}
              placeholder="Pourquoi se retrouve-t-on ?"
            />
          )}

          {(categorie === 'Anniversaire' || categorie === 'Soirée') && (
            <ChoiceField
              label="Faut-il manger avant ?"
              hint={manger === 'non' ? 'Sondage « Qui mange ensemble » ajouté' : undefined}
              value={manger}
              onChange={setManger}
              options={[
                { v: 'oui', l: 'Oui' },
                { v: 'non', l: 'On mange là-bas' },
                { v: 'nsp', l: 'Je ne sais pas' },
              ]}
            />
          )}
          {categorie === 'Soirée jeux de société' && (
            <>
              <ChoiceField
                label="On mange ensemble ?"
                hint={manger === 'oui' ? 'Sondage « Qui mange ensemble » ajouté' : undefined}
                value={manger === 'oui' ? 'oui' : 'non'}
                onChange={setManger}
                options={[
                  { v: 'oui', l: 'Oui' },
                  { v: 'non', l: 'Non' },
                ]}
              />
              <FormField
                label="Jeux déjà sur place"
                value={jeuxListe}
                onChangeText={setJeuxListe}
                placeholder="Catan, Uno, Codenames…"
              />
            </>
          )}
          {categorie === 'Nouvel an' && (
            <ChoiceField
              label="On mange ensemble le soir ?"
              hint={mangerSoir === 'oui' ? 'Sondage « Qui mange le soir » ajouté' : undefined}
              value={mangerSoir}
              onChange={setMangerSoir}
              options={[
                { v: 'oui', l: 'Oui, ensemble' },
                { v: 'non', l: 'Non, mangez avant' },
                { v: 'nsp', l: 'Je ne sais pas' },
              ]}
            />
          )}
          {categorie === 'Olympiade' && (
            <Text style={styles.formHint}>Sondages « Qui mange le midi » et « le soir » ajoutés.</Text>
          )}
          {categorie === 'Barathon' && (
            <Text style={styles.formHint}>Sondages « Présent vendredi » et « samedi » ajoutés.</Text>
          )}
          {categorie === 'Barbecue' && (
            <>
              <ChoiceField
                label="Besoin d’aller faire les courses ?"
                hint="Sondage « Qui mange au barbecue » ajouté"
                value={courses === 'oui' ? 'oui' : 'non'}
                onChange={setCourses}
                options={[
                  { v: 'oui', l: 'Oui' },
                  { v: 'non', l: 'Non' },
                ]}
              />
              {courses === 'oui' && (
                <>
                  <FormField
                    label="Heure des courses"
                    value={heureCourses}
                    onChangeText={setHeureCourses}
                    placeholder="15:00"
                    autoCapitalize="none"
                  />
                  <FormField
                    label="Magasin"
                    value={lieuCourses}
                    onChangeText={setLieuCourses}
                    placeholder="Leclerc, Intermarché…"
                  />
                </>
              )}
            </>
          )}
          {WITH_DORMIR.includes(categorie) && (
            <ChoiceField label="Peut-on dormir sur place ?" value={dormir} onChange={setDormir} options={YES_NO_NSP} />
          )}
          {WITH_ALCOOL.includes(categorie) && (
            <FormField
              label="Alcool déjà sur place (optionnel)"
              value={alcool}
              onChangeText={setAlcool}
              placeholder="6 bières, 1 bouteille de rhum…"
            />
          )}
          {categorie === 'Vacances' && (
            <FormField label="Budget à prévoir" value={budget} onChangeText={setBudget} placeholder="~300 € / personne" />
          )}

          <FormField label="Lieu" value={lieu} onChangeText={setLieu} placeholder="Adresse, ville" />
          <FormField
            label={CHEZ_QUI_REQUIS.includes(categorie) ? 'Chez qui ?' : 'Chez qui ? (optionnel)'}
            value={chezQui}
            onChangeText={setChezQui}
            placeholder="Marie"
          />
          <FormField
            label="Note"
            value={note}
            onChangeText={setNote}
            placeholder="Ce qu'il faut savoir, le thème, l'ambiance…"
            multiline
            style={{ minHeight: 100, textAlignVertical: 'top' }}
          />
          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [styles.saveBtn, (pressed || saving) && { opacity: 0.7 }]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveText}>{isEdit ? 'Enregistrer' : 'Créer l’événement'}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAware>
    </SafeAreaView>
  );
}

function VoteChoice({
  label,
  icon,
  tone,
  active,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.voteChoice,
        active && { backgroundColor: tone, borderColor: tone },
        !active && { borderColor: tone + '55' },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <Ionicons name={icon} size={20} color={active ? theme.colors.deep : tone} />
      <Text style={[styles.voteChoiceText, { color: active ? theme.colors.deep : tone }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ChoiceField({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <View style={{ marginBottom: theme.s(4) }}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.catRow, { marginBottom: 0 }]}>
        {options.map((o) => (
          <Pressable
            key={o.v}
            onPress={() => {
              tap();
              onChange(o.v);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === o.v }}
            style={[styles.catChip, value === o.v && styles.catChipActive]}
          >
            <Text style={[styles.catChipText, value === o.v && styles.catChipTextActive]}>{o.l}</Text>
          </Pressable>
        ))}
      </View>
      {!!hint && <Text style={[styles.formHint, { marginTop: 8, marginBottom: 0 }]}>{hint}</Text>}
    </View>
  );
}

function FormField(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: theme.s(4) }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="rgba(255,255,255,0.3)"
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.deep },

  heroBlock: { paddingHorizontal: theme.s(5), paddingTop: theme.s(6), paddingBottom: theme.s(2) },
  heroLabel: {
    color: theme.colors.coral,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1,
  },
  heroSub: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 14, marginTop: 6 },

  section: { marginTop: theme.s(7), paddingHorizontal: theme.s(5) },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: theme.s(3) },
  sectionAccent: { width: 18, height: 2, backgroundColor: theme.colors.coral, borderRadius: 1 },
  sectionLabel: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  birthdayScroll: { paddingRight: theme.s(5), gap: 10 },
  birthdayCard: {
    width: 168,
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    padding: theme.s(3),
  },
  birthdayIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.s(2),
  },
  birthdayName: { color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 15, marginBottom: 2 },
  birthdayWhen: { fontFamily: theme.fonts.bodyBold, fontSize: 13, marginTop: 4 },
  birthdayDate: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 12, marginTop: 2 },

  featured: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.s(5),
  },
  featuredHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.s(3),
  },
  featuredDateBox: {
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
  },
  featuredDay: { color: '#fff', fontFamily: theme.fonts.serifBlack, fontSize: 24, lineHeight: 26 },
  featuredMonth: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 10, letterSpacing: 1 },

  catPill: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  catPillText: { color: theme.colors.muted, fontFamily: theme.fonts.bodyBold, fontSize: 11, letterSpacing: 0.5 },
  myVotePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  myVotePillPresent: {
    backgroundColor: '#0fb3a6',
  },
  myVotePillAbsent: {
    backgroundColor: '#e84a4a',
  },
  myVotePillText: {
    color: '#fff',
    fontFamily: theme.fonts.bodyBold,
    fontSize: 11.5,
    letterSpacing: 0.3,
  },
  voteBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voteBadgePresent: { backgroundColor: '#0fb3a6' },
  voteBadgeAbsent: { backgroundColor: '#e84a4a' },

  featuredTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 22,
    lineHeight: 26,
    marginBottom: theme.s(2),
  },
  featuredMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 4 },
  featuredMetaText: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 13 },
  featuredDesc: {
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    fontSize: 14,
    lineHeight: 20,
    marginTop: theme.s(3),
  },
  featuredFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: theme.s(4) },
  featuredNames: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.body,
    fontSize: 13,
    marginTop: theme.s(2),
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
  },
  statDot: { width: 6, height: 6, borderRadius: 3 },
  statText: { color: theme.colors.muted, fontFamily: theme.fonts.bodyMedium, fontSize: 12 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.s(3),
    marginBottom: theme.s(2),
    minHeight: 64,
  },
  cardMuted: { opacity: 0.7 },
  dateBox: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.s(3),
  },
  dateDay: { color: theme.colors.text, fontFamily: theme.fonts.serifBlack, fontSize: 18, lineHeight: 20 },
  dateMonth: { color: theme.colors.coral, fontFamily: theme.fonts.bodyBold, fontSize: 9, letterSpacing: 1 },
  cardTitle: { color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 4 },
  metaText: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 12 },

  emptyHero: { padding: theme.s(8), alignItems: 'center', marginTop: theme.s(4) },
  emptyHeroText: { color: theme.colors.muted, fontFamily: theme.fonts.bodyBold, fontSize: 15, marginTop: theme.s(3) },
  emptyHeroSub: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 13, marginTop: 4 },
  emptyText: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 14 },

  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.coral,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },

  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.s(3),
    paddingTop: theme.s(2),
    paddingBottom: theme.s(1),
  },
  detailHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  detailTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
    marginTop: theme.s(2),
    marginBottom: theme.s(3),
  },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  detailMetaText: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 14, flexShrink: 1 },
  detailDescription: {
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    fontSize: 15,
    lineHeight: 22,
    marginTop: theme.s(4),
  },
  detailSection: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: theme.s(6),
    marginBottom: theme.s(2),
  },
  voteRow: { flexDirection: 'row', gap: 10 },
  voteChoice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    backgroundColor: theme.colors.surface,
  },
  voteChoiceText: { fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  cancelVote: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 4,
    marginTop: theme.s(3),
  },
  cancelVoteText: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 13 },

  attendeesBox: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.s(3),
    marginTop: theme.s(4),
    gap: theme.s(2),
  },
  attendeesGroup: {},
  dateField: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: theme.s(3) },
  dateFieldText: { flex: 1, color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 16 },
  agendaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: theme.s(3),
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.teal + '66',
  },
  agendaText: { color: theme.colors.teal, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: '#241833',
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    padding: theme.s(5),
    paddingBottom: theme.s(10),
    gap: theme.s(3),
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border,
    marginBottom: theme.s(1),
  },
  sheetTitle: { color: theme.colors.text, fontFamily: theme.fonts.serif, fontSize: 22, marginBottom: theme.s(1) },
  createOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: theme.s(4),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  createIcon: { width: 44, height: 44, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center' },
  createTitle: { color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  createSub: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 13, marginTop: 2, lineHeight: 18 },
  sheetCancel: { alignItems: 'center', paddingVertical: theme.s(3) },
  sheetCancelText: { color: theme.colors.muted, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  formHint: {
    color: theme.colors.teal,
    fontFamily: theme.fonts.body,
    fontSize: 12,
    marginTop: -theme.s(2),
    marginBottom: theme.s(4),
  },
  attendeesMore: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  attendeesMoreText: { color: theme.colors.teal, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  attendeeRow: {
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    fontSize: 15,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  attendeesLabel: {
    color: theme.colors.teal,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    marginBottom: 2,
  },
  attendeesNames: { color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 18 },

  comment: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.s(3),
    marginTop: theme.s(2),
  },
  commentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentAuthor: { color: theme.colors.teal, fontFamily: theme.fonts.bodyBold, fontSize: 12, marginBottom: 4 },
  commentText: { color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 20 },

  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: theme.s(3),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.deep,
  },
  commentInput: {
    flex: 1,
    backgroundColor: theme.colors.inputBg,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.s(3),
    paddingTop: theme.s(2),
    paddingBottom: theme.s(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serif,
    fontSize: 18,
  },
  label: {
    fontFamily: theme.fonts.bodyBold,
    fontSize: 11,
    color: theme.colors.muted,
    marginBottom: 6,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: theme.colors.inputBg,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: theme.s(4) },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
  },
  catChipActive: { borderColor: theme.colors.coral, backgroundColor: theme.colors.coral },
  catChipText: { color: theme.colors.muted, fontFamily: theme.fonts.bodyMedium, fontSize: 13 },
  catChipTextActive: { color: '#fff', fontFamily: theme.fonts.bodyBold },
  saveBtn: {
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: theme.s(4),
    minHeight: 52,
    justifyContent: 'center',
  },
  saveText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
