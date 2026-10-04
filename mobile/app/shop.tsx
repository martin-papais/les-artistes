import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
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
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  sb,
  type ShopArticle,
  type ShopConfig,
  type ShopOrder,
  type SondageCandidat,
  type SondageVote, sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const WEB_BASE = 'https://les--artistes.fr';
const VOTES_MAX_DEFAULT = 3; // comme sondageVotesMaxDefault côté web

function imageUrl(name: string | null | undefined): string | null {
  if (!name) return null;
  if (/^https?:\/\//i.test(name)) return name;
  return `${WEB_BASE}/images/${encodeURIComponent(name)}`;
}

function parseTailles(t: string | null): string[] {
  if (!t) return ['S', 'M', 'L'];
  return t.split(',').map((x) => x.trim()).filter(Boolean);
}

type Tab = 'articles' | 'sondage';

export default function ShopScreen() {
  const [tab, setTab] = useState<Tab>('articles');
  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.subTabs}>
        <SubTab
          label="Articles"
          icon="bag"
          active={tab === 'articles'}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setTab('articles');
          }}
        />
        <SubTab
          label="Sondage"
          icon="star"
          active={tab === 'sondage'}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            setTab('sondage');
          }}
        />
      </View>
      {tab === 'articles' ? <ArticlesView /> : <SondageView />}
    </SafeAreaView>
  );
}

