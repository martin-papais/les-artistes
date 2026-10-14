import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { reactionOf, REACTIONS } from '@/components/plus/reactions';
import { EmptyState, IconButton, Pastille, ScreenHeader } from '@/components/ui/kit';
import {
  sb,
  type Note,
  type NoteReaction,
  type ProfileMini, sessionUser } from '@/lib/supabase';
import { getBlocked, ModerationButton } from '@/lib/moderation';
import { KeyboardAware } from '@/lib/keyboard';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

type NoteCard = Note & {
  author?: ProfileMini | null;
  reactions: NoteReaction[];
};

export default function NotesScreen() {
  const [notes, setNotes] = useState<NoteCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const reacting = useRef(false);
  const [userId, setUserId] = useState<string | null>(null);
  // Une seule grille de réactions ouverte à la fois
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const loadAll = useCallback(async () => {
    const user = await sessionUser();
    setUserId(user?.id ?? null);

    const [{ data: all, error: loadError }, blocked] = await Promise.all([
      sb.from('notes').select('*').order('created_at', { ascending: false }),
      getBlocked(),
    ]);
    if (loadError) {
      setLoading(false);
      Alert.alert('Chargement impossible', 'Vérifie ta connexion puis tire vers le bas pour réessayer.');
      return;
    }
    const rows = all ? all.filter((n) => !blocked.has(n.user_id)) : null;
    if (!rows) {
      setNotes([]);
      setLoading(false);
      return;
    }

    const uids = Array.from(new Set(rows.map((n) => n.user_id).filter(Boolean)));
    const noteIds = rows.map((n) => n.id);
    const [profRes, reacRes] = await Promise.all([
      uids.length
        ? sb.from('profiles').select('id,prenom,nom,pseudo').in('id', uids)
        : Promise.resolve({ data: [] as ProfileMini[] }),
      noteIds.length
        ? sb.from('note_reactions').select('*').in('note_id', noteIds)
        : Promise.resolve({ data: [] as NoteReaction[] }),
    ]);

    const pmap: Record<string, ProfileMini> = {};
    (profRes.data ?? []).forEach((p) => {
      pmap[p.id] = p as ProfileMini;
    });

    const reacByNote: Record<string, NoteReaction[]> = {};
    (reacRes.data ?? []).forEach((r) => {
      const list = reacByNote[(r as NoteReaction).note_id] ?? (reacByNote[(r as NoteReaction).note_id] = []);
      list.push(r as NoteReaction);
    });

    setNotes(
      (rows as Note[]).map((n) => ({
        ...n,
        author: pmap[n.user_id] ?? null,
        reactions: reacByNote[n.id] ?? [],
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }

  async function publish() {
    const t = text.trim();
    if (!t || !userId) return;
    setPosting(true);
    const { error } = await sb.from('notes').insert({
      user_id: userId,
      contenu: t,
      categorie: 'autre', // valeur par défaut du web (notes.html)
    });
    setPosting(false);
    if (error) {
      Alert.alert('Erreur', error.message);
      return;
    }
    setText('');
    loadAll();
  }

  async function toggleReact(note: NoteCard, emoji: string) {
    if (!userId || reacting.current) return;
    reacting.current = true;
    try {
      const mine = note.reactions.find((r) => r.user_id === userId && r.emoji === emoji);
      const { error } = mine
        ? await sb.from('note_reactions').delete().eq('id', mine.id)
        : await sb.from('note_reactions').insert({
            note_id: note.id,
            user_id: userId,
            emoji,
          });
      if (error) Alert.alert('Erreur', error.message);
      await loadAll();
    } finally {
      reacting.current = false;
    }
  }

  async function deleteNote(note: NoteCard) {
    if (!userId || note.user_id !== userId) return;
    Alert.alert('Supprimer cette note ?', 'Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await sb.from('note_reactions').delete().eq('note_id', note.id);
          const { error } = await sb.from('notes').delete().eq('id', note.id);
          if (error) Alert.alert('Suppression impossible', error.message);
          loadAll();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.teal} />
      </View>
    );
  }

  const canSend = !!text.trim() && !posting;

  return (
    <KeyboardAware insideSafeArea={false} style={styles.flex}>
      <FlatList
        data={notes}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        ListHeaderComponent={
          <View>
            <ScreenHeader back title="Notes" sub="Le mur des pensées du groupe" />
            <View style={styles.composer}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Écris une pensée du moment"
                placeholderTextColor={c.muted}
                selectionColor={c.coral}
                accessibilityLabel="Écris une pensée du moment"
                style={styles.composerInput}
                multiline
              />
              {posting ? (
                <View style={[styles.send, { backgroundColor: c.coral }]}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : (
                <IconButton
                  name="send"
                  label="Publier"
                  onPress={publish}
                  disabled={!canSend}
                  bg={canSend ? c.coral : c.rail}
                  color={canSend ? '#fff' : c.muted}
                />
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="edit-3"
            iconBg={c.yellow}
            iconColor={c.ink}
            title="Aucune note pour l'instant"
            text="Écris la première pensée du groupe, juste au-dessus."
          />
        }
        renderItem={({ item }) => (
          <NoteCardView
            note={item}
            currentUserId={userId}
            pickerOpen={pickerFor === item.id}
            onTogglePicker={() => setPickerFor((p) => (p === item.id ? null : item.id))}
            onReact={(e) => {
              setPickerFor(null);
              toggleReact(item, e);
            }}
            onDelete={() => deleteNote(item)}
            onBlocked={loadAll}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
      />
    </KeyboardAware>
  );
}

function NoteCardView({
  note,
  currentUserId,
  pickerOpen,
  onTogglePicker,
  onReact,
  onDelete,
  onBlocked,
}: {
  note: NoteCard;
  currentUserId: string | null;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onBlocked: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
}) {
  const counts = new Map<string, number>();
  const mine = new Set<string>();
  note.reactions.forEach((r) => {
    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
    if (r.user_id === currentUserId) mine.add(r.emoji);
  });
  const usedEmojis = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const isMine = note.user_id === currentUserId;
  const author = note.author;
  const name = author ? author.pseudo || `${author.prenom ?? ''} ${author.nom ?? ''}`.trim() : '?';

  return (
    <View style={styles.note}>
      <View style={styles.noteHeader}>
        <Pastille id={note.user_id} name={name} size={32} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.noteAuthor} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.noteDate}>
            {new Date(note.created_at).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'long',
            })}
          </Text>
        </View>
        {isMine ? (
          <IconButton name="trash-2" label="Supprimer ma note" onPress={onDelete} bg="transparent" color={c.muted} size={40} />
        ) : (
          <ModerationButton
            kind="note"
            itemId={note.id}
            authorId={note.user_id}
            authorName={name}
            excerpt={note.contenu}
            currentUserId={currentUserId}
            onBlocked={onBlocked}
          />
        )}
      </View>
      <Text style={styles.noteText}>{note.contenu}</Text>

      {pickerOpen ? (
        <View style={styles.picker} accessibilityLabel="Choisir une réaction">
          {REACTIONS.map((r) => {
            const on = mine.has(r.emoji);
            return (
              <Pressable
                key={r.emoji}
                onPress={() => onReact(r.emoji)}
                accessibilityRole="button"
                accessibilityLabel={on ? `${r.label}, retirer ma réaction` : r.label}
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [styles.pickCell, pressed && { opacity: 0.6 }]}
              >
                <View style={[styles.pickDot, on && styles.pickCellMine]}>{r.draw(22, r.color)}</View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.reactionRow}>
          {usedEmojis.map(([emoji, count]) => {
            const r = reactionOf(emoji);
            const on = mine.has(emoji);
            return (
              <Pressable
                key={emoji}
                onPress={() => onReact(emoji)}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}, ${count}${on ? ', tu as réagi' : ''}`}
                accessibilityState={{ selected: on }}
                hitSlop={{ top: 2, bottom: 2 }}
                style={({ pressed }) => [styles.reactionPill, on && styles.reactionPillMine, pressed && { opacity: 0.7 }]}
              >
                {r.draw(18, on ? c.coralSoft : r.color)}
                <Text style={[styles.reactionCount, on && { color: c.coralSoft }]}>{count}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={onTogglePicker}
            accessibilityRole="button"
            accessibilityLabel="Réagir"
            hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
            style={({ pressed }) => [styles.reactBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialCommunityIcons name="emoticon-plus-outline" size={21} color={c.muted} />
          </Pressable>
        </View>
      )}
      {pickerOpen && (
        <Pressable onPress={onTogglePicker} accessibilityRole="button" style={styles.pickerClose}>
          <Text style={styles.pickerCloseText}>Fermer</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.deep },
  composer: {
    marginTop: 18,
    marginBottom: 18,
    marginHorizontal: theme.gutter,
    paddingVertical: 6,
    paddingRight: 6,
    paddingLeft: 16,
    borderRadius: 26,
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  composerInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    maxHeight: 140,
    paddingTop: 11,
    paddingBottom: 11,
    color: c.text,
    fontFamily: f.body,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  note: {
    marginHorizontal: theme.gutter,
    marginBottom: 10,
    padding: 16,
    borderRadius: theme.radius.card,
    backgroundColor: c.card,
  },
  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  noteAuthor: { color: c.text, fontFamily: f.bodyBold, fontSize: 15, lineHeight: 20 },
  noteDate: { color: c.muted, fontFamily: f.body, fontSize: 13, lineHeight: 18 },
  noteText: { color: c.text, fontFamily: f.body, fontSize: 16, lineHeight: 23, marginTop: 12, marginBottom: 14 },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  reactionPill: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: c.deep,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reactionPillMine: { backgroundColor: 'rgba(255,107,107,0.18)' },
  reactionCount: { color: c.text, fontFamily: f.bodyBold, fontSize: 14 },
  reactBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.deep, alignItems: 'center', justifyContent: 'center' },
  picker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 4,
    rowGap: 2,
    borderRadius: 24,
    backgroundColor: c.deep,
  },
  // 4 colonnes
  pickCell: { width: '25%', height: 44, alignItems: 'center', justifyContent: 'center' },
  pickDot: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pickCellMine: { backgroundColor: 'rgba(255,107,107,0.18)' },
  pickerClose: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, marginBottom: -10 },
  pickerCloseText: { color: c.muted, fontFamily: f.bodyBold, fontSize: 14 },
});
