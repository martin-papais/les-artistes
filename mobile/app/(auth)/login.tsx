import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { sb } from '@/lib/supabase';
import { theme } from '@/lib/theme';

type Panel = 'login' | 'signup';

export default function LoginScreen() {
  const [panel, setPanel] = useState<Panel>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Login
  const [identifiant, setIdentifiant] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Signup
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [email, setEmail] = useState('');
  const [tel, setTel] = useState('');
  const [dob, setDob] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupPassword2, setSignupPassword2] = useState('');
  const [groupePassword, setGroupePassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  function switchPanel(p: Panel) {
    setError(null);
    setPanel(p);
  }

  async function handleLogin() {
    if (!identifiant || !loginPassword) {
      setError('Remplis tous les champs.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      let emailToUse = identifiant.trim();
      if (!emailToUse.includes('@')) {
        // profiles n'est plus lisible sans connexion : la RPC renvoie l'email d'un pseudo exact
        const { data: found, error: lookupError } = await sb.rpc('email_for_pseudo', {
          p_pseudo: emailToUse,
        });
        if (lookupError || typeof found !== 'string' || !found) {
          setError('Pseudo introuvable. Essaie ton email.');
          setLoading(false);
          return;
        }
        emailToUse = found;
      }
      const { error: authError } = await sb.auth.signInWithPassword({
        email: emailToUse,
        password: loginPassword,
      });
      if (authError) {
        if (authError.message.toLowerCase().includes('confirm')) {
          setError('Confirme d’abord ton email (regarde ta boîte mail).');
        } else {
          setError('Identifiant ou mot de passe incorrect.');
        }
      }
      // La navigation vers les onglets est faite par _layout.tsx (événement SIGNED_IN)
    } catch {
      setError('Erreur réseau. Réessaie.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup() {
    if (!prenom || !nom || !email || !signupPassword || !signupPassword2) {
      setError('Remplis tous les champs obligatoires.');
      return;
    }
    if (signupPassword !== signupPassword2) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (signupPassword.length < 8) {
      setError('Mot de passe : 8 caractères minimum.');
      return;
    }
    // Le web envoie une date AAAA-MM-JJ (input type="date") : on accepte aussi JJ/MM/AAAA
    const dobRaw = dob.trim();
    let dobIso = '';
    if (dobRaw) {
      const fr = dobRaw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      dobIso = fr ? `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}` : dobRaw;
      const d = new Date(`${dobIso}T00:00:00`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dobIso) || Number.isNaN(d.getTime())) {
        setError('Date de naissance invalide (format AAAA-MM-JJ).');
        return;
      }
    }
    if (!groupePassword.trim()) {
      setError('Mot de passe du groupe requis. Demande-le à un membre.');
      return;
    }
    if (!acceptTerms) {
      setError('Accepte les conditions d’utilisation pour rejoindre le groupe.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const pseudo = `${prenom.trim()} ${nom.trim()}`;
      const { data: signupData, error: signupError } = await sb.auth.signUp({
        email: email.trim(),
        password: signupPassword,
        options: {
          data: {
            pseudo,
            prenom: prenom.trim(),
            nom: nom.trim(),
            tel: tel.trim(),
            dob: dobIso,
            // Vérifié côté serveur (trigger Supabase) : un mauvais code fait échouer l'inscription
            group_code: groupePassword.trim(),
          },
        },
      });
      if (signupError) {
        const msg = signupError.message;
        if (msg.includes('group_code') || msg.includes('Database error saving new user')) {
          setError('Mot de passe du groupe incorrect. Demande-le à un membre.');
        } else {
          setError(
            msg.toLowerCase().includes('already') ? 'Cet email est déjà utilisé.' : msg,
          );
        }
      } else if (signupData.session) {
        // Compte confirmé d'office : _layout.tsx bascule sur les onglets (SIGNED_IN)
      } else {
        Alert.alert(
          'Compte créé',
          'Vérifie tes emails pour confirmer ta boîte, puis reviens te connecter.',
        );
        switchPanel('login');
      }
    } catch {
      setError('Erreur réseau. Réessaie.');
    } finally {
      setLoading(false);
    }
  }

  async function sendReset(value: string) {
    const mail = value.trim();
    if (!mail.includes('@')) {
      Alert.alert('Email requis', 'Saisis l’adresse email de ton compte.');
      return;
    }
    try {
      // resetPasswordForEmail renvoie l'erreur au lieu de la lever
      const { error: resetError } = await sb.auth.resetPasswordForEmail(mail, {
        redirectTo: 'https://les--artistes.fr/login.html',
      });
      if (resetError) Alert.alert('Erreur', resetError.message);
      else Alert.alert('Lien envoyé', 'Vérifie ta boîte mail (et les spams).');
    } catch {
      Alert.alert('Erreur', 'Erreur réseau. Réessaie.');
    }
  }

  function handleForgot() {
    // Alert.prompt n'existe que sur iOS (sur Android il ne fait rien)
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'Mot de passe oublié',
        'Saisis ton email, on t’envoie un lien.',
        (value) => {
          if (value) sendReset(value);
        },
        'plain-text',
        identifiant.includes('@') ? identifiant.trim() : '',
        'email-address',
      );
      return;
    }
    if (identifiant.includes('@')) {
      Alert.alert('Mot de passe oublié', `Envoyer un lien de réinitialisation à ${identifiant.trim()} ?`, [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Envoyer', onPress: () => sendReset(identifiant) },
      ]);
    } else {
      Alert.alert(
        'Mot de passe oublié',
        'Saisis ton adresse email dans le champ « Pseudo ou email », puis appuie à nouveau sur « Mot de passe oublié ».',
      );
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>LA</Text>
          </View>
          <Text style={styles.title}>Les Artistes</Text>
          <Text style={styles.subtitle}>L&apos;espace privé du groupe.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.tabs}>
            <Pressable
              onPress={() => switchPanel('login')}
              style={[styles.tab, panel === 'login' && styles.tabActive]}
            >
              <Text style={[styles.tabText, panel === 'login' && styles.tabTextActive]}>
                Connexion
              </Text>
            </Pressable>
            <Pressable
              onPress={() => switchPanel('signup')}
              style={[styles.tab, panel === 'signup' && styles.tabActive]}
            >
              <Text style={[styles.tabText, panel === 'signup' && styles.tabTextActive]}>
                Inscription
              </Text>
            </Pressable>
          </View>

          {!!error && (
            <View style={styles.alert}>
              <Text style={styles.alertText}>{error}</Text>
            </View>
          )}

          {panel === 'login' ? (
            <>
              <Field
                label="Pseudo (prénom + nom) ou email"
                value={identifiant}
                onChangeText={setIdentifiant}
                placeholder="Marie Dupont"
                autoCapitalize="words"
                textContentType="username"
              />
              <Field
                label="Mot de passe"
                value={loginPassword}
                onChangeText={setLoginPassword}
                placeholder="••••••••"
                secureTextEntry
                textContentType="password"
              />
              <Pressable onPress={handleForgot} style={styles.forgotRow}>
                <Text style={styles.link}>Mot de passe oublié ?</Text>
              </Pressable>
              <PrimaryButton
                label="Se connecter"
                onPress={handleLogin}
                loading={loading}
              />
            </>
          ) : (
            <>
              <View style={styles.row2}>
                <View style={styles.flex}>
                  <Field label="Prénom" value={prenom} onChangeText={setPrenom} placeholder="Marie" />
                </View>
                <View style={{ width: 12 }} />
                <View style={styles.flex}>
                  <Field label="Nom" value={nom} onChangeText={setNom} placeholder="Dupont" />
                </View>
              </View>
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="marie@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
                textContentType="emailAddress"
              />
              <Field
                label="Téléphone (optionnel)"
                value={tel}
                onChangeText={setTel}
                placeholder="06 12 34 56 78"
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
              />
              <Field
                label="Date de naissance (AAAA-MM-JJ)"
                value={dob}
                onChangeText={setDob}
                placeholder="1995-03-21"
                autoCapitalize="none"
              />
              <Field
                label="Mot de passe"
                value={signupPassword}
                onChangeText={setSignupPassword}
                placeholder="Min. 8 caractères"
                secureTextEntry
                textContentType="newPassword"
              />
              <Field
                label="Confirmer le mot de passe"
                value={signupPassword2}
                onChangeText={setSignupPassword2}
                placeholder="••••••••"
                secureTextEntry
                textContentType="newPassword"
              />
              <Field
                label="Mot de passe du groupe"
                value={groupePassword}
                onChangeText={setGroupePassword}
                placeholder="Demande-le à un membre"
                secureTextEntry
                autoCapitalize="none"
              />
              <View style={styles.termsRow}>
                <Pressable
                  onPress={() => setAcceptTerms((v) => !v)}
                  hitSlop={8}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: acceptTerms }}
                >
                  <Ionicons
                    name={acceptTerms ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={acceptTerms ? theme.colors.teal : theme.colors.muted}
                  />
                </Pressable>
                <Text style={styles.termsText}>
                  J&apos;accepte les{' '}
                  <Text
                    style={styles.link}
                    onPress={() => Linking.openURL('https://les--artistes.fr/confidentialite.html#conditions')}
                  >
                    conditions d&apos;utilisation
                  </Text>
                  {' '}: aucun contenu offensant ou abusif n&apos;est toléré.
                </Text>
              </View>
              <PrimaryButton
                label="Rejoindre le groupe"
                onPress={handleSignup}
                loading={loading}
              />
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="rgba(255,255,255,0.3)"
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  loading,
}: {
  label: string;
  onPress: () => void;
  loading: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.btn,
        pressed && { opacity: 0.85 },
        loading && { opacity: 0.6 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.btnText}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.s(6),
    backgroundColor: theme.colors.deep,
  },
  header: { alignItems: 'center', marginBottom: theme.s(8) },
  logoMark: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.s(3),
  },
  logoMarkText: {
    color: '#fff',
    fontFamily: theme.fonts.serifBlack,
    fontSize: 22,
    letterSpacing: 1,
  },
  title: {
    fontFamily: theme.fonts.title,
    fontSize: 32,
    fontWeight: '900',
    color: theme.colors.yellow,
    letterSpacing: -0.5,
  },
  subtitle: { color: theme.colors.muted, marginTop: theme.s(1) },
  card: {
    backgroundColor: theme.colors.cardBg,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.s(6),
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    padding: 4,
    marginBottom: theme.s(5),
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: theme.colors.surface2 },
  tabText: { color: theme.colors.muted, fontWeight: '600', fontSize: 14 },
  tabTextActive: { color: theme.colors.text },
  field: { marginBottom: theme.s(4) },
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
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  row2: { flexDirection: 'row' },
  forgotRow: { alignSelf: 'flex-end', marginTop: -theme.s(1), marginBottom: theme.s(4) },
  link: { color: theme.colors.teal, fontSize: 13, fontWeight: '500' },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: theme.s(4) },
  termsText: { flex: 1, color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
  btn: {
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: theme.s(2),
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  alert: {
    backgroundColor: 'rgba(255,107,107,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,107,107,0.4)',
    borderRadius: theme.radius.sm,
    padding: 10,
    marginBottom: theme.s(3),
  },
  alertText: { color: theme.colors.danger, fontSize: 13 },
});
