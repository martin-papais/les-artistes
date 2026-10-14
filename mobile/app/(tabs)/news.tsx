import { Feather, Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomFade, commentTime, dayLabel, MoreButton } from '@/components/news/parts';
import { EmptyState, IconButton, Pastille, ScreenHeader, SectionTitle } from '@/components/ui/kit';
import {
  sb,
  type NewsComment,
  type NewsLike,
  type NewsRow,
  type ProfileMini, sessionUser } from '@/lib/supabase';
import { getBlocked } from '@/lib/moderation';
import { KeyboardAware } from '@/lib/keyboard';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const PAGE_SIZE = 20;

type NewsLite = Omit<NewsRow, 'contenu'> & {
  author?: ProfileMini | null;
  likeCount: number;
  iLiked: boolean;
  commentCount: number;
};

// Images insérées dans le texte depuis le site (bouton « image » de l'éditeur)
// Le site insère l'adresse tapée telle quelle : on la rend absolue et en https
// (iOS et Android bloquent le http en clair), le reste est ignoré
function imagesOf(html: string) {
  const urls: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let url = m[1].replace(/&amp;/g, '&').trim();
    if (url.startsWith('data:')) {
      if (url.startsWith('data:image/')) urls.push(url);
      continue;
    }
    try {
      url = new URL(url, 'https://les--artistes.fr/').href.replace(/^http:/, 'https:');
    } catch {
      continue;
    }
    if (url.startsWith('https://')) urls.push(url);
  }
  return urls;
}

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
  const router = useRouter();
  const [items, setItems] = useState<NewsLite[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [me, setMe] = useState<ProfileMini | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const lastOpen = useRef<NewsLite | null>(null);
  const liking = useRef(new Set<string>());
  const meLoaded = useRef(false);
  // Lignes déjà lues côté serveur, news masquées comprises (items.length les ignore)
  const offset = useRef(0);

  const fetchPage = useCallback(
    async (offset: number, currentUserId: string | null) => {
      const lightSelect = 'id,titre,tags,cover_url,created_by,created_at';
      const [{ data: page }, blocked] = await Promise.all([
        sb
          .from('news')
          .select(lightSelect)
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1),
        getBlocked(),
      ]);
      if (!page || page.length === 0) {
        return { items: [] as NewsLite[], hasMore: false, consumed: 0 };
      }
      const pageFull = page.length === PAGE_SIZE;
      // Les news des membres bloqués sont masquées
      const rows = page.filter((r: { created_by: string }) => !blocked.has(r.created_by));
      if (rows.length === 0) {
        return { items: [] as NewsLite[], hasMore: pageFull, consumed: page.length };
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
      return { items: cards, hasMore: pageFull, consumed: page.length };
    },
    [],
  );

  const loadInitial = useCallback(async () => {
    const user = await sessionUser();
    const uid = user?.id ?? null;
    setUserId(uid);
    // Ma pastille dans l'en-tête : un seul chargement par session de l'écran
    const mineRes =
      uid && !meLoaded.current
        ? sb.from('profiles').select('id,prenom,nom,pseudo').eq('id', uid).maybeSingle()
        : null;
    const [{ items, hasMore, consumed }, mine] = await Promise.all([fetchPage(0, uid), mineRes]);
    if (mine?.data) {
      meLoaded.current = true;
      setMe(mine.data as ProfileMini);
    }
    offset.current = consumed;
    setItems(items);
    setHasMore(hasMore);
    setLoading(false);
  }, [fetchPage]);

  useRefreshOnFocus(loadInitial);

  async function onRefresh() {
    setRefreshing(true);
    try {
      const { items, hasMore, consumed } = await fetchPage(0, userId);
      offset.current = consumed;
      setItems(items);
      setHasMore(hasMore);
    } finally {
      setRefreshing(false);
    }
  }

  async function onEndReached() {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const { items: next, hasMore: more, consumed } = await fetchPage(offset.current, userId);
      offset.current += consumed;
      setItems((prev) => [...prev, ...next.filter((n) => !prev.some((p) => p.id === n.id))]);
      setHasMore(more);
    } finally {
      setLoadingMore(false);
    }
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
    if (error) {
      refreshLikeCounts(card.id); // rollback
      Alert.alert('Erreur', error.message);
    }
    liking.current.delete(card.id);
  }

  const header = (
    <ScreenHeader
      title="Actualités"
      sub="Quoi de neuf chez nous ?"
      style={{ paddingBottom: 20 }}
      right={
        me ? (
          <Pressable
            onPress={() => router.push('/profil')}
            accessibilityRole="button"
            accessibilityLabel="Mon profil"
            style={({ pressed }) => pressed && { opacity: 0.7 }}
          >
            <Pastille id={me.id} name={authorName(me)} size={44} />
          </Pressable>
        ) : null
      }
    />
  );

  if (loading) {
    return (
      <View style={styles.flex}>
        {header}
        <View style={{ paddingHorizontal: theme.gutter }}>
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </View>
      </View>
    );
  }

  // Un rechargement au retour dans l'appli ne garde que la 1re page : la fiche
  // ouverte (et son plein écran) ne doit pas se fermer pour autant
  const found = items.find((n) => n.id === openId);
  if (found) lastOpen.current = found;
  const open = openId ? (found ?? lastOpen.current) : null;

  return (
    <View style={styles.flex}>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingBottom: theme.s(8) }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState icon="file-text" title="Aucune actu pour l'instant" text="Les nouvelles du groupe arriveront ici." />
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={{ paddingVertical: theme.s(4) }}>
              <ActivityIndicator color={c.teal} />
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
            currentUserId={userId}
            onBlocked={loadInitial}
          />
        )}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.teal}
          />
        }
      />
      <Modal
        statusBarTranslucent
        navigationBarTranslucent
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
            onLike={() => toggleLike(open)}
            onBlocked={() => {
              setOpenId(null);
              loadInitial();
            }}
            onCommentPosted={() => {
              setItems((prev) =>
                prev.map((n) => (n.id === open.id ? { ...n, commentCount: n.commentCount + 1 } : n)),
              );
            }}
          />
        )}
      </Modal>
    </View>
  );
}

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonImage} />
      <View style={{ padding: 16 }}>
        <View style={[styles.skeletonLine, { width: '45%' }]} />
        <View style={[styles.skeletonLine, { width: '80%', height: 18, marginTop: 12 }]} />
      </View>
    </View>
  );
}

