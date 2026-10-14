import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { JeuForm } from '@/components/jeux/JeuForm';
import {
  sb,
  type JeuAlcool,
  type JeuSociete,
  type JeuSocieteVote,
  type ProfileMini, sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

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
  // On garde l'id : la fiche affichée est relue dans la liste après chaque rechargement
  const [openAlcId, setOpenAlcId] = useState<string | null>(null);
  const openAlc = openAlcId ? alcool.find((j) => j.id === openAlcId) ?? null : null;
  const [openSocId, setOpenSocId] = useState<string | null>(null);
  const openSoc = openSocId ? societe.find((s) => s.id === openSocId) ?? null : null;
  // Formulaire affiché dans la même fiche que le détail : pas d'enchaînement de deux Modal
  const [alcForm, setAlcForm] = useState<'new' | JeuAlcool | null>(null);
  const [socForm, setSocForm] = useState<'new' | JeuSociete | null>(null);
  const rating = useRef(false);

  const loadAll = useCallback(async () => {
    const user = await sessionUser();
    setUserId(user?.id ?? null);

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
        const mine = user ? votes.find((v) => v.user_id === user!.id) : undefined;
        const avg = votes.length ? votes.reduce((s, v) => s + v.note, 0) / votes.length : 0;
        return { ...j, votes, myVote: mine ?? null, avg };
      }),
    );
    setLoading(false);
  }, []);

  useRefreshOnFocus(loadAll);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
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

  function closeAlc() {
    setOpenAlcId(null);
    setAlcForm(null);
  }
  function closeSoc() {
    setOpenSocId(null);
    setSocForm(null);
  }

  function deleteJeu(kind: Tab, id: string) {
    Alert.alert('Supprimer ce jeu ?', undefined, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          const { data, error } = await sb
            .from(kind === 'alcool' ? 'jeux_alcool' : 'jeux_societe')
            .delete()
            .eq('id', id)
            .select('id');
          if (error || !data?.length) {
            Alert.alert(
              'Suppression impossible',
              error ? 'Réessaie dans un moment.' : 'Ce jeu a déjà été supprimé, ou tu n’en es pas l’auteur.',
            );
            loadAll();
            return;
          }
          if (kind === 'alcool') closeAlc();
          else closeSoc();
          loadAll();
        },
      },
    ]);
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
            <AlcoolCardView jeu={item} onPress={() => setOpenAlcId(item.id)} />
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

      {!!userId && (
        <Pressable
          onPress={() => (tab === 'alcool' ? setAlcForm('new') : setSocForm('new'))}
          accessibilityRole="button"
          accessibilityLabel={tab === 'alcool' ? 'Ajouter un jeu d’alcool' : 'Ajouter un jeu de société'}
          style={({ pressed }) => [
            styles.fab,
            tab === 'societe' && { backgroundColor: theme.colors.teal, shadowColor: theme.colors.teal },
            pressed && { transform: [{ scale: 0.92 }] },
          ]}
        >
          <Ionicons name="add" size={30} color="#fff" />
        </Pressable>
      )}

      <Modal
        visible={!!openAlc || alcForm !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => (alcForm !== null && openAlc ? setAlcForm(null) : closeAlc())}
      >
        {alcForm !== null && userId ? (
          <JeuForm
            kind="alcool"
            initial={alcForm === 'new' ? null : alcForm}
            userId={userId}
            // Depuis une fiche, fermer le formulaire ramène à la fiche
            onClose={() => (openAlc ? setAlcForm(null) : closeAlc())}
            onSaved={() => {
              if (alcForm === 'new') closeAlc();
              else setAlcForm(null);
              loadAll();
            }}
          />
        ) : (
          !!openAlc && (
            <AlcoolDetail
              jeu={openAlc}
              onClose={closeAlc}
              authorName={authorName(profiles[openAlc.created_by])}
              mine={openAlc.created_by === userId}
              onEdit={() => setAlcForm(openAlc)}
              onDelete={() => deleteJeu('alcool', openAlc.id)}
            />
          )
        )}
      </Modal>
      <Modal
        visible={!!openSoc || socForm !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => (socForm !== null && openSoc ? setSocForm(null) : closeSoc())}
      >
        {socForm !== null && userId ? (
          <JeuForm
            kind="societe"
            initial={socForm === 'new' ? null : socForm}
            userId={userId}
            onClose={() => (openSoc ? setSocForm(null) : closeSoc())}
            onSaved={() => {
              if (socForm === 'new') closeSoc();
              else setSocForm(null);
              loadAll();
            }}
          />
        ) : (
          !!openSoc && (
            <SocieteDetail
              card={openSoc}
              onClose={closeSoc}
              authorName={authorName(profiles[openSoc.created_by])}
              onRate={(n) => rateSociete(openSoc, n)}
              mine={openSoc.created_by === userId}
              onEdit={() => setSocForm(openSoc)}
              onDelete={() => deleteJeu('societe', openSoc.id)}
            />
          )
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
        {!!jeu.joueurs && <MetaChip icon="people-outline" text={jeu.joueurs} />}
        {!!jeu.niveau && <MetaChip icon="flame-outline" text={jeu.niveau} />}
      </View>
    </Pressable>
  );
}

