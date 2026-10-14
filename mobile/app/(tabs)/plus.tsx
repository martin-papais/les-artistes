import { useRouter, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, Pastille, ScreenHeader, type FeatherName } from '@/components/ui/kit';
import { sb, sessionUser, type ProfileMini } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

type Tile = { label: string; icon: FeatherName; route: Href; bg: string; fg: string };

const TILES: Tile[] = [
  { label: 'Photos', icon: 'image', route: '/photos', bg: c.violet, fg: c.ink },
  { label: 'Notes', icon: 'edit-3', route: '/notes', bg: c.yellow, fg: c.ink },
  { label: 'Boutique', icon: 'shopping-bag', route: '/shop', bg: c.coral, fg: '#fff' },
  { label: 'Annuaire', icon: 'users', route: '/annuaire', bg: c.teal, fg: c.tealInk },
];

/** État de la boutique d'après la date limite (shop_config.deadline). */
function shopLabel(deadline: string | null | undefined) {
  if (!deadline) return 'Articles et sondage';
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return 'Articles et sondage';
  if (Date.now() >= d.getTime()) return 'Commandes fermées';
  return `Commandes jusqu'au ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
}

export default function PlusScreen() {
  const router = useRouter();
  const [me, setMe] = useState<ProfileMini | null>(null);
  const [members, setMembers] = useState<number | null>(null);
  const [shop, setShop] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Sous-titres vivants : en cas d'erreur, on garde le texte fixe
  const load = useCallback(async () => {
    const user = await sessionUser();
    const [profRes, countRes, cfgRes] = await Promise.all([
      user
        ? sb.from('profiles').select('id,prenom,nom,pseudo').eq('id', user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      sb.from('profiles').select('id', { count: 'exact', head: true }),
      sb.from('shop_config').select('*').eq('key', 'deadline').maybeSingle(),
    ]);
    if (profRes.data) setMe(profRes.data as ProfileMini);
    if (!countRes.error && countRes.count != null) setMembers(countRes.count);
    if (!cfgRes.error) setShop(shopLabel(cfgRes.data?.value as string | null | undefined));
  }, []);

  useRefreshOnFocus(load);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  const fullName = me ? `${me.prenom ?? ''} ${me.nom ?? ''}`.trim() || me.pseudo || 'Mon profil' : 'Mon profil';
  const subs: Record<string, string> = {
    Photos: 'Les souvenirs',
    Notes: 'Le mur des pensées',
    Boutique: shop ?? 'Articles et sondage',
    Annuaire: members != null ? `${members} membre${members > 1 ? 's' : ''}` : 'Les contacts du groupe',
  };

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
    >
      <ScreenHeader title="Plus" sub="Tout le reste du groupe" />

      <Pressable
        onPress={() => router.navigate('/profil')}
        accessibilityRole="button"
        accessibilityLabel={`${fullName}, mon profil et mes infos`}
        style={({ pressed }) => [styles.profile, pressed && { opacity: 0.85 }]}
      >
        <Pastille id={me?.id} name={me?.prenom || me?.pseudo || fullName} size={56} serif />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.profileName} numberOfLines={1}>
            {fullName}
          </Text>
          <Text style={styles.detail}>Mon profil et mes infos</Text>
        </View>
        <Icon name="chevron-right" size={20} color={c.muted} />
      </Pressable>

      <View style={styles.grid}>
        {TILES.map((t) => (
          <Pressable
            key={t.label}
            onPress={() => router.navigate(t.route)}
            accessibilityRole="button"
            accessibilityLabel={`${t.label}, ${subs[t.label]}`}
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
          >
            <View style={[styles.tileIcon, { backgroundColor: t.bg }]}>
              <Icon name={t.icon} size={24} color={t.fg} />
            </View>
            <View>
              <Text style={styles.tileLabel}>{t.label}</Text>
              <Text style={[styles.detail, { fontSize: 13 }]} numberOfLines={2}>
                {subs[t.label]}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  profile: {
    marginTop: 20,
    marginHorizontal: theme.gutter,
    padding: 16,
    borderRadius: 22,
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  profileName: { fontFamily: f.serif, fontSize: 21, lineHeight: 27, color: c.text },
  detail: { fontFamily: f.body, fontSize: 14, lineHeight: 19, color: c.muted, marginTop: 2 },
  grid: {
    marginTop: 12,
    marginHorizontal: theme.gutter,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  tile: {
    // deux colonnes : moitié de la largeur moins la moitié de l'espace
    flexBasis: '47%',
    flexGrow: 1,
    height: 150,
    padding: 16,
    borderRadius: 22,
    backgroundColor: c.card,
    justifyContent: 'space-between',
  },
  tileIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: f.bodyBold, fontSize: 17, lineHeight: 22, color: c.text },
});