function LikeButton({ liked, count, onPress, style }: { liked: boolean; count: number; onPress: () => void; style?: object }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`J'aime, ${count}`}
      accessibilityState={{ selected: liked }}
      style={({ pressed }) => [styles.act, style, pressed && styles.actPressed]}
    >
      {/* Feather n'a pas de cœur plein : Ionicons pour les deux états */}
      <Ionicons name={liked ? 'heart' : 'heart-outline'} size={21} color={c.coral} />
      <Text style={styles.actText}>{count}</Text>
    </Pressable>
  );
}

function NewsCardView({
  card,
  onPress,
  onLike,
  currentUserId,
  onBlocked,
}: {
  card: NewsLite;
  onPress: () => void;
  onLike: () => void;
  currentUserId: string | null;
  onBlocked: () => void;
}) {
  const author = authorName(card.author);
  return (
    <View style={styles.card}>
      {/* Toute la carte ouvre l'actu */}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${card.titre}, par ${author}`}
        style={({ pressed }) => pressed && { opacity: 0.9 }}
      >
        {!!card.cover_url && (
          <Image source={{ uri: card.cover_url }} style={styles.cover} contentFit="cover" />
        )}
        <View style={styles.cardBody}>
          <View style={styles.byline}>
            <Pastille id={card.created_by} name={author} size={24} />
            <Text style={styles.bylineText} numberOfLines={1}>
              <Text style={styles.bylineName}>{author}</Text>, {dayLabel(card.created_at)}
            </Text>
          </View>
          <Text style={styles.cardTitle}>{card.titre}</Text>
        </View>
      </Pressable>
      <View style={styles.cardActions}>
        <LikeButton liked={card.iLiked} count={card.likeCount} onPress={onLike} />
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={card.commentCount > 1 ? `${card.commentCount} commentaires` : `${card.commentCount} commentaire`}
          style={({ pressed }) => [styles.act, pressed && styles.actPressed]}
        >
          <Feather name="message-circle" size={21} color={c.text} />
          <Text style={styles.actText}>{card.commentCount}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <MoreButton
          kind="news"
          itemId={card.id}
          authorId={card.created_by}
          authorName={author}
          excerpt={card.titre}
          currentUserId={currentUserId}
          onBlocked={onBlocked}
        />
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
  onLike,
  onBlocked,
  onCommentPosted,
}: {
  news: NewsLite;
  authorName: string;
  currentUserId: string;
  profiles: Record<string, ProfileMini>;
  onClose: () => void;
  onLike: () => void;
  onBlocked: () => void;
  onCommentPosted: () => void;
}) {
  const [contenu, setContenu] = useState<string | null>(null);
  // Calculé une fois : une image collée en base64 pèse plusieurs Mo
  const body = useMemo(
    () => (contenu ? { text: stripHtml(contenu), images: imagesOf(contenu) } : { text: '', images: [] }),
    [contenu],
  );
  const [comments, setComments] = useState<NewsComment[]>([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  // Images en échec (lien mort, page web collée à la place d'une image) : masquées
  const [brokenImages, setBrokenImages] = useState<Set<number>>(new Set());
  const insets = useSafeAreaInsets();
  // Profils des commentateurs qui n'ont écrit aucune news chargée
  const [commenters, setCommenters] = useState<Record<string, ProfileMini>>({});

  const loadAll = useCallback(async () => {
    const [contentRes, commentsRes] = await Promise.all([
      sb.from('news').select('contenu').eq('id', news.id).single(),
      sb.from('news_comments').select('*').eq('news_id', news.id).order('created_at', { ascending: true }),
    ]);
    const blocked = await getBlocked();
    const list = ((commentsRes.data as NewsComment[] | null) ?? []).filter((c) => !blocked.has(c.user_id));
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
    if (error) Alert.alert('Erreur', error.message);
    if (!error && data) {
      setText('');
      setComments((prev) => [...prev, data as NewsComment]);
      onCommentPosted();
    }
  }

  function nameOf(uid: string) {
    return authorName(profiles[uid] ?? commenters[uid]);
  }

  const canSend = !posting && !!text.trim();

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.flex}>
        <KeyboardAware>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: theme.s(6) }}>
            {news.cover_url ? (
              <Pressable
                onPress={() => setViewerUrl(news.cover_url)}
                accessibilityRole="imagebutton"
                accessibilityLabel="Agrandir la photo"
              >
                <Image source={{ uri: news.cover_url }} style={styles.detailCover} contentFit="cover" />
                <BottomFade />
              </Pressable>
            ) : (
              // Place des boutons Fermer et « … » quand il n'y a pas de photo
              <View style={{ height: 68 }} />
            )}
            <View style={{ paddingHorizontal: theme.gutter }}>
              <Text style={[styles.detailTitle, !!news.cover_url && { marginTop: -6 }]}>{news.titre}</Text>
              <View style={[styles.byline, { marginTop: 10 }]}>
                <Pastille id={news.created_by} name={authorNameStr} size={28} />
                <Text style={[styles.bylineText, { fontSize: 14 }]} numberOfLines={1}>
                  <Text style={styles.bylineName}>{authorNameStr}</Text>, {dayLabel(news.created_at, true)}
                </Text>
              </View>
              {loadingDetail ? (
                <View style={{ marginTop: 18 }}>
                  <View style={[styles.skeletonLine, { width: '95%' }]} />
                  <View style={[styles.skeletonLine, { width: '88%', marginTop: 10 }]} />
                  <View style={[styles.skeletonLine, { width: '72%', marginTop: 10 }]} />
                </View>
              ) : (
                <>
                  {!!body.text && <Text style={styles.detailContent}>{body.text}</Text>}
                  {body.images.map((url, i) =>
                    brokenImages.has(i) ? null : (
                      <Pressable
                        key={i}
                        onPress={() => setViewerUrl(url)}
                        accessibilityRole="imagebutton"
                        accessibilityLabel="Agrandir l’image"
                      >
                        <Image
                          source={{ uri: url }}
                          style={styles.inlineImage}
                          contentFit="cover"
                          onError={() => setBrokenImages((prev) => new Set(prev).add(i))}
                        />
                      </Pressable>
                    ),
                  )}
                </>
              )}

              <SectionTitle count={comments.length} style={{ marginTop: 22, marginBottom: 10 }}>
                Commentaires
              </SectionTitle>
              {comments.length === 0 && !loadingDetail && (
                <Text style={styles.emptyText}>Personne n&apos;a encore commenté.</Text>
              )}
              {comments.map((cm) => (
                <View key={cm.id} style={styles.comment}>
                  <Pastille id={cm.user_id} name={nameOf(cm.user_id)} size={32} />
                  <View style={styles.bubble}>
                    <View style={styles.bubbleHead}>
                      <Text style={styles.commentAuthor} numberOfLines={1}>
                        {nameOf(cm.user_id)} <Text style={styles.commentTime}>{commentTime(cm.created_at)}</Text>
                      </Text>
                      <MoreButton
                        kind="news_comment"
                        itemId={cm.id}
                        authorId={cm.user_id}
                        authorName={nameOf(cm.user_id)}
                        excerpt={cm.contenu}
                        currentUserId={currentUserId}
                        size={28}
                        style={{ marginRight: -8, marginVertical: -4 }}
                        onBlocked={() => setComments((prev) => prev.filter((x) => x.user_id !== cm.user_id))}
                      />
                    </View>
                    <Text style={styles.commentText}>{cm.contenu}</Text>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={styles.composer}>
            <LikeButton liked={news.iLiked} count={news.likeCount} onPress={onLike} style={styles.composerLike} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Écrire un commentaire"
              placeholderTextColor={c.muted}
              selectionColor={c.coral}
              accessibilityLabel="Écrire un commentaire"
              style={styles.commentInput}
              multiline
            />
            <Pressable
              onPress={postComment}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Envoyer"
              accessibilityState={{ disabled: !canSend }}
              style={({ pressed }) => [
                styles.sendBtn,
                { backgroundColor: canSend || posting ? c.coral : c.rail },
                pressed && { opacity: 0.8 },
              ]}
            >
              {posting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Feather name="send" size={19} color={canSend ? '#fff' : c.muted} />
              )}
            </Pressable>
          </View>
        </KeyboardAware>

        {/* Posés sur la photo, fixes pendant le défilement */}
        <View style={styles.detailTop} pointerEvents="box-none">
          <IconButton name="x" label="Fermer" onPress={onClose} bg="rgba(26,16,37,0.6)" />
          <MoreButton
            kind="news"
            itemId={news.id}
            authorId={news.created_by}
            authorName={authorNameStr}
            excerpt={news.titre}
            currentUserId={currentUserId}
            color={c.text}
            bg="rgba(26,16,37,0.6)"
            onBlocked={onBlocked}
          />
        </View>
      </View>
      <Modal
        visible={!!viewerUrl}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerUrl(null)}
        statusBarTranslucent
        navigationBarTranslucent
      >
        {!!viewerUrl && (
          <View style={styles.viewer}>
            <Image source={{ uri: viewerUrl }} style={StyleSheet.absoluteFill} contentFit="contain" />
            <IconButton
              name="x"
              label="Fermer"
              onPress={() => setViewerUrl(null)}
              color="#fff"
              bg="rgba(0,0,0,0.5)"
              style={[styles.viewerClose, { top: insets.top + 8 }]}
            />
          </View>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },

  card: {
    backgroundColor: c.card,
    borderRadius: 22,
    marginBottom: 12,
    overflow: 'hidden',
    marginHorizontal: theme.gutter,
  },
  cover: { width: '100%', height: 190 },
  cardBody: { paddingTop: 14, paddingHorizontal: 16 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bylineText: { flex: 1, color: c.muted, fontFamily: theme.fonts.body, fontSize: 13 },
  bylineName: { color: c.text, fontFamily: theme.fonts.bodyBold },
  cardTitle: {
    color: c.text,
    fontFamily: theme.fonts.serif,
    fontSize: 22,
    lineHeight: 27,
    marginTop: 8,
  },

  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingHorizontal: 6,
    paddingBottom: 6,
  },
  act: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
  },
  actPressed: { backgroundColor: c.raised },
  actText: { color: c.text, fontFamily: theme.fonts.bodyBold, fontSize: 14 },

  emptyText: { color: c.muted, fontFamily: theme.fonts.body, fontSize: 14 },
  endText: {
    color: c.muted,
    fontFamily: theme.fonts.body,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: theme.s(4),
  },

  skeletonCard: {
    backgroundColor: c.card,
    borderRadius: 22,
    marginBottom: 12,
    overflow: 'hidden',
  },
  skeletonImage: { height: 190, backgroundColor: c.raised },
  skeletonLine: { height: 12, borderRadius: 6, backgroundColor: c.raised },

  detailTop: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailCover: { width: '100%', height: 270 },
  inlineImage: {
    width: '100%',
    height: 220,
    borderRadius: theme.radius.lg,
    marginTop: theme.s(4),
  },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerClose: { position: 'absolute', right: 16, zIndex: 10 },
  detailTitle: {
    color: c.text,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 30,
    lineHeight: 36,
  },
  detailContent: { color: c.text, fontFamily: theme.fonts.body, fontSize: 16, lineHeight: 25, marginTop: 16 },

  comment: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  bubble: {
    flexShrink: 1,
    backgroundColor: c.card,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  commentAuthor: { flexShrink: 1, color: c.text, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  commentTime: { color: c.muted, fontFamily: theme.fonts.bodyMedium },
  commentText: { color: c.text, fontFamily: theme.fonts.body, fontSize: 15, lineHeight: 21, marginTop: 4 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: c.hairline,
    backgroundColor: c.deep,
  },
  composerLike: { height: 46, borderRadius: 23, paddingHorizontal: 14, backgroundColor: c.card },
  commentInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    maxHeight: 120,
    backgroundColor: c.card,
    borderRadius: 23,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 13 : 10,
    paddingBottom: Platform.OS === 'ios' ? 13 : 10,
    color: c.text,
    fontFamily: theme.fonts.body,
    fontSize: 15,
    textAlignVertical: 'center',
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
