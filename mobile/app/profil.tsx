import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Field, FieldLabel, IconButton, Pastille, Sheet } from '@/components/ui/kit';
import { signOutAndUnregister, unregisterPushToken } from '@/lib/notifications';
import { parseDobInput, sb, type AnnuaireExtra, type Profile, sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

function parseAddresses(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((a): a is string => typeof a === 'string');
  } catch {}
  return [raw];
}

/** AAAA-MM-JJ → « 9 juin 2001 » (la valeur brute si elle n'est pas lisible). */
function dobLabel(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const m = dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return dob;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? dob : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** « Les Artistes, version 1.0.0 », avec la date de la mise à jour reçue s'il y en a une. */
function versionLabel(): string {
  let label = `Les Artistes, version ${Constants.expoConfig?.version ?? '?'}`;
  try {
    if (!Updates.isEmbeddedLaunch && Updates.createdAt) {
      label += `, mise à jour du ${Updates.createdAt.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
    }
  } catch {}
  return label;
}

export default function ProfilScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  function openEdit() {
    if (profile) setEditing(true);
    else Alert.alert('Profil introuvable', 'Reviens sur cette page dans un instant pour réessayer.');
  }

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
      for (const folder of [user.id, `${user.id}/covers`, `${user.id}/agenda`]) {
        const { data: files } = await sb.storage.from('media').list(folder, { limit: 1000 });
        const paths = (files ?? []).filter((x) => x.id).map((x) => `${folder}/${x.name}`);
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
      <View style={styles.flex}>
        <BackRow />
        <View style={styles.center}>
          <ActivityIndicator color={c.teal} />
        </View>
      </View>
    );
  }

  const fullName = [profile?.prenom, profile?.nom].filter(Boolean).join(' ').trim();
  const displayName = fullName || profile?.pseudo || email || '?';
  const addresses = parseAddresses(extra?.addresses);

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <BackRow />

        <View style={styles.hero}>
          <Pastille id={profile?.id ?? null} name={displayName} size={88} serif />
          <Text style={styles.name} accessibilityRole="header">
            {displayName}
          </Text>
          {!!email && (
            <Text style={styles.email} selectable>
              {email}
            </Text>
          )}
          <Button label="Modifier mon profil" variant="secondary" height={44} onPress={openEdit} style={{ marginTop: 14 }} />
        </View>

        <View style={{ paddingHorizontal: theme.gutter }}>
          <Text style={styles.groupTitle} accessibilityRole="header">
            Ce que le groupe voit
          </Text>
          <View style={styles.group}>
            <InfoRow label="Anniversaire" value={dobLabel(profile?.dob)} onAdd={openEdit} />
            <InfoRow label="Téléphone" value={profile?.tel} onAdd={openEdit} />
            {addresses.length === 0 ? (
              <InfoRow label="Adresses" value={null} onAdd={openEdit} />
            ) : (
              addresses.map((a, i) => (
                <InfoRow key={i} label={i === 0 ? 'Adresse' : `Adresse ${i + 1}`} value={a} onAdd={openEdit} />
              ))
            )}
            <InfoRow label="RIB" value={extra?.rib} onAdd={openEdit} last />
          </View>

          <View style={[styles.group, { marginTop: 20 }]}>
            <Pressable
              onPress={confirmLogout}
              accessibilityRole="button"
              style={({ pressed }) => [styles.item, styles.itemBorder, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.actionText}>Se déconnecter</Text>
              <Feather name="log-out" size={18} color={c.muted} />
            </Pressable>
            <Pressable
              onPress={confirmDeleteAccount}
              disabled={deleting}
              accessibilityRole="button"
              accessibilityState={{ disabled: deleting }}
              style={({ pressed }) => [styles.item, (pressed || deleting) && { opacity: 0.7 }]}
            >
              <Text style={[styles.actionText, { color: c.danger }]}>Supprimer mon compte</Text>
              {deleting && <ActivityIndicator color={c.danger} />}
            </Pressable>
          </View>

          <Text style={styles.version}>{versionLabel()}</Text>
        </View>
      </ScrollView>

      {editing && !!profile && (
        <EditProfileSheet
          profile={profile}
          extra={extra}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            loadAll();
          }}
        />
      )}
    </View>
  );
}

/** Chevron de retour seul : le nom en grand, centré, sert de titre. */
function BackRow() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 4, paddingHorizontal: theme.gutter }}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/plus'))}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Retour"
        style={styles.back}
      >
        <Feather name="chevron-left" size={28} color={c.coral} />
      </Pressable>
    </View>
  );
}

/** Ligne « clé : valeur » ; ce qui manque propose « Ajouter ». */
function InfoRow({
  label,
  value,
  onAdd,
  last,
}: {
  label: string;
  value: string | null | undefined;
  onAdd: () => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.item, !last && styles.itemBorder]}>
      <Text style={styles.key}>{label}</Text>
      {value ? (
        <Text style={styles.value} selectable>
          {value}
        </Text>
      ) : (
        <Pressable onPress={onAdd} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Ajouter : ${label}`} style={styles.addBtn}>
          <Text style={styles.addText}>Ajouter</Text>
        </Pressable>
      )}
    </View>
  );
}

