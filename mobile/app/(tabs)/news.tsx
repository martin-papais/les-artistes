import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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
  type NewsComment,
  type NewsLike,
  type NewsRow,
  type ProfileMini,
} from '@/lib/supabase';
import { theme } from '@/lib/theme';

const PAGE_SIZE = 20;

type NewsLite = Omit<NewsRow, 'contenu'> & {
  author?: ProfileMini | null;
  likeCount: number;
  iLiked: boolean;
  commentCount: number;
};

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function authorName(p: ProfileMini | null | undefined) {
  if (!p) return '?';
  return p.pseudo || `${p.prenom ?? ''} ${p.nom ?? ''}`.trim() || '?';
}

export default function NewsScreen() {
  const [items, setItems] = useState<NewsLite[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const liking = useRef(new Set<string>());

  const fetchPage = useCallback(
    async (offset: number, currentUserId: string | null) => {
      const lightSelect = 'id,titre,tags,cover_url,created_by,created_at';
      const { data: rows } = await sb
        .from('news')
        .select(lightSelect)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (!rows || rows.length === 0) {
        return { items: [] as NewsLite[], hasMore: false };
      }

      const ids = rows.map((r: { id: string }) => r.id);
      const uids = Array.from(
        new Set(rows.map((r: { created_by: string }) => r.created_by).filter(Boolean)),
      );
      const [profRes, likeRes, commentRes] = await Promise.all([
        uids.length
          ? sb.from('profiles').select('id,prenom,nom,pseudo').in('id', uids)
          : Promise.resolve({ data: [] as ProfileMini[] }),
        sb.from('news_likes').select('news_id,user_id').in('news_id', ids),
        sb.from('news_comments').select('news_id').in('news_id', ids),
      ]);

      const pmap: Record<string, ProfileMini> = {};
      (profRes.data ?? []).forEach((p) => {
        pmap[p.id] = p as ProfileMini;
      });
      setProfiles((prev) => ({ ...prev, ...pmap }));

      const likesByNews: Record<string, NewsLike[]> = {};
      (likeRes.data ?? []).forEach((l) => {
        const list = likesByNews[(l as NewsLike).news_id] ?? (likesByNews[(l as NewsLike).news_id] = []);
        list.push(l as NewsLike);
      });
      const commentCountByNews: Record<string, number> = {};
      (commentRes.data ?? []).forEach((c) => {
        commentCountByNews[c.news_id] = (commentCountByNews[c.news_id] ?? 0) + 1;
      });

      const cards: NewsLite[] = rows.map((r) => {
        const likes = likesByNews[(r as NewsRow).id] ?? [];
        const mine = currentUserId ? likes.find((l) => l.user_id === currentUserId) : undefined;
        return {
          ...(r as Omit<NewsRow, 'contenu'>),
          author: pmap[(r as NewsRow).created_by] ?? null,
          likeCount: likes.length,
          iLiked: !!mine,
          commentCount: commentCountByNews[(r as NewsRow).id] ?? 0,
        };
      });
      return { items: cards, hasMore: rows.length === PAGE_SIZE };
    },
    [],
  );

  const loadInitial = useCallback(async () => {
    const { data: u } = await sb.auth.getUser();
    const uid = u.user?.id ?? null;
    setUserId(uid);
    const { items, hasMore } = await fetchPage(0, uid);
    setItems(items);
    setHasMore(hasMore);
    setLoading(false);
  }, [fetchPage]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  async function onRefresh() {
    setRefreshing(true);
    const { items, hasMore } = await fetchPage(0, userId);
    setItems(items);
    setHasMore(hasMore);
    setRefreshing(false);
  }

  async function onEndReached() {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    const { items: next, hasMore: more } = await fetchPage(items.length, userId);
    setItems((prev) => [...prev, ...next]);
    setHasMore(more);
    setLoadingMore(false);
  }

  function refreshLikeCounts(newsId: string) {
    setItems((prev) =>
      prev.map((n) => {
        if (n.id !== newsId) return n;
        const liked = !n.iLiked;
        return {
          ...n,
          iLiked: liked,
          likeCount: n.likeCount + (liked ? 1 : -1),
        };
      }),
    );
  }

  async function toggleLike(card: NewsLite) {
    if (!userId || liking.current.has(card.id)) return;
    liking.current.add(card.id);
    Haptics.selectionAsync().catch(() => {});
    const wasLiked = card.iLiked;
    refreshLikeCounts(card.id); // Optimistic update
    // Comme le web : la ligne est identifiée par (news_id, user_id)
    const { error } = wasLiked
      ? await sb.from('news_likes').delete().eq('news_id', card.id).eq('user_id', userId)
      : await sb.from('news_likes').insert({ news_id: card.id, user_id: userId });
    if (error) refreshLikeCounts(card.id); // rollback
    liking.current.delete(card.id);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.flex}>
        <View style={styles.heroBlock}>
          <Text style={styles.heroLabel}>Les Artistes</Text>
          <Text style={styles.heroTitle}>Actualités</Text>
        </View>
        <View style={{ paddingHorizontal: theme.s(5) }}>
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  const open = items.find((n) => n.id === openId) ?? null;

  return (
    <SafeAreaView style={styles.flex}>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingBottom: theme.s(10) }}
        ListHeaderComponent={
          <View style={styles.heroBlock}>
            <Text style={styles.heroLabel}>Les Artistes</Text>
            <Text style={styles.heroTitle}>Actualités</Text>
            <Text style={styles.heroSub}>Quoi de neuf chez nous ?</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="newspaper-outline" size={40} color={theme.colors.muted} />
            <Text style={styles.emptyText}>Aucune actu pour l&apos;instant.</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: theme.s(4) }}>
              <ActivityIndicator color={theme.colors.teal} />
            </View>
          ) : !hasMore && items.length > PAGE_SIZE ? (
            <Text style={styles.endText}>Tu as tout vu.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <NewsCardView
            card={item}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setOpenId(item.id);
            }}
            onLike={() => toggleLike(item)}
          />
        )}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.teal}
          />
        }
      />
      <Modal
        visible={!!open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenId(null)}
      >
        {open && userId && (
          <NewsDetail
            news={open}
            authorName={authorName(open.author)}
            currentUserId={userId}
            profiles={profiles}
            onClose={() => setOpenId(null)}
            onCommentPosted={() => {
              setItems((prev) =>
                prev.map((n) => (n.id === open.id ? { ...n, commentCount: n.commentCount + 1 } : n)),
              );
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonImage} />
      <View style={{ padding: theme.s(3) }}>
        <View style={[styles.skeletonLine, { width: '70%', height: 18 }]} />
        <View style={[styles.skeletonLine, { width: '90%', marginTop: 8 }]} />
        <View style={[styles.skeletonLine, { width: '60%', marginTop: 6 }]} />
      </View>
    </View>
  );
}

function NewsCardView({
  card,
  onPress,
  onLike,
}: {
  card: NewsLite;
  onPress: () => void;
  onLike: () => void;
}) {
  const author = authorName(card.author);
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.cardTapZone, pressed && { opacity: 0.92 }]}
      >
        {card.cover_url && (
          <Image source={{ uri: card.cover_url }} style={styles.cover} contentFit="cover" />
        )}
        <View style={{ padding: theme.s(3) }}>
          <Text style={styles.cardTitle}>{card.titre}</Text>
          <Text style={styles.cardMeta}>
            {author} · {new Date(card.created_at).toLocaleDateString('fr-FR')}
          </Text>
        </View>
      </Pressable>
      <View style={styles.cardActions}>
        <Pressable
          onPress={onLike}
          hitSlop={8}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
        >
          <Ionicons
            name={card.iLiked ? 'heart' : 'heart-outline'}
            size={20}
            color={card.iLiked ? theme.colors.coral : theme.colors.muted}
          />
          <Text style={[styles.actionCount, card.iLiked && { color: theme.colors.coral }]}>
            {card.likeCount}
          </Text>
        </Pressable>
        <Pressable
          onPress={onPress}
          hitSlop={8}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
        >
          <Ionicons name="chatbubble-outline" size={18} color={theme.colors.muted} />
          <Text style={styles.actionCount}>{card.commentCount}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onPress} hitSlop={8} style={styles.readMoreBtn}>
          <Text style={styles.readMoreText}>Lire</Text>
          <Ionicons name="arrow-forward" size={14} color={theme.colors.coral} />
        </Pressable>
      </View>
    </View>
  );
}

