/**
 * Formulaire d'événement (création, modification, pré-rempli depuis un sondage).
 * Mêmes champs et mêmes règles que le site : les champs propres à chaque
 * catégorie déclenchent les sondages repas / courses de la fiche.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { dayLabel } from '@/components/ui/CalendarPicker';
import { Button, Chip, Field, FieldLabel, IconButton } from '@/components/ui/kit';
import { KeyboardAware } from '@/lib/keyboard';
import { sb, type EventRow } from '@/lib/supabase';
import { theme } from '@/lib/theme';

import { DayCalendar } from './DayCalendar';
import {
  capFirst,
  CATEGORIES,
  CatIcon,
  catMeta,
  CHEZ_QUI_REQUIS,
  normalizeTime,
  tap,
  WITH_ALCOOL,
  WITH_DORMIR,
  YES_NO_NSP,
  type EventCard,
} from './shared';

const c = theme.colors;
const f = theme.fonts;

// Heures proposées en un geste ; « Autre heure » ouvre la saisie libre
const QUICK_HOURS = ['18:00', '19:00', '20:00', '21:00'];

export function EventForm({
  initial,
  prefill,
  currentUserId,
  onClose,
  onSaved,
  eventDays,
}: {
  initial: EventCard | null;
  /** Création pré-remplie (ex. depuis un sondage de date) */
  prefill?: Partial<EventRow> | null;
  currentUserId: string;
  onClose: () => void;
  onSaved: (eventId: string | null) => void;
  /** Jours qui ont déjà un événement, signalés dans le calendrier */
  eventDays: string[];
}) {
  const isEdit = !!initial;
  const init: Partial<EventRow> = initial ?? prefill ?? {};
  const { width } = useWindowDimensions();
  const tileW = Math.floor((width - theme.gutter * 2 - 8 * 3) / 4);
  const [categorie, setCategorie] = useState(init.categorie ?? CATEGORIES[0]);
  // date_event peut revenir en timestamp : on garde AAAA-MM-JJ
  const [date, setDate] = useState((init.date_event ?? '').slice(0, 10));
  const [calendarOpen, setCalendarOpen] = useState(!init.date_event);
  const [heure, setHeure] = useState(init.heure ?? '');
  const initialQuick = QUICK_HOURS.includes(normalizeTime(init.heure ?? '') ?? '');
  const [otherHour, setOtherHour] = useState(!!init.heure && !initialQuick);
  const [lieu, setLieu] = useState(init.lieu ?? '');
  const [chezQui, setChezQui] = useState(init.chez_qui ?? '');
  const [annivQui, setAnnivQui] = useState(init.anniversaire_qui ?? '');
  const [feriaVille, setFeriaVille] = useState(init.feria_ville ?? '');
  const [sportType, setSportType] = useState(init.sport_type ?? '');
  const [raison, setRaison] = useState(init.raison ?? '');
  const [note, setNote] = useState(init.note ?? '');
  // Champs du site qui déclenchent les sondages repas / courses
  const [manger, setManger] = useState(init.manger ?? 'nsp');
  const [mangerSoir, setMangerSoir] = useState(init.manger_soir ?? 'nsp');
  const [courses, setCourses] = useState(init.courses ?? 'non');
  const [heureCourses, setHeureCourses] = useState(init.heure_courses ?? '');
  const [lieuCourses, setLieuCourses] = useState(init.lieu_courses ?? '');
  const [dormir, setDormir] = useState(init.dormir ?? 'nsp');
  const [alcool, setAlcool] = useState(init.alcool ?? '');
  const [jeuxListe, setJeuxListe] = useState(init.jeux_liste ?? '');
  const [budget, setBudget] = useState(init.budget ?? '');
  const [saving, setSaving] = useState(false);

  const quickOn = normalizeTime(heure) ?? null;

  async function save() {
    if (saving) return;
    if (!date) {
      Alert.alert('Date requise', 'Choisis le jour dans le calendrier.');
      setCalendarOpen(true);
      return;
    }
    // Mêmes champs obligatoires que le site, sinon il refuse ensuite d'enregistrer une modification
    if (CHEZ_QUI_REQUIS.includes(categorie) && !chezQui.trim()) {
      Alert.alert('Champ requis', 'Indique chez qui ça se passe.');
      return;
    }
    if (categorie === 'Sport' && !sportType.trim()) {
      Alert.alert('Champ requis', 'Indique le sport.');
      return;
    }
    if (categorie === 'Anniversaire' && !annivQui.trim()) {
      Alert.alert('Champ requis', 'Indique de qui c’est l’anniversaire.');
      return;
    }
    // Le site lit ces heures avec un champ <input type="time"> : HH:MM uniquement
    // Une heure déjà en base et non retouchée passe telle quelle (anciennes saisies libres)
    const h = heure === (init.heure ?? '') && heure ? heure : normalizeTime(heure);
    const hc = heureCourses === (init.heure_courses ?? '') && heureCourses ? heureCourses : normalizeTime(heureCourses);
    if (h === undefined || (categorie === 'Barbecue' && courses === 'oui' && hc === undefined)) {
      Alert.alert('Format de l’heure', 'Écris l’heure comme 20:30 ou 20h30.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        categorie,
        date_event: date,
        heure: h,
        lieu: lieu.trim() || null,
        chez_qui: chezQui.trim() || null,
        anniversaire_qui: annivQui.trim() || null,
        feria_ville: feriaVille.trim() || null,
        sport_type: sportType.trim() || null,
        raison: raison.trim() || null,
        note: note.trim() || null,
        // Comme le site : un champ hors de la catégorie choisie est remis à null
        manger:
          categorie === 'Soirée jeux de société'
            ? manger === 'oui'
              ? 'oui'
              : 'non'
            : ['Anniversaire', 'Soirée'].includes(categorie)
              ? manger
              : null,
        manger_soir: categorie === 'Nouvel an' ? mangerSoir : null,
        courses: categorie === 'Barbecue' ? courses : null,
        heure_courses: categorie === 'Barbecue' && courses === 'oui' ? (hc ?? null) : null,
        lieu_courses: categorie === 'Barbecue' && courses === 'oui' ? lieuCourses.trim() || null : null,
        dormir: WITH_DORMIR.includes(categorie) ? dormir : null,
        alcool: WITH_ALCOOL.includes(categorie) ? alcool.trim() || null : null,
        jeux_liste: categorie === 'Soirée jeux de société' ? jeuxListe.trim() || null : null,
        budget: categorie === 'Vacances' ? budget.trim() || null : null,
      };
      if (isEdit) {
        const r = await sb.from('events').update(payload).eq('id', initial!.id);
        if (r.error) throw r.error;
        onSaved(initial!.id);
      } else {
        const r = await sb
          .from('events')
          .insert({ ...payload, created_by: currentUserId })
          .select('id')
          .single();
        if (r.error) throw r.error;
        onSaved((r.data as { id: string } | null)?.id ?? null);
      }
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <IconButton name="x" label="Fermer" onPress={onClose} bg="transparent" />
        <Text style={styles.headerTitle} accessibilityRole="header">
          {isEdit ? 'Modifier l’événement' : 'Nouvel événement'}
        </Text>
        <View style={{ width: 44 }} />
      </View>
      <KeyboardAware insideSafeArea={false}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <FieldLabel>C&apos;est quoi ?</FieldLabel>
          <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Catégorie">
            {CATEGORIES.map((cat) => {
              const m = catMeta(cat);
              const on = categorie === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => {
                    tap();
                    // « Oui » ne veut pas dire la même chose d'une catégorie à l'autre
                    // (manger avant / manger ensemble) : on repart de « je ne sais pas »
                    if (cat !== categorie) setManger(cat === 'Soirée jeux de société' ? 'non' : 'nsp');
                    setCategorie(cat);
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={cat}
                  accessibilityState={{ checked: on }}
                  style={({ pressed }) => [
                    styles.tile,
                    { width: tileW },
                    on && { backgroundColor: c.coral },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <CatIcon icon={m.icon} size={22} color={on ? '#fff' : m.color} />
                  <Text style={[styles.tileText, on && { color: '#fff', fontFamily: f.bodyBold }]} numberOfLines={1}>
                    {m.short}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.gap} />
          <FieldLabel>Quand ?</FieldLabel>
          <Pressable
            onPress={() => {
              tap();
              setCalendarOpen((o) => !o);
            }}
            accessibilityRole="button"
            accessibilityLabel={date ? `${dayLabel(date, true)}. Changer le jour` : 'Choisir le jour'}
            style={({ pressed }) => [styles.dateBtn, pressed && { opacity: 0.85 }]}
          >
            <Feather name="calendar" size={20} color={c.coral} />
            <Text style={[styles.dateText, !date && { color: c.muted, fontFamily: f.body }]} numberOfLines={1}>
              {date ? capFirst(dayLabel(date)) : 'Choisir le jour'}
            </Text>
            <Text style={styles.dateChange}>{calendarOpen ? 'Fermer' : date ? 'Changer' : ''}</Text>
          </Pressable>
          {calendarOpen && (
            <View style={{ marginTop: 10 }}>
              <DayCalendar
                selected={date ? [date] : []}
                marked={eventDays}
                onToggle={(d) => {
                  setDate(d);
                  setCalendarOpen(false);
                }}
              />
            </View>
          )}
          <View style={styles.hours} accessibilityLabel="Heure">
            {QUICK_HOURS.map((hh) => (
              <Chip
                key={hh}
                label={`${Number(hh.slice(0, 2))} h`}
                active={!otherHour && quickOn === hh}
                onPress={() => {
                  tap();
                  setOtherHour(false);
                  // Retaper l'heure choisie la retire
                  setHeure(!otherHour && quickOn === hh ? '' : hh);
                }}
              />
            ))}
            <Chip
              label="Autre heure"
              active={otherHour}
              onPress={() => {
                tap();
                if (!otherHour && QUICK_HOURS.includes(quickOn ?? '')) setHeure('');
                setOtherHour((o) => !o);
              }}
            />
          </View>
          {otherHour && (
            <Field
              value={heure}
              onChangeText={setHeure}
              placeholder="20h30"
              autoCapitalize="none"
              accessibilityLabel="Heure"
              style={{ marginTop: 10 }}
            />
          )}

          {categorie === 'Anniversaire' && (
            <FormField label="Qui fête son anniversaire ?" value={annivQui} onChangeText={setAnnivQui} placeholder="Marie" />
          )}
          {categorie === 'Féria' && (
            <FormField label="Ville de la féria" value={feriaVille} onChangeText={setFeriaVille} placeholder="Bayonne" />
          )}
          {categorie === 'Sport' && (
            <FormField label="Quel sport ?" value={sportType} onChangeText={setSportType} placeholder="Tennis, foot…" />
          )}
          {categorie === 'Autre' && (
            <FormField label="Pour quoi ?" value={raison} onChangeText={setRaison} placeholder="Pourquoi se retrouve-t-on ?" />
          )}

          <FormField
            label="Chez qui ?"
            hint={CHEZ_QUI_REQUIS.includes(categorie) ? undefined : '(facultatif)'}
            value={chezQui}
            onChangeText={setChezQui}
            placeholder="Marie"
          />
          <FormField label="Où ?" hint="(adresse ou ville)" value={lieu} onChangeText={setLieu} placeholder="12 rue des Lilas, Toulouse" />

          {(categorie === 'Anniversaire' || categorie === 'Soirée') && (
            <ChoiceField
              label="Faut-il manger avant ?"
              hint={manger === 'non' ? 'Sondage « Qui mange ensemble » ajouté' : undefined}
              value={manger}
              onChange={setManger}
              options={[
                { v: 'oui', l: 'Oui' },
                { v: 'non', l: 'On mange là-bas' },
                { v: 'nsp', l: 'Je ne sais pas' },
              ]}
            />
          )}
          {categorie === 'Soirée jeux de société' && (
            <>
              <ChoiceField
                label="On mange ensemble ?"
                hint={manger === 'oui' ? 'Sondage « Qui mange ensemble » ajouté' : undefined}
                value={manger === 'oui' ? 'oui' : 'non'}
                onChange={setManger}
                options={[
                  { v: 'oui', l: 'Oui' },
                  { v: 'non', l: 'Non' },
                ]}
              />
              <FormField label="Jeux déjà sur place" value={jeuxListe} onChangeText={setJeuxListe} placeholder="Catan, Uno, Codenames…" />
            </>
          )}
          {categorie === 'Nouvel an' && (
            <ChoiceField
              label="On mange ensemble le soir ?"
              hint={mangerSoir === 'oui' ? 'Sondage « Qui mange le soir » ajouté' : undefined}
              value={mangerSoir}
              onChange={setMangerSoir}
              options={[
                { v: 'oui', l: 'Oui, ensemble' },
                { v: 'non', l: 'Non, mangez avant' },
                { v: 'nsp', l: 'Je ne sais pas' },
              ]}
            />
          )}
          {categorie === 'Olympiade' && <Hint>Sondages « Qui mange le midi » et « le soir » ajoutés.</Hint>}
          {categorie === 'Barathon' && <Hint>Sondages « Présent vendredi » et « samedi » ajoutés.</Hint>}
          {categorie === 'Barbecue' && (
            <>
              <ChoiceField
                label="Besoin d’aller faire les courses ?"
                hint="Sondage « Qui mange au barbecue » ajouté"
                value={courses === 'oui' ? 'oui' : 'non'}
                onChange={setCourses}
                options={[
                  { v: 'oui', l: 'Oui' },
                  { v: 'non', l: 'Non' },
                ]}
              />
              {courses === 'oui' && (
                <>
                  <FormField label="Heure des courses" value={heureCourses} onChangeText={setHeureCourses} placeholder="15:00" autoCapitalize="none" />
                  <FormField label="Magasin" value={lieuCourses} onChangeText={setLieuCourses} placeholder="Leclerc, Intermarché…" />
                </>
              )}
            </>
          )}
          {WITH_DORMIR.includes(categorie) && (
            <ChoiceField label="Peut-on dormir sur place ?" value={dormir} onChange={setDormir} options={YES_NO_NSP} />
          )}
          {WITH_ALCOOL.includes(categorie) && (
            <FormField
              label="Alcool déjà sur place"
              hint="(facultatif)"
              value={alcool}
              onChangeText={setAlcool}
              placeholder="6 bières, 1 bouteille de rhum…"
            />
          )}
          {categorie === 'Vacances' && (
            <FormField label="Budget à prévoir" value={budget} onChangeText={setBudget} placeholder="300 € par personne" />
          )}

          <FormField
            label="Note"
            hint="(facultatif)"
            value={note}
            onChangeText={setNote}
            placeholder="Ce qu'il faut savoir, le thème, l'ambiance…"
            multiline
          />
        </ScrollView>
        <View style={styles.footer}>
          <SafeAreaView edges={['bottom']}>
            <Button label={isEdit ? 'Enregistrer' : 'Créer l’événement'} onPress={save} loading={saving} height={54} />
          </SafeAreaView>
        </View>
      </KeyboardAware>
    </SafeAreaView>
  );
}

function Hint({ children }: { children: string }) {
  return <Text style={styles.hint}>{children}</Text>;
}

function ChoiceField({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: { v: string; l: string }[];
}) {
  return (
    <View style={styles.block}>
      <FieldLabel>{label}</FieldLabel>
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => (
          <Chip
            key={o.v}
            label={o.l}
            active={value === o.v}
            onPress={() => {
              tap();
              onChange(o.v);
            }}
          />
        ))}
      </View>
      {!!hint && <Text style={[styles.hint, { marginTop: 8 }]}>{hint}</Text>}
    </View>
  );
}

function FormField({ label, hint, ...rest }: React.ComponentProps<typeof Field> & { label: string; hint?: string }) {
  return (
    <View style={styles.block}>
      <FieldLabel hint={hint}>{label}</FieldLabel>
      <Field accessibilityLabel={label} {...rest} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.hairline,
  },
  headerTitle: { color: c.text, fontFamily: f.serif, fontSize: 18, flexShrink: 1, textAlign: 'center' },
  scroll: { paddingHorizontal: theme.gutter, paddingTop: 18, paddingBottom: 24 },
  gap: { height: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    height: 76,
    borderRadius: 18,
    backgroundColor: c.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  tileText: { color: c.text, fontFamily: f.bodyMedium, fontSize: 13 },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: c.card,
  },
  dateText: { flex: 1, color: c.text, fontFamily: f.bodyBold, fontSize: 15 },
  dateChange: { color: c.coralSoft, fontFamily: f.bodyBold, fontSize: 14 },
  hours: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  block: { marginTop: 22 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hint: { color: c.teal, fontFamily: f.body, fontSize: 13, lineHeight: 18, marginTop: 14 },
  footer: {
    paddingHorizontal: theme.gutter,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: c.deep,
    shadowColor: c.deep,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -12 },
    elevation: 12,
  },
});