function EditProfileSheet({
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
    <Sheet
      visible
      onClose={onClose}
      title="Modifier mon profil"
      footer={<Button label="Enregistrer" onPress={save} loading={saving} />}
    >
      <FormField label="Prénom" value={prenom} onChangeText={setPrenom} />
      <FormField label="Nom" value={nom} onChangeText={setNom} />
      <FormField
        label="Date de naissance"
        hint="JJ/MM/AAAA"
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

      <FieldLabel>Adresses</FieldLabel>
      {addresses.map((a, i) => (
        <View key={i} style={styles.addrRow}>
          <Field
            value={a}
            onChangeText={(v) => setAddrAt(i, v)}
            placeholder={`Adresse ${i + 1}`}
            accessibilityLabel={`Adresse ${i + 1}`}
            multiline
            style={styles.addrInput}
            onDark
          />
          <IconButton name="x" label={`Retirer l'adresse ${i + 1}`} onPress={() => removeAddr(i)} bg={c.raised} color={c.muted} />
        </View>
      ))}
      <Pressable onPress={addAddr} accessibilityRole="button" style={({ pressed }) => [styles.addAddrBtn, pressed && { opacity: 0.7 }]}>
        <Feather name="plus" size={18} color={c.teal} />
        <Text style={styles.addAddrText}>Ajouter une adresse</Text>
      </Pressable>

      <FormField
        label="RIB / IBAN"
        value={rib}
        onChangeText={setRib}
        autoCapitalize="characters"
        placeholder="FR76 ..."
      />
    </Sheet>
  );
}

function FormField({ label, hint, ...rest }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <Field accessibilityLabel={label} onDark {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', paddingHorizontal: theme.gutter },
  name: { color: c.text, fontFamily: f.serifBlack, fontSize: 28, lineHeight: 34, marginTop: 12, textAlign: 'center' },
  email: { color: c.muted, fontFamily: f.body, fontSize: 14, marginTop: 4, textAlign: 'center' },
  groupTitle: { color: c.muted, fontFamily: f.bodyBold, fontSize: 14, marginTop: 20, marginBottom: 8, marginLeft: 4 },
  group: { backgroundColor: c.card, borderRadius: theme.radius.card, overflow: 'hidden' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  itemBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  key: { color: c.muted, fontFamily: f.body, fontSize: 15 },
  value: { flexShrink: 1, color: c.text, fontFamily: f.body, fontSize: 15, lineHeight: 21, textAlign: 'right' },
  addBtn: { minHeight: 44, justifyContent: 'center' },
  addText: { color: c.coralSoft, fontFamily: f.bodyBold, fontSize: 15 },
  actionText: { color: c.text, fontFamily: f.bodyBold, fontSize: 15 },
  version: { color: c.muted, fontFamily: f.body, fontSize: 12, textAlign: 'center', marginTop: 16 },

  addrRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  addrInput: { flex: 1, minHeight: 50, paddingTop: 14, paddingBottom: 14 },
  addAddrBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44, marginBottom: 12 },
  addAddrText: { color: c.teal, fontFamily: f.bodyBold, fontSize: 15 },
});
