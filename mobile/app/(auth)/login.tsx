import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Field, FieldLabel, Segmented } from '@/components/ui/kit';
import { KeyboardAware } from '@/lib/keyboard';
import { sb } from '@/lib/supabase';
import { theme } from '@/lib/theme';

type Panel = 'login' | 'signup';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
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
        setError('Date de naissance invalide (JJ/MM/AAAA).');
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
        'Saisis ton adresse email dans le champ « Prénom Nom ou email », puis appuie à nouveau sur « Mot de passe oublié ».',
      );
    }
  }


  return (
    <KeyboardAware style={styles.flex} insideSafeArea={false}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 56, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logo} accessible={false}>
          <Text style={styles.logoText}>LA</Text>
        </View>
        <Text style={styles.title} accessibilityRole="header">
          Les Artistes
        </Text>
        <Text style={styles.subtitle}>L&apos;espace privé du groupe</Text>

        <Segmented
          style={{ marginTop: 28 }}
          value={panel}
          onChange={switchPanel}
          options={[
            { key: 'login', label: 'Connexion' },
            { key: 'signup', label: 'Inscription' },
          ]}
        />

        {!!error && (
          <View style={styles.alert} accessibilityLiveRegion="polite">
            <Feather name="alert-circle" size={18} color={theme.colors.coralSoft} />
            <Text style={styles.alertText}>{error}</Text>
          </View>
        )}

        {panel === 'login' ? (
          <>
            <LabeledField
              label="Prénom Nom ou email"
              value={identifiant}
              onChangeText={setIdentifiant}
              placeholder="Marie Dupont"
              autoCapitalize="words"
              textContentType="username"
            />
            <LabeledField
              label="Mot de passe"
              value={loginPassword}
              onChangeText={setLoginPassword}
              placeholder="Ton mot de passe"
              password
              textContentType="password"
            />
            <Pressable onPress={handleForgot} accessibilityRole="button" style={styles.forgot}>
              <Text style={styles.link}>Mot de passe oublié ?</Text>
            </Pressable>
            <Button label="Se connecter" onPress={handleLogin} loading={loading} height={56} style={{ marginTop: 10 }} />
          </>
        ) : (
          <>
            <View style={styles.row2}>
              <View style={styles.flex}>
                <LabeledField label="Prénom" value={prenom} onChangeText={setPrenom} placeholder="Marie" textContentType="givenName" />
              </View>
              <View style={styles.flex}>
                <LabeledField label="Nom" value={nom} onChangeText={setNom} placeholder="Dupont" textContentType="familyName" />
              </View>
            </View>
            <LabeledField
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="marie@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              textContentType="emailAddress"
            />
            <LabeledField
              label="Téléphone"
              hint="facultatif"
              value={tel}
              onChangeText={setTel}
              placeholder="06 12 34 56 78"
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
            />
            <LabeledField
              label="Date de naissance"
              hint="JJ/MM/AAAA, facultatif"
              value={dob}
              onChangeText={setDob}
              placeholder="21/03/1995"
              autoCapitalize="none"
            />
            <LabeledField
              label="Mot de passe"
              hint="8 caractères minimum"
              value={signupPassword}
              onChangeText={setSignupPassword}
              placeholder="Ton mot de passe"
              password
              textContentType="newPassword"
            />
            <LabeledField
              label="Confirme le mot de passe"
              value={signupPassword2}
              onChangeText={setSignupPassword2}
              placeholder="Le même, une deuxième fois"
              password
              textContentType="newPassword"
            />
            <LabeledField
              label="Mot de passe du groupe"
              value={groupePassword}
              onChangeText={setGroupePassword}
              placeholder="Demande-le à un membre"
              password
              autoCapitalize="none"
            />
            <View style={styles.termsRow}>
              <Pressable
                onPress={() => setAcceptTerms((v) => !v)}
                hitSlop={4}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acceptTerms }}
                accessibilityLabel="J'accepte les conditions d'utilisation"
                style={styles.checkTarget}
              >
                <View style={[styles.checkBox, acceptTerms && styles.checkBoxOn]}>
                  {acceptTerms && <Feather name="check" size={16} color={theme.colors.tealInk} />}
                </View>
              </Pressable>
              <Text style={styles.termsText}>
                J&apos;accepte les{' '}
                <Text
                  style={styles.termsLink}
                  onPress={() => Linking.openURL('https://les--artistes.fr/confidentialite.html#conditions')}
                >
                  conditions d&apos;utilisation
                </Text>
                {' '}: aucun contenu offensant ou abusif n&apos;est toléré.
              </Text>
            </View>
            <Button label="Rejoindre le groupe" onPress={handleSignup} loading={loading} height={56} style={{ marginTop: 6 }} />
          </>
        )}
      </ScrollView>
    </KeyboardAware>
  );
}

/** Champ avec son libellé ; `password` ajoute l'œil pour afficher la saisie. */
function LabeledField({
  label,
  hint,
  password,
  ...rest
}: TextInputProps & { label: string; hint?: string; password?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.field}>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <View>
        <Field
          accessibilityLabel={label}
          secureTextEntry={password && !shown}
          autoCorrect={password ? false : rest.autoCorrect}
          style={[styles.input, password && { paddingRight: 56 }]}
          {...rest}
        />
        {password && (
          <Pressable
            onPress={() => setShown((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            style={styles.eye}
          >
            <Feather name={shown ? 'eye-off' : 'eye'} size={20} color={theme.colors.muted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    backgroundColor: theme.colors.deep,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: theme.colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-6deg' }],
    shadowColor: theme.colors.coral,
    shadowOpacity: 0.35,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  logoText: { color: '#fff', fontFamily: theme.fonts.serifBlack, fontSize: 30, lineHeight: 38 },
  title: {
    marginTop: 22,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -0.5,
    color: theme.colors.text,
  },
  subtitle: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 16, marginTop: 6 },
  alert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,107,107,0.12)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 18,
  },
  alertText: { flex: 1, color: theme.colors.coralSoft, fontFamily: theme.fonts.bodyBold, fontSize: 14, lineHeight: 19 },
  field: { marginTop: 18 },
  input: { height: 54 },
  eye: {
    position: 'absolute',
    right: 5,
    top: 5,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row2: { flexDirection: 'row', gap: 12 },
  forgot: { alignSelf: 'flex-end', minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' },
  link: { color: theme.colors.teal, fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 18, marginBottom: 12 },
  checkTarget: { width: 44, height: 44, marginLeft: -10, marginTop: -10, alignItems: 'center', justifyContent: 'center' },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: theme.colors.rail,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxOn: { backgroundColor: theme.colors.teal, borderColor: theme.colors.teal },
  termsText: { flex: 1, color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 20 },
  termsLink: { color: theme.colors.teal, fontFamily: theme.fonts.bodyBold },
});
