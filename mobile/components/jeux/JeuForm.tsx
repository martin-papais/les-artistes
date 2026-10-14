import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAware } from '@/lib/keyboard';
import { sb, type JeuAlcool, type JeuSociete } from '@/lib/supabase';
import { theme } from '@/lib/theme';

// Mêmes champs et mêmes valeurs que games.html : un jeu créé ici s'affiche à l'identique sur le site
const CATEGORIES = ['Cartes', 'Dés', 'Oral', 'Balle', 'Autre'];
const NIVEAUX = ['Soft', 'Medium', 'Hard', 'Destruction'];

function tap() {
  Haptics.selectionAsync().catch(() => {});
}

type Props =
  | { kind: 'alcool'; initial: JeuAlcool | null; userId: string; onClose: () => void; onSaved: () => void }
  | { kind: 'societe'; initial: JeuSociete | null; userId: string; onClose: () => void; onSaved: () => void };

export function JeuForm(props: Props) {
  const { kind, userId, onClose, onSaved } = props;
  const alc = kind === 'alcool' ? props.initial : null;
  const soc = kind === 'societe' ? props.initial : null;
  const isEdit = !!props.initial;
  const tone = kind === 'alcool' ? theme.colors.coral : theme.colors.teal;

  const [nom, setNom] = useState(props.initial?.nom ?? '');
  const [regles, setRegles] = useState(props.initial?.regles ?? '');
  // Alcool
  const [categorie, setCategorie] = useState(alc?.categorie ?? '');
  const [joueurs, setJoueurs] = useState(alc?.joueurs ?? '');
  const [niveau, setNiveau] = useState(alc?.niveau ?? '');
  const [materiel, setMateriel] = useState(alc?.materiel ?? '');
  // Société
  const [joueursMax, setJoueursMax] = useState(soc?.joueurs_max != null ? String(soc.joueurs_max) : '');
  const [duree, setDuree] = useState(soc?.duree ?? '');
  const [detenteur, setDetenteur] = useState(soc?.detenteur ?? '');
  const [aAcheter, setAAcheter] = useState(soc?.a_acheter === 'oui');
  const [note, setNote] = useState(soc?.note ?? 0);
  const [avis, setAvis] = useState(soc?.avis ?? '');
  const [saving, setSaving] = useState(false);
  // Le state n'est pas encore à jour si on tape deux fois dans la même frame
  const busy = useRef(false);

  async function save() {
    if (busy.current) return;
    if (kind === 'alcool' && !categorie) return Alert.alert('Catégorie manquante', 'Choisis une catégorie.');
    if (!nom.trim()) return Alert.alert('Nom manquant', 'Le nom du jeu est obligatoire.');
    if (!regles.trim()) return Alert.alert('Règles manquantes', 'Explique en quelques mots comment on joue.');
    const max = Number(joueursMax.replace(/\D/g, '')) || 0;
    if (kind === 'societe' && joueursMax && (max < 1 || max > 20)) {
      return Alert.alert('Nombre de joueurs', 'Entre 1 et 20 joueurs.');
    }
    busy.current = true;
    setSaving(true);
    try {
      const table = kind === 'alcool' ? 'jeux_alcool' : 'jeux_societe';
      const payload =
        kind === 'alcool'
          ? {
              categorie,
              nom: nom.trim(),
              regles: regles.trim(),
              joueurs: joueurs.trim() || null,
              niveau: niveau || null,
              materiel: materiel.trim() || null,
            }
          : {
              nom: nom.trim(),
              regles: regles.trim(),
              joueurs_max: max ? String(max) : null,
              duree: duree.trim() || null,
              // « À acheter » vide le détenteur (le site le garde, champ grisé)
              detenteur: aAcheter ? null : detenteur.trim() || null,
              a_acheter: aAcheter ? 'oui' : 'non',
              note: note || null,
              avis: avis.trim() || null,
            };
      const r = isEdit
        ? await sb.from(table).update(payload).eq('id', props.initial!.id).select('id')
        : await sb.from(table).insert({ ...payload, created_by: userId }).select('id');
      if (r.error) throw r.error;
      // La RLS refuse sans erreur : aucune ligne renvoyée
      if (!r.data?.length) throw new Error('Ce jeu a été supprimé, ou tu n’en es pas l’auteur.');
      // La moyenne affichée vient des votes : l'avis donné à la création compte comme un vote
      if (kind === 'societe' && !isEdit && note) {
        await sb.from('jeux_societe_votes').insert({ jeu_id: r.data[0].id, user_id: userId, note });
      }
      onSaved();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Fermer">
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {isEdit ? 'Modifier le jeu' : kind === 'alcool' ? 'Nouveau jeu d’alcool' : 'Nouveau jeu de société'}
        </Text>
        <View style={{ width: 36 }} />
      </View>
      <KeyboardAware>
        <ScrollView contentContainerStyle={{ padding: theme.s(5) }} keyboardShouldPersistTaps="handled">
          {kind === 'alcool' && (
            <Chips label="Catégorie" options={CATEGORIES} value={categorie} onChange={setCategorie} tone={tone} />
          )}
          <Field label="Nom du jeu" value={nom} onChangeText={setNom} tone={tone}
            placeholder={kind === 'alcool' ? 'Bière-pong, Roi de l’alcool…' : 'Catan, Codenames, Uno…'} />

          {kind === 'alcool' ? (
            <>
              <Field label="Nombre de joueurs idéal (optionnel)" value={joueurs} onChangeText={setJoueurs}
                placeholder="4-8, 2+…" tone={tone} />
              <Chips label="Niveau d’ivresse (optionnel)" options={NIVEAUX} value={niveau} tone={tone}
                // Toucher le niveau choisi le retire : le champ reste facultatif
                onChange={(v) => setNiveau((cur) => (cur === v ? '' : v))} />
            </>
          ) : (
            <>
              <Field label="Joueurs max (optionnel)" value={joueursMax} onChangeText={setJoueursMax}
                placeholder="6" keyboardType="number-pad" maxLength={2} tone={tone} />
              <Field label="Durée (optionnel)" value={duree} onChangeText={setDuree} placeholder="30 min, 1 h…" tone={tone} />
              <Text style={styles.label}>Qui l’a ?</Text>
              <Pressable
                onPress={() => {
                  tap();
                  setAAcheter((a) => !a);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: aAcheter }}
                style={styles.toggle}
              >
                <Ionicons name={aAcheter ? 'checkbox' : 'square-outline'} size={22} color={aAcheter ? tone : theme.colors.muted} />
                <Text style={styles.toggleText}>Personne, il est à acheter</Text>
              </Pressable>
              {!aAcheter && (
                <Field label="" value={detenteur} onChangeText={setDetenteur} placeholder="Prénom de la personne" tone={tone} />
              )}
            </>
          )}

          <Field
            label={kind === 'alcool' ? 'Règles du jeu' : 'Règle en bref'}
            value={regles}
            onChangeText={setRegles}
            placeholder={kind === 'alcool' ? 'Comment on joue, les règles, les gages…' : 'Le principe du jeu en quelques lignes'}
            multiline
            tone={tone}
            style={{ minHeight: 110, textAlignVertical: 'top' }}
          />

          {kind === 'alcool' ? (
            <Field label="Matériel (optionnel)" value={materiel} onChangeText={setMateriel}
              placeholder="Un jeu de cartes, des dés, des verres…" tone={tone} />
          ) : (
            <>
              <Text style={styles.label}>Ton avis (optionnel)</Text>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => {
                      tap();
                      setNote((cur) => (cur === n ? 0 : n));
                    }}
                    hitSlop={6}
                    accessibilityLabel={`${n} étoile${n > 1 ? 's' : ''}`}
                    accessibilityState={{ selected: note === n }}
                  >
                    <Ionicons name={note >= n ? 'star' : 'star-outline'} size={30}
                      color={note >= n ? theme.colors.yellow : theme.colors.muted} />
                  </Pressable>
                ))}
              </View>
              <Field label="" value={avis} onChangeText={setAvis} placeholder="Ton avis en quelques mots" tone={tone} />
            </>
          )}

          <Pressable
            onPress={save}
            disabled={saving}
            accessibilityRole="button"
            style={({ pressed }) => [styles.saveBtn, { backgroundColor: tone }, (pressed || saving) && { opacity: 0.7 }]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveText}>{isEdit ? 'Enregistrer' : 'Ajouter le jeu'}</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAware>
    </SafeAreaView>
  );
}

