import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { dayLabel, parseDay, toDay } from '@/components/ui/CalendarPicker';
import { Badge, Button, Chip, Field, FieldLabel, IconButton, Pastille, SectionTitle, Sheet } from '@/components/ui/kit';
import { KeyboardAware } from '@/lib/keyboard';
import {
  sb,
  type DateSondage,
  type DateSondageOption,
  type DateSondageVote,
  type ProfileMini,
} from '@/lib/supabase';
import { theme } from '@/lib/theme';

import { DayCalendar } from './DayCalendar';

const c = theme.colors;
const f = theme.fonts;

export type SondageFull = DateSondage & {
  options: DateSondageOption[];
  votes: DateSondageVote[];
};

// Plafond aussi vérifié par create_date_sondage (11_sondages_date_et_rappel_veille.sql)
const MAX_DATES = 8;

/** « samedi 7 novembre » → « Samedi 7 novembre » (pas de majuscule aux mois) */
function cap(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function today() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function profileName(p: ProfileMini | undefined) {
  if (!p) return '?';
  return p.pseudo || `${p.prenom ?? ''} ${p.nom ?? ''}`.trim() || '?';
}

/** Sondages encore utiles : pas clos et au moins une date à venir. */
export async function loadOpenSondages(): Promise<SondageFull[] | null> {
  // Dates et votes dans la même requête : un seul aller-retour au lieu de trois
  const { data: rows, error } = await sb
    .from('date_sondages')
    .select('*,date_sondage_options(id,sondage_id,date_option,date_sondage_votes(option_id,user_id,dispo))')
    .eq('closed', false)
    .order('created_at', { ascending: false })
    .order('date_option', { referencedTable: 'date_sondage_options', ascending: true });
  if (error) return null;
  type Ligne = DateSondage & {
    date_sondage_options: (DateSondageOption & { date_sondage_votes: DateSondageVote[] })[];
  };
  const t0 = today();
  return ((rows ?? []) as Ligne[])
    .map(({ date_sondage_options, ...s }) => ({
      ...s,
      options: date_sondage_options.map((o) => ({ id: o.id, sondage_id: o.sondage_id, date_option: o.date_option })),
      votes: date_sondage_options.flatMap((o) => o.date_sondage_votes),
    }))
    .filter((s) => s.options.some((o) => parseDay(o.date_option) >= t0));
}

/** « Sam. 7 nov. » */
function chipDate(s: string) {
  const d = parseDay(s);
  const wd = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'][d.getDay()];
  const m = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][d.getMonth()];
  return `${wd} ${d.getDate()} ${m}`;
}

