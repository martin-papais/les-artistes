import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  ZoomIn,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { KeyboardAware } from '@/lib/keyboard';
import { getBlocked } from '@/lib/moderation';
import { sb, sessionUser } from '@/lib/supabase';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

type Source = 'membres' | 'alcool' | 'societe';
type Entry = {
  key: string;
  label: string;
  source: Source;
  detail: string | null;
};

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
const SOURCES: { id: Source; label: string; icon: IoniconName }[] = [
  { id: 'membres', label: 'Membres', icon: 'people' },
  { id: 'alcool', label: 'Jeux d’alcool', icon: 'beer' },
  { id: 'societe', label: 'Jeux de société', icon: 'dice' },
];
const SOURCE_LABEL: Record<Source, string> = {
  membres: 'Membre',
  alcool: 'Jeu d’alcool',
  societe: 'Jeu de société',
};

const PALETTE = [
  theme.colors.coral,
  theme.colors.yellow,
  theme.colors.teal,
  theme.colors.violet,
  theme.colors.pink,
];
const SPIN_MS = 5200;
const TURNS = 6;

function wedgeColor(i: number, n: number) {
  // Le dernier secteur touche le premier : jamais deux fois la même couleur côte à côte
  if (i === n - 1 && n % PALETTE.length === 1) return PALETTE[2];
  return PALETTE[i % PALETTE.length];
}

const WHEEL_MARGIN = theme.s(5); // = styles.wheelZone.marginTop
const WHEEL_EXTRA = 28; // place du pointeur au-dessus de la roue
const ACTIONS_MARGIN = theme.s(6); // = styles.actions.marginTop

