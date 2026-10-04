import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  sb,
  type JeuAlcool,
  type JeuSociete,
  type JeuSocieteVote,
  type ProfileMini,
} from '@/lib/supabase';
import { theme } from '@/lib/theme';

type Tab = 'alcool' | 'societe';
type SocieteCard = JeuSociete & {
  votes: JeuSocieteVote[];
  myVote: JeuSocieteVote | null;
  avg: number;
};

export default function JeuxScreen() {
  const [tab, setTab] = useState<Tab>('alcool');
  const [alcool, setAlcool] = useState<JeuAlcool[]>([]);
  const [societe, setSociete] = useState<SocieteCard[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [openAlc, setOpenAlc] = useState<JeuAlcool | null>(null);
  // On garde l'id : la carte affichée est relue dans `societe` après chaque rechargement
  const [openSocId, setOpenSocId] = useState<string | null>(null);
  const openSoc = openSocId ? societe.find((s) => s.id === openSocId) ?? null : null;
  const rating = useRef(false);

  const loadAll = useCallback(async () => {
    const { data: u } = await sb.auth.getUser();
    setUserId(u.user?.id ?? null);

    const [alcRes, socRes] = await Promise.all([
      sb.from('jeux_alcool').select('*').order('created_at', { ascending: false }),
      sb.from('jeux_societe').select('*').order('created_at', { ascending: false }),
    ]);

    const allUids = new Set<string>();
    (alcRes.data ?? []).forEach((j) => j.created_by && allUids.add(j.created_by));
    (socRes.data ?? []).forEach((j) => j.created_by && allUids.add(j.created_by));

    const socIds = (socRes.data ?? []).map((j) => j.id);
    const [profRes, voteRes] = await Promise.all([
      allUids.size
        ? sb.from('profiles').select('id,prenom,nom,pseudo').in('id', Array.from(allUids))
        : Promise.resolve({ data: [] as ProfileMini[] }),
      socIds.length
        ? sb.from('jeux_societe_votes').select('*').in('jeu_id', socIds)
        : Promise.resolve({ data: [] as JeuSocieteVote[] }),
    ]);

    const pmap: Record<string, ProfileMini> = {};
    (profRes.data ?? []).forEach((p) => {
      pmap[p.id] = p as ProfileMini;
    });
    setProfiles(pmap);

    const votesByJeu: Record<string, JeuSocieteVote[]> = {};
    (voteRes.data ?? []).forEach((v) => {
      const list = votesByJeu[(v as JeuSocieteVote).jeu_id] ?? (votesByJeu[(v as JeuSocieteVote).jeu_id] = []);
      list.push(v as JeuSocieteVote);
    });

    setAlcool((alcRes.data ?? []) as JeuAlcool[]);
    setSociete(
      ((socRes.data ?? []) as JeuSociete[]).map((j) => {
        const votes = votesByJeu[j.id] ?? [];
        const mine = u.user ? votes.find((v) => v.user_id === u.user!.id) : undefined;
        const avg = votes.length ? votes.reduce((s, v) => s + v.note, 0) / votes.length : 0;
        return { ...j, votes, myVote: mine ?? null, avg };
      }),
    );
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

  async function rateSociete(card: SocieteCard, note: number) {
    if (!userId || rating.current) return;
    rating.current = true;
    try {
      let res;
      if (card.myVote && card.myVote.note === note) {
        res = await sb.from('jeux_societe_votes').delete().eq('id', card.myVote.id);
      } else if (card.myVote) {
        res = await sb.from('jeux_societe_votes').update({ note }).eq('id', card.myVote.id);
      } else {
        res = await sb.from('jeux_societe_votes').insert({
          jeu_id: card.id,
          user_id: userId,
          note,
        });
      }
      if (res.error) Alert.alert('Erreur', res.error.message);
      await loadAll();
    } finally {
      rating.current = false;
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={theme.colors.teal} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex}>
      <View style={{ padding: theme.s(4), paddingBottom: 0 }}>
        <Text style={styles.bigTitle}>Jeux</Text>
        <Text style={styles.bigSub}>L&apos;atelier ludique du groupe.</Text>
      </View>
      <View style={styles.subTabs}>
        <SubTab label="Alcool" active={tab === 'alcool'} onPress={() => setTab('alcool')} />
        <SubTab label="Société" active={tab === 'societe'} onPress={() => setTab('societe')} />
      </View>
      {tab === 'alcool' ? (
        <FlatList
          data={alcool}
          keyExtractor={(j) => j.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <AlcoolCardView jeu={item} onPress={() => setOpenAlc(item)} />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.teal} />
          }
          ListEmptyComponent={<EmptyState text="Aucun jeu d'alcool pour l'instant." />}
        />
      ) : (
        <FlatList
          data={societe}
          keyExtractor={(j) => j.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <SocieteCardView card={item} onPress={() => setOpenSocId(item.id)} />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.teal} />
          }
          ListEmptyComponent={<EmptyState text="Aucun jeu de société pour l'instant." />}
        />
      )}

      <Modal
        visible={!!openAlc}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenAlc(null)}
      >
        {openAlc && (
          <AlcoolDetail jeu={openAlc} onClose={() => setOpenAlc(null)} authorName={authorName(profiles[openAlc.created_by])} />
        )}
      </Modal>
      <Modal
        visible={!!openSoc}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenSocId(null)}
      >
        {openSoc && (
          <SocieteDetail
            card={openSoc}
            onClose={() => setOpenSocId(null)}
            authorName={authorName(profiles[openSoc.created_by])}
            onRate={(n) => rateSociete(openSoc, n)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

function authorName(p: ProfileMini | null | undefined) {
  if (!p) return '?';
  return p.pseudo || `${p.prenom ?? ''} ${p.nom ?? ''}`.trim() || '?';
}

function SubTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.subTab,
        active && styles.subTabActive,
        pressed && !active && { backgroundColor: theme.colors.surface2 },
      ]}
    >
      <Text style={[styles.subTabText, active && styles.subTabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function AlcoolCardView({ jeu, onPress }: { jeu: JeuAlcool; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{jeu.categorie}</Text>
      </View>
      <Text style={styles.cardTitle}>{jeu.nom}</Text>
      <Text style={styles.cardExcerpt} numberOfLines={2}>{jeu.regles}</Text>
      <View style={styles.cardMetaRow}>
        {jeu.joueurs && <MetaChip icon="people-outline" text={jeu.joueurs} />}
        {jeu.niveau && <MetaChip icon="flame-outline" text={jeu.niveau} />}
      </View>
    </Pressable>
  );
}

function AlcoolDetail({
  jeu,
  authorName,
  onClose,
}: {
  jeu: JeuAlcool;
  authorName: string;
  onClose: () => void;
}) {
  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.modalTopBar}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.modalCloseBtn}>
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.modalTopTitle} numberOfLines={1}>
          {jeu.nom}
        </Text>
        <View style={{ width: 36 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: theme.s(5) }}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{jeu.categorie}</Text>
        </View>
        <Text style={styles.detailTitle}>{jeu.nom}</Text>
        <Text style={styles.detailMeta}>Ajouté par {authorName}</Text>
        <Text style={styles.detailSection}>Règles</Text>
        <Text style={styles.detailContent}>{jeu.regles}</Text>
        {jeu.joueurs && <DetailRow label="Joueurs" value={jeu.joueurs} />}
        {jeu.niveau && <DetailRow label="Niveau" value={jeu.niveau} />}
        {jeu.materiel && <DetailRow label="Matériel" value={jeu.materiel} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function SocieteCardView({ card, onPress }: { card: SocieteCard; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
      <Text style={styles.cardTitle}>{card.nom}</Text>
      <Text style={styles.cardExcerpt} numberOfLines={2}>{card.regles}</Text>
      <View style={styles.cardMetaRow}>
        <Stars value={card.avg} small />
        <Text style={styles.metaTextSmall}>
          {card.avg ? card.avg.toFixed(1) : '—'} ({card.votes.length} avis)
        </Text>
      </View>
      <View style={styles.cardMetaRow}>
        {card.joueurs_max && <MetaChip icon="people-outline" text={`max ${card.joueurs_max}`} />}
        {card.duree && <MetaChip icon="time-outline" text={card.duree} />}
        {card.detenteur && <MetaChip icon="person-outline" text={card.detenteur} />}
      </View>
    </Pressable>
  );
}

function SocieteDetail({
  card,
  authorName,
  onClose,
  onRate,
}: {
  card: SocieteCard;
  authorName: string;
  onClose: () => void;
  onRate: (n: number) => void;
}) {
  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.modalTopBar}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.modalCloseBtn}>
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.modalTopTitle} numberOfLines={1}>
          {card.nom}
        </Text>
        <View style={{ width: 36 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: theme.s(5) }}>
        <Text style={styles.detailTitle}>{card.nom}</Text>
        <Text style={styles.detailMeta}>Ajouté par {authorName}</Text>

        <Text style={styles.detailSection}>Note moyenne</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Stars value={card.avg} />
          <Text style={styles.metaTextSmall}>
            {card.avg ? card.avg.toFixed(1) : '—'} ({card.votes.length})
          </Text>
        </View>

        <Text style={styles.detailSection}>Ta note</Text>
        <Stars value={card.myVote?.note ?? 0} interactive onPress={onRate} />

        <Text style={styles.detailSection}>Règles</Text>
        <Text style={styles.detailContent}>{card.regles}</Text>
        {card.joueurs_max && <DetailRow label="Joueurs max" value={card.joueurs_max} />}
        {card.duree && <DetailRow label="Durée" value={card.duree} />}
        {card.detenteur && <DetailRow label="Détenteur" value={card.detenteur} />}
        {card.a_acheter && <DetailRow label="À acheter" value={card.a_acheter} />}
        {card.avis && (
          <>
            <Text style={styles.detailSection}>Avis</Text>
            <Text style={styles.detailContent}>{card.avis}</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailRowLabel}>{label}</Text>
      <Text style={styles.detailRowValue}>{value}</Text>
    </View>
  );
}