function Field({
  label,
  tone,
  style,
  ...rest
}: React.ComponentProps<typeof TextInput> & { label: string; tone: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: theme.s(4) }}>
      {!!label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        placeholderTextColor="rgba(255,255,255,0.3)"
        accessibilityLabel={label || rest.placeholder}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[styles.input, focused && { borderColor: tone }, style]}
      />
    </View>
  );
}

function Chips({
  label,
  options,
  value,
  onChange,
  tone,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  tone: string;
}) {
  return (
    <View style={{ marginBottom: theme.s(4) }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((o) => {
          const on = value === o;
          return (
            <Pressable
              key={o}
              onPress={() => {
                tap();
                onChange(o);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.chip, on && { backgroundColor: tone, borderColor: tone }]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.s(3),
    paddingVertical: theme.s(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    marginHorizontal: theme.s(2),
    color: theme.colors.text,
    fontFamily: theme.fonts.serif,
    fontSize: 18,
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
  },
  chipText: { color: theme.colors.muted, fontFamily: theme.fonts.bodyMedium, fontSize: 13 },
  chipTextOn: { color: '#fff', fontFamily: theme.fonts.bodyBold },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, marginBottom: theme.s(2) },
  toggleText: { color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 15 },
  stars: { flexDirection: 'row', gap: 10, marginBottom: theme.s(3) },
  saveBtn: {
    borderRadius: theme.radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: theme.s(4),
    minHeight: 52,
    justifyContent: 'center',
  },
  saveText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
