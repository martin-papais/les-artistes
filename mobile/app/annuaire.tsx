import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { sb, type AnnuaireExtra, type Profile } from '@/lib/supabase';
import { theme } from '@/lib/theme';

type Card = Profile & {
  addresses: string[];
  rib: string | null;
};

function parseAddresses(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((a): a is string => typeof a === 'string');
  } catch {}
  return [raw];
}

export default function AnnuaireScreen() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);

  const loadAll = useCallback(async () => {
    const { data: u } = await sb.auth.getUser();
    setUserId(u.user?.id ?? null);

    const [profRes, extraRes] = await Promise.all([
      sb.from('profiles').select('*').order('nom', { ascending: true }),
      sb.from('annuaire_extra').select('*'),
    ]);

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
    await loadAll();
    setRefreshing(false);
  }

  function editMine() {
    const me = cards.find((c) => c.id === userId);
    if (me) setEditing(me);
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
      <FlatList
        data={cards}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: theme.s(4), paddingBottom: theme.s(10) }}
        ListHeaderComponent={
          <Pressable
            onPress={editMine}
            style={({ pressed }) => [styles.editBanner, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="create-outline" size={18} color={theme.colors.coral} />
            <Text style={styles.editBannerText}>Modifier mon profil</Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} style={{ marginLeft: 'auto' }} />
          </Pressable>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Aucun contact pour l&apos;instant.</Text>
          </View>
        }
        renderItem={({ item }) => <ContactCard card={item} isMine={item.id === userId} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.teal} />
        }
      />
      <Modal
        visible={!!editing}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditing(null)}
      >
        {editing && (
          <EditProfileModal
            card={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              loadAll();
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

function ContactCard({ card, isMine }: { card: Card; isMine: boolean }) {
  const name = card.pseudo || `${card.prenom ?? ''} ${card.nom ?? ''}`.trim() || '?';
  const initial = name[0]?.toUpperCase() ?? '?';
  return (
    <View style={[styles.card, isMine && styles.cardMine]}>
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.cardName}>
            {name} {isMine && <Text style={styles.youTag}>· toi</Text>}
          </Text>
          {card.dob && <Text style={styles.cardSub}>{formatDob(card.dob)}</Text>}
        </View>
      </View>
      {card.email && <InfoRow icon="mail-outline" label={card.email} />}
      {card.tel && <InfoRow icon="call-outline" label={card.tel} />}
      {card.addresses.map((a, i) => (
        <InfoRow key={i} icon="location-outline" label={a} />
      ))}
      {card.rib && <InfoRow icon="card-outline" label={card.rib} />}
    </View>
  );
}

function InfoRow({ icon, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={14} color={theme.colors.muted} />
      <Text style={styles.infoText} selectable>
        {label}
      </Text>
    </View>
  );
}

function formatDob(dob: string) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return dob;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function EditProfileModal({
  card,
  onClose,
  onSaved,
}: {
  card: Card;
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
    setSaving(true);
    try {
      const cleanAddrs = addresses.map((a) => a.trim()).filter(Boolean);
      const r1 = await sb
        .from('profiles')
        .update({
          prenom: prenom.trim(),
          nom: nom.trim(),
          pseudo: `${prenom.trim()} ${nom.trim()}`,
          dob: dob || null,
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
    <SafeAreaView style={styles.flex}>
      <View style={styles.modalHeader}>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={28} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.modalTitle}>Mon profil</Text>
        <View style={{ width: 28 }} />
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={20}
      >
        <ScrollView contentContainerStyle={{ padding: theme.s(5) }} keyboardShouldPersistTaps="handled">
          <FormField label="Prénom" value={prenom} onChangeText={setPrenom} />
          <FormField label="Nom" value={nom} onChangeText={setNom} />
          <FormField
            label="Date de naissance (AAAA-MM-JJ)"
            value={dob}
            onChangeText={setDob}
            placeholder="1995-03-21"
            autoCapitalize="none"
          />
          <FormField
            label="Téléphone"
            value={tel}
            onChangeText={setTel}
            keyboardType="phone-pad"
          />
          <Text style={styles.label}>Adresses</Text>
          {addresses.map((a, i) => (
            <View key={i} style={styles.addrRow}>
              <TextInput
                value={a}
                onChangeText={(v) => setAddrAt(i, v)}
                placeholder={`Adresse ${i + 1}`}
                placeholderTextColor="rgba(255,255,255,0.3)"
                style={[styles.input, { flex: 1 }]}
                multiline
              />
              <Pressable onPress={() => removeAddr(i)} hitSlop={6} style={styles.addrRemove}>
                <Ionicons name="close" size={18} color={theme.colors.muted} />
              </Pressable>
            </View>
          ))}
          <Pressable onPress={addAddr} style={styles.addAddrBtn}>
            <Ionicons name="add" size={16} color={theme.colors.teal} />
            <Text style={styles.addAddrText}>Ajouter une adresse</Text>
          </Pressable>
          <FormField label="RIB / IBAN" value={rib} onChangeText={setRib} autoCapitalize="characters" />

          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [styles.saveBtn, (pressed || saving) && { opacity: 0.7 }]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveText}>Enregistrer ✓</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FormField(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: theme.s(4) }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="rgba(255,255,255,0.3)"
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.deep },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.radius.lg,
    padding: theme.s(3),
    marginBottom: theme.s(4),
  },
  editBannerText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.s(3),
    marginBottom: theme.s(3),
  },
  cardMine: { borderColor: theme.colors.coral },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.s(2) },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  cardName: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  youTag: { color: theme.colors.coral, fontSize: 12, fontWeight: '600' },
  cardSub: { color: theme.colors.muted, fontSize: 12, marginTop: 2 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  infoText: { color: theme.colors.text, fontSize: 13, flex: 1 },
  empty: { padding: theme.s(8), alignItems: 'center' },
  emptyText: { color: theme.colors.muted, fontSize: 14 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.s(4),
    paddingTop: theme.s(2),
    paddingBottom: theme.s(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalTitle: { color: theme.colors.text, fontFamily: theme.fonts.title, fontSize: 18, fontWeight: '700' },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.muted,
    marginBottom: 6,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: theme.colors.inputBg,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: theme.s(2),
  },
  addrRemove: { padding: 6 },
  addAddrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginBottom: theme.s(4),
  },
  addAddrText: { color: theme.colors.teal, fontSize: 13, fontWeight: '600' },
  saveBtn: {
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: theme.s(4),
  },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