function MetaChip({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={12} color={theme.colors.muted} />
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

function Stars({
  value,
  interactive,
  onPress,
  small,
}: {
  value: number;
  interactive?: boolean;
  onPress?: (n: number) => void;
  small?: boolean;
}) {
  const size = small ? 16 : 26;
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = value >= n - 0.4;
        const star = (
          <Ionicons
            key={n}
            name={filled ? 'star' : 'star-outline'}
            size={size}
            color={filled ? theme.colors.yellow : theme.colors.muted}
          />
        );
        if (!interactive) return star;
        return (
          <Pressable key={n} onPress={() => onPress?.(n)} hitSlop={6}>
            {star}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.deep },
  bigTitle: { color: theme.colors.text, fontFamily: theme.fonts.title, fontSize: 32, fontWeight: '800' },
  bigSub: { color: theme.colors.muted, marginTop: 2 },
  subTabs: {
    flexDirection: 'row',
    paddingHorizontal: theme.s(4),
    paddingVertical: theme.s(3),
    gap: 8,
  },
  subTab: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  subTabActive: { backgroundColor: theme.colors.coral, borderColor: theme.colors.coral },
  subTabText: { color: theme.colors.muted, fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  subTabTextActive: { color: '#fff' },
  list: { padding: theme.s(4), paddingBottom: theme.s(10) },
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.s(3),
    marginBottom: theme.s(3),
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 6,
  },
  badgeText: { color: theme.colors.coral, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  cardTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  cardExcerpt: { color: theme.colors.muted, fontSize: 13, lineHeight: 18 },
  cardMetaRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  chipText: { color: theme.colors.muted, fontSize: 11 },
  metaTextSmall: { color: theme.colors.muted, fontSize: 12 },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.s(4),
    paddingTop: theme.s(2),
  },
  detailTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.title,
    fontSize: 28,
    fontWeight: '800',
    marginTop: 8,
  },
  detailMeta: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  detailSection: {
    color: theme.colors.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: theme.s(6),
    marginBottom: theme.s(2),
  },
  detailContent: { color: theme.colors.text, fontSize: 15, lineHeight: 22 },
  detailRow: {
    paddingVertical: theme.s(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  detailRowLabel: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  detailRowValue: {
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    fontSize: 15,
    lineHeight: 21,
  },
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
  empty: { padding: theme.s(8), alignItems: 'center' },
  emptyText: { color: theme.colors.muted, fontSize: 14 },
});