function SubTab({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.subTab,
        active && styles.subTabActive,
        pressed && !active && { backgroundColor: theme.colors.surface2 },
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={active ? '#fff' : theme.colors.muted}
      />
      <Text style={[styles.subTabText, active && styles.subTabTextActive]}>{label}</Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ARTICLES (boutique)
// ─────────────────────────────────────────────────────────────────────────────

type ArticleCard = ShopArticle & { myOrders: ShopOrder[] };

function ArticlesView() {
  const [articles, setArticles] = useState<ArticleCard[]>([]);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const loadAll = useCallback(async () => {
    const user = await sessionUser();
    setUserId(user?.id ?? null);

    const [artRes, ordRes, cfgRes] = await Promise.all([
      sb.from('shop_articles').select('*').order('created_at', { ascending: true }),
      user
        ? sb.from('shop_orders').select('*').eq('user_id', user.id)
        : Promise.resolve({ data: [] as ShopOrder[] }),
      sb.from('shop_config').select('*').eq('key', 'deadline').maybeSingle(),
    ]);

    const ordersByArt: Record<string, ShopOrder[]> = {};
    (ordRes.data ?? []).forEach((o) => {
      const list = ordersByArt[(o as ShopOrder).article_id] ?? (ordersByArt[(o as ShopOrder).article_id] = []);
      list.push(o as ShopOrder);
    });

    setArticles(
      ((artRes.data ?? []) as ShopArticle[]).map((a) => ({
        ...a,
        myOrders: ordersByArt[a.id] ?? [],
      })),
    );

    const cfg = cfgRes.data as ShopConfig | null;
    setDeadline(cfg?.value ? new Date(cfg.value) : null);
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

  const isClosed = deadline ? now >= deadline.getTime() : false;
  const open = articles.find((a) => a.id === openId) ?? null;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.teal} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <FlatList
        data={articles}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: theme.s(4), paddingBottom: theme.s(10) }}
        ListHeaderComponent={
          <View>
            {!!deadline && (
              <View style={[styles.deadline, isClosed && styles.deadlineClosed]}>
                <Ionicons
                  name={isClosed ? 'lock-closed' : 'time-outline'}
                  size={16}
                  color={isClosed ? theme.colors.danger : theme.colors.yellow}
                />
                <Text style={styles.deadlineText}>
                  {isClosed
                    ? `Commandes fermées depuis le ${deadline.toLocaleDateString('fr-FR')}`
                    : `Date limite : ${deadline.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                </Text>
              </View>
            )}
            <Text style={styles.bigSub}>{articles.length} articles · groupez vos commandes</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Aucun article pour l&apos;instant.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ArticleCardView
            article={item}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              setOpenId(item.id);
            }}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.teal} />
        }
      />
      <Modal
        visible={!!open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenId(null)}
      >
        {open && userId && (
          <ArticleDetail
            article={open}
            currentUserId={userId}
            isClosed={isClosed}
            onClose={() => setOpenId(null)}
            onSaved={() => {
              setOpenId(null);
              loadAll();
            }}
          />
        )}
      </Modal>
    </View>
  );
}

function ArticleCardView({ article, onPress }: { article: ArticleCard; onPress: () => void }) {
  const url = imageUrl(article.image);
  const total = article.myOrders.length;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}
    >
      {url ? (
        <Image
          source={{ uri: url }}
          style={styles.cardImage}
          contentFit="cover"
          onError={(e) => console.warn('[shop] image fail:', url, e.error)}
        />
      ) : (
        <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
          <Ionicons name="shirt-outline" size={48} color={theme.colors.muted} />
        </View>
      )}
      <View style={{ padding: theme.s(3) }}>
        {!!article.badge && (
          <View style={styles.articleBadge}>
            <Text style={styles.articleBadgeText}>{article.badge}</Text>
          </View>
        )}
        <Text style={styles.cardTitle}>{article.nom}</Text>
        {article.prix !== null && <Text style={styles.cardPrice}>{article.prix.toFixed(2)} €</Text>}
        {total > 0 && (
          <View style={styles.myOrderTag}>
            <Ionicons name="checkmark-circle" size={14} color={theme.colors.teal} />
            <Text style={styles.myOrderText}>{total} commandé·e·s</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function ArticleDetail({
  article,
  currentUserId,
  isClosed,
  onClose,
  onSaved,
}: {
  article: ArticleCard;
  currentUserId: string;
  isClosed: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tailles = useMemo(() => parseTailles(article.tailles), [article.tailles]);
  const [qtyByTaille, setQtyByTaille] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    tailles.forEach((t) => {
      map[t] = article.myOrders.filter((o) => o.taille === t).length;
    });
    return map;
  });
  const [perso, setPerso] = useState<string>(article.myOrders[0]?.personnalisation ?? '');
  const [saving, setSaving] = useState(false);

  const allImages = [article.image, article.image2, article.image3, article.image4]
    .map(imageUrl)
    .filter((u): u is string => !!u);

  function bump(t: string, d: number) {
    Haptics.selectionAsync().catch(() => {});
    setQtyByTaille((prev) => ({
      ...prev,
      [t]: Math.max(0, (prev[t] ?? 0) + d),
    }));
  }

  async function confirmOrder() {
    if (isClosed) {
      Alert.alert('Commandes fermées', 'La date limite est dépassée.');
      return;
    }
    setSaving(true);
    try {
      // Lignes actuelles : supprimées seulement une fois les nouvelles enregistrées (comme le web)
      const old = await sb
        .from('shop_orders')
        .select('id')
        .eq('article_id', article.id)
        .eq('user_id', currentUserId);
      if (old.error) throw new Error(old.error.message);
      const oldIds = (old.data ?? []).map((o: { id: string }) => o.id);

      const toInsert: Omit<ShopOrder, 'id'>[] = [];
      Object.entries(qtyByTaille).forEach(([taille, qty]) => {
        for (let i = 0; i < qty; i++) {
          toInsert.push({
            article_id: article.id,
            user_id: currentUserId,
            taille,
            personnalisation: perso.trim() || null,
          });
        }
      });
      let newIds: string[] = [];
      if (toInsert.length) {
        const ins = await sb.from('shop_orders').insert(toInsert).select('id');
        if (ins.error) {
          throw new Error(`${ins.error.message} (ta commande précédente est conservée)`);
        }
        newIds = (ins.data ?? []).map((o: { id: string }) => o.id);
      }

      if (oldIds.length) {
        const del = await sb.from('shop_orders').delete().in('id', oldIds);
        if (del.error) {
          // On retire les nouvelles lignes pour ne pas cumuler ancienne + nouvelle commande
          if (newIds.length) await sb.from('shop_orders').delete().in('id', newIds);
          throw new Error(`${del.error.message} (ta commande précédente est conservée)`);
        }
      }
      onSaved();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.');
    } finally {
      setSaving(false);
    }
  }

  const totalCount = Object.values(qtyByTaille).reduce((s, n) => s + n, 0);
  const totalPrice = totalCount * (article.prix ?? 0);

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.modalTopBar}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.modalCloseBtn}>
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.modalTopTitle} numberOfLines={1}>
          {article.nom}
        </Text>
        <View style={{ width: 36 }} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: theme.s(5), paddingBottom: theme.s(10) }}>
          {allImages.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: theme.s(4) }}>
              {allImages.map((u, i) => (
                <Image
                  key={i}
                  source={{ uri: u }}
                  style={styles.detailImg}
                  contentFit="cover"
                />
              ))}
            </ScrollView>
          )}
          <Text style={styles.detailTitle}>{article.nom}</Text>
          {article.prix !== null && <Text style={styles.detailPrice}>{article.prix.toFixed(2)} €</Text>}
          {!!article.description && <Text style={styles.detailDesc}>{article.description}</Text>}

          <Text style={styles.section}>Choisis tes tailles</Text>
          {tailles.map((t) => (
            <View key={t} style={styles.tailleRow}>
              <Text style={styles.tailleLabel}>{t}</Text>
              <View style={styles.qtyRow}>
                <Pressable
                  onPress={() => bump(t, -1)}
                  disabled={isClosed || (qtyByTaille[t] ?? 0) === 0}
                  style={({ pressed }) => [styles.qtyBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="remove" size={20} color={theme.colors.text} />
                </Pressable>
                <Text style={styles.qtyVal}>{qtyByTaille[t] ?? 0}</Text>
                <Pressable
                  onPress={() => bump(t, 1)}
                  disabled={isClosed}
                  style={({ pressed }) => [styles.qtyBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="add" size={20} color={theme.colors.text} />
                </Pressable>
              </View>
            </View>
          ))}

          <Text style={styles.section}>Personnalisation (optionnel)</Text>
          <TextInput
            value={perso}
            onChangeText={setPerso}
            placeholder="Ex: nom à floquer, n° au dos…"
            placeholderTextColor={theme.colors.muted}
            style={styles.input}
            multiline
            editable={!isClosed}
          />

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>
              {totalCount} pièce·s · {totalPrice.toFixed(2)} €
            </Text>
          </View>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              confirmOrder();
            }}
            disabled={saving || isClosed}
            style={({ pressed }) => [
              styles.confirmBtn,
              (pressed || saving || isClosed) && { opacity: 0.6 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.confirmText}>
                {isClosed ? 'Commandes fermées' : 'Confirmer ma commande'}
              </Text>
            )}
          </Pressable>
          <Text style={styles.note}>
            Confirmer écrase tes commandes précédentes pour cet article.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SONDAGE (vote pour les futurs articles)
// ─────────────────────────────────────────────────────────────────────────────

function SondageView() {
  const [candidats, setCandidats] = useState<SondageCandidat[]>([]);
  const [votes, setVotes] = useState<SondageVote[]>([]);
  // Quota de votes par catégorie, stocké en JSON côté web : {"T-shirt":2,…}
  const [maxByCat, setMaxByCat] = useState<Record<string, number>>({});
  const voting = useRef(false);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    const user = await sessionUser();
    setUserId(user?.id ?? null);

    const [candRes, voteRes, cfgRes] = await Promise.all([
      sb.from('sondage_candidats').select('*').order('categorie').order('nom'),
      sb.from('sondage_votes').select('*'),
      sb.from('shop_config').select('*').in('key', ['sondage_deadline', 'sondage_votes_max_by_cat']),
    ]);

    setCandidats((candRes.data ?? []) as SondageCandidat[]);
    setVotes((voteRes.data ?? []) as SondageVote[]);
    const cfgs = (cfgRes.data ?? []) as ShopConfig[];
    const deadlineCfg = cfgs.find((c) => c.key === 'sondage_deadline');
    setDeadline(deadlineCfg?.value ? new Date(deadlineCfg.value) : null);
    const maxCfg = cfgs.find((c) => c.key === 'sondage_votes_max_by_cat');
    let parsedMax: Record<string, number> = {};
    if (maxCfg?.value) {
      try {
        const obj = JSON.parse(maxCfg.value);
        if (obj && typeof obj === 'object') parsedMax = obj;
      } catch {}
    }
    setMaxByCat(parsedMax);
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

  const grouped = useMemo(() => {
    const map: Record<string, SondageCandidat[]> = {};
    candidats.forEach((c) => {
      const list = map[c.categorie] ?? (map[c.categorie] = []);
      list.push(c);
    });
    return Object.entries(map);
  }, [candidats]);

  const myVotes = useMemo(
    () => (userId ? votes.filter((v) => v.user_id === userId) : []),
    [votes, userId],
  );

  const isClosed = deadline ? Date.now() >= deadline.getTime() : false;

  function votesMax(cat: string) {
    const v = Number(maxByCat[cat]);
    return Number.isFinite(v) && v > 0 ? v : VOTES_MAX_DEFAULT;
  }

  async function toggleVote(c: SondageCandidat) {
    if (!userId || voting.current) return;
    // Recalculé au clic : l'écran peut rester ouvert après l'échéance
    if (deadline && Date.now() >= deadline.getTime()) {
      Alert.alert('Sondage fermé', 'La date limite est dépassée.');
      return;
    }
    const mine = myVotes.find((v) => v.candidat_id === c.id);
    if (!mine) {
      const max = votesMax(c.categorie);
      const usedInCat = myVotes.filter((v) => v.categorie === c.categorie).length;
      if (usedInCat >= max) {
        Alert.alert(
          'Quota atteint',
          `Tu as déjà ${max} ${max > 1 ? 'votes' : 'vote'} dans cette catégorie. Retire un vote pour en ajouter un autre.`,
        );
        return;
      }
    }
    voting.current = true;
    Haptics.selectionAsync().catch(() => {});
    try {
      const { error } = mine
        ? await sb.from('sondage_votes').delete().eq('id', mine.id)
        : await sb
            .from('sondage_votes')
            .insert({ candidat_id: c.id, user_id: userId, categorie: c.categorie });
      if (error) Alert.alert('Erreur', error.message);
      await loadAll();
    } finally {
      voting.current = false;
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.teal} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: theme.s(4), paddingBottom: theme.s(10) }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.teal} />
      }
    >
      <Text style={styles.bigSub}>
        Vote pour les futurs articles
      </Text>
      {!!deadline && (
        <View style={[styles.deadline, isClosed && styles.deadlineClosed]}>
          <Ionicons
            name={isClosed ? 'lock-closed' : 'time-outline'}
            size={16}
            color={isClosed ? theme.colors.danger : theme.colors.yellow}
          />
          <Text style={styles.deadlineText}>
            {isClosed
              ? `Sondage fermé depuis le ${deadline.toLocaleDateString('fr-FR')}`
              : `Vote ouvert jusqu'au ${deadline.toLocaleDateString('fr-FR')}`}
          </Text>
        </View>
      )}

      {grouped.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Aucun candidat pour l&apos;instant.</Text>
        </View>
      )}

      {grouped.map(([cat, list]) => {
        const max = votesMax(cat);
        const left = Math.max(0, max - myVotes.filter((v) => v.categorie === cat).length);
        return (
        <View key={cat} style={{ marginTop: theme.s(4) }}>
          <Text style={styles.sondageSection}>
            {`${cat} · ${left}/${max} ${left > 1 ? 'votes restants' : 'vote restant'}`}
          </Text>
          {list.map((c) => {
            const count = votes.filter((v) => v.candidat_id === c.id).length;
            const iVoted = myVotes.some((v) => v.candidat_id === c.id);
            const url = imageUrl(c.image);
            return (
              <Pressable
                key={c.id}
                onPress={() => toggleVote(c)}
                style={({ pressed }) => [
                  styles.candidat,
                  iVoted && styles.candidatVoted,
                  pressed && { opacity: 0.92 },
                ]}
              >
                {url ? (
                  <Image source={{ uri: url }} style={styles.candidatImg} contentFit="cover" />
                ) : (
                  <View style={[styles.candidatImg, styles.candidatImgPlaceholder]}>
                    <Ionicons name="person" size={28} color={theme.colors.muted} />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.candidatName} numberOfLines={1}>{c.nom}</Text>
                  {!!c.description && (
                    <Text style={styles.candidatDesc} numberOfLines={2}>
                      {c.description}
                    </Text>
                  )}
                  <Text style={styles.candidatCount}>
                    {count} vote{count > 1 ? 's' : ''}
                  </Text>
                </View>
                {iVoted ? (
                  <Ionicons name="checkmark-circle" size={28} color={theme.colors.coral} />
                ) : (
                  <Ionicons name="ellipse-outline" size={26} color={theme.colors.muted} />
                )}
              </Pressable>
            );
          })}
        </View>
        );
      })}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.deep },

  subTabs: {
    flexDirection: 'row',
    paddingHorizontal: theme.s(4),
    paddingVertical: theme.s(3),
    gap: 8,
    backgroundColor: theme.colors.deep,
  },
  subTab: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
  },
  subTabActive: { backgroundColor: theme.colors.coral, borderColor: theme.colors.coral },
  subTabText: { color: theme.colors.muted, fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  subTabTextActive: { color: '#fff' },

  bigSub: { color: theme.colors.muted, fontFamily: theme.fonts.body, marginBottom: theme.s(3) },
  deadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,217,61,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,217,61,0.3)',
    borderRadius: theme.radius.md,
    padding: theme.s(3),
    marginBottom: theme.s(3),
  },
  deadlineClosed: {
    backgroundColor: 'rgba(255,107,107,0.1)',
    borderColor: 'rgba(255,107,107,0.3)',
  },
  deadlineText: { color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 13, flex: 1 },

  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.s(3),
    overflow: 'hidden',
  },
  cardImage: { width: '100%', height: 200 },
  cardImagePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  articleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 6,
  },
  articleBadgeText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 10, letterSpacing: 0.5 },
  cardTitle: { color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 17 },
  cardPrice: { color: theme.colors.yellow, fontFamily: theme.fonts.bodyBold, fontSize: 16, marginTop: 4 },
  myOrderTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  myOrderText: { color: theme.colors.teal, fontFamily: theme.fonts.bodyBold, fontSize: 12 },

  empty: { padding: theme.s(8), alignItems: 'center' },
  emptyText: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 14 },

  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.s(3),
    paddingTop: theme.s(2),
    paddingBottom: theme.s(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.deep,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  modalTopTitle: {
    flex: 1,
    color: theme.colors.text,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 15,
    textAlign: 'center',
    marginHorizontal: theme.s(2),
  },

  detailImg: { width: 280, height: 280, borderRadius: theme.radius.lg, marginRight: 8 },
  detailTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 26,
    lineHeight: 30,
  },
  detailPrice: {
    color: theme.colors.yellow,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 20,
    marginTop: 6,
  },
  detailDesc: {
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    fontSize: 14,
    lineHeight: 20,
    marginTop: theme.s(3),
  },
  section: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: theme.s(6),
    marginBottom: theme.s(2),
  },
  tailleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tailleLabel: {
    color: theme.colors.text,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 16,
    minWidth: 40,
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  qtyBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyVal: {
    color: theme.colors.text,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 18,
    minWidth: 30,
    textAlign: 'center',
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
    minHeight: 60,
    textAlignVertical: 'top',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.s(4),
    marginTop: theme.s(3),
  },
  totalLabel: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyMedium,
    fontSize: 14,
  },
  totalValue: {
    color: theme.colors.text,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 18,
  },
  confirmBtn: {
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  confirmText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  note: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.body,
    fontSize: 11,
    textAlign: 'center',
    marginTop: theme.s(2),
  },

  // SONDAGE
  sondageSection: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 22,
    lineHeight: 26,
    marginBottom: theme.s(2),
  },
  candidat: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    padding: theme.s(3),
    marginBottom: theme.s(2),
    minHeight: 88,
  },
  candidatVoted: { borderColor: theme.colors.coral, backgroundColor: 'rgba(255,107,107,0.08)' },
  candidatImg: { width: 64, height: 64, borderRadius: theme.radius.md },
  candidatImgPlaceholder: {
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  candidatName: {
    color: theme.colors.text,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 16,
  },
  candidatDesc: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.body,
    fontSize: 12,
    marginTop: 2,
  },
  candidatCount: {
    color: theme.colors.teal,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    marginTop: 4,
  },
});
