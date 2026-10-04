import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { theme } from '@/lib/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Item = { label: string; icon: IoniconName; route: Href; sub: string };

const ITEMS: Item[] = [
  { label: 'Notes', icon: 'create', route: '/notes', sub: 'Mur des pensées du groupe' },
  { label: 'Boutique', icon: 'bag', route: '/shop', sub: 'Articles à commander & sondage' },
  { label: 'Annuaire', icon: 'people', route: '/annuaire', sub: 'Contacts du groupe' },
  { label: 'Profil', icon: 'person-circle', route: '/profil', sub: 'Tes infos & déconnexion' },
];

export default function PlusScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.bigTitle}>Plus</Text>
        <Text style={styles.bigSub}>Toutes les autres sections du groupe.</Text>
        <View style={{ height: theme.s(4) }} />
        {ITEMS.map((it) => (
          <Pressable
            key={it.label}
            onPress={() => router.push(it.route)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.iconBox}>
              <Ionicons name={it.icon} size={22} color={theme.colors.coral} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{it.label}</Text>
              <Text style={styles.rowSub}>{it.sub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.muted} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },
  scroll: { padding: theme.s(4), paddingTop: theme.s(6) },
  bigTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.title,
    fontSize: 32,
    fontWeight: '800',
  },
  bigSub: { color: theme.colors.muted, marginTop: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.s(3),
    marginBottom: theme.s(2),
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.s(3),
  },
  rowLabel: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  rowSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
});
