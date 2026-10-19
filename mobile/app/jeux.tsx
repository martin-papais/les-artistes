import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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

import { AlcoolCard, CATEGORIES, SearchField, SocieteCardView, type SocieteCard } from '@/components/jeux/JeuCards';
import { AlcoolDetail, SocieteDetail } from '@/components/jeux/JeuDetail';
import { JeuForm } from '@/components/jeux/JeuForm';
import { Chip, EmptyState, Pastille, ScreenHeader, Segmented } from '@/components/ui/kit';
import {
  sb,
  type JeuAlcool,
  type JeuSociete,
  type JeuSocieteVote,
  type ProfileMini, plain, sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;

type Tab = 'alcool' | 'societe';
// Tris et filtre des jeux de société, comme sur le site
type SocSort = 'recent' | 'note' | 'joueurs' | 'acheter';
const SOC_SORTS: { key: SocSort; label: string }[] = [
  { key: 'recent', label: 'Récents' },
  { key: 'note', label: 'Mieux notés' },
  { key: 'joueurs', label: 'Plus de joueurs' },
  { key: 'acheter', label: 'À acheter' },
];

export default function JeuxScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('alcool');
  const [alcool, setAlcool] = useState<JeuAlcool[]>([]);
  const [societe, setSociete] = useState<SocieteCard[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>({});
  const [me, setMe] = useState<ProfileMini | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [socSort, setSocSort] = useState<SocSort>('recent');
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

    const [alcRes, socRes, meRes] = await Promise.all([
      sb.from('jeux_alcool').select('*').order('created_at', { ascending: false }),
      sb.from('jeux_societe').select('*').order('created_at', { ascending: false }),
      // Pastille de l'en-tête
      user
        ? sb.from('profiles').select('id,prenom,nom,pseudo').eq('id', user.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setMe((meRes.data as ProfileMini | null) ?? null);

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

  function changeTab(t: Tab) {
    setTab(t);
    setQuery('');
    setCat(null);
  }

  // Recherche dans le nom, les règles et la catégorie (ou le détenteur), comme sur le site
  const q = plain(query.trim());
  const alcoolShown = alcool.filter(
    (j) => (!cat || j.categorie === cat) && (!q || plain(j.nom).includes(q) || plain(j.regles).includes(q) || plain(j.categorie).includes(q)),
  );
  const societeFound = societe.filter(
    (j) =>
      (socSort !== 'acheter' || j.a_acheter === 'oui') &&
      (!q || plain(j.nom).includes(q) || plain(j.regles).includes(q) || plain(j.detenteur).includes(q)),
  );
  const societeShown =
    socSort === 'note'
      ? [...societeFound].sort((a, b) => b.avg - a.avg)
      : socSort === 'joueurs'
        ? [...societeFound].sort((a, b) => (Number(b.joueurs_max) || 0) - (Number(a.joueurs_max) || 0))
        : societeFound;
  const filtered = tab === 'alcool' ? !!q || !!cat : !!q || socSort === 'acheter';
  const tone = tab === 'alcool' ? c.coral : c.teal;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.coral} />
      </View>
    );
  }

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.coral} colors={[c.coral]} />;
  const empty = filtered ? (
    <EmptyState icon="search" title="Aucun jeu trouvé" text="Essaie un autre mot, ou enlève le filtre." />
  ) : (
    <EmptyState
      icon="package"
      title={tab === 'alcool' ? 'Pas encore de jeu d’alcool' : 'Pas encore de jeu de société'}
      text="Ajoute le premier avec le bouton Ajouter."
    />
  );

  return (
    <View style={styles.flex}>
      <ScreenHeader
        back
        title="Jeux"
        sub="L’atelier ludique du groupe"
        right={
          me || userId ? (
            <Pressable
              onPress={() => router.push('/profil')}
              accessibilityRole="button"
              accessibilityLabel="Mon profil"
              hitSlop={4}
              style={({ pressed }) => pressed && { opacity: 0.8 }}
            >
              <Pastille id={userId} name={me?.prenom || me?.pseudo} />
            </Pressable>
          ) : null
        }
      />
      <View style={styles.controls}>
        <Segmented
          options={[
            { key: 'alcool', label: 'Alcool', color: c.coral },
            { key: 'societe', label: 'Société', color: c.teal, textColor: c.tealInk },
          ]}
          value={tab}
          onChange={changeTab}
        />
        <View style={{ marginTop: 14 }}>
          <SearchField value={query} onChangeText={setQuery} />
        </View>
      </View>
      {/* Marge sous les filtres : la liste qui défile s'arrête avant eux */}
      <View style={styles.chipsBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chips}
        >
          {tab === 'alcool' ? (
            <>
              <Chip label="Tous" active={!cat} onPress={() => setCat(null)} />
              {CATEGORIES.map((k) => (
                <Chip key={k} label={k} active={cat === k} onPress={() => setCat((cur) => (cur === k ? null : k))} />
              ))}
            </>
          ) : (
            SOC_SORTS.map((o) => (
              <Chip key={o.key} label={o.label} active={socSort === o.key} onPress={() => setSocSort(o.key)} />
            ))
          )}
        </ScrollView>
      </View>

      {tab === 'alcool' ? (
        <FlatList
          data={alcoolShown}
          keyExtractor={(j) => j.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <AlcoolCard jeu={item} onPress={() => setOpenAlcId(item.id)} />}
          ItemSeparatorComponent={Gap}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={refresh}
          ListEmptyComponent={empty}
        />
      ) : (
        <FlatList
          data={societeShown}
          keyExtractor={(j) => j.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <SocieteCardView card={item} onPress={() => setOpenSocId(item.id)} />}
          ItemSeparatorComponent={Gap}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={refresh}
          ListEmptyComponent={empty}
        />
      )}

      {!!userId && (
        <Pressable
          onPress={() => (tab === 'alcool' ? setAlcForm('new') : setSocForm('new'))}
          accessibilityRole="button"
          accessibilityLabel={tab === 'alcool' ? 'Ajouter un jeu d’alcool' : 'Ajouter un jeu de société'}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: tone, shadowColor: tone },
            pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] },
          ]}
        >
          <Feather name="plus" size={22} color={tab === 'alcool' ? '#fff' : c.tealInk} />
          <Text style={[styles.fabText, { color: tab === 'alcool' ? '#fff' : c.tealInk }]}>Ajouter</Text>
        </Pressable>
      )}

      <Modal
        statusBarTranslucent
        navigationBarTranslucent
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
        statusBarTranslucent
        navigationBarTranslucent
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
    </View>
  );
}

function Gap() {
  return <View style={{ height: 10 }} />;
}

function authorName(p: ProfileMini | null | undefined) {
  if (!p) return '?';
  return p.pseudo || `${p.prenom ?? ''} ${p.nom ?? ''}`.trim() || '?';
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.deep },
  controls: { paddingHorizontal: theme.gutter, marginTop: 20 },
  chips: { paddingHorizontal: theme.gutter, paddingTop: 12, gap: 8 },
  chipsBar: { marginBottom: 14 },
  // Le bas de la liste reste dégagé du bouton « Ajouter »
  list: { paddingHorizontal: theme.gutter, paddingTop: 2, paddingBottom: 100, flexGrow: 1 },
  fab: {
    position: 'absolute',
    right: theme.gutter,
    bottom: 16,
    height: 56,
    paddingLeft: 18,
    paddingRight: 22,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  fabText: { fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
