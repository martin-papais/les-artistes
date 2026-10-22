import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Button, Chip, IconButton, Pastille, ScreenHeader, SectionTitle, Sheet } from '@/components/ui/kit';
import { KeyboardAware } from '@/lib/keyboard';
import { getBlocked } from '@/lib/moderation';
import { sb, sessionUser } from '@/lib/supabase';
import { usePageCache } from '@/lib/cache';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;

type Source = 'membres' | 'alcool' | 'societe';
type Entry = {
  key: string;
  /** id de la ligne (profil ou jeu) : sert à la couleur de la pastille */
  id: string;
  label: string;
  source: Source;
  detail: string | null;
};

const SOURCES: { id: Source; label: string; chip: string }[] = [
  { id: 'membres', label: 'Membres', chip: 'Membres' },
  { id: 'alcool', label: 'Jeux d’alcool', chip: 'Jeux d’alcool' },
  { id: 'societe', label: 'Jeux de société', chip: 'Société' },
];
const SOURCE_LABEL: Record<Source, string> = {
  membres: 'Membre',
  alcool: 'Jeu d’alcool',
  societe: 'Jeu de société',
};

const PALETTE = [c.coral, c.yellow, c.teal, c.violet, c.pink];
const SPIN_MS = 5200;
const TURNS = 6;

function wedgeColor(i: number, n: number) {
  // Le dernier secteur touche le premier : jamais deux fois la même couleur côte à côte
  if (i === n - 1 && n % PALETTE.length === 1) return PALETTE[2];
  return PALETTE[i % PALETTE.length];
}

const WHEEL_MARGIN = 12; // = styles.wheelZone.marginTop
const WHEEL_EXTRA = 16; // place du pointeur au-dessus de la roue (haut de la roue dans wheelZone)
const ACTIONS_MARGIN = theme.s(5); // = styles.actions.marginTop
const BOTTOM_PAD = theme.s(4); // paddingBottom du ScrollView
const HUB = 64;

