/**
 * Fiche d'un événement : bandeau de la couleur de la catégorie, infos en étiquettes,
 * qui vient, repas et organisation, commentaires, et « Tu viens ? » collé en bas.
 */
import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomBar, Button, IconButton, Pastille, PastilleStack, Sheet } from '@/components/ui/kit';
import { addToAgenda } from '@/lib/agenda';
import { KeyboardAware } from '@/lib/keyboard';
import { getBlocked, ModerationButton } from '@/lib/moderation';
import { sb, type EventComment, type ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';

import { RsvpButtons } from './EventCards';
import { EventInfos, EventPolls } from './EventPolls';
import {
  buildEventTitle,
  capFirst,
  catMeta,
  countsLabel,
  dateParts,
  heureLabel,
  profileName,
  shortDate,
  tap,
  voteEvent,
  type EventCard,
} from './shared';

const c = theme.colors;
const f = theme.fonts;

type Person = { id: string; name: string };

/** Ouvre le GPS du téléphone sur l'adresse (Plans sur iPhone, l'appli de cartes sur Android). */
function openMaps(address: string) {
  const q = encodeURIComponent(address);
  const url = Platform.OS === 'ios' ? `http://maps.apple.com/?q=${q}` : `geo:0,0?q=${q}`;
  Linking.openURL(url).catch(() =>
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`).catch(() => {}),
  );
}

/** « aujourd'hui à 20:15 », « 14 oct. à 20:15 » */
function commentTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `aujourd'hui à ${hm}`;
  const day = dateParts(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  return `${day.day} ${day.month}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ''} à ${hm}`;
}

export function EventDetail({
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
  // Clavier ouvert : la barre « Tu viens ? » laisse la place au champ de commentaire
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const inputFocused = useRef(false);
  const myVote = event.votes.find((v) => v.user_id === currentUserId);
  const isOwner = event.created_by === currentUserId;
  const title = buildEventTitle(event);
  const meta = catMeta(event.categorie);
  const p = dateParts(event.date_event);

  const loadComments = useCallback(async () => {
    const [{ data }, blocked] = await Promise.all([
      sb.from('event_comments').select('*').eq('event_id', event.id).order('created_at', { ascending: true }),
      getBlocked(),
    ]);
    setBlockedIds(blocked);
    setComments(((data as EventComment[] | null) ?? []).filter((cm) => !blocked.has(cm.user_id)));
  }, [event.id]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      setKeyboardOpen(true);
      // Le champ est en bas de la fiche : on y descend pour qu'il reste au-dessus du clavier
      if (inputFocused.current) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250);
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  async function setVote(present: 'oui' | 'non') {
    // Un double appui insérait deux votes : on bloque jusqu'au rechargement
    if (voting.current) return;
    voting.current = true;
    try {
      const error = await voteEvent(event, currentUserId, present);
      if (error) Alert.alert('Erreur', error.message);
      await onVoteChange();
    } finally {
      voting.current = false;
    }
  }

  async function postComment() {
    const t = text.trim();
    if (!t || posting) return;
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
    Alert.alert('Supprimer cet événement ?', 'Tous les commentaires et votes seront aussi supprimés.', [
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
    ]);
  }

  function nameOf(uid: string) {
    return profileName(profiles[uid]);
  }

  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name, 'fr');
  const presents: Person[] = event.votes
    .filter((v) => v.present === 'oui')
    .map((v) => ({ id: v.user_id, name: nameOf(v.user_id) }))
    .sort(byName);
  const absents: Person[] = event.votes
    .filter((v) => v.present === 'non')
    .map((v) => ({ id: v.user_id, name: nameOf(v.user_id) }))
    .sort(byName);
  const voterIds = new Set(event.votes.map((v) => v.user_id));
  const missing: Person[] = Object.keys(profiles)
    .filter((id) => !voterIds.has(id) && !blockedIds.has(id))
    .map((id) => ({ id, name: nameOf(id) }))
    .sort(byName);

  const yearSuffix = p.year !== new Date().getFullYear() ? ` ${p.year}` : '';
  const heure = heureLabel(event.heure);
  const canSend = !!text.trim() && !posting;

  return (
    // Haut seulement : la barre du bas gère elle-même le bord de l'écran
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
      <KeyboardAware insideSafeArea={false}>
        <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={[styles.band, { backgroundColor: meta.color }]}>
            <View style={styles.bandTop}>
              <IconButton name="x" label="Fermer" onPress={onClose} color={c.ink} bg="rgba(26,16,37,0.12)" />
              {isOwner && (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <IconButton name="edit-2" label="Modifier l'événement" onPress={onEdit} color={c.ink} bg="rgba(26,16,37,0.12)" />
                  <IconButton name="trash-2" label="Supprimer l'événement" onPress={deleteEvent} color={c.ink} bg="rgba(26,16,37,0.12)" />
                </View>
              )}
            </View>
            {!!event.categorie && <Text style={styles.bandCat}>{event.categorie}</Text>}
            <Text style={styles.bandTitle} accessibilityRole="header">
              {title}
            </Text>
            <View style={styles.datePill}>
              <Text style={styles.datePillDay}>
                {capFirst(p.wd)} {p.day} {p.month}
                {yearSuffix}
              </Text>
              {!!heure && (
                <>
                  <View style={styles.datePillDot} />
                  <Text style={styles.datePillHour}>{heure}</Text>
                </>
              )}
            </View>
          </View>

          <View style={styles.body}>
            {(!event.isPast || !!event.lieu) && (
              <View style={styles.actions}>
                {!event.isPast && (
                  <Button
                    label="Ajouter à mon agenda"
                    icon="calendar"
                    variant="secondary"
                    height={48}
                    style={{ flex: 1, paddingHorizontal: 12 }}
                    onPress={() => {
                      tap();
                      addToAgenda(event, title, currentUserId);
                    }}
                  />
                )}
                {!!event.lieu && (
                  <Button
                    label="Y aller"
                    icon="navigation"
                    variant="secondary"
                    height={48}
                    style={event.isPast ? { flex: 1 } : { paddingHorizontal: 18 }}
                    accessibilityLabel={`Y aller : ouvrir ${event.lieu} dans le GPS`}
                    onPress={() => {
                      tap();
                      openMaps(event.lieu!);
                    }}
                  />
                )}
              </View>
            )}
            {!!event.note && <Text style={styles.note}>{event.note}</Text>}
            <EventInfos event={event} />

            <Pressable
              onPress={() => {
                tap();
                setShowAttendees(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Qui vient : ${countsLabel(presents.length, absents.length)}, ${missing.length} sans réponse. Voir la liste`}
              style={({ pressed }) => [styles.who, pressed && { opacity: 0.85 }]}
            >
              {presents.length > 0 ? (
                <PastilleStack people={presents} max={3} size={32} ring={c.card} />
              ) : (
                <View style={styles.whoIcon}>
                  <Feather name="users" size={18} color={c.muted} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.whoTitle}>
                  {presents.length + absents.length === 0 ? (
                    'Personne n’a encore répondu'
                  ) : (
                    <>
                      <Text style={{ color: presents.length ? c.teal : c.text }}>{countsLabel(presents.length, 0)}</Text>
                      {absents.length > 0 && `, ${absents.length} non`}
                    </>
                  )}
                </Text>
                <Text style={styles.whoSub}>
                  {missing.length === 0
                    ? 'Tout le monde a répondu'
                    : `${missing.length} ${missing.length > 1 ? 'n’ont' : 'n’a'} pas encore répondu`}
                </Text>
              </View>
              <Feather name="chevron-right" size={20} color={c.muted} />
            </Pressable>

            <EventPolls event={event} currentUserId={currentUserId} nameOf={nameOf} />

            <Text style={styles.section} accessibilityRole="header">
              Commentaires
              {comments.length > 0 && <Text style={{ color: c.muted, fontFamily: f.bodyMedium }}> {comments.length}</Text>}
            </Text>
            {comments.length === 0 && <Text style={styles.muted}>Personne n&apos;a encore commenté. Lance la discussion.</Text>}
            {comments.map((cm) => (
              <View key={cm.id} style={styles.comment}>
                <Pastille id={cm.user_id} name={nameOf(cm.user_id)} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.commentHead}>
                    <Text style={styles.commentAuthor} numberOfLines={1}>
                      {nameOf(cm.user_id)}
                    </Text>
                    <Text style={styles.commentTime} numberOfLines={1}>
                      {commentTime(cm.created_at)}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <ModerationButton
                      kind="event_comment"
                      itemId={cm.id}
                      authorId={cm.user_id}
                      authorName={nameOf(cm.user_id)}
                      excerpt={cm.contenu}
                      currentUserId={currentUserId}
                      onBlocked={() => setComments((prev) => prev.filter((x) => x.user_id !== cm.user_id))}
                    />
                  </View>
                  <Text style={styles.commentText}>{cm.contenu}</Text>
                </View>
              </View>
            ))}
            <View style={styles.inputRow}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Écrire un commentaire"
                placeholderTextColor={c.muted}
                selectionColor={c.coral}
                accessibilityLabel="Écrire un commentaire"
                onFocus={() => {
                  inputFocused.current = true;
                }}
                onBlur={() => {
                  inputFocused.current = false;
                }}
                style={styles.input}
                multiline
              />
              <Pressable
                onPress={postComment}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="Envoyer le commentaire"
                accessibilityState={{ disabled: !canSend }}
                style={({ pressed }) => [styles.send, { backgroundColor: canSend ? c.coral : c.rail }, pressed && { opacity: 0.8 }]}
              >
                {posting ? <ActivityIndicator color="#fff" /> : <Feather name="send" size={19} color={canSend ? '#fff' : c.muted} />}
              </Pressable>
            </View>
          </View>
        </ScrollView>

        {!keyboardOpen && (
          <BottomBar>
            <View style={styles.barHead}>
              <Text style={styles.barTitle}>
                {myVote?.present === 'oui' ? 'Tu viens' : myVote?.present === 'non' ? 'Tu n’es pas dispo' : 'Tu viens ?'}
              </Text>
              {!!myVote && <Text style={styles.barHint}>Retouche ton choix pour le retirer</Text>}
            </View>
            <RsvpButtons mine={myVote?.present ?? null} onVote={setVote} height={50} />
          </BottomBar>
        )}
      </KeyboardAware>

      <WhoComesSheet
        visible={showAttendees}
        onClose={() => setShowAttendees(false)}
        sub={`${title}, ${shortDate(event.date_event)}`}
        presents={presents}
        absents={absents}
        missing={missing}
      />
    </SafeAreaView>
  );
}

type Tab = 'oui' | 'non' | 'rien';

function WhoComesSheet({
  visible,
  onClose,
  sub,
  presents,
  absents,
  missing,
}: {
  visible: boolean;
  onClose: () => void;
  sub: string;
  presents: Person[];
  absents: Person[];
  missing: Person[];
}) {
  const [tab, setTab] = useState<Tab>('oui');
  const tabs: { key: Tab; label: string; bg: string; fg: string; flex: number; list: Person[] }[] = [
    { key: 'oui', label: `Viennent ${presents.length}`, bg: c.teal, fg: c.tealInk, flex: 1, list: presents },
    { key: 'non', label: `Non ${absents.length}`, bg: c.text, fg: c.ink, flex: 1, list: absents },
    { key: 'rien', label: `Sans réponse ${missing.length}`, bg: c.rail, fg: c.text, flex: 1.35, list: missing },
  ];
  const current = tabs.find((t) => t.key === tab) ?? tabs[0];
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Qui vient ?"
      sub={sub}
      footer={<Button label="Fermer" variant="ghost" onPress={onClose} />}
    >
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((t) => {
          const on = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.tab, { flex: t.flex }, on && { backgroundColor: t.bg }]}
            >
              <Text style={[styles.tabText, { color: on ? t.fg : c.muted }]} numberOfLines={1}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={{ marginTop: 8 }}>
        {current.list.length === 0 && <Text style={[styles.muted, { paddingVertical: 16 }]}>Personne</Text>}
        {current.list.map((pp, i) => (
          <View key={pp.id} style={[styles.personRow, i === current.list.length - 1 && { borderBottomWidth: 0 }]}>
            <Pastille id={pp.id} name={pp.name} size={36} />
            <Text style={styles.personName} numberOfLines={1}>
              {pp.name}
            </Text>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  muted: { color: c.muted, fontFamily: f.body, fontSize: 15, lineHeight: 21 },

  band: { paddingHorizontal: theme.gutter, paddingBottom: 22, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  bandTop: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -10, paddingTop: 10 },
  bandCat: { color: c.ink, fontFamily: f.bodyBold, fontSize: 14, marginTop: 10 },
  bandTitle: { color: c.ink, fontFamily: f.serifBlack, fontSize: 30, lineHeight: 36, marginTop: 4 },
  datePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 14,
    marginTop: 14,
    borderRadius: 20,
    backgroundColor: c.deep,
  },
  datePillDay: { color: c.text, fontFamily: f.serifBlack, fontSize: 18 },
  datePillDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: c.muted },
  datePillHour: { color: c.text, fontFamily: f.bodyBold, fontSize: 15 },

  body: { paddingHorizontal: theme.gutter, paddingTop: 16, gap: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  note: { color: c.text, fontFamily: f.body, fontSize: 16, lineHeight: 23 },

  who: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: theme.radius.card, backgroundColor: c.card },
  whoIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' },
  whoTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 15 },
  whoSub: { color: c.muted, fontFamily: f.body, fontSize: 13, marginTop: 1 },

  section: { color: c.text, fontFamily: f.bodyBold, fontSize: 18, lineHeight: 24, marginTop: 8 },
  comment: { flexDirection: 'row', gap: 10 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  commentAuthor: { color: c.text, fontFamily: f.bodyBold, fontSize: 14, flexShrink: 1 },
  commentTime: { color: c.muted, fontFamily: f.body, fontSize: 12, flexShrink: 1 },
  commentText: { color: c.text, fontFamily: f.body, fontSize: 15, lineHeight: 21 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 4 },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: 23,
    backgroundColor: c.card,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 13 : 10,
    paddingBottom: Platform.OS === 'ios' ? 13 : 10,
    color: c.text,
    fontFamily: f.body,
    fontSize: 15,
  },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },

  barHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 10 },
  barTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 15 },
  barHint: { color: c.muted, fontFamily: f.body, fontSize: 12, flexShrink: 1, textAlign: 'right' },

  tabs: { flexDirection: 'row', padding: 4, borderRadius: 26, backgroundColor: c.deep },
  tab: { height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  tabText: { fontFamily: f.bodyBold, fontSize: 14 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderBottomWidth: 1, borderBottomColor: c.hairline },
  personName: { flex: 1, color: c.text, fontFamily: f.bodyMedium, fontSize: 16 },
});
