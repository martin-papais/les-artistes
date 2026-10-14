import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContactCard, displayName, type ContactData } from '@/components/plus/ContactCard';
import { Button, EmptyState, Field, FieldLabel, Icon, IconButton, Pastille, ScreenHeader, Sheet } from '@/components/ui/kit';
import { parseDobInput, sb, type AnnuaireExtra, type Profile, sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

function parseAddresses(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((a): a is string => typeof a === 'string');
  } catch {}
  return [raw];
}

/** Minuscules sans accents, pour la recherche et le tri. */
function fold(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Lettre de section : initiale du nom de famille, sinon du nom affiché. */
function letterOf(p: ContactData) {
  const l = fold((p.nom || displayName(p)).trim())[0]?.toUpperCase() ?? '#';
  return /[A-Z]/.test(l) ? l : '#';
}

export default function AnnuaireScreen() {
  const [cards, setCards] = useState<ContactData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContactData | null>(null);
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();

  const loadAll = useCallback(async () => {
    const user = await sessionUser();
    setUserId(user?.id ?? null);

    const [profRes, extraRes] = await Promise.all([
      sb.from('profiles').select('*').order('nom', { ascending: true }),
      sb.from('annuaire_extra').select('*'),
    ]);
    if (profRes.error) {
      // Sans ça, une erreur réseau ressemble à un annuaire vide
      setLoading(false);
      Alert.alert('Chargement impossible', 'Vérifie ta connexion puis tire vers le bas pour réessayer.');
      return;
    }

    const extraMap: Record<string, AnnuaireExtra> = {};
    (extraRes.data ?? []).forEach((e) => {
      extraMap[(e as AnnuaireExtra).user_id] = e as AnnuaireExtra;
    });

    setCards(
      ((profRes.data ?? []) as Profile[]).map((p) => {
        const extra = extraMap[p.id];
        return {
          ...p,
          addresses: parseAddresses(extra?.addresses ?? null),
          rib: extra?.rib ?? null,
        };
      }),
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

  function editMine() {
    const me = cards.find((p) => p.id === userId);
    if (me) setEditing(me);
    else Alert.alert('Profil introuvable', 'Tire vers le bas pour rafraîchir, puis réessaie.');
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.teal} />
      </View>
    );
  }

  const me = cards.find((p) => p.id === userId) ?? null;
  const q = fold(query.trim());
  const shown = q
    ? cards.filter((p) => fold(`${p.prenom ?? ''} ${p.nom ?? ''} ${p.pseudo ?? ''}`).includes(q))
    : cards;
  // Sections par lettre ; l'ordre du serveur (par nom) est gardé dans chaque section
  const sections: { title: string; data: ContactData[] }[] = [];
  [...shown]
    .sort((a, b) => letterOf(a).localeCompare(letterOf(b)))
    .forEach((p) => {
      const l = letterOf(p);
      const last = sections[sections.length - 1];
      if (last && last.title === l) last.data.push(p);
      else sections.push({ title: l, data: [p] });
    });
  const n = cards.length;

  return (
    <View style={styles.flex}>
      <SectionList
        sections={sections}
        keyExtractor={(p) => p.id}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        ListHeaderComponent={
          <View>
            <ScreenHeader back title="Annuaire" sub={`${n} membre${n > 1 ? 's' : ''}`} />
            <View style={styles.search}>
              <Icon name="search" size={18} color={c.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Chercher un membre"
                placeholderTextColor={c.muted}
                selectionColor={c.coral}
                accessibilityLabel="Chercher un membre"
                autoCorrect={false}
                returnKeyType="search"
                style={styles.searchInput}
              />
              {!!query && <IconButton name="x" label="Effacer la recherche" onPress={() => setQuery('')} bg="transparent" color={c.muted} size={36} />}
            </View>
            <Pressable
              onPress={editMine}
              accessibilityRole="button"
              accessibilityLabel="Modifier ta fiche"
              style={({ pressed }) => [styles.mine, pressed && { opacity: 0.85 }]}
            >
              <Pastille id={userId} name={me?.prenom || me?.pseudo} size={40} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.mineTitle}>Ta fiche</Text>
                <Text style={styles.mineSub}>Ce que le groupe voit de toi</Text>
              </View>
              <Text style={styles.mineAction}>Modifier</Text>
            </Pressable>
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.letter}>{section.title}</Text>}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <ContactCard card={item} isMine={item.id === userId} />
          </View>
        )}
        ListEmptyComponent={
          q ? (
            <EmptyState icon="search" title="Personne à ce nom" text="Essaie avec le prénom, le nom ou le pseudo." />
          ) : (
            <EmptyState icon="users" title="Aucun contact pour l'instant" text="Tire vers le bas pour rafraîchir." />
          )
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
      />
      {!!editing && (
        <EditProfileSheet
          card={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadAll();
          }}
        />
      )}
    </View>
  );
}

