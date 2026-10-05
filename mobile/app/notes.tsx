import { Ionicons } from '@expo/vector-icons';
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

import {
  sb,
  type Note,
  type NoteReaction,
  type ProfileMini, sessionUser } from '@/lib/supabase';
import { getBlocked, ModerationButton } from '@/lib/moderation';
import { KeyboardAware } from '@/lib/keyboard';
import { theme } from '@/lib/theme';

const EMOJIS = ['👍', '❤️', '😂', '🔥', '👀', '💯', '✅', '😮'] as const;

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
        <ActivityIndicator color={theme.colors.teal} />
      </View>
    );
  }

  return (
    <KeyboardAware insideSafeArea={false}>
      <FlatList
        data={notes}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: theme.s(4), paddingBottom: theme.s(40) }}
        ListHeaderComponent={
          <View style={styles.composer}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Écris une pensée du moment…"
              placeholderTextColor={theme.colors.muted}
              style={styles.composerInput}
              multiline
            />
            <Pressable
              onPress={publish}
              disabled={posting || !text.trim()}
              style={({ pressed }) => [
                styles.publishBtn,
                (pressed || posting || !text.trim()) && { opacity: 0.5 },
              ]}
            >
              {posting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.publishText}>Publier</Text>
              )}
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Aucune note pour l&apos;instant.</Text>
            <Text style={styles.emptySub}>Sois le premier à publier.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <NoteCardView
            note={item}
            currentUserId={userId}
            onReact={(e) => toggleReact(item, e)}
            onDelete={() => deleteNote(item)}
            onBlocked={loadAll}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.teal}
          />
        }
      />
    </KeyboardAware>
  );
}

function NoteCardView({
  note,
  currentUserId,
  onReact,
  onDelete,
  onBlocked,
}: {
  note: NoteCard;
  currentUserId: string | null;
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
        <Text style={styles.noteAuthor}>{name}</Text>
        <Text style={styles.noteDate}>
          {new Date(note.created_at).toLocaleDateString('fr-FR', {
            day: 'numeric',
            month: 'short',
          })}
        </Text>
        <ModerationButton
          kind="note"
          itemId={note.id}
          authorId={note.user_id}
          authorName={name}
          excerpt={note.contenu}
          currentUserId={currentUserId}
          onBlocked={onBlocked}
        />
      </View>
      <Text style={styles.noteText}>{note.contenu}</Text>

      <View style={styles.reactionRow}>
        {usedEmojis.map(([emoji, count]) => (
          <Pressable
            key={emoji}
            onPress={() => onReact(emoji)}
            style={[styles.reactionPill, mine.has(emoji) && styles.reactionPillMine]}
          >
            <Text style={styles.reactionEmoji}>{emoji}</Text>
            <Text style={[styles.reactionCount, mine.has(emoji) && { color: theme.colors.coral }]}>
              {count}
            </Text>
          </Pressable>
        ))}
        <View style={styles.emojiPicker}>
          {EMOJIS.map((e) => (
            <Pressable key={e} onPress={() => onReact(e)} style={styles.emojiPickBtn}>
              <Text style={styles.emojiChar}>{e}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {!!isMine && (
        <Pressable onPress={onDelete} style={styles.deleteBtn} hitSlop={6}>
          <Ionicons name="trash-outline" size={14} color={theme.colors.muted} />
          <Text style={styles.deleteText}>Supprimer</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.deep },
  composer: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.s(3),
    marginBottom: theme.s(4),
  },
  composerInput: {
    color: theme.colors.text,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  publishBtn: {
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: theme.s(2),
  },
  publishText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  empty: { padding: theme.s(8), alignItems: 'center' },
  emptyText: { color: theme.colors.muted, fontSize: 15 },
  emptySub: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  note: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.s(3),
    marginBottom: theme.s(3),
  },
  noteHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 },
  noteAuthor: { color: theme.colors.teal, fontSize: 12, fontWeight: '700' },
  noteDate: { color: theme.colors.muted, fontSize: 11, marginLeft: 'auto' },
  noteText: { color: theme.colors.text, fontSize: 15, lineHeight: 22 },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: theme.s(3),
    alignItems: 'center',
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  reactionPillMine: {
    backgroundColor: 'rgba(255,107,107,0.15)',
    borderWidth: 1,
    borderColor: theme.colors.coral,
  },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { color: theme.colors.muted, fontSize: 11, fontWeight: '700' },
  emojiPicker: {
    flexDirection: 'row',
    gap: 2,
    marginLeft: 'auto',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    padding: 2,
  },
  emojiPickBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  emojiChar: { fontSize: 14 },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: theme.s(2),
    alignSelf: 'flex-end',
  },
  deleteText: { color: theme.colors.muted, fontSize: 11 },
});
