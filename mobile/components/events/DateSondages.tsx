import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CalendarPicker, dayLabel, parseDay, toDay } from '@/components/ui/CalendarPicker';
import { KeyboardAware } from '@/lib/keyboard';
import {
  sb,
  type DateSondage,
  type DateSondageOption,
  type DateSondageVote,
  type ProfileMini,
} from '@/lib/supabase';
import { theme } from '@/lib/theme';

export type SondageFull = DateSondage & {
  options: DateSondageOption[];
  votes: DateSondageVote[];
};

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
  const { data: rows, error } = await sb
    .from('date_sondages')
    .select('*')
    .eq('closed', false)
    .order('created_at', { ascending: false });
  if (error) return null;
  const list = (rows ?? []) as DateSondage[];
  if (list.length === 0) return [];
  const { data: opts, error: optsError } = await sb
    .from('date_sondage_options')
    .select('id,sondage_id,date_option')
    .in(
      'sondage_id',
      list.map((s) => s.id),
    )
    .order('date_option', { ascending: true });
  // Sans les dates, tous les sondages seraient filtrés : on garde la liste affichée
  if (optsError) return null;
  const options = (opts ?? []) as DateSondageOption[];
  const { data: vts, error: vtsError } = options.length
    ? await sb
        .from('date_sondage_votes')
        .select('option_id,user_id,dispo')
        .in(
          'option_id',
          options.map((o) => o.id),
        )
    : { data: [], error: null };
  if (vtsError) return null;
  const votes = (vts ?? []) as DateSondageVote[];
  const t0 = today();
  return list
    .map((s) => {
      const o = options.filter((x) => x.sondage_id === s.id);
      const ids = new Set(o.map((x) => x.id));
      return { ...s, options: o, votes: votes.filter((v) => ids.has(v.option_id)) };
    })
    .filter((s) => s.options.some((o) => parseDay(o.date_option) >= t0));
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
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionAccent} />
            <Text style={styles.sectionLabel}>Quelle date ?</Text>
          </View>
          {sondages.map((s) => {
            const voters = new Set(s.votes.map((v) => v.user_id));
            const answered = voters.has(currentUserId);
            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setOpenId(s.id);
                }}
                style={({ pressed }) => [styles.card, pressed && { backgroundColor: theme.colors.surface2 }]}
              >
                <View style={styles.cardIcon}>
                  <Ionicons name="calendar-number" size={20} color={theme.colors.deep} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {s.titre}
                  </Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {s.options.length} dates · {voters.size} réponse{voters.size > 1 ? 's' : ''} ·{' '}
                    {profileName(profiles[s.created_by])}
                  </Text>
                </View>
                {answered ? (
                  <Ionicons name="checkmark-circle" size={22} color={theme.colors.teal} />
                ) : (
                  <View style={styles.todoPill}>
                    <Text style={styles.todoPillText}>À toi</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}

      <Modal
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

      <Modal visible={openNew} animationType="slide" presentationStyle="pageSheet" onRequestClose={onNewClosed}>
        {openNew && (
          <SondageForm
            currentUserId={currentUserId}
            categories={categories}
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
  const isOwner = sondage.created_by === currentUserId;
  const voters = new Set(sondage.votes.map((v) => v.user_id));
  const missing = Object.keys(profiles)
    .filter((id) => !voters.has(id))
    .map((id) => profileName(profiles[id]))
    .sort((a, b) => a.localeCompare(b, 'fr'));
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
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fermer">
          <Ionicons name="close" size={26} color={theme.colors.text} />
        </Pressable>
        {isOwner && (
          <Pressable onPress={remove} hitSlop={10} accessibilityRole="button" accessibilityLabel="Supprimer">
            <Ionicons name="trash-outline" size={22} color={theme.colors.danger} />
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={{ padding: theme.s(5), paddingBottom: theme.s(12) }}>
        {!!sondage.categorie && (
          <View style={styles.catPill}>
            <Text style={styles.catPillText}>{sondage.categorie}</Text>
          </View>
        )}
        <Text style={styles.title}>{sondage.titre}</Text>
        <Text style={styles.meta}>
          Proposé par {isOwner ? 'toi' : profileName(profiles[sondage.created_by])} · {voters.size} réponse
          {voters.size > 1 ? 's' : ''}
        </Text>
        {!!sondage.note && <Text style={styles.note}>{sondage.note}</Text>}

        <Text style={styles.sectionTitle}>Tu es dispo quand ?</Text>
        {sondage.options.map((o) => {
          const past = parseDay(o.date_option) < t0;
          const yes = sondage.votes.filter((v) => v.option_id === o.id && v.dispo);
          const no = sondage.votes.filter((v) => v.option_id === o.id && !v.dispo);
          const mine = sondage.votes.find((v) => v.option_id === o.id && v.user_id === currentUserId);
          const top = best > 0 && yes.length === best;
          return (
            <View key={o.id} style={[styles.option, top && styles.optionTop, past && { opacity: 0.5 }]}>
              <View style={styles.optionHead}>
                <Text style={styles.optionDate}>{cap(dayLabel(o.date_option))}</Text>
                {top && (
                  <View style={styles.topPill}>
                    <Text style={styles.topPillText}>La plus demandée</Text>
                  </View>
                )}
              </View>
              <View style={styles.choiceRow}>
                <Choice
                  label={`Dispo · ${yes.length}`}
                  icon="checkmark-circle"
                  tone={theme.colors.teal}
                  active={mine?.dispo === true}
                  disabled={past}
                  onPress={() => vote(o.id, true)}
                />
                <Choice
                  label={`Pas dispo · ${no.length}`}
                  icon="close-circle"
                  tone={theme.colors.coral}
                  active={mine?.dispo === false}
                  disabled={past}
                  onPress={() => vote(o.id, false)}
                />
              </View>
              {yes.length > 0 && (
                <Text style={styles.names}>
                  <Text style={{ color: theme.colors.teal }}>Dispo : </Text>
                  {yes.map((v) => profileName(profiles[v.user_id])).join(' · ')}
                </Text>
              )}
              {no.length > 0 && (
                <Text style={styles.names}>
                  <Text style={{ color: theme.colors.coral }}>Pas dispo : </Text>
                  {no.map((v) => profileName(profiles[v.user_id])).join(' · ')}
                </Text>
              )}
              {/* L'auteur choisit la date : bouton plein sur la favorite, discret ailleurs */}
              {isOwner && !past && (
                <Pressable
                  onPress={() => onPick(o.date_option)}
                  style={({ pressed }) => [
                    top ? styles.pickBtnTop : styles.pickBtn,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Ionicons
                    name="calendar"
                    size={15}
                    color={top ? theme.colors.deep : theme.colors.muted}
                  />
                  <Text style={top ? styles.pickTextTop : styles.pickText}>
                    {top ? 'Créer l’événement à cette date' : 'Choisir cette date'}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}

        <Text style={styles.sectionTitle}>Pas encore répondu ({missing.length})</Text>
        <Text style={styles.names}>{missing.length ? missing.join(' · ') : 'Tout le monde a répondu.'}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Choice({
  label,
  icon,
  tone,
  active,
  disabled,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tone: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [
        styles.choice,
        { borderColor: active ? tone : tone + '55' },
        active && { backgroundColor: tone },
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      <Ionicons name={icon} size={17} color={active ? theme.colors.deep : tone} />
      <Text style={[styles.choiceText, { color: active ? theme.colors.deep : tone }]}>{label}</Text>
    </Pressable>
  );
}

function SondageForm({
  currentUserId,
  categories,
  onClose,
  onSaved,
}: {
  currentUserId: string;
  categories: string[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [titre, setTitre] = useState('');
  const [categorie, setCategorie] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [dates, setDates] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

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
    <SafeAreaView style={styles.flex}>
      <View style={styles.formHeader}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fermer">
          <Ionicons name="close" size={26} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.formTitle}>Sondage de date</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAware>
        <ScrollView contentContainerStyle={{ padding: theme.s(5) }} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Quoi ?</Text>
          <TextInput
            value={titre}
            onChangeText={setTitre}
            placeholder="Soirée chez Marie, week-end à la mer…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={styles.input}
            maxLength={120}
          />

          <Text style={styles.label}>Dates proposées</Text>
          <Text style={styles.subLabel}>Touche les jours à proposer, de 2 à {MAX_DATES}.</Text>
          <CalendarPicker selected={dates} onToggle={toggleDate} minDay={toDay(new Date())} />
          <View style={[styles.catRow, { marginTop: theme.s(3) }]}>
            {dates.map((d) => (
              <Pressable
                key={d}
                onPress={() => toggleDate(d)}
                style={[styles.chip, styles.chipOn, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
                accessibilityLabel={`Retirer ${dayLabel(d)}`}
              >
                <Text style={styles.chipTextOn}>{cap(dayLabel(d))}</Text>
                <Ionicons name="close" size={14} color={theme.colors.deep} />
              </Pressable>
            ))}
          </View>
          {dates.length < 2 && <Text style={styles.hint}>Au moins deux dates.</Text>}

          <Text style={[styles.label, { marginTop: theme.s(4) }]}>Catégorie (optionnel)</Text>
          <View style={styles.catRow}>
            {categories.map((c) => (
              <Pressable
                key={c}
                onPress={() => setCategorie(categorie === c ? null : c)}
                style={[styles.chip, categorie === c && styles.chipOn]}
              >
                <Text style={[styles.chipText, categorie === c && styles.chipTextOn]}>{c}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Note (optionnel)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Le lieu, l’idée, le budget…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
            multiline
          />

          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [styles.saveBtn, (pressed || saving) && { opacity: 0.7 }]}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Envoyer le sondage</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAware>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },
  section: { marginTop: theme.s(7), paddingHorizontal: theme.s(5) },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: theme.s(3) },
  sectionAccent: { width: 18, height: 2, backgroundColor: theme.colors.yellow, borderRadius: 1 },
  sectionLabel: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: theme.s(3),
    marginBottom: theme.s(2),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.yellow + '66',
    backgroundColor: theme.colors.cardBg,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  cardMeta: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 12, marginTop: 2 },
  todoPill: {
    backgroundColor: theme.colors.coral,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  todoPillText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 12 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.s(4),
    paddingVertical: theme.s(3),
  },
  catPill: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    marginBottom: theme.s(2),
  },
  catPillText: { color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 12 },
  title: { color: theme.colors.text, fontFamily: theme.fonts.serifBlack, fontSize: 28 },
  meta: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 13, marginTop: 4 },
  note: { color: theme.colors.text, fontFamily: theme.fonts.body, fontSize: 15, lineHeight: 22, marginTop: theme.s(3) },
  sectionTitle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: theme.s(6),
    marginBottom: theme.s(2),
  },
  option: {
    padding: theme.s(3),
    marginBottom: theme.s(3),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  optionTop: { borderColor: theme.colors.yellow },
  optionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  optionDate: { flex: 1, color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 16 },
  topPill: { backgroundColor: theme.colors.yellow, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill },
  topPillText: { color: theme.colors.deep, fontFamily: theme.fonts.bodyBold, fontSize: 11 },
  choiceRow: { flexDirection: 'row', gap: 8, marginTop: theme.s(3) },
  choice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
  },
  choiceText: { fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  names: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 13, lineHeight: 18, marginTop: 8 },
  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: theme.s(3), alignSelf: 'flex-start' },
  pickText: { color: theme.colors.muted, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  pickBtnTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: theme.s(3),
    paddingVertical: 11,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.yellow,
  },
  pickTextTop: { color: theme.colors.deep, fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  subLabel: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 13, marginTop: -4, marginBottom: theme.s(3) },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.s(4),
    paddingVertical: theme.s(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  formTitle: { color: theme.colors.text, fontFamily: theme.fonts.serif, fontSize: 18 },
  label: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: theme.s(2),
  },
  input: {
    backgroundColor: theme.colors.inputBg,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    fontSize: 16,
    paddingHorizontal: theme.s(3),
    paddingVertical: 12,
    marginBottom: theme.s(4),
  },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: theme.s(4) },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipOn: { backgroundColor: theme.colors.yellow, borderColor: theme.colors.yellow },
  chipText: { color: theme.colors.muted, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  chipTextOn: { color: theme.colors.deep, fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 12, marginTop: -theme.s(2) },
  saveBtn: {
    marginTop: theme.s(2),
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16 },
});