function EditProfileSheet({
  card,
  onClose,
  onSaved,
}: {
  card: ContactData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [prenom, setPrenom] = useState(card.prenom ?? '');
  const [nom, setNom] = useState(card.nom ?? '');
  const [dob, setDob] = useState(card.dob ?? '');
  const [tel, setTel] = useState(card.tel ?? '');
  const [addresses, setAddresses] = useState<string[]>(card.addresses.length ? card.addresses : ['']);
  const [rib, setRib] = useState(card.rib ?? '');
  const [saving, setSaving] = useState(false);

  function setAddrAt(i: number, v: string) {
    setAddresses((prev) => prev.map((a, idx) => (idx === i ? v : a)));
  }
  function addAddr() {
    setAddresses((prev) => [...prev, '']);
  }
  function removeAddr(i: number) {
    setAddresses((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!prenom.trim() || !nom.trim()) {
      Alert.alert('Champs requis', 'Prénom et nom obligatoires.');
      return;
    }
    const dobIso = parseDobInput(dob);
    if (dobIso === false) {
      Alert.alert('Date invalide', 'Format attendu : JJ/MM/AAAA ou AAAA-MM-JJ.');
      return;
    }
    setSaving(true);
    try {
      const cleanAddrs = addresses.map((a) => a.trim()).filter(Boolean);
      const r1 = await sb
        .from('profiles')
        .update({
          prenom: prenom.trim(),
          nom: nom.trim(),
          dob: dobIso,
          tel: tel.trim() || null,
        })
        .eq('id', card.id);
      const r2 = await sb.from('annuaire_extra').upsert(
        {
          user_id: card.id,
          addresses: JSON.stringify(cleanAddrs),
          rib: rib.trim() || null,
        },
        { onConflict: 'user_id' },
      );
      if (r1.error || r2.error) throw r1.error || r2.error;
      onSaved();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Ta fiche"
      sub="Ce que le groupe voit de toi dans l'annuaire."
      footer={<Button label="Enregistrer" icon="check" onPress={save} loading={saving} />}
    >
      <FieldLabel>Prénom</FieldLabel>
      <Field value={prenom} onChangeText={setPrenom} onDark autoComplete="given-name" />
      <View style={styles.gap} />
      <FieldLabel>Nom</FieldLabel>
      <Field value={nom} onChangeText={setNom} onDark autoComplete="family-name" />
      <View style={styles.gap} />
      <FieldLabel hint="JJ/MM/AAAA">Date de naissance</FieldLabel>
      <Field value={dob} onChangeText={setDob} placeholder="21/03/1995" autoCapitalize="none" keyboardType="numbers-and-punctuation" onDark />
      <View style={styles.gap} />
      <FieldLabel>Téléphone</FieldLabel>
      <Field value={tel} onChangeText={setTel} keyboardType="phone-pad" onDark autoComplete="tel" />
      <View style={styles.gap} />
      <FieldLabel>Adresses</FieldLabel>
      {addresses.map((a, i) => (
        <View key={i} style={styles.addrRow}>
          <Field
            value={a}
            onChangeText={(v) => setAddrAt(i, v)}
            placeholder={`Adresse ${i + 1}`}
            onDark
            multiline
            style={{ flex: 1, minHeight: 50 }}
          />
          <IconButton name="x" label={`Retirer l'adresse ${i + 1}`} onPress={() => removeAddr(i)} bg="transparent" color={c.muted} />
        </View>
      ))}
      <Button label="Ajouter une adresse" icon="plus" variant="raised" height={44} onPress={addAddr} style={{ alignSelf: 'flex-start' }} />
      <View style={styles.gap} />
      <FieldLabel hint="visible par le groupe, masqué à l'affichage">RIB ou IBAN</FieldLabel>
      <Field value={rib} onChangeText={setRib} autoCapitalize="characters" autoCorrect={false} onDark />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.deep },
  search: {
    marginTop: 16,
    marginHorizontal: theme.gutter,
    height: 48,
    borderRadius: 24,
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 6,
  },
  searchInput: { flex: 1, height: 48, color: c.text, fontFamily: f.body, fontSize: 15, paddingVertical: 0 },
  mine: {
    marginTop: 12,
    marginHorizontal: theme.gutter,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mineTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 15, lineHeight: 20 },
  mineSub: { color: c.muted, fontFamily: f.body, fontSize: 13, lineHeight: 18 },
  mineAction: { color: c.yellow, fontFamily: f.bodyBold, fontSize: 14 },
  letter: {
    marginTop: 20,
    marginBottom: 8,
    marginHorizontal: theme.gutter,
    color: c.text,
    fontFamily: f.bodyBold,
    fontSize: 18,
    lineHeight: 24,
  },
  item: { marginHorizontal: theme.gutter, marginBottom: 10 },
  gap: { height: 16 },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
});