export default function RouletteScreen() {
  const { width } = useWindowDimensions();
  // Hauteurs mesurées : la roue rétrécit pour que l'écran tienne sans défiler
  const [viewH, setViewH] = useState(0);
  const [topH, setTopH] = useState(0);
  const [actionsH, setActionsH] = useState(0);
  const fit =
    viewH && topH && actionsH ? viewH - topH - actionsH - WHEEL_MARGIN - WHEEL_EXTRA - theme.s(4) /* paddingBottom du ScrollView */ : Infinity;
  const size = Math.round(Math.max(220, Math.min(width - theme.s(10), 360, fit)));
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
  const lastTick = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  const rotation = useSharedValue(0);
  const pointerTilt = useSharedValue(0);
  // Vrai seulement pendant un lancer : la remise de l'angle à [0, 360) ne doit pas « cliquer »
  const live = useSharedValue(false);
  // Un rechargement pendant un lancer décalerait les secteurs sous le pointeur :
  // la nouvelle liste attend la fin du lancer
  const spinningRef = useRef(false);
  const pendingAll = useRef<Entry[] | null>(null);

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
      Alert.alert(
        'Chargement impossible',
        'Vérifie ta connexion puis tire vers le bas pour réessayer.',
      );
      return;
    }
    const byLabel = (a: Entry, b: Entry) => a.label.localeCompare(b.label, 'fr');
    const membres: Entry[] = (profRes.data ?? [])
      .filter((p) => !blocked.has(p.id))
      .map((p) => ({
        key: `membres:${p.id}`,
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
        label: j.nom,
        source: 'alcool' as const,
        detail: j.regles,
      }))
      .sort(byLabel);
    const societe: Entry[] = (socRes.data ?? [])
      .filter((j) => !!j.nom)
      .map((j) => ({
        key: `societe:${j.id}`,
        label: j.nom,
        source: 'societe' as const,
        detail: j.regles,
      }))
      .sort(byLabel);
    const next = [...membres, ...alcool, ...societe];
    if (spinningRef.current) pendingAll.current = next;
    else setAll(next);
    setLoading(false);
  }, []);

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
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={theme.colors.teal} />
      </SafeAreaView>
    );
  }

  const fontSize = n <= 8 ? 15 : n <= 16 ? 12 : n <= 30 ? 10 : 8;
  // Demi-largeur du triangle qui dessine un secteur (débord rogné par le cercle)
  const half = n >= 3 ? radius * Math.tan(Math.PI / n + 0.01) : radius;
  const pickable = all.filter((e) => sources.has(e.source));
  const q = search.trim().toLocaleLowerCase('fr');
  const shown = q ? pickable.filter((e) => e.label.toLocaleLowerCase('fr').includes(q)) : pickable;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        contentContainerStyle={{ paddingBottom: theme.s(4) }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.teal}
            enabled={!spinning}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View onLayout={(e) => setTopH(e.nativeEvent.layout.height)}>
        <View style={styles.heroBlock}>
          <Text style={styles.heroLabel}>Les Artistes</Text>
          <Text style={styles.heroTitle}>Roulette</Text>
          <Text style={styles.heroSub}>Qui s’y colle, à quoi on joue : la roue décide.</Text>
        </View>

        <View style={styles.chips}>
          {SOURCES.map((s) => {
            const on = sources.has(s.id);
            return (
              <Pressable
                key={s.id}
                onPress={() => toggleSource(s.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Ionicons
                  name={s.icon}
                  size={15}
                  color={on ? theme.colors.deep : theme.colors.muted}
                />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={() => setPicking(true)}
          disabled={spinning}
          accessibilityRole="button"
          style={({ pressed }) => [styles.pickCard, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="options-outline" size={20} color={theme.colors.teal} />
          <View style={{ flex: 1 }}>
            <Text style={styles.pickTitle}>
              {n} sur {pickable.length} dans la roue
            </Text>
            <Text style={styles.pickSub}>Choisir un par un</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.muted} />
        </Pressable>
        </View>

        {/* Cachée jusqu'aux mesures : sinon elle s'affiche à 360 puis rétrécit */}
        <View style={[styles.wheelZone, { height: size + WHEEL_EXTRA, opacity: fit === Infinity ? 0 : 1 }]}>
          <View
            style={[
              styles.wheelShadow,
              { width: size, height: size, borderRadius: radius, top: 20 },
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
                  style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.surface2 }]}
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
              { top: 20 + radius - 34 },
              pressed && { transform: [{ scale: 0.94 }] },
            ]}
          >
            <Ionicons
              name={spinning ? 'hourglass' : 'sparkles'}
              size={26}
              color={theme.colors.deep}
            />
          </Pressable>

          <Animated.View style={[styles.pointerWrap, pointerStyle]} pointerEvents="none">
            <View style={styles.pointer} />
          </Animated.View>
        </View>

        <View style={styles.actions} onLayout={(e) => setActionsH(e.nativeEvent.layout.height + ACTIONS_MARGIN)}>
          <Pressable
            onPress={spin}
            disabled={spinning || n < 2}
            style={({ pressed }) => [
              styles.spinBtn,
              (spinning || n < 2) && { opacity: 0.5 },
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            <Text style={styles.spinText}>{spinning ? 'Ça tourne…' : 'Lancer la roue'}</Text>
          </Pressable>
          {/* Place toujours réservée : la roue ne change pas de taille quand l'indice apparaît */}
          <Text style={[styles.hint, n >= 2 && { opacity: 0 }]} accessibilityElementsHidden={n >= 2}
            importantForAccessibility={n >= 2 ? 'no-hide-descendants' : 'auto'}>
            Il faut au moins deux choix dans la roue.
          </Text>
        </View>

        {!!winner && (
          <View
            // La carte tombe sous la roue : on fait défiler jusqu'à elle
            onLayout={(e) =>
              scrollRef.current?.scrollTo({
                y: Math.max(0, e.nativeEvent.layout.y - theme.s(40)),
                animated: true,
              })
            }
          >
            <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.result}>
              <Text style={styles.resultKind}>{SOURCE_LABEL[winner.source]}</Text>
              <Text style={styles.resultName}>{winner.label}</Text>
              {!!winner.detail && (
                <Text style={styles.resultDetail} numberOfLines={5}>
                  {winner.detail}
                </Text>
              )}
              <View style={styles.resultActions}>
                <Pressable
                  onPress={() => toggleEntry(winner.key)}
                  style={({ pressed }) => [styles.resultBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="remove-circle-outline" size={16} color={theme.colors.text} />
                  <Text style={styles.resultBtnText}>Retirer de la roue</Text>
                </Pressable>
                <Pressable
                  onPress={spin}
                  style={({ pressed }) => [styles.resultBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="refresh" size={16} color={theme.colors.text} />
                  <Text style={styles.resultBtnText}>Relancer</Text>
                </Pressable>
              </View>
            </Animated.View>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={picking}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => closePicker()}
      >
        <SafeAreaView style={styles.flex}>
          <View style={styles.modalHeader}>
            <Pressable
              onPress={() => closePicker()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
            >
              <Ionicons name="close" size={26} color={theme.colors.text} />
            </Pressable>
            <Text style={styles.modalTitle}>Dans la roue</Text>
            <View style={{ width: 26 }} />
          </View>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={17} color={theme.colors.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Rechercher"
              placeholderTextColor={theme.colors.muted}
              style={styles.searchInput}
              autoCorrect={false}
            />
            {!!search && (
              <Pressable onPress={() => setSearch('')} hitSlop={10} accessibilityLabel="Effacer">
                <Ionicons name="close-circle" size={18} color={theme.colors.muted} />
              </Pressable>
            )}
          </View>
          {/* Android : la fenêtre de la Modal se rétrécit sous le clavier, KeyboardAware n'ajoute que le reste */}
          <KeyboardAware style={styles.flex}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{
                padding: theme.s(4),
                paddingBottom: theme.s(10),
              }}
            >
              {SOURCES.filter((s) => sources.has(s.id)).map((s) => {
                const group = pickable.filter((e) => e.source === s.id);
                const list = shown.filter((e) => e.source === s.id);
                const onCount = group.filter((e) => !excluded.has(e.key)).length;
                return (
                  <View key={s.id} style={{ marginBottom: theme.s(5) }}>
                    <View style={styles.groupHead}>
                      <Text style={styles.groupLabel}>
                        {s.label} · {onCount}/{group.length}
                      </Text>
                      <View style={styles.groupBulk}>
                        <Pressable onPress={() => setGroupIncluded(s.id, true)} hitSlop={8}>
                          <Text style={styles.bulkText}>Tout</Text>
                        </Pressable>
                        <Pressable onPress={() => setGroupIncluded(s.id, false)} hitSlop={8}>
                          <Text style={styles.bulkText}>Aucun</Text>
                        </Pressable>
                      </View>
                    </View>
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
                          style={({ pressed }) => [styles.pickRow, pressed && { opacity: 0.7 }]}
                        >
                          <Ionicons
                            name={on ? 'checkbox' : 'square-outline'}
                            size={22}
                            color={on ? theme.colors.teal : theme.colors.muted}
                          />
                          <Text style={[styles.pickRowText, !on && { color: theme.colors.muted }]}>
                            {e.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.modalFooter}>
              <Pressable
                onPress={() => closePicker()}
                style={({ pressed }) => [styles.spinBtn, pressed && { transform: [{ scale: 0.97 }] }]}
              >
                <Text style={styles.spinText}>
                  {n < 2 ? 'Coche au moins deux choix' : `C’est bon · ${n} dans la roue`}
                </Text>
              </Pressable>
            </View>
          </KeyboardAware>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.deep,
  },
  heroBlock: {
    paddingHorizontal: theme.s(5),
    paddingTop: theme.s(6),
    paddingBottom: theme.s(2),
  },
  heroLabel: {
    color: theme.colors.coral,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  heroTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 38,
  },
  heroSub: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.body,
    fontSize: 14,
    marginTop: 6,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: theme.s(5),
    marginTop: theme.s(4),
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipOn: {
    backgroundColor: theme.colors.yellow,
    borderColor: theme.colors.yellow,
  },
  chipText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 13,
  },
  chipTextOn: { color: theme.colors.deep },
  wheelZone: { marginTop: WHEEL_MARGIN, alignItems: 'center' },
  wheelShadow: {
    position: 'absolute',
    shadowColor: theme.colors.violet,
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
    backgroundColor: theme.colors.deep,
  },
  wheel: { overflow: 'hidden', backgroundColor: theme.colors.deep },
  rim: { borderWidth: 6, borderColor: '#fff' },
  wedgeLabel: {
    position: 'absolute',
    height: 22,
    lineHeight: 22,
    color: theme.colors.deep,
    fontFamily: theme.fonts.bodyBold,
    textAlign: 'center',
    transform: [{ rotate: '90deg' }],
  },
  hub: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#fff',
    borderWidth: 4,
    borderColor: theme.colors.deep,
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
    borderLeftWidth: 15,
    borderRightWidth: 15,
    borderTopWidth: 34,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#fff',
  },
  actions: {
    alignItems: 'center',
    marginTop: ACTIONS_MARGIN,
    paddingHorizontal: theme.s(5),
  },
  spinBtn: {
    alignSelf: 'stretch',
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
  },
  spinText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 17 },
  pickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: theme.s(5),
    marginTop: theme.s(3),
    paddingHorizontal: theme.s(4),
    paddingVertical: theme.s(3),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  pickTitle: { color: theme.colors.text, fontFamily: theme.fonts.bodyBold, fontSize: 15 },
  pickSub: { color: theme.colors.muted, fontFamily: theme.fonts.body, fontSize: 13, marginTop: 2 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: theme.s(4),
    marginTop: theme.s(3),
    paddingHorizontal: theme.s(3),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    fontSize: 15,
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.s(2),
  },
  groupBulk: { flexDirection: 'row', gap: theme.s(4) },
  modalFooter: {
    paddingHorizontal: theme.s(4),
    paddingTop: theme.s(3),
    paddingBottom: theme.s(2),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  hint: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.body,
    fontSize: 13,
    marginTop: theme.s(2),
  },
  result: {
    marginTop: theme.s(6),
    marginHorizontal: theme.s(5),
    padding: theme.s(5),
    borderRadius: theme.radius.xl,
    borderWidth: 2,
    borderColor: theme.colors.yellow,
    backgroundColor: theme.colors.cardBg,
    alignItems: 'center',
  },
  resultKind: {
    color: theme.colors.yellow,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  resultName: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serifBlack,
    fontSize: 32,
    textAlign: 'center',
    marginTop: 6,
  },
  resultDetail: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: theme.s(3),
  },
  resultActions: { flexDirection: 'row', gap: 10, marginTop: theme.s(5) },
  resultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  resultBtnText: {
    color: theme.colors.text,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 13,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.s(4),
    paddingVertical: theme.s(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.serif,
    fontSize: 18,
  },
  bulkText: {
    color: theme.colors.teal,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 14,
  },
  groupLabel: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  pickRowText: {
    color: theme.colors.text,
    fontFamily: theme.fonts.body,
    fontSize: 15,
    flex: 1,
  },
});