export default function RouletteScreen() {
  const { width } = useWindowDimensions();
  // Hauteurs mesurées : la roue rétrécit pour que l'écran tienne sans défiler.
  // topH = en-tête + puces + carte « dans la roue », actionsH = bouton + indice + marge
  const [viewH, setViewH] = useState(0);
  const [topH, setTopH] = useState(0);
  const [actionsH, setActionsH] = useState(0);
  const fit =
    viewH && topH && actionsH ? viewH - topH - actionsH - WHEEL_MARGIN - WHEEL_EXTRA - BOTTOM_PAD : Infinity;
  const size = Math.round(Math.max(220, Math.min(width - theme.gutter * 2, 360, fit)));
  const radius = size / 2;

  const [all, setAll] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sources, setSources] = useState<Set<Source>>(new Set(['membres']));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<Entry | null>(null);
  // Dernier tirage, gardé pendant que la feuille se referme (sinon elle descend vide)
  const [shown, setShown] = useState<Entry | null>(null);
  const lastTick = useRef(0);

  const rotation = useSharedValue(0);
  const pointerTilt = useSharedValue(0);
  // Vrai seulement pendant un lancer : la remise de l'angle à [0, 360) ne doit pas « cliquer »
  const live = useSharedValue(false);
  // Un rechargement pendant un lancer décalerait les secteurs sous le pointeur :
  // la nouvelle liste attend la fin du lancer
  const spinningRef = useRef(false);
  const pendingAll = useRef<Entry[] | null>(null);

  const montrer = useCallback((next: Entry[]) => {
    if (spinningRef.current) pendingAll.current = next;
    else setAll(next);
    setLoading(false);
  }, []);
  const { garder, echec } = usePageCache('roulette', montrer);

  const loadAll = useCallback(async () => {
    const user = await sessionUser();
    if (!user) return;
    const [profRes, alcRes, socRes, blocked] = await Promise.all([
      sb.from('profiles').select('id,prenom,nom,pseudo'),
      sb.from('jeux_alcool').select('id,nom,regles'),
      sb.from('jeux_societe').select('id,nom,regles'),
      getBlocked(),
    ]);
    if (profRes.error || alcRes.error || socRes.error) {
      setLoading(false);
      echec();
      return;
    }
    const byLabel = (a: Entry, b: Entry) => a.label.localeCompare(b.label, 'fr');
    const membres: Entry[] = (profRes.data ?? [])
      .filter((p) => !blocked.has(p.id))
      .map((p) => ({
        key: `membres:${p.id}`,
        id: p.id,
        label: p.pseudo || `${p.prenom ?? ''} ${p.nom ?? ''}`.trim(),
        source: 'membres' as const,
        detail: null,
      }))
      .filter((e) => !!e.label)
      .sort(byLabel);
    const alcool: Entry[] = (alcRes.data ?? [])
      .filter((j) => !!j.nom)
      .map((j) => ({
        key: `alcool:${j.id}`,
        id: String(j.id),
        label: j.nom,
        source: 'alcool' as const,
        detail: j.regles,
      }))
      .sort(byLabel);
    const societe: Entry[] = (socRes.data ?? [])
      .filter((j) => !!j.nom)
      .map((j) => ({
        key: `societe:${j.id}`,
        id: String(j.id),
        label: j.nom,
        source: 'societe' as const,
        detail: j.regles,
      }))
      .sort(byLabel);
    garder([...membres, ...alcool, ...societe]);
  }, [garder, echec]);

  useRefreshOnFocus(loadAll);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }

  const entries = useMemo(
    () => all.filter((e) => sources.has(e.source) && !excluded.has(e.key)),
    [all, sources, excluded],
  );
  const n = entries.length;
  const segment = n > 0 ? 360 / n : 360;

  // Petit « clic » à chaque secteur qui passe sous le pointeur
  const tick = useCallback(() => {
    const now = Date.now();
    // Sur Android chaque appel est une vraie vibration : on espace davantage
    if (now - lastTick.current < (Platform.OS === 'android' ? 110 : 45)) return;
    lastTick.current = now;
    Haptics.selectionAsync().catch(() => {});
  }, []);

  useAnimatedReaction(
    () => Math.floor((rotation.value + segment / 2) / segment),
    (cur, prev) => {
      if (!live.value || prev === null || cur === prev) return;
      pointerTilt.value = withSequence(
        withTiming(-14, { duration: 40 }),
        withTiming(0, { duration: 120 }),
      );
      scheduleOnRN(tick);
    },
    [segment],
  );

  const finish = useCallback((entry: Entry | null) => {
    spinningRef.current = false;
    if (pendingAll.current) {
      setAll(pendingAll.current);
      pendingAll.current = null;
    }
    if (!entry) {
      setSpinning(false);
      return;
    }
    setSpinning(false);
    setShown(entry);
    setWinner(entry);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, []);

  function spin() {
    // La ref, pas l'état : deux taps avant le re-rendu lanceraient deux animations
    if (spinningRef.current || n < 2) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    setWinner(null);
    setSpinning(true);
    spinningRef.current = true;
    const idx = Math.floor(Math.random() * n);
    const entry = entries[idx];
    // Le secteur idx est centré à idx*segment (sens horaire depuis le haut) :
    // il arrive sous le pointeur quand la roue a tourné de -idx*segment (mod 360)
    const jitter = (Math.random() - 0.5) * segment * 0.7;
    const current = rotation.value;
    const wanted = (((-idx * segment + jitter - current) % 360) + 360) % 360;
    const target = current + TURNS * 360 + wanted;
    live.value = true;
    rotation.value = withTiming(
      target,
      { duration: SPIN_MS, easing: Easing.bezier(0.15, 0.85, 0.25, 1) },
      (done) => {
        live.value = false;
        if (!done) {
          scheduleOnRN(finish, null);
          return;
        }
        rotation.value = target % 360;
        scheduleOnRN(finish, entry);
      },
    );
  }

  function toggleSource(id: Source) {
    if (spinning) return;
    Haptics.selectionAsync().catch(() => {});
    setWinner(null);
    setSources((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size === 1) return prev; // au moins une source
        next.delete(id);
      } else next.add(id);
      return next;
    });
  }

  function toggleEntry(key: string) {
    setWinner(null);
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function closePicker() {
    setPicking(false);
    setSearch('');
  }

  function setGroupIncluded(source: Source, include: boolean) {
    Haptics.selectionAsync().catch(() => {});
    setWinner(null);
    setExcluded((prev) => {
      const next = new Set(prev);
      all
        .filter((e) => e.source === source)
        .forEach((e) => (include ? next.delete(e.key) : next.add(e.key)));
      return next;
    });
  }

  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  const pointerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${pointerTilt.value}deg` }],
  }));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.teal} />
      </View>
    );
  }

  const fontSize = n <= 8 ? 15 : n <= 16 ? 12 : n <= 30 ? 10 : 8;
  // Demi-largeur du triangle qui dessine un secteur (débord rogné par le cercle)
  const half = n >= 3 ? radius * Math.tan(Math.PI / n + 0.01) : radius;
  const pickable = all.filter((e) => sources.has(e.source));
  const q = search.trim().toLocaleLowerCase('fr');
  const found = q ? pickable.filter((e) => e.label.toLocaleLowerCase('fr').includes(q)) : pickable;

  return (
    <View style={styles.flex}>
      <ScrollView
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        contentContainerStyle={{ paddingBottom: BOTTOM_PAD }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.teal}
            enabled={!spinning}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View onLayout={(e) => setTopH(e.nativeEvent.layout.height)}>
          <ScreenHeader title="Roulette" sub="Qui s’y colle, à quoi on joue : la roue décide" />

          <View style={styles.chips}>
            {SOURCES.map((s) => (
              <Chip
                key={s.id}
                label={s.chip}
                active={sources.has(s.id)}
                onPress={() => toggleSource(s.id)}
                style={styles.chip}
              />
            ))}
          </View>

          <Pressable
            onPress={() => setPicking(true)}
            disabled={spinning}
            accessibilityRole="button"
            accessibilityLabel={`${n} sur ${pickable.length} dans la roue. Choisir`}
            style={({ pressed }) => [styles.pickCard, (pressed || spinning) && { opacity: 0.7 }]}
          >
            <Feather name="sliders" size={20} color={c.teal} />
            <Text style={styles.pickTitle} numberOfLines={1}>
              {n} sur {pickable.length} dans la roue
            </Text>
            <Text style={styles.pickSub}>Choisir</Text>
          </Pressable>
        </View>

        {/* Cachée jusqu'aux mesures : sinon elle s'affiche à 360 puis rétrécit */}
        <View style={[styles.wheelZone, { height: size + WHEEL_EXTRA, opacity: fit === Infinity ? 0 : 1 }]}>
          <View
            style={[
              styles.wheelShadow,
              { width: size, height: size, borderRadius: radius, top: WHEEL_EXTRA },
            ]}
          >
            <Animated.View
              style={[
                styles.wheel,
                { width: size, height: size, borderRadius: radius },
                wheelStyle,
              ]}
            >
              {n === 0 && (
                <View
                  style={[StyleSheet.absoluteFill, { backgroundColor: c.raised }]}
                />
              )}
              {n === 1 && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: PALETTE[0] }]} />
              )}
              {n === 2 &&
                entries.map((e, i) => (
                  <View
                    key={e.key}
                    style={{
                      position: 'absolute',
                      left: 0,
                      width: size,
                      height: radius,
                      top: i === 0 ? 0 : radius,
                      backgroundColor: wedgeColor(i, n),
                    }}
                  />
                ))}
              {n >= 3 &&
                entries.map((e, i) => (
                  <View
                    key={e.key}
                    style={[
                      StyleSheet.absoluteFill,
                      { transform: [{ rotate: `${i * segment}deg` }] },
                    ]}
                  >
                    <View
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: radius - half,
                        width: 0,
                        height: 0,
                        borderLeftWidth: half,
                        borderRightWidth: half,
                        borderTopWidth: radius,
                        borderLeftColor: 'transparent',
                        borderRightColor: 'transparent',
                        borderTopColor: wedgeColor(i, n),
                      }}
                    />
                  </View>
                ))}
              {entries.map((e, i) => (
                <View
                  key={`label-${e.key}`}
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { transform: [{ rotate: `${i * segment}deg` }] },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.wedgeLabel,
                      {
                        fontSize,
                        // Du bord jusqu'à 0,24 r : le moyeu ne masque pas la fin du nom
                        width: radius * 0.66,
                        left: radius - (radius * 0.66) / 2,
                        top: radius * 0.43 - 11,
                      },
                    ]}
                  >
                    {e.label}
                  </Text>
                </View>
              ))}
            </Animated.View>
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, styles.rim, { borderRadius: radius }]}
            />
          </View>

          <Pressable
            onPress={spin}
            disabled={spinning || n < 2}
            accessibilityRole="button"
            accessibilityLabel="Lancer la roue"
            style={({ pressed }) => [
              styles.hub,
              { top: WHEEL_EXTRA + radius - HUB / 2 },
              pressed && { transform: [{ scale: 0.94 }] },
            ]}
          >
            <Feather
              name={spinning ? 'loader' : 'play'}
              size={24}
              color={c.text}
              style={spinning ? null : { marginLeft: 3 }}
            />
          </Pressable>

          <Animated.View style={[styles.pointerWrap, pointerStyle]} pointerEvents="none">
            <View style={styles.pointer} />
          </Animated.View>
        </View>

        <View style={styles.actions} onLayout={(e) => setActionsH(e.nativeEvent.layout.height + ACTIONS_MARGIN)}>
          <Button
            label={spinning ? 'Ça tourne…' : 'Lancer la roue'}
            onPress={spin}
            disabled={spinning || n < 2}
            height={54}
            style={{ alignSelf: 'stretch' }}
          />
          {/* Place toujours réservée : la roue ne change pas de taille quand l'indice apparaît */}
          <Text style={[styles.hint, n >= 2 && { opacity: 0 }]} accessibilityElementsHidden={n >= 2}
            importantForAccessibility={n >= 2 ? 'no-hide-descendants' : 'auto'}>
            Il faut au moins deux choix dans la roue.
          </Text>
        </View>
      </ScrollView>

      {/* Le résultat monte en feuille du bas : la roue reste visible au-dessus */}
      <Sheet
        visible={!!winner}
        onClose={() => setWinner(null)}
        footer={
          shown ? (
            <View style={styles.resultActions}>
              <Button
                label="Retirer de la roue"
                variant="secondary"
                onPress={() => toggleEntry(shown.key)}
                style={[styles.resultBtn, { backgroundColor: c.deep }]}
              />
              <Button
                label="Relancer"
                onPress={spin}
                disabled={n < 2}
                style={styles.resultBtn}
              />
            </View>
          ) : null
        }
      >
        {shown && (
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.resultKicker}>La roue a choisi</Text>
            <Text style={styles.resultName}>{shown.label}</Text>
            <Text style={styles.resultSource}>{SOURCE_LABEL[shown.source]}</Text>
            {!!shown.detail && (
              <Text style={styles.resultDetail} numberOfLines={6}>
                {shown.detail}
              </Text>
            )}
          </View>
        )}
      </Sheet>

      <Modal
        statusBarTranslucent
        navigationBarTranslucent
        visible={picking}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => closePicker()}
      >
        <SafeAreaView style={styles.flex}>
          <View style={styles.modalHeader}>
            <IconButton name="x" label="Fermer" onPress={() => closePicker()} bg="transparent" />
            <Text style={styles.modalTitle}>Dans la roue</Text>
            <View style={{ width: 44 }} />
          </View>
          <View style={styles.searchBox}>
            <Feather name="search" size={18} color={c.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Chercher un nom"
              placeholderTextColor={c.muted}
              selectionColor={c.coral}
              accessibilityLabel="Chercher un nom"
              style={styles.searchInput}
              autoCorrect={false}
            />
            {!!search && (
              <Pressable
                onPress={() => setSearch('')}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Effacer"
                style={styles.clearBtn}
              >
                <Feather name="x-circle" size={18} color={c.muted} />
              </Pressable>
            )}
          </View>
          {/* Android : la fenêtre de la Modal se rétrécit sous le clavier, KeyboardAware n'ajoute que le reste */}
          <KeyboardAware style={styles.flex}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{
                paddingHorizontal: theme.gutter,
                paddingTop: theme.s(4),
                paddingBottom: theme.s(6),
              }}
            >
              {SOURCES.filter((s) => sources.has(s.id)).map((s) => {
                const group = pickable.filter((e) => e.source === s.id);
                const list = found.filter((e) => e.source === s.id);
                const onCount = group.filter((e) => !excluded.has(e.key)).length;
                return (
                  <View key={s.id} style={{ marginBottom: theme.s(5) }}>
                    <SectionTitle
                      count={`${onCount} sur ${group.length}`}
                      style={{ marginBottom: 4 }}
                      right={
                        <View style={styles.groupBulk}>
                          <Pressable
                            onPress={() => setGroupIncluded(s.id, true)}
                            accessibilityRole="button"
                            accessibilityLabel={`Tout cocher : ${s.label}`}
                            style={({ pressed }) => [styles.bulkBtn, pressed && { opacity: 0.6 }]}
                          >
                            <Text style={styles.bulkText}>Tout</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => setGroupIncluded(s.id, false)}
                            accessibilityRole="button"
                            accessibilityLabel={`Tout décocher : ${s.label}`}
                            style={({ pressed }) => [styles.bulkBtn, pressed && { opacity: 0.6 }]}
                          >
                            <Text style={styles.bulkText}>Aucun</Text>
                          </Pressable>
                        </View>
                      }
                    >
                      {s.label}
                    </SectionTitle>
                    {list.length === 0 && (
                      <Text style={styles.hint}>{q ? 'Aucun résultat.' : 'Rien pour l’instant.'}</Text>
                    )}
                    {list.map((e) => {
                      const on = !excluded.has(e.key);
                      return (
                        <Pressable
                          key={e.key}
                          onPress={() => toggleEntry(e.key)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={e.label}
                          style={({ pressed }) => [styles.pickRow, pressed && { opacity: 0.7 }]}
                        >
                          {e.source === 'membres' && <Pastille id={e.id} name={e.label} size={34} />}
                          <Text style={[styles.pickRowText, !on && { color: c.muted }]} numberOfLines={2}>
                            {e.label}
                          </Text>
                          <View style={[styles.box, !on && styles.boxOff]}>
                            {on && <Feather name="check" size={16} color={c.tealInk} />}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Button
                label={n < 2 ? 'Coche au moins deux choix' : `C’est bon, ${n} dans la roue`}
                onPress={() => closePicker()}
                height={54}
              />
            </View>
          </KeyboardAware>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.deep,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: theme.gutter,
    marginTop: 16,
  },
  chip: { height: 44, borderRadius: 22 },
  pickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: theme.gutter,
    marginTop: 10,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: c.card,
  },
  pickTitle: { flex: 1, color: c.text, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  pickSub: { color: c.muted, fontFamily: theme.fonts.body, fontSize: 14 },

  wheelZone: { marginTop: WHEEL_MARGIN, alignItems: 'center' },
  wheelShadow: {
    position: 'absolute',
    shadowColor: c.violet,
    shadowOpacity: 0.45,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
    backgroundColor: c.deep,
  },
  wheel: { overflow: 'hidden', backgroundColor: c.deep },
  rim: { borderWidth: 6, borderColor: c.text },
  wedgeLabel: {
    position: 'absolute',
    height: 22,
    lineHeight: 22,
    color: c.ink,
    fontFamily: theme.fonts.bodyBold,
    textAlign: 'center',
    transform: [{ rotate: '90deg' }],
  },
  hub: {
    position: 'absolute',
    width: HUB,
    height: HUB,
    borderRadius: HUB / 2,
    backgroundColor: c.deep,
    borderWidth: 4,
    borderColor: c.text,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 14,
  },
  pointerWrap: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    elevation: 16,
    zIndex: 5,
  },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 14,
    borderRightWidth: 14,
    borderTopWidth: 28,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: c.text,
  },
  actions: {
    alignItems: 'center',
    marginTop: ACTIONS_MARGIN,
    paddingHorizontal: theme.gutter,
  },
  hint: {
    color: c.muted,
    fontFamily: theme.fonts.body,
    fontSize: 13,
    marginTop: theme.s(2),
  },

  resultKicker: { color: c.yellow, fontFamily: theme.fonts.bodyBold, fontSize: 14 },
  resultName: {
    color: c.text,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 38,
    lineHeight: 44,
    textAlign: 'center',
    marginTop: 6,
  },
  resultSource: { color: c.muted, fontFamily: theme.fonts.body, fontSize: 14, marginTop: 4 },
  resultDetail: {
    color: c.text,
    fontFamily: theme.fonts.body,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 14,
  },
  resultActions: { flexDirection: 'row', gap: 10 },
  resultBtn: { flex: 1, paddingHorizontal: 10 },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  modalTitle: {
    color: c.text,
    fontFamily: theme.fonts.serif,
    fontSize: 18,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: theme.gutter,
    marginTop: 4,
    height: 48,
    paddingLeft: 16,
    paddingRight: 6,
    borderRadius: 24,
    backgroundColor: c.card,
  },
  searchInput: {
    flex: 1,
    height: 48,
    color: c.text,
    fontFamily: theme.fonts.body,
    fontSize: 15,
    ...(Platform.OS === 'android' ? { paddingVertical: 0 } : null),
  },
  clearBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  groupBulk: { flexDirection: 'row', marginRight: -12 },
  bulkBtn: { height: 44, paddingHorizontal: 12, justifyContent: 'center' },
  bulkText: {
    color: c.teal,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 14,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 54,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  pickRowText: {
    color: c.text,
    fontFamily: theme.fonts.body,
    fontSize: 16,
    flex: 1,
  },
  box: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: c.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOff: { backgroundColor: 'transparent', borderWidth: 2, borderColor: c.rail },
  modalFooter: {
    paddingHorizontal: theme.gutter,
    paddingTop: 14,
    paddingBottom: theme.s(2),
    backgroundColor: c.deep,
    shadowColor: c.deep,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -12 },
    elevation: 12,
  },
});
