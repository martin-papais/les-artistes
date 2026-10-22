import { Feather, Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, BottomBar, Button, EmptyState, Field, ScreenHeader, Segmented } from '@/components/ui/kit';
import {
  sb,
  type ShopArticle,
  type ShopConfig,
  type ShopOrder,
  type SondageCandidat,
  type SondageVote, sessionUser } from '@/lib/supabase';
import { KeyboardAware } from '@/lib/keyboard';
import { usePageCache } from '@/lib/cache';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

const WEB_BASE = 'https://les--artistes.fr';
const VOTES_MAX_DEFAULT = 3; // comme sondageVotesMaxDefault côté web
const GRID_GAP = 12;

function imageUrl(name: string | null | undefined): string | null {
  if (!name) return null;
  if (/^https?:\/\//i.test(name)) return name;
  return `${WEB_BASE}/images/${encodeURIComponent(name)}`;
}

function parseTailles(t: string | null): string[] {
  if (!t) return ['S', 'M', 'L'];
  return t.split(',').map((x) => x.trim()).filter(Boolean);
}

/** 25 → « 25 € », 12.5 → « 12,50 € » */
function euros(n: number): string {
  const r = Math.round(n * 100) / 100;
  return `${Number.isInteger(r) ? r : r.toFixed(2).replace('.', ',')} €`;
}

/** Date en toutes lettres, l'année seulement si ce n'est pas l'année en cours. */
function longDate(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

type Tab = 'articles' | 'sondage';

export default function ShopScreen() {
  const [tab, setTab] = useState<Tab>('articles');
  function change(t: Tab) {
    Haptics.selectionAsync().catch(() => {});
    setTab(t);
  }
  return (
    <View style={styles.flex}>
      {tab === 'articles' ? <ArticlesView tab={tab} onTab={change} /> : <SondageView tab={tab} onTab={change} />}
    </View>
  );
}

/** En-tête commun aux deux onglets : il défile avec la liste. */
function ShopHeader({ tab, onTab, sub }: { tab: Tab; onTab: (t: Tab) => void; sub?: string | null }) {
  return (
    <View>
      <ScreenHeader back title="Boutique" sub={sub} />
      <Segmented
        style={styles.segmented}
        value={tab}
        onChange={onTab}
        options={[
          { key: 'articles', label: 'Articles' },
          { key: 'sondage', label: 'Sondage' },
        ]}
      />
    </View>
  );
}

/** Bandeau d'échéance : soleil tant que c'est ouvert, corail une fois fermé. */
function DeadlineBanner({ closed, text }: { closed: boolean; text: string }) {
  const color = closed ? c.coralSoft : c.yellow;
  return (
    <View style={[styles.banner, { backgroundColor: closed ? 'rgba(255,107,107,0.12)' : 'rgba(255,217,61,0.12)' }]}>
      <Feather name={closed ? 'lock' : 'clock'} size={18} color={color} />
      <Text style={[styles.bannerText, { color }]}>{text}</Text>
    </View>
  );
}

function Loading({ header }: { header: ReactNode }) {
  return (
    <View style={styles.flex}>
      {header}
      <View style={styles.center}>
        <ActivityIndicator color={c.teal} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ARTICLES (boutique)
// ─────────────────────────────────────────────────────────────────────────────

type ArticleCard = ShopArticle & { myOrders: ShopOrder[] };

type SondageData = {
  userId: string | null;
  candidats: SondageCandidat[];
  votes: SondageVote[];
  deadline: string | null;
  maxByCat: Record<string, number>;
};

function ArticlesView({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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

  const montrer = useCallback((d: { userId: string | null; articles: ArticleCard[]; deadline: string | null }) => {
    setUserId(d.userId);
    setArticles(d.articles);
    setDeadline(d.deadline ? new Date(d.deadline) : null);
    setLoading(false);
  }, []);
  const { garder, echec } = usePageCache('boutique', montrer);

  const loadAll = useCallback(async () => {
    const user = await sessionUser();

    const [artRes, ordRes, cfgRes] = await Promise.all([
      sb.from('shop_articles').select('*').order('created_at', { ascending: true }),
      user
        ? sb.from('shop_orders').select('*').eq('user_id', user.id)
        : Promise.resolve({ data: [] as ShopOrder[] }),
      sb.from('shop_config').select('*').eq('key', 'deadline').maybeSingle(),
    ]);
    if (artRes.error) {
      // Sans ça, une erreur réseau ressemble à une boutique vide
      setLoading(false);
      echec();
      return;
    }

    const ordersByArt: Record<string, ShopOrder[]> = {};
    (ordRes.data ?? []).forEach((o) => {
      const list = ordersByArt[(o as ShopOrder).article_id] ?? (ordersByArt[(o as ShopOrder).article_id] = []);
      list.push(o as ShopOrder);
    });

    const cfg = cfgRes.data as ShopConfig | null;
    garder({
      userId: user?.id ?? null,
      articles: ((artRes.data ?? []) as ShopArticle[]).map((a) => ({
        ...a,
        myOrders: ordersByArt[a.id] ?? [],
      })),
      deadline: cfg?.value ?? null,
    });
  }, [garder, echec]);

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

  const isClosed = deadline ? now >= deadline.getTime() : false;
  const open = articles.find((a) => a.id === openId) ?? null;
  const cardWidth = Math.floor((width - theme.gutter * 2 - GRID_GAP) / 2);
  const sub = articles.length
    ? `${articles.length} ${articles.length > 1 ? 'articles' : 'article'}, on commande ensemble`
    : null;

  if (loading) return <Loading header={<ShopHeader tab={tab} onTab={onTab} />} />;

  return (
    <View style={styles.flex}>
      <FlatList
        data={articles}
        keyExtractor={(a) => a.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: theme.gutter }}
        contentContainerStyle={{ gap: GRID_GAP, paddingBottom: insets.bottom + 32 }}
        ListHeaderComponent={
          <View>
            <ShopHeader tab={tab} onTab={onTab} sub={sub} />
            {!!deadline && (
              <View style={{ paddingHorizontal: theme.gutter, marginTop: 12 }}>
                <DeadlineBanner
                  closed={isClosed}
                  text={
                    isClosed
                      ? `Commandes fermées depuis le ${longDate(deadline)}`
                      : `Commandes ouvertes jusqu'au ${longDate(deadline)}`
                  }
                />
              </View>
            )}
            <View style={{ height: 2 }} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="shopping-bag" title="Aucun article pour l'instant" text="Les articles du groupe apparaîtront ici." />
        }
        renderItem={({ item }) => (
          <ArticleCardView
            article={item}
            width={cardWidth}
            onPress={() => {
              // Sans utilisateur, la fiche s'ouvrirait vide et sans bouton de fermeture
              if (!userId) return;
              Haptics.selectionAsync().catch(() => {});
              setOpenId(item.id);
            }}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
      />
      <Modal
        visible={!!open}
        animationType="slide"
        onRequestClose={() => setOpenId(null)}
        statusBarTranslucent
        navigationBarTranslucent
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

function ArticleCardView({ article, width, onPress }: { article: ArticleCard; width: number; onPress: () => void }) {
  const url = imageUrl(article.image);
  const total = article.myOrders.length;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${article.nom}${article.prix !== null ? `, ${euros(article.prix)}` : ''}`}
      style={({ pressed }) => [styles.card, { width }, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.cardPhoto}>
        {url ? (
          <Image
            source={{ uri: url }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            onError={(e) => console.warn('[shop] image fail:', url, e.error)}
          />
        ) : (
          <Ionicons name="shirt-outline" size={44} color={c.muted} />
        )}
        {!!article.badge && <Badge label={article.badge} color={c.coral} textColor="#fff" style={styles.cardBadge} />}
      </View>
      <View style={{ padding: 12 }}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {article.nom}
        </Text>
        {article.prix !== null && <Text style={styles.cardPrice}>{euros(article.prix)}</Text>}
        {total > 0 && (
          <View style={styles.myOrderTag}>
            <Feather name="check-circle" size={14} color={c.teal} />
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
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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
  const [photo, setPhoto] = useState(0);

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

  function onPhotoScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setPhoto(Math.round(e.nativeEvent.contentOffset.x / width));
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
  const sizeWidth = Math.floor((width - theme.gutter * 2 - 8) / 2);

  return (
    <View style={styles.flex}>
      <KeyboardAware insideSafeArea={false}>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          {/* Bande sombre sous la barre d'état : ses icônes claires restent lisibles */}
          <View style={{ height: insets.top, backgroundColor: c.deep }} />
          <View style={styles.photoBox}>
            {allImages.length > 0 ? (
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={onPhotoScroll}
              >
                {allImages.map((u, i) => (
                  <Image
                    key={i}
                    source={{ uri: u }}
                    style={{ width, height: 300 }}
                    contentFit="contain"
                    accessibilityLabel={`${article.nom}, photo ${i + 1} sur ${allImages.length}`}
                  />
                ))}
              </ScrollView>
            ) : (
              <View style={styles.center}>
                <Ionicons name="shirt-outline" size={64} color={c.muted} />
              </View>
            )}
            {allImages.length > 1 && (
              <View style={styles.dots} accessible={false}>
                {allImages.map((_, i) => (
                  <View key={i} style={[styles.dot, i === photo && styles.dotOn]} />
                ))}
              </View>
            )}
          </View>

          <View style={{ paddingHorizontal: theme.gutter, paddingTop: 16 }}>
            <View style={styles.titleRow}>
              <Text style={styles.detailTitle} accessibilityRole="header">
                {article.nom}
              </Text>
              {article.prix !== null && <Text style={styles.detailPrice}>{euros(article.prix)}</Text>}
            </View>
            {!!article.description && <Text style={styles.detailDesc}>{article.description}</Text>}

            <Text style={styles.section} accessibilityRole="header">
              Tes tailles
            </Text>
            <View style={styles.sizeGrid}>
              {tailles.map((t) => {
                const q = qtyByTaille[t] ?? 0;
                return (
                  <View key={t} style={[styles.sizeCell, { width: sizeWidth }]}>
                    <Text style={styles.sizeLabel} numberOfLines={1}>
                      {t}
                    </Text>
                    <View style={styles.stepper}>
                      <Stepper icon="minus" label={`Moins de ${t}`} disabled={isClosed || q === 0} onPress={() => bump(t, -1)} />
                      <Text style={[styles.qtyVal, q === 0 && { color: c.muted }]}>{q}</Text>
                      <Stepper icon="plus" label={`Plus de ${t}`} disabled={isClosed} onPress={() => bump(t, 1)} />
                    </View>
                  </View>
                );
              })}
            </View>

            <Field
              value={perso}
              onChangeText={setPerso}
              placeholder="Personnalisation : nom à floquer, n° au dos"
              accessibilityLabel="Personnalisation"
              multiline
              editable={!isClosed}
              style={styles.perso}
            />
            <Text style={styles.note}>Confirmer remplace tes commandes précédentes pour cet article.</Text>
          </View>
        </ScrollView>

        <BottomBar style={styles.totalBar}>
          <View>
            <Text style={styles.totalValue}>{euros(totalPrice)}</Text>
            <Text style={styles.totalCount}>
              {totalCount} {totalCount > 1 ? 'pièces' : 'pièce'}
            </Text>
          </View>
          {isClosed ? (
            <View style={styles.closedBtn} accessibilityRole="text">
              <Feather name="lock" size={18} color={c.muted} />
              <Text style={styles.closedText}>Commandes fermées</Text>
            </View>
          ) : (
            <Button
              label="Confirmer ma commande"
              height={54}
              style={{ flex: 1 }}
              loading={saving}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                confirmOrder();
              }}
            />
          )}
        </BottomBar>
      </KeyboardAware>

      <Pressable
        onPress={onClose}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="Fermer"
        style={({ pressed }) => [styles.closeBtn, { top: insets.top + 10 }, pressed && { opacity: 0.7 }]}
      >
        <Feather name="x" size={22} color={c.text} />
      </Pressable>
    </View>
  );
}

function Stepper({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'plus' | 'minus';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.7 }]}
    >
      <Feather name={icon} size={18} color={disabled ? '#5E5070' : c.text} />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SONDAGE (vote pour les futurs articles)
// ─────────────────────────────────────────────────────────────────────────────

function SondageView({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const insets = useSafeAreaInsets();
  const [candidats, setCandidats] = useState<SondageCandidat[]>([]);
  const [votes, setVotes] = useState<SondageVote[]>([]);
  // Quota de votes par catégorie, stocké en JSON côté web : {"T-shirt":2,…}
  const [maxByCat, setMaxByCat] = useState<Record<string, number>>({});
  const voting = useRef(false);
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const montrer = useCallback((d: SondageData) => {
    setUserId(d.userId);
    setCandidats(d.candidats);
    setVotes(d.votes);
    setDeadline(d.deadline ? new Date(d.deadline) : null);
    setMaxByCat(d.maxByCat);
    setLoading(false);
  }, []);
  const { garder, echec } = usePageCache('boutique-sondage', montrer);

  const loadAll = useCallback(async () => {
    const user = await sessionUser();

    const [candRes, voteRes, cfgRes] = await Promise.all([
      sb.from('sondage_candidats').select('*').order('categorie').order('nom'),
      sb.from('sondage_votes').select('*'),
      sb.from('shop_config').select('*').in('key', ['sondage_deadline', 'sondage_votes_max_by_cat']),
    ]);
    if (candRes.error || voteRes.error) {
      setLoading(false);
      echec();
      return;
    }

    const cfgs = (cfgRes.data ?? []) as ShopConfig[];
    const deadlineCfg = cfgs.find((x) => x.key === 'sondage_deadline');
    const maxCfg = cfgs.find((x) => x.key === 'sondage_votes_max_by_cat');
    let parsedMax: Record<string, number> = {};
    if (maxCfg?.value) {
      try {
        const obj = JSON.parse(maxCfg.value);
        if (obj && typeof obj === 'object') parsedMax = obj;
      } catch {}
    }
    garder({
      userId: user?.id ?? null,
      candidats: (candRes.data ?? []) as SondageCandidat[],
      votes: (voteRes.data ?? []) as SondageVote[],
      deadline: deadlineCfg?.value ?? null,
      maxByCat: parsedMax,
    });
  }, [garder, echec]);

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

  const grouped = useMemo(() => {
    const map: Record<string, SondageCandidat[]> = {};
    candidats.forEach((x) => {
      const list = map[x.categorie] ?? (map[x.categorie] = []);
      list.push(x);
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

  async function toggleVote(cand: SondageCandidat) {
    if (!userId || voting.current) return;
    // Recalculé au clic : l'écran peut rester ouvert après l'échéance
    if (deadline && Date.now() >= deadline.getTime()) {
      Alert.alert('Sondage fermé', 'La date limite est dépassée.');
      return;
    }
    const mine = myVotes.find((v) => v.candidat_id === cand.id);
    if (!mine) {
      const max = votesMax(cand.categorie);
      const usedInCat = myVotes.filter((v) => v.categorie === cand.categorie).length;
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
            .insert({ candidat_id: cand.id, user_id: userId, categorie: cand.categorie });
      if (error) Alert.alert('Erreur', error.message);
      await loadAll();
    } finally {
      voting.current = false;
    }
  }

  const header = <ShopHeader tab={tab} onTab={onTab} />;
  if (loading) return <Loading header={header} />;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
    >
      {header}
      <View style={{ paddingHorizontal: theme.gutter }}>
        <Text style={styles.intro}>Vote pour les futurs articles</Text>
        {!!deadline && (
          <View style={{ marginTop: 10 }}>
            <DeadlineBanner
              closed={isClosed}
              text={
                isClosed
                  ? `Sondage fermé depuis le ${longDate(deadline)}`
                  : `Vote ouvert jusqu'au ${longDate(deadline)}`
              }
            />
          </View>
        )}

        {grouped.length === 0 && (
          <EmptyState icon="star" title="Aucun candidat pour l'instant" text="Les idées d'articles à départager apparaîtront ici." />
        )}

        {grouped.map(([cat, list]) => {
          const max = votesMax(cat);
          const left = Math.max(0, max - myVotes.filter((v) => v.categorie === cat).length);
          const counts = list.map((x) => votes.filter((v) => v.candidat_id === x.id).length);
          const top = Math.max(0, ...counts);
          return (
            <View key={cat}>
              <View style={styles.catRow}>
                <Text style={styles.catTitle} accessibilityRole="header" numberOfLines={1}>
                  {cat}
                </Text>
                <Text style={styles.catLeft}>
                  {left === 0
                    ? 'Plus de vote'
                    : `${left} ${left > 1 ? 'votes restants' : 'vote restant'}${max > 1 ? ` sur ${max}` : ''}`}
                </Text>
              </View>
              {list.map((cand, i) => {
                const count = counts[i];
                const iVoted = myVotes.some((v) => v.candidat_id === cand.id);
                const url = imageUrl(cand.image);
                return (
                  <Pressable
                    key={cand.id}
                    onPress={() => toggleVote(cand)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: iVoted }}
                    accessibilityLabel={`${iVoted ? 'Retirer mon vote pour' : 'Voter pour'} ${cand.nom}, ${count} vote${count > 1 ? 's' : ''}`}
                    style={({ pressed }) => [styles.cand, pressed && { opacity: 0.85 }]}
                  >
                    <View style={styles.thumb}>
                      {url ? (
                        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                      ) : (
                        <Feather name="image" size={24} color={c.muted} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.candName} numberOfLines={2}>
                        {cand.nom}
                      </Text>
                      {!!cand.description && (
                        <Text style={styles.candDesc} numberOfLines={2}>
                          {cand.description}
                        </Text>
                      )}
                      <View style={styles.candMeta}>
                        <Text style={styles.candCount}>
                          {count} vote{count > 1 ? 's' : ''}
                        </Text>
                        {count > 0 && count === top && <Badge label="En tête" style={styles.lead} />}
                      </View>
                    </View>
                    <View style={[styles.voteDot, iVoted && styles.voteDotOn]}>
                      {iVoted && <Feather name="check" size={22} color="#fff" />}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  segmented: { marginHorizontal: theme.gutter, marginTop: 16 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16 },
  bannerText: { flex: 1, fontFamily: f.bodyBold, fontSize: 14, lineHeight: 19 },

  // Grille d'articles
  card: { backgroundColor: c.card, borderRadius: theme.radius.card, overflow: 'hidden' },
  cardPhoto: { height: 150, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  cardBadge: { position: 'absolute', top: 10, left: 10, height: 24 },
  cardTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 15, lineHeight: 19 },
  cardPrice: { color: c.yellow, fontFamily: f.serifBlack, fontSize: 18, lineHeight: 24, marginTop: 4 },
  myOrderTag: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  myOrderText: { color: c.teal, fontFamily: f.bodyBold, fontSize: 12 },

  // Fiche article
  photoBox: { height: 300, backgroundColor: '#fff' },
  dots: { position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(26,16,37,0.3)' },
  dotOn: { width: 18, backgroundColor: c.deep },
  closeBtn: {
    position: 'absolute',
    left: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(26,16,37,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  detailTitle: { flex: 1, color: c.text, fontFamily: f.serifBlack, fontSize: 28, lineHeight: 34 },
  detailPrice: { color: c.yellow, fontFamily: f.serifBlack, fontSize: 24, lineHeight: 30 },
  detailDesc: { color: c.muted, fontFamily: f.body, fontSize: 15, lineHeight: 21, marginTop: 6 },
  section: { color: c.text, fontFamily: f.bodyBold, fontSize: 16, marginTop: 18, marginBottom: 8 },
  sizeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sizeCell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingRight: 6,
    paddingLeft: 16,
    borderRadius: 16,
    backgroundColor: c.card,
  },
  sizeLabel: { flexShrink: 1, color: c.text, fontFamily: f.bodyBold, fontSize: 16, marginRight: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.deep, alignItems: 'center', justifyContent: 'center' },
  qtyVal: { minWidth: 16, textAlign: 'center', color: c.text, fontFamily: f.bodyBold, fontSize: 16 },
  perso: { marginTop: 10, minHeight: 48, fontSize: 15 },
  note: { color: c.muted, fontFamily: f.body, fontSize: 13, lineHeight: 18, marginTop: 8 },
  totalBar: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 14 },
  totalValue: { color: c.text, fontFamily: f.serifBlack, fontSize: 22, lineHeight: 28 },
  totalCount: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  closedBtn: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    backgroundColor: c.rail,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  closedText: { color: c.muted, fontFamily: f.bodyBold, fontSize: 16 },

  // Sondage
  intro: { color: c.muted, fontFamily: f.body, fontSize: 15, marginTop: 14 },
  catRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 18, marginBottom: 8 },
  catTitle: { flexShrink: 1, color: c.text, fontFamily: f.serifBlack, fontSize: 22, lineHeight: 28 },
  catLeft: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  cand: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 18, backgroundColor: c.card, marginBottom: 8 },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  candName: { color: c.text, fontFamily: f.bodyBold, fontSize: 15, lineHeight: 20 },
  candDesc: { color: c.muted, fontFamily: f.body, fontSize: 13, lineHeight: 18, marginTop: 2 },
  candMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  candCount: { color: c.teal, fontFamily: f.bodyBold, fontSize: 13 },
  lead: { height: 22, paddingHorizontal: 8 },
  voteDot: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: c.deep,
    borderWidth: 2,
    borderColor: c.rail,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voteDotOn: { backgroundColor: c.coral, borderColor: c.coral },
});
