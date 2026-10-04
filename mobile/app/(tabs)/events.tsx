import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  sb,
  type EventComment,
  type EventRow,
  type EventVote,
  type ProfileMini,
} from '@/lib/supabase';
import { theme } from '@/lib/theme';

type EventCard = EventRow & {
  author?: ProfileMini | null;
  votes: (EventVote & { id: string })[];
  isPast: boolean;
};

type Compose = 'new' | EventCard | null;

type Birthday = {
  id: string;
  name: string;
  monthDay: string;
  daysUntil: number;
  age: number;
};

const CATEGORIES = ['Anniversaire', 'Vacances', 'Féria', 'Sport', 'Barathon', 'Soirée', 'Restaurant', 'Autre'];

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

  const loadAll = useCallback(async () => {
    const { data: u } = await sb.auth.getUser();
    setUserId(u.user?.id ?? null);

    const [eventsRes, allProfilesRes] = await Promise.all([
      sb.from('events').select('*').order('date_event', { ascending: true }),
      sb.from('profiles').select('id,prenom,nom,pseudo,dob'),
    ]);
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

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function onRefresh() {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
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

        {featured && (
          <View style={styles.section}>
            <SectionHeader label="À la une" />
            <FeaturedEventCard
              event={featured}
              currentUserId={userId}
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
          setCompose('new');
        }}
        style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.92 }] }]}
      >
        <Ionicons name="add" size={30} color="#fff" />
      </Pressable>

      <Modal
        visible={!!openEvent}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenId(null)}
      >
        {openEvent && userId && (
          <EventDetail
            event={openEvent}
            currentUserId={userId}
            profiles={profiles}
            onClose={() => setOpenId(null)}
            onVoteChange={loadAll}
            onEdit={() => {
              setOpenId(null);
              setCompose(openEvent);
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
            initial={compose === 'new' ? null : compose}
            currentUserId={userId}
            onClose={() => setCompose(null)}
            onSaved={() => {
              setCompose(null);
              loadAll();
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
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
  onPress,
}: {
  event: EventCard;
  currentUserId: string | null;
  onPress: () => void;
}) {
  const presents = event.votes.filter((v) => v.present === 'oui').length;
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
          {myVote && (
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
          {event.categorie && (
            <View style={styles.catPill}>
              <Text style={styles.catPillText}>{event.categorie}</Text>
            </View>
          )}
        </View>
      </View>
      <Text style={styles.featuredTitle}>{title}</Text>
      {(event.lieu || event.heure) && (
        <View style={styles.featuredMetaRow}>
          {event.heure && (
            <>
              <Ionicons name="time-outline" size={14} color={theme.colors.muted} />
              <Text style={styles.featuredMetaText}>{event.heure}</Text>
            </>
          )}
          {event.heure && event.lieu && <Text style={styles.featuredMetaText}> · </Text>}
          {event.lieu && (
            <>
              <Ionicons name="location-outline" size={14} color={theme.colors.muted} />
              <Text style={styles.featuredMetaText}>{event.lieu}</Text>
            </>
          )}
        </View>
      )}
      {event.note && (
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
    </Pressable>
  );
}

function EventCardView({
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
  const presents = event.votes.filter((v) => v.present === 'oui').length;
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
        {event.lieu && (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={12} color={theme.colors.muted} />
            <Text style={styles.metaText} numberOfLines={1}>
              {event.lieu}
            </Text>
          </View>
        )}
        <View style={styles.metaRow}>
          <Ionicons name="people-outline" size={12} color={theme.colors.muted} />
          <Text style={styles.metaText}>{presents} présent·e·s</Text>
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
  const myVote = event.votes.find((v) => v.user_id === currentUserId);
  const isOwner = event.created_by === currentUserId;
  const title = buildEventTitle(event);

  const loadComments = useCallback(async () => {
    const { data } = await sb
      .from('event_comments')
      .select('*')
      .eq('event_id', event.id)
      .order('created_at', { ascending: true });
    setComments((data as EventComment[] | null) ?? []);
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
    if (!error) {
      setText('');
      loadComments();
    }
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
            await sb.from('events').delete().eq('id', event.id);
            onDeleted();
          },
        },
      ],
    );
  }

  function nameOf(uid: string) {
    const p = profiles[uid];
    if (!p) return '?';
    return p.pseudo || `${p.prenom ?? ''} ${p.nom ?? ''}`.trim() || '?';
  }

  const presents = event.votes.filter((v) => v.present === 'oui');
  const absents = event.votes.filter((v) => v.present === 'non');

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.detailHeader}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.detailHeaderBtn}>
          <Ionicons name="close" size={26} color={theme.colors.text} />
        </Pressable>
        {isOwner && (
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={20}
      >
        <ScrollView contentContainerStyle={{ padding: theme.s(5) }}>
          {event.categorie && (
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
          {event.lieu && (
            <View style={styles.detailMetaRow}>
              <Ionicons name="location-outline" size={14} color={theme.colors.muted} />
              <Text style={styles.detailMetaText}>{event.lieu}</Text>
            </View>
          )}
          {event.chez_qui && (
            <View style={styles.detailMetaRow}>
              <Ionicons name="home-outline" size={14} color={theme.colors.muted} />
              <Text style={styles.detailMetaText}>chez {event.chez_qui}</Text>
            </View>
          )}
          {event.note && <Text style={styles.detailDescription}>{event.note}</Text>}

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
          {myVote && (
            <Pressable onPress={() => setVote(null)} style={styles.cancelVote} hitSlop={6}>
              <Ionicons name="refresh-outline" size={14} color={theme.colors.muted} />
              <Text style={styles.cancelVoteText}>Retirer mon vote</Text>
            </Pressable>
          )}

          {(presents.length > 0 || absents.length > 0) && (
            <View style={styles.attendeesBox}>
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
            </View>
          )}

          <Text style={styles.detailSection}>Commentaires ({comments.length})</Text>
          {comments.length === 0 && (
            <Text style={styles.emptyText}>Personne n&apos;a encore commenté.</Text>
          )}
          {comments.map((c) => (
            <View key={c.id} style={styles.comment}>
              <Text style={styles.commentAuthor}>{nameOf(c.user_id)}</Text>
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function EventForm({
  initial,
  currentUserId,
  onClose,
  onSaved,
}: {
  initial: EventCard | null;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [categorie, setCategorie] = useState(initial?.categorie ?? CATEGORIES[0]);
  const [date, setDate] = useState(initial?.date_event ?? '');
  const [heure, setHeure] = useState(initial?.heure ?? '');
  const [lieu, setLieu] = useState(initial?.lieu ?? '');
  const [chezQui, setChezQui] = useState(initial?.chez_qui ?? '');
  const [annivQui, setAnnivQui] = useState(initial?.anniversaire_qui ?? '');
  const [feriaVille, setFeriaVille] = useState(initial?.feria_ville ?? '');
  const [sportType, setSportType] = useState(initial?.sport_type ?? '');
  const [raison, setRaison] = useState(initial?.raison ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!date.trim()) {
      Alert.alert('Date requise', 'Indique la date au format AAAA-MM-JJ.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      Alert.alert('Format date', 'Utilise le format AAAA-MM-JJ (ex: 2026-08-15).');
      return;
    }
    if (categorie === 'Anniversaire' && !annivQui.trim()) {
      Alert.alert('Champ requis', 'Indique de qui c’est l’anniversaire.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        categorie,
        date_event: date.trim(),
        heure: heure.trim() || null,
        lieu: lieu.trim() || null,
        chez_qui: chezQui.trim() || null,
        anniversaire_qui: annivQui.trim() || null,
        feria_ville: feriaVille.trim() || null,
        sport_type: sportType.trim() || null,
        raison: raison.trim() || null,
        note: note.trim() || null,
      };
      const r = isEdit
        ? await sb.from('events').update(payload).eq('id', initial!.id)
        : await sb.from('events').insert({ ...payload, created_by: currentUserId });
      if (r.error) throw r.error;
      onSaved();
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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

          <FormField
            label="Date (AAAA-MM-JJ)"
            value={date}
            onChangeText={setDate}
            placeholder="2026-08-15"
            autoCapitalize="none"
          />
          <FormField
            label="Heure"
            value={heure}
            onChangeText={setHeure}
            placeholder="20:30"
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

          <FormField label="Lieu" value={lieu} onChangeText={setLieu} placeholder="Adresse, ville" />
          <FormField
            label="Chez qui ?"
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
      </KeyboardAvoidingView>
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