function NewsDetail({
  news,
  authorName: authorNameStr,
  currentUserId,
  profiles,
  onClose,
  onCommentPosted,
}: {
  news: NewsLite;
  authorName: string;
  currentUserId: string;
  profiles: Record<string, ProfileMini>;
  onClose: () => void;
  onCommentPosted: () => void;
}) {
  const [contenu, setContenu] = useState<string | null>(null);
  const [comments, setComments] = useState<NewsComment[]>([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(true);
  // Profils des commentateurs qui n'ont écrit aucune news chargée
  const [commenters, setCommenters] = useState<Record<string, ProfileMini>>({});

  const loadAll = useCallback(async () => {
    const [contentRes, commentsRes] = await Promise.all([
      sb.from('news').select('contenu').eq('id', news.id).single(),
      sb.from('news_comments').select('*').eq('news_id', news.id).order('created_at', { ascending: true }),
    ]);
    const list = (commentsRes.data as NewsComment[] | null) ?? [];
    setContenu((contentRes.data as { contenu: string } | null)?.contenu ?? '');
    setComments(list);
    setLoadingDetail(false);
    const uids = Array.from(new Set([currentUserId, ...list.map((c) => c.user_id)].filter(Boolean)));
    if (uids.length) {
      const { data } = await sb.from('profiles').select('id,prenom,nom,pseudo').in('id', uids);
      const map: Record<string, ProfileMini> = {};
      (data ?? []).forEach((p) => {
        map[p.id] = p as ProfileMini;
      });
      setCommenters(map);
    }
  }, [news.id, currentUserId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function postComment() {
    const t = text.trim();
    if (!t) return;
    setPosting(true);
    const { error, data } = await sb
      .from('news_comments')
      .insert({
        news_id: news.id,
        user_id: currentUserId,
        contenu: t,
      })
      .select('*')
      .single();
    setPosting(false);
    if (!error && data) {
      setText('');
      setComments((prev) => [...prev, data as NewsComment]);
      onCommentPosted();
    }
  }

  function nameOf(uid: string) {
    return authorName(profiles[uid] ?? commenters[uid]);
  }

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.detailHeader}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.detailHeaderBtn}>
          <Ionicons name="close" size={26} color={theme.colors.text} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={20}
      >
        <ScrollView contentContainerStyle={{ padding: theme.s(5) }}>
          {news.cover_url && (
            <Image source={{ uri: news.cover_url }} style={styles.detailCover} contentFit="cover" />
          )}
          <Text style={styles.detailTitle}>{news.titre}</Text>
          <Text style={styles.detailMetaText}>
            {authorNameStr} ·{' '}
            {new Date(news.created_at).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Text>
          {loadingDetail ? (
            <View style={{ marginTop: theme.s(5) }}>
              <View style={[styles.skeletonLine, { width: '95%' }]} />
              <View style={[styles.skeletonLine, { width: '88%', marginTop: 8 }]} />
              <View style={[styles.skeletonLine, { width: '72%', marginTop: 8 }]} />
            </View>
          ) : (
            <Text style={styles.detailContent}>{contenu ? stripHtml(contenu) : ''}</Text>
          )}

          <Text style={styles.detailSection}>Commentaires ({comments.length})</Text>
          {comments.length === 0 && !loadingDetail && (
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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },

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
  heroSub: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 14, marginTop: 6, marginBottom: theme.s(4) },

  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.s(3),
    overflow: 'hidden',
    marginHorizontal: theme.s(5),
  },
  cardTapZone: {},
  cover: { width: '100%', height: 180 },
  cardTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serif,
    fontSize: 19,
    lineHeight: 24,
    marginBottom: 6,
  },
  cardMeta: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 12 },

  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.s(3),
    paddingVertical: theme.s(2),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 6,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    minHeight: 36,
  },
  actionBtnPressed: { backgroundColor: theme.colors.surface2 },
  actionCount: { color: theme.colors.muted, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  readMoreBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 },
  readMoreText: { color: theme.colors.coral, fontFamily: theme.fonts.bodyBold, fontSize: 13 },

  empty: { padding: theme.s(10), alignItems: 'center', gap: theme.s(2) },
  emptyText: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 14 },
  endText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.body,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: theme.s(4),
  },

  skeletonCard: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.s(3),
    overflow: 'hidden',
  },
  skeletonImage: { height: 180, backgroundColor: theme.colors.surface2 },
  skeletonLine: { height: 12, borderRadius: 4, backgroundColor: theme.colors.surface2 },

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
  detailCover: {
    width: '100%',
    height: 200,
    borderRadius: theme.radius.lg,
    marginBottom: theme.s(4),
  },
  detailTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  detailMetaText: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 13, marginBottom: theme.s(4) },
  detailContent: { color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 16, lineHeight: 24 },
  detailSection: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: theme.s(6),
    marginBottom: theme.s(2),
  },
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
});
