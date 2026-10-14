import { Feather, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, Field, FieldLabel, IconButton } from '@/components/ui/kit';
import { KeyboardAware } from '@/lib/keyboard';
import { sb, type JeuAlcool, type JeuSociete } from '@/lib/supabase';
import { theme } from '@/lib/theme';

// Mêmes champs et mêmes valeurs que games.html : un jeu créé ici s'affiche à l'identique sur le site
import { CATEGORIES, NIVEAUX, NiveauGauge } from './JeuCards';

const c = theme.colors;

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

  const title = isEdit ? 'Modifier le jeu' : kind === 'alcool' ? 'Nouveau jeu d’alcool' : 'Nouveau jeu de société';

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.topBar}>
        <IconButton name="x" label="Fermer" onPress={onClose} bg="transparent" />
      </View>
      <KeyboardAware>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Text style={[styles.kicker, { color: kind === 'alcool' ? c.coralSoft : c.teal }]}>
            {kind === 'alcool' ? 'Jeu d’alcool' : 'Jeu de société'}
          </Text>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>

          {kind === 'alcool' && (
            <Group label="Catégorie">
              <View style={styles.chipRow}>
                {CATEGORIES.map((o) => (
                  <Chip
                    key={o}
                    label={o}
                    active={categorie === o}
                    color={c.coral}
                    onPress={() => {
                      tap();
                      setCategorie(o);
                    }}
                  />
                ))}
              </View>
            </Group>
          )}

          <Group label="Nom du jeu">
            <Field
              value={nom}
              onChangeText={setNom}
              accessibilityLabel="Nom du jeu"
              placeholder={kind === 'alcool' ? 'Bière-pong, Roi de l’alcool…' : 'Catan, Codenames, Uno…'}
            />
          </Group>

          {kind === 'alcool' ? (
            <>
              <Group label="Nombre de joueurs idéal" hint="(optionnel)">
                <Field value={joueurs} onChangeText={setJoueurs} placeholder="4-8, 2+…" accessibilityLabel="Nombre de joueurs idéal" />
              </Group>
              <Group label="Niveau d’ivresse" hint="(optionnel)">
                <View style={styles.chipRow}>
                  {NIVEAUX.map((o) => (
                    <Chip
                      key={o}
                      label={o}
                      active={niveau === o}
                      color={c.coral}
                      onPress={() => {
                        tap();
                        // Toucher le niveau choisi le retire : le champ reste facultatif
                        setNiveau((cur) => (cur === o ? '' : o));
                      }}
                    />
                  ))}
                </View>
                {!!niveau && (
                  <View style={styles.gauge}>
                    <NiveauGauge niveau={niveau} size={10} />
                  </View>
                )}
              </Group>
            </>
          ) : (
            <>
              <View style={styles.pair}>
                <View style={{ flex: 1 }}>
                  <Group label="Joueurs max" hint="(optionnel)">
                    <Field
                      value={joueursMax}
                      onChangeText={setJoueursMax}
                      placeholder="6"
                      keyboardType="number-pad"
                      maxLength={2}
                      accessibilityLabel="Joueurs max, de 1 à 20"
                    />
                  </Group>
                </View>
                <View style={{ flex: 1 }}>
                  <Group label="Durée" hint="(optionnel)">
                    <Field value={duree} onChangeText={setDuree} placeholder="30 min, 1 h…" accessibilityLabel="Durée d’une partie" />
                  </Group>
                </View>
              </View>
              <Group label="Qui l’a ?">
                <Pressable
                  onPress={() => {
                    tap();
                    setAAcheter((a) => !a);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: aAcheter }}
                  style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.8 }]}
                >
                  <Feather name={aAcheter ? 'check-square' : 'square'} size={22} color={aAcheter ? c.teal : c.muted} />
                  <Text style={styles.toggleText}>Personne, il est à acheter</Text>
                </Pressable>
                {!aAcheter && (
                  <Field
                    value={detenteur}
                    onChangeText={setDetenteur}
                    placeholder="Prénom de la personne"
                    accessibilityLabel="Prénom de la personne qui a le jeu"
                    style={{ marginTop: 10 }}
                  />
                )}
              </Group>
            </>
          )}

          <Group label={kind === 'alcool' ? 'Règles du jeu' : 'Règle en bref'}>
            <Field
              value={regles}
              onChangeText={setRegles}
              placeholder={kind === 'alcool' ? 'Comment on joue, les règles, les gages…' : 'Le principe du jeu en quelques lignes'}
              accessibilityLabel={kind === 'alcool' ? 'Règles du jeu' : 'Règle en bref'}
              multiline
              style={{ minHeight: 120 }}
            />
          </Group>

          {kind === 'alcool' ? (
            <Group label="Matériel" hint="(optionnel)">
              <Field
                value={materiel}
                onChangeText={setMateriel}
                placeholder="Un jeu de cartes, des dés, des verres…"
                accessibilityLabel="Matériel"
              />
            </Group>
          ) : (
            <Group label="Ta note" hint="(optionnel)">
              <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Ta note">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => {
                      tap();
                      setNote((cur) => (cur === n ? 0 : n));
                    }}
                    accessibilityRole="radio"
                    accessibilityLabel={`${n} étoile${n > 1 ? 's' : ''}`}
                    accessibilityState={{ checked: note === n }}
                    style={({ pressed }) => [styles.star, pressed && { opacity: 0.6 }]}
                  >
                    <Ionicons name={note >= n ? 'star' : 'star-outline'} size={30} color={note >= n ? c.yellow : c.muted} />
                  </Pressable>
                ))}
              </View>
              <Field value={avis} onChangeText={setAvis} placeholder="Ton avis en quelques mots" accessibilityLabel="Ton avis" style={{ marginTop: 6 }} />
            </Group>
          )}
        </ScrollView>
        {/* Bouton toujours visible, au-dessus du clavier */}
        <View style={styles.footer}>
          <Button
            label={isEdit ? 'Enregistrer' : 'Ajouter le jeu'}
            variant={kind === 'alcool' ? 'primary' : 'yes'}
            onPress={save}
            loading={saving}
          />
        </View>
      </KeyboardAware>
    </SafeAreaView>
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  topBar: { paddingHorizontal: 12, paddingTop: 4 },
  body: { paddingHorizontal: theme.gutter, paddingTop: 4, paddingBottom: 16 },
  kicker: { fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  title: { fontFamily: theme.fonts.serifBlack, fontSize: 32, lineHeight: 38, color: c.text, marginTop: 4, marginBottom: 8 },
  group: { marginTop: 18 },
  pair: { flexDirection: 'row', gap: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gauge: { marginTop: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 16, borderRadius: 16, backgroundColor: c.card },
  toggleText: { color: c.text, fontFamily: theme.fonts.body, fontSize: 16, flexShrink: 1 },
  stars: { flexDirection: 'row', marginLeft: -8 },
  star: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingHorizontal: theme.gutter, paddingTop: 10, paddingBottom: 8, backgroundColor: c.deep },
});
