import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { signOutAndUnregister, unregisterPushToken } from '@/lib/notifications';
import { parseDobInput, sb, type AnnuaireExtra, type Profile, sessionUser } from '@/lib/supabase';
import { KeyboardAware } from '@/lib/keyboard';
import { theme } from '@/lib/theme';

function parseAddresses(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((a): a is string => typeof a === 'string');
  } catch {}
  return [raw];
}

export default function ProfilScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [extra, setExtra] = useState<AnnuaireExtra | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const loadAll = useCallback(async () => {
    const user = await sessionUser();
    if (!user) {
      setLoading(false);
      router.replace('/(auth)/login');
      return;
    }
    setEmail(user.email ?? null);
    const [profRes, extraRes] = await Promise.all([
      sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      sb.from('annuaire_extra').select('*').eq('user_id', user.id).maybeSingle(),
    ]);
    setProfile(profRes.data as Profile | null);
    setExtra(extraRes.data as AnnuaireExtra | null);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  function confirmLogout() {
    Alert.alert('Déconnexion', 'Tu veux vraiment te déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Déconnexion',
        style: 'destructive',
        onPress: async () => {
          // La navigation vers le login est faite par app/_layout.tsx (événement SIGNED_OUT)
          await signOutAndUnregister();
        },
      },
    ]);
  }

  // Suppression du compte (exigée par l'App Store) : fichiers Storage d'abord (le SQL ne peut
  // pas les effacer), puis delete_my_account qui supprime le compte et toutes ses données.
  async function deleteAccount() {
    const user = await sessionUser();
    if (!user) return;
    setDeleting(true);
    try {
      for (const folder of [user.id, `${user.id}/covers`]) {
        const { data: files } = await sb.storage.from('media').list(folder, { limit: 1000 });
        const paths = (files ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`);
        if (paths.length) await sb.storage.from('media').remove(paths);
      }
      await unregisterPushToken();
      const { error } = await sb.rpc('delete_my_account');
      if (error) throw new Error(error.message);
      // La navigation vers le login est faite par app/_layout.tsx (événement SIGNED_OUT)
      await sb.auth.signOut({ scope: 'local' });
    } catch (e) {
      setDeleting(false);
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.');
    }
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Supprimer mon compte',
      'Ton compte et tout ce que tu as publié (événements, photos, news, votes, commentaires, notes, commandes) seront supprimés définitivement.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer définitivement', style: 'destructive', onPress: deleteAccount },
      ],
    );
  }

  if (loading) {
    return (
      <View style={[styles.flex, styles.center]}>
        <ActivityIndicator color={theme.colors.teal} />
      </View>
    );
  }

  const displayName = profile?.pseudo || profile?.prenom || email || '?';
  const initial = displayName[0]?.toUpperCase() ?? '?';
  const addresses = parseAddresses(extra?.addresses);

  return (
    <SafeAreaView style={styles.flex} edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={{ marginLeft: 16, flex: 1 }}>
            <Text style={styles.name}>{displayName}</Text>
            {!!email && <Text style={styles.email}>{email}</Text>}
          </View>
        </View>

        <Pressable
          onPress={() =>
            profile
              ? setEditing(true)
              : Alert.alert('Profil introuvable', 'Reviens sur cette page dans un instant pour réessayer.')
          }
          style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="create-outline" size={18} color={theme.colors.coral} />
          <Text style={styles.editBtnText}>Modifier mon profil</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} style={{ marginLeft: 'auto' }} />
        </Pressable>

        <Text style={styles.section}>Identité</Text>
        <View style={styles.card}>
          <Row icon="person-outline" label="Prénom" value={profile?.prenom} />
          <Row icon="person-outline" label="Nom" value={profile?.nom} />
          <Row icon="balloon-outline" label="Date de naissance" value={profile?.dob} last />
        </View>

        <Text style={styles.section}>Contact</Text>
        <View style={styles.card}>
          <Row icon="mail-outline" label="Email" value={email} />
          <Row icon="call-outline" label="Téléphone" value={profile?.tel} last />
        </View>

        <Text style={styles.section}>Annuaire</Text>
        <View style={styles.card}>
          {addresses.length === 0 ? (
            <Row icon="location-outline" label="Adresses" value={null} last />
          ) : (
            addresses.map((a, i) => (
              <Row
                key={i}
                icon="location-outline"
                label={i === 0 ? 'Adresse' : `Adresse ${i + 1}`}
                value={a}
                last={i === addresses.length - 1 && !extra?.rib}
              />
            ))
          )}
          {!!extra?.rib && <Row icon="card-outline" label="RIB / IBAN" value={extra.rib} last />}
        </View>

        <Pressable
          onPress={confirmLogout}
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="log-out-outline" size={18} color={theme.colors.coral} />
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>

        <Pressable
          onPress={confirmDeleteAccount}
          disabled={deleting}
          style={({ pressed }) => [styles.deleteBtn, (pressed || deleting) && { opacity: 0.6 }]}
        >
          {deleting ? (
            <ActivityIndicator color={theme.colors.danger} />
          ) : (
            <Text style={styles.deleteText}>Supprimer mon compte</Text>
          )}
        </Pressable>
      </ScrollView>

      <Modal
        visible={editing && !!profile}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditing(false)}
      >
        {!!profile && (
          <EditProfileModal
            profile={profile}
            extra={extra}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              loadAll();
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

function Row({
  icon,
  label,
  value,
  last,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string | null | undefined;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Ionicons name={icon} size={16} color={theme.colors.muted} style={{ marginRight: 10 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} selectable>
          {value || '—'}
        </Text>
      </View>
    </View>
  );
}

function EditProfileModal({
  profile,
  extra,
  onClose,
  onSaved,
}: {
  profile: Profile;
  extra: AnnuaireExtra | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialAddrs = parseAddresses(extra?.addresses);
  const [prenom, setPrenom] = useState(profile.prenom ?? '');
  const [nom, setNom] = useState(profile.nom ?? '');
  const [dob, setDob] = useState(profile.dob ?? '');
  const [tel, setTel] = useState(profile.tel ?? '');
  const [addresses, setAddresses] = useState<string[]>(initialAddrs.length ? initialAddrs : ['']);
  const [rib, setRib] = useState(extra?.rib ?? '');
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
        .eq('id', profile.id);
      const r2 = await sb.from('annuaire_extra').upsert(
        {
          user_id: profile.id,
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
        <Pressable onPress={onClose} hitSlop={10} style={styles.modalCloseBtn}>
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.modalTitle}>Modifier mon profil</Text>
        <View style={{ width: 36 }} />
      </View>
      <KeyboardAware>
        <ScrollView contentContainerStyle={{ padding: theme.s(5) }} keyboardShouldPersistTaps="handled">
          <FormField label="Prénom" value={prenom} onChangeText={setPrenom} />
          <FormField label="Nom" value={nom} onChangeText={setNom} />
          <FormField
            label="Date de naissance (JJ/MM/AAAA)"
            value={dob}
            onChangeText={setDob}
            placeholder="21/03/1995"
            autoCapitalize="none"
          />
          <FormField
            label="Téléphone"
            value={tel}
            onChangeText={setTel}
            keyboardType="phone-pad"
            placeholder="06 12 34 56 78"
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

          <FormField
            label="RIB / IBAN"
            value={rib}
            onChangeText={setRib}
            autoCapitalize="characters"
            placeholder="FR76 ..."
          />

          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [styles.saveBtn, (pressed || saving) && { opacity: 0.7 }]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveText}>Enregistrer</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAware>
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
  center: { alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: theme.s(5), paddingTop: theme.s(6) },
  avatarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.s(5) },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.violet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontFamily: theme.fonts.serifBlack, fontSize: 26 },
  name: { color: theme.colors.text, fontFamily: theme.fonts.serifBlack, fontSize: 24 },
  email: { color: theme.colors.muted, fontFamily: theme.fonts.body, marginTop: 2, fontSize: 13 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.radius.lg,
    padding: theme.s(3),
    marginBottom: theme.s(5),
    minHeight: 50,
  },
  editBtnText: { color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  section: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: theme.s(2),
    marginTop: theme.s(2),
  },
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.s(3),
    marginBottom: theme.s(5),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  rowLabel: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  rowValue: { color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 15 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,107,107,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.35)',
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    marginTop: theme.s(2),
    minHeight: 48,
  },
  logoutText: { color: theme.colors.coral, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  deleteBtn: { marginTop: 14, paddingVertical: 12, alignItems: 'center' },
  deleteText: { color: theme.colors.danger, fontFamily: theme.fonts.body, fontSize: 13, textDecorationLine: 'underline' },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.s(3),
    paddingTop: theme.s(2),
    paddingBottom: theme.s(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  modalTitle: {
    flex: 1,
    color: theme.colors.text,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 15,
    textAlign: 'center',
  },
  label: {
    fontFamily: theme.fonts.bodyBold,
    fontSize: 11,
    color: theme.colors.muted,
    marginBottom: 6,
    letterSpacing: 1,
    textTransform: 'uppercase',
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
  },
  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: theme.s(2) },
  addrRemove: { padding: 6 },
  addAddrBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginBottom: theme.s(4),
  },
  addAddrText: { color: theme.colors.teal, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  saveBtn: {
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: theme.s(4),
    minHeight: 52,
    justifyContent: 'center',
  },
  saveText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