type OwnerProps = { mine: boolean; onEdit: () => void; onDelete: () => void };

function OwnerActions({ mine, onEdit, onDelete }: OwnerProps) {
  if (!mine) return null;
  return (
    <View style={styles.ownerRow}>
      <Pressable onPress={onEdit} accessibilityRole="button" style={({ pressed }) => [styles.ownerBtn, pressed && { opacity: 0.7 }]}>
        <Ionicons name="create-outline" size={18} color={theme.colors.text} />
        <Text style={styles.ownerBtnText}>Modifier</Text>
      </Pressable>
      <Pressable onPress={onDelete} accessibilityRole="button" style={({ pressed }) => [styles.ownerBtn, pressed && { opacity: 0.7 }]}>
        <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
        <Text style={[styles.ownerBtnText, { color: theme.colors.danger }]}>Supprimer</Text>
      </Pressable>
    </View>
  );
}

function AlcoolDetail({
  jeu,
  authorName,
  onClose,
  ...owner
}: {
  jeu: JeuAlcool;
  authorName: string;
  onClose: () => void;
} & OwnerProps) {
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
        {!!jeu.joueurs && <DetailRow label="Joueurs" value={jeu.joueurs} />}
        {!!jeu.niveau && <DetailRow label="Niveau" value={jeu.niveau} />}
        {!!jeu.materiel && <DetailRow label="Matériel" value={jeu.materiel} />}
        <OwnerActions {...owner} />
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
        {!!card.joueurs_max && <MetaChip icon="people-outline" text={`max ${card.joueurs_max}`} />}
        {!!card.duree && <MetaChip icon="time-outline" text={card.duree} />}
        {!!card.detenteur && <MetaChip icon="person-outline" text={card.detenteur} />}
      </View>
    </Pressable>
  );
}

function SocieteDetail({
  card,
  authorName,
  onClose,
  onRate,
  ...owner
}: {
  card: SocieteCard;
  authorName: string;
  onClose: () => void;
  onRate: (n: number) => void;
} & OwnerProps) {
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
        {!!card.joueurs_max && <DetailRow label="Joueurs max" value={card.joueurs_max} />}
        {!!card.duree && <DetailRow label="Durée" value={card.duree} />}
        {!!card.detenteur && <DetailRow label="Détenteur" value={card.detenteur} />}
        {card.a_acheter === 'oui' && <DetailRow label="À acheter" value="oui" />}
        {!!card.avis && (
          <>
            <Text style={styles.detailSection}>Avis</Text>
            <Text style={styles.detailContent}>{card.avis}</Text>
          </>
        )}
        <OwnerActions {...owner} />
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
  // Le bas de la liste reste dégagé du bouton « + »
  list: { padding: theme.s(4), paddingBottom: 100 },
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
  ownerRow: { flexDirection: 'row', gap: 10, marginTop: theme.s(8) },
  ownerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  ownerBtnText: { color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
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