export function DateSondagesSection({
  sondages,
  currentUserId,
  profiles,
  categories,
  onChanged,
  onCreateEvent,
  openNew,
  onNewClosed,
  focusId,
  eventDays,
}: {
  sondages: SondageFull[];
  currentUserId: string;
  profiles: Record<string, ProfileMini>;
  categories: string[];
  onChanged: () => void | Promise<void>;
  /** L'auteur retient une date : le parent ouvre le formulaire d'événement pré-rempli */
  onCreateEvent: (s: SondageFull, date: string) => void;
  openNew: boolean;
  onNewClosed: () => void;
  /** Sondage à ouvrir (tap sur sa notification) */
  focusId: string | null;
  /** Jours qui ont déjà un événement, signalés dans le calendrier */
  eventDays: string[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const focused = useRef<string | null>(null);
  // Ouvre une fois le sondage de la notification, dès qu'il est chargé
  useEffect(() => {
    if (!focusId || focused.current === focusId) return;
    if (!sondages.some((s) => s.id === focusId)) return;
    focused.current = focusId;
    setOpenId(focusId);
  }, [focusId, sondages]);
  // iOS refuse d'ouvrir une fiche pendant qu'une autre se ferme : on attend onDismiss
  const pendingCreate = useRef<{ s: SondageFull; date: string } | null>(null);
  const open = sondages.find((s) => s.id === openId) ?? null;

  function flushPending() {
    const p = pendingCreate.current;
    pendingCreate.current = null;
    if (p) onCreateEvent(p.s, p.date);
  }

  return (
    <>
      {sondages.length > 0 && (
        <View style={styles.section}>
          <SectionTitle count={sondages.length} style={{ marginBottom: 10 }}>
            Quelle date ?
          </SectionTitle>
          {sondages.map((s) => {
            const voters = new Set(s.votes.map((v) => v.user_id));
            const answered = voters.has(currentUserId);
            const author = s.created_by === currentUserId ? 'toi' : profileName(profiles[s.created_by]);
            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setOpenId(s.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Sondage de date : ${s.titre}. ${answered ? 'Tu as répondu' : 'À toi de répondre'}`}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
              >
                <View style={styles.cardIcon}>
                  <Feather name="calendar" size={22} color={c.ink} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {s.titre}
                  </Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {s.options.length} dates · {voters.size} réponse{voters.size > 1 ? 's' : ''} · par {author}
                  </Text>
                </View>
                {answered ? (
                  <View style={styles.doneDot}>
                    <Feather name="check" size={16} color={c.tealInk} />
                  </View>
                ) : (
                  <Badge label="À toi" />
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      <Modal
        statusBarTranslucent
        navigationBarTranslucent
        visible={!!open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpenId(null)}
        onDismiss={flushPending}
      >
        {!!open && (
          <SondageDetail
            sondage={open}
            currentUserId={currentUserId}
            profiles={profiles}
            onClose={() => setOpenId(null)}
            onChanged={onChanged}
            onPick={(date) => {
              pendingCreate.current = { s: open, date };
              setOpenId(null);
              // onDismiss n'est pas fiable sur Android : pas d'animation iOS à attendre
              if (Platform.OS !== 'ios') setTimeout(flushPending, 300);
            }}
          />
        )}
      </Modal>

      <Modal
        statusBarTranslucent
        navigationBarTranslucent
        visible={openNew}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onNewClosed}
      >
        {openNew && (
          <SondageForm
            currentUserId={currentUserId}
            categories={categories}
            eventDays={eventDays}
            onClose={onNewClosed}
            onSaved={async () => {
              onNewClosed();
              await onChanged();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function SondageDetail({
  sondage,
  currentUserId,
  profiles,
  onClose,
  onChanged,
  onPick,
}: {
  sondage: SondageFull;
  currentUserId: string;
  profiles: Record<string, ProfileMini>;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onPick: (date: string) => void;
}) {
  const busy = useRef(false);
  const [showMissing, setShowMissing] = useState(false);
  const isOwner = sondage.created_by === currentUserId;
  const voters = new Set(sondage.votes.map((v) => v.user_id));
  const missing = Object.keys(profiles)
    .filter((id) => !voters.has(id))
    .map((id) => ({ id, name: profileName(profiles[id]) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const dispoCount = (optId: string) => sondage.votes.filter((v) => v.option_id === optId && v.dispo).length;
  const best = Math.max(0, ...sondage.options.map((o) => dispoCount(o.id)));
  const t0 = today();

  async function vote(optionId: string, dispo: boolean) {
    if (busy.current) return;
    busy.current = true;
    Haptics.selectionAsync().catch(() => {});
    try {
      const mine = sondage.votes.find((v) => v.option_id === optionId && v.user_id === currentUserId);
      const { error } =
        mine && mine.dispo === dispo
          ? await sb.from('date_sondage_votes').delete().eq('option_id', optionId).eq('user_id', currentUserId)
          : await sb
              .from('date_sondage_votes')
              .upsert({ option_id: optionId, user_id: currentUserId, dispo }, { onConflict: 'option_id,user_id' });
      if (error) Alert.alert('Erreur', error.message);
      await onChanged();
    } finally {
      busy.current = false;
    }
  }

  function remove() {
    Alert.alert('Supprimer ce sondage ?', 'Les réponses seront perdues.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          const { error } = await sb.from('date_sondages').delete().eq('id', sondage.id);
          if (error) {
            Alert.alert('Suppression impossible', error.message);
            return;
          }
          onClose();
          await onChanged();
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.header}>
        <IconButton name="x" label="Fermer" onPress={onClose} bg="transparent" />
        {isOwner && <IconButton name="trash-2" label="Supprimer le sondage" onPress={remove} color={c.danger} bg="transparent" />}
      </View>
      <ScrollView contentContainerStyle={styles.detailScroll}>
        <Text style={styles.kicker}>
          Quelle date ?{sondage.categorie ? <Text style={{ color: c.muted }}> · {sondage.categorie}</Text> : null}
        </Text>
        <Text style={styles.title} accessibilityRole="header">
          {sondage.titre}
        </Text>
        <Text style={styles.meta}>
          Proposé par {isOwner ? 'toi' : profileName(profiles[sondage.created_by])}, {voters.size} réponse
          {voters.size > 1 ? 's' : ''}
        </Text>
        {!!sondage.note && <Text style={styles.note}>{sondage.note}</Text>}

        <View style={{ height: 16 }} />
        {sondage.options.map((o) => {
          const past = parseDay(o.date_option) < t0;
          const yes = sondage.votes.filter((v) => v.option_id === o.id && v.dispo);
          const no = sondage.votes.filter((v) => v.option_id === o.id && !v.dispo);
          const mine = sondage.votes.find((v) => v.option_id === o.id && v.user_id === currentUserId);
          const top = best > 0 && yes.length === best;
          const pct = voters.size ? Math.round((yes.length / voters.size) * 100) : 0;
          return (
            <View key={o.id} style={[styles.option, top && styles.optionTop, past && { opacity: 0.5 }]}>
              <View style={styles.optionHead}>
                <Text style={styles.optionDate}>{cap(dayLabel(o.date_option))}</Text>
                {top ? (
                  <Badge label="La plus demandée" color={c.teal} textColor={c.tealInk} style={{ alignSelf: 'center' }} />
                ) : (
                  <Text style={styles.optionCount}>
                    {yes.length} dispo{past ? ' · passée' : ''}
                  </Text>
                )}
              </View>
              <View
                style={styles.bar}
                accessible
                accessibilityRole="image"
                accessibilityLabel={`${yes.length} dispo sur ${voters.size}`}
              >
                <View style={[styles.barFill, { width: `${pct}%` }]} />
              </View>
              <View style={styles.choiceRow}>
                <Choice
                  label={`Dispo · ${yes.length}`}
                  kind="yes"
                  active={mine?.dispo === true}
                  disabled={past}
                  onPress={() => vote(o.id, true)}
                />
                <Choice
                  label={`Pas dispo · ${no.length}`}
                  kind="no"
                  active={mine?.dispo === false}
                  disabled={past}
                  onPress={() => vote(o.id, false)}
                />
              </View>
              {yes.length > 0 && (
                <Text style={styles.names}>
                  <Text style={{ color: c.teal, fontFamily: f.bodyBold }}>Dispo : </Text>
                  {yes.map((v) => profileName(profiles[v.user_id])).join(', ')}
                </Text>
              )}
              {no.length > 0 && (
                <Text style={styles.names}>
                  <Text style={{ color: c.coralSoft, fontFamily: f.bodyBold }}>Pas dispo : </Text>
                  {no.map((v) => profileName(profiles[v.user_id])).join(', ')}
                </Text>
              )}
              {/* L'auteur choisit la date : bouton plein sur la favorite, discret ailleurs */}
              {isOwner && !past && (
                <Button
                  label={top ? 'Créer l’événement ce jour-là' : 'Choisir cette date'}
                  variant={top ? 'primary' : 'danger'}
                  height={46}
                  style={{ marginTop: 10 }}
                  onPress={() => onPick(o.date_option)}
                />
              )}
            </View>
          );
        })}
      </ScrollView>

      <Pressable
        onPress={() => setShowMissing(true)}
        accessibilityRole="button"
        accessibilityLabel={`Pas encore répondu : ${missing.length}. Voir qui`}
        style={({ pressed }) => [styles.missingBar, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.missingText}>
          {missing.length ? 'Pas encore répondu' : 'Tout le monde a répondu'}
          {missing.length > 0 && <Text style={{ color: c.muted, fontFamily: f.bodyMedium }}> {missing.length}</Text>}
        </Text>
        <Feather name="chevron-right" size={20} color={c.muted} />
      </Pressable>

      <Sheet
        visible={showMissing}
        onClose={() => setShowMissing(false)}
        title="Pas encore répondu"
        sub={sondage.titre}
        footer={<Button label="Fermer" variant="ghost" onPress={() => setShowMissing(false)} />}
      >
        {missing.length === 0 && <Text style={styles.names}>Tout le monde a répondu.</Text>}
        {missing.map((m, i) => (
          <View key={m.id} style={[styles.personRow, i === missing.length - 1 && { borderBottomWidth: 0 }]}>
            <Pastille id={m.id} name={m.name} size={36} />
            <Text style={styles.personName} numberOfLines={1}>
              {m.name}
            </Text>
          </View>
        ))}
      </Sheet>
    </SafeAreaView>
  );
}

function Choice({
  label,
  kind,
  active,
  disabled,
  onPress,
}: {
  label: string;
  kind: 'yes' | 'no';
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const bg = active ? (kind === 'yes' ? c.teal : c.text) : c.deep;
  const fg = active ? (kind === 'yes' ? c.tealInk : c.ink) : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={active ? `${label}, choisi. Toucher pour retirer` : label}
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [styles.choice, { backgroundColor: bg }, pressed && { opacity: 0.8 }]}
    >
      {active && <Feather name={kind === 'yes' ? 'check' : 'x'} size={16} color={fg} />}
      <Text style={[styles.choiceText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function SondageForm({
  currentUserId,
  categories,
  eventDays,
  onClose,
  onSaved,
}: {
  currentUserId: string;
  categories: string[];
  eventDays: string[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [titre, setTitre] = useState('');
  const [categorie, setCategorie] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [more, setMore] = useState(false);

  function toggleDate(d: string) {
    if (dates.includes(d)) {
      setDates((prev) => prev.filter((x) => x !== d));
      return;
    }
    if (dates.length >= MAX_DATES) {
      Alert.alert('Trop de dates', `${MAX_DATES} dates maximum.`);
      return;
    }
    // Contrôle refait sur l'état à jour : deux appuis rapides lisent le même `dates`
    setDates((prev) => (prev.includes(d) || prev.length >= MAX_DATES ? prev : [...prev, d].sort()));
  }

  async function save() {
    if (saving) return;
    if (!titre.trim()) {
      Alert.alert('Titre requis', 'Dis ce que vous voulez organiser.');
      return;
    }
    if (dates.length < 2) {
      Alert.alert('Deux dates minimum', 'Ajoute au moins deux dates au choix.');
      return;
    }
    setSaving(true);
    try {
      // Sondage + dates en une transaction côté base (11_sondages_date_et_rappel_veille.sql)
      const { error } = await sb.rpc('create_date_sondage', {
        p_titre: titre.trim(),
        p_categorie: categorie,
        p_note: note.trim(),
        p_dates: dates,
      });
      if (error) {
        // SQL pas encore appliqué : fonction ou table inconnue
        if (error.code === 'PGRST202' || error.code === '42P01' || error.code === '42883') {
          Alert.alert('Pas encore disponible', 'Les sondages de date ne sont pas encore activés.');
          return;
        }
        throw new Error(error.message);
      }
      await onSaved();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
      <View style={[styles.header, styles.formHeader]}>
        <IconButton name="x" label="Fermer" onPress={onClose} bg="transparent" />
        <Text style={styles.formTitle} accessibilityRole="header">
          Sondage de date
        </Text>
        <View style={{ width: 44 }} />
      </View>
      <KeyboardAware insideSafeArea={false}>
        <ScrollView contentContainerStyle={styles.formScroll} keyboardShouldPersistTaps="handled">
          <FieldLabel>C&apos;est pour quoi ?</FieldLabel>
          <Field
            value={titre}
            onChangeText={setTitre}
            placeholder="Soirée chez Marie, week-end à la mer…"
            accessibilityLabel="C'est pour quoi ?"
            maxLength={120}
          />

          <View style={styles.datesHead}>
            <Text style={styles.datesLabel}>Quelles dates proposer ?</Text>
          </View>
          <Text style={styles.subLabel}>Touche les jours à proposer.</Text>
          <DayCalendar
            selected={dates}
            onToggle={toggleDate}
            minDay={toDay(new Date())}
            marked={eventDays}
            accent={c.yellow}
            accentText={c.ink}
          />
          {dates.length > 0 && (
            <View style={styles.chips}>
              {dates.map((d) => (
                <Pressable
                  key={d}
                  onPress={() => toggleDate(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`Retirer ${dayLabel(d)}`}
                  style={({ pressed }) => [styles.dateChip, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.dateChipText}>{chipDate(d)}</Text>
                  <Feather name="x" size={14} color={c.yellow} />
                </Pressable>
              ))}
            </View>
          )}
          {dates.length < 2 && <Text style={styles.hint}>Au moins deux dates.</Text>}

          {more ? (
            <>
              <View style={{ height: 22 }} />
              <FieldLabel hint="(facultatif)">Catégorie</FieldLabel>
              <View style={styles.chips}>
                {categories.map((cat) => (
                  <Chip
                    key={cat}
                    label={cat}
                    active={categorie === cat}
                    color={c.yellow}
                    onPress={() => setCategorie(categorie === cat ? null : cat)}
                  />
                ))}
              </View>
              <View style={{ height: 22 }} />
              <FieldLabel hint="(facultatif)">Note</FieldLabel>
              <Field
                value={note}
                onChangeText={setNote}
                placeholder="Le lieu, l’idée, le budget…"
                accessibilityLabel="Note"
                multiline
              />
            </>
          ) : (
            <Pressable
              onPress={() => setMore(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.moreBtn, pressed && { opacity: 0.7 }]}
            >
              <Feather name="plus" size={18} color={c.muted} />
              <Text style={styles.moreText}>Ajouter une catégorie ou une note</Text>
            </Pressable>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <SafeAreaView edges={['bottom']}>
            <Button label="Envoyer le sondage au groupe" onPress={save} loading={saving} height={54} />
          </SafeAreaView>
        </View>
      </KeyboardAware>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  section: { marginTop: 24, paddingHorizontal: theme.gutter },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    marginBottom: 10,
    borderRadius: theme.radius.card,
    backgroundColor: c.card,
  },
  cardIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.yellow, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 16, lineHeight: 21 },
  cardMeta: { color: c.muted, fontFamily: f.body, fontSize: 13, marginTop: 2 },
  doneDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.teal, alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6 },
  detailScroll: { paddingHorizontal: theme.gutter, paddingTop: 4, paddingBottom: 24 },
  kicker: { color: c.yellow, fontFamily: f.bodyBold, fontSize: 13 },
  title: { color: c.text, fontFamily: f.serifBlack, fontSize: 28, lineHeight: 34, marginTop: 4 },
  meta: { color: c.muted, fontFamily: f.body, fontSize: 14, marginTop: 6 },
  note: { color: c.text, fontFamily: f.body, fontSize: 16, lineHeight: 23, marginTop: 12 },
  option: { padding: 14, marginBottom: 10, borderRadius: theme.radius.card, backgroundColor: c.card, borderWidth: 2, borderColor: 'transparent' },
  optionTop: { borderColor: c.teal },
  optionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  optionDate: { flex: 1, color: c.text, fontFamily: f.serif, fontSize: 19, lineHeight: 24 },
  optionCount: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  bar: { height: 8, borderRadius: 4, backgroundColor: c.rail, overflow: 'hidden', marginTop: 10, marginBottom: 12 },
  barFill: { height: 8, backgroundColor: c.teal },
  choiceRow: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  choiceText: { fontFamily: f.bodyBold, fontSize: 14, flexShrink: 1 },
  names: { color: c.muted, fontFamily: f.body, fontSize: 13, lineHeight: 19, marginTop: 8 },
  missingBar: {
    marginHorizontal: theme.gutter,
    marginBottom: 8,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 26,
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  missingText: { color: c.text, fontFamily: f.bodyBold, fontSize: 15 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderBottomWidth: 1, borderBottomColor: c.hairline },
  personName: { flex: 1, color: c.text, fontFamily: f.bodyMedium, fontSize: 16 },

  formHeader: { borderBottomWidth: 1, borderBottomColor: c.hairline },
  formTitle: { color: c.text, fontFamily: f.serif, fontSize: 18 },
  formScroll: { paddingHorizontal: theme.gutter, paddingTop: 18, paddingBottom: 24 },
  datesHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 22, marginBottom: 4 },
  datesLabel: { color: c.text, fontFamily: f.bodyBold, fontSize: 15 },
  subLabel: { color: c.muted, fontFamily: f.body, fontSize: 13, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255,217,61,0.16)',
  },
  dateChipText: { color: c.yellow, fontFamily: f.bodyBold, fontSize: 13 },
  hint: { color: c.muted, fontFamily: f.body, fontSize: 13, marginTop: 8 },
  moreBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 14 },
  moreText: { color: c.muted, fontFamily: f.bodyBold, fontSize: 15 },
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
