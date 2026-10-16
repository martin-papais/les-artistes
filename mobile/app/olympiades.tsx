import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ErrorBoundaryProps } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  type LayoutChangeEvent,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { decorWidth, Verre3D } from '@/components/olympiades/Verre3D';
import { VerreDecor, yearColor } from '@/components/olympiades/VerreDecor';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  ListRow,
  ScreenHeader,
  SectionTitle,
  type FeatherName,
} from '@/components/ui/kit';
import {
  championOf,
  colorHex,
  computeYear,
  fetchOlympiades,
  loadCachedOlympiades,
  type Edition,
  type Olympiades,
  type RankedTeam,
  verreArt,
} from '@/lib/olympiades';
import { theme } from '@/lib/theme';

type Tab = 'classement' | 'epreuves' | 'equipes' | 'journee' | 'photos';

const SPIN = 28; // degrés par seconde, au repos
// Ecocup « Eco 30 » : bord Ø 7,4 cm, fond Ø 4,8, hauteur 11,8
const TAPER = 0.65;
const TALL = 1.59;
// Le vrai verre 3D demande le moteur OpenGL de l'appli : une version installée avant
// son arrivée garde le verre en bandes (la mise à jour à distance ne l'ajoute pas)
const VerreGL: typeof import('@/components/olympiades/VerreGL').VerreGL | null = requireOptionalNativeModule(
  'ExponentGLObjectManager',
)
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/components/olympiades/VerreGL').VerreGL
  : null;
// Plastique dépoli : on voit l'encre noire, comme sur le vrai verre
const FROST = 'rgba(226,228,240,0.38)';
const c = theme.colors;
const f = theme.fonts;

// Une donnée inattendue sur le site ne doit pas fermer l'appli
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.flex}>
      <ScreenHeader back title="Olympiades" />
      <EmptyState
        icon="alert-triangle"
        title="Les Olympiades n’ont pas pu s’afficher"
        action={<Button label="Réessayer" onPress={retry} height={48} />}
      />
    </View>
  );
}

function tabsOf(d: Edition): { key: Tab; label: string }[] {
  const tabs: { key: Tab; label: string }[] = [];
  if (!d.legacy) tabs.push({ key: 'classement', label: 'Classement' });
  tabs.push({ key: 'epreuves', label: 'Épreuves' }, { key: 'equipes', label: 'Équipes' }, { key: 'journee', label: 'Journée' });
  if (d.photos?.length) tabs.push({ key: 'photos', label: 'Photos' });
  return tabs;
}

export default function OlympiadesScreen() {
  const [data, setData] = useState<Olympiades | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [year, setYear] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('classement');
  const [viewer, setViewer] = useState<number | null>(null);
  // Le verre ne s'anime que s'il est à l'écran
  const [heroVisible, setHeroVisible] = useState(true);
  const [tabsY, setTabsY] = useState(0);
  const scrollY = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();

  const load = useCallback(async () => {
    try {
      const fresh = await fetchOlympiades();
      setData(fresh);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    loadCachedOlympiades().then((cached) => {
      if (cached) setData((cur) => cur ?? cached);
    });
    load();
  }, [load]);

  const years = useMemo(() => Object.keys(data ?? {}).sort(), [data]);
  const current = year && data?.[year] ? year : years[years.length - 1];
  const edition = current ? data?.[current] : undefined;
  const tabs = edition ? tabsOf(edition) : [];
  // Un onglet absent de l'édition (classement d'une archive) retombe sur le premier
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function pick(y: string) {
    if (y === current) return;
    Haptics.selectionAsync().catch(() => {});
    setYear(y);
    setViewer(null);
  }

  function chooseTab(t: Tab) {
    Haptics.selectionAsync().catch(() => {});
    if (t === activeTab) return;
    setTab(t);
    // La page ne bouge pas, sauf si on était plus bas que les onglets :
    // on revient alors au début du nouvel onglet, onglets collés en haut
    if (tabsY > 0 && scrollY.current > tabsY) scrollRef.current?.scrollTo({ y: tabsY, animated: false });
  }

  function onScroll(ev: NativeSyntheticEvent<NativeScrollEvent>) {
    scrollY.current = ev.nativeEvent.contentOffset.y;
    const visible = scrollY.current < tabsY;
    if (visible !== heroVisible) setHeroVisible(visible);
  }

  if (!data || !current || !edition) {
    return (
      <View style={styles.flex}>
        <ScreenHeader back title="Olympiades" />
        {failed ? (
          <EmptyState
            icon="wifi-off"
            title="Impossible de charger les Olympiades"
            text="Vérifie ta connexion, puis réessaie."
            action={<Button label="Réessayer" onPress={load} height={48} />}
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={c.teal} />
          </View>
        )}
      </View>
    );
  }

  const n = years.length;
  return (
    // Bande sombre sous la barre d'état : les onglets collés s'arrêtent dessous
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        onScroll={onScroll}
        scrollEventThrottle={64}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
      >
        {/* La hauteur de ce bloc donne la position des onglets (une vue collante mesure 0 elle-même) */}
        <View onLayout={(e: LayoutChangeEvent) => setTabsY(e.nativeEvent.layout.height)}>
          <ScreenHeader
            back
            title="Olympiades"
            sub={`${n} édition${n > 1 ? 's' : ''} depuis ${years[0]}`}
            // La marge de l'encoche est déjà prise par la vue parente
            style={{ paddingTop: 4 }}
          />
          {failed && (
            <View style={styles.offline}>
              <Icon name="wifi-off" size={18} color={c.muted} />
              <Text style={styles.offlineText}>Hors connexion : dernières données enregistrées.</Text>
            </View>
          )}
          <Hero year={current} edition={edition} active={heroVisible && viewer === null} />
          <Shelf years={years} data={data} current={current} onPick={pick} />
        </View>

        <View style={styles.tabsBar} accessibilityRole="tablist">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {tabs.map((t) => (
              <Chip key={t.key} label={t.label} active={t.key === activeTab} onPress={() => chooseTab(t.key)} style={styles.tab} />
            ))}
          </ScrollView>
        </View>

        {/* Hauteur minimale : un onglet court ne fait pas remonter la page */}
        <View style={[styles.content, { minHeight: windowH }]}>
          {activeTab === 'classement' && <Classement d={edition} />}
          {activeTab === 'epreuves' && <Epreuves d={edition} />}
          {activeTab === 'equipes' && <Equipes d={edition} />}
          {activeTab === 'journee' && <Journee d={edition} />}
          {activeTab === 'photos' && <Photos d={edition} onPhoto={setViewer} />}
          <Palmares
            years={years}
            data={data}
            current={current}
            onPick={(y) => {
              pick(y);
              scrollRef.current?.scrollTo({ y: 0, animated: true });
            }}
          />
        </View>
      </ScrollView>
      <PhotoViewer photos={edition.photos ?? []} index={viewer} onClose={() => setViewer(null)} />
    </View>
  );
}

// ─── Verre en vitrine : tourne seul, et se fait tourner du doigt ───

function Hero({ year, edition, active }: { year: string; edition: Edition; active: boolean }) {
  const { width: screenW } = useWindowDimensions();
  const W = Math.min(180, screenW * 0.42);
  const H = W * TALL;
  const T = decorWidth(W, TAPER);
  const rotation = useSharedValue(0);
  const velocity = useSharedValue(SPIN);
  const dragging = useSharedValue(false);
  const reduced = useReducedMotion();
  const rest = reduced ? 0 : SPIN;

  const frame = useFrameCallback((fr) => {
    if (dragging.get()) return;
    const v = velocity.get();
    // Animations réduites : rien à écrire une fois le verre arrêté
    if (rest === 0 && Math.abs(v) < 0.5) return;
    const dt = Math.min(0.05, (fr.timeSincePreviousFrame ?? 16) / 1000);
    // La vitesse revient doucement à la rotation de repos
    const next = v + (rest - v) * Math.min(1, dt * 1.8);
    velocity.set(next);
    rotation.set((rotation.get() + next * dt) % 360);
  }, false);

  useEffect(() => {
    frame.setActive(active);
  }, [active, frame]);

  // Un tour rapide quand on change d'année
  const firstYear = useRef(year);
  useEffect(() => {
    if (year !== firstYear.current && !reduced) velocity.set(720);
    firstYear.current = year;
  }, [year, reduced, velocity]);

  // Valeur partagée plutôt qu'une ref : le React Compiler refuse une ref lue dans useMemo
  const lastDx = useSharedValue(0);
  const hint = useSharedValue(1);
  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.get() * 0.8 }));
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragging.set(true);
          lastDx.set(0);
          // Le geste est compris : la consigne s'efface
          hint.set(withTiming(0, { duration: 400 }));
        },
        onPanResponderMove: (_, g) => {
          // La surface suit le doigt : 1 px de glissé = 1 px de décor
          rotation.set((rotation.get() + ((g.dx - lastDx.get()) * 360) / T) % 360);
          lastDx.set(g.dx);
        },
        onPanResponderRelease: (_, g) => {
          velocity.set(Math.max(-1440, Math.min(1440, (g.vx * 1000 * 360) / T)));
          dragging.set(false);
        },
        onPanResponderTerminate: () => {
          dragging.set(false);
        },
      }),
    [T, dragging, hint, lastDx, rotation, velocity],
  );

  // Lecteur d'écran : glisser vers le haut ou le bas fait tourner le verre
  function onA11y(e: { nativeEvent: { actionName: string } }) {
    const step = e.nativeEvent.actionName === 'increment' ? 45 : -45;
    rotation.set((rotation.get() + step) % 360);
  }

  const accent = yearColor(year);
  const art = verreArt(year, edition);
  const champion = edition.legacy ? null : computeYear(edition).ranked[0];
  return (
    <Card style={styles.hero}>
      {/* Vitrine : lueur de la couleur de l'année, faisceau venu d'en haut, socle éclairé */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Image
          source={HALO}
          contentFit="fill"
          tintColor={accent}
          style={[styles.backdrop, { width: W * 2.8, height: W * 2.8, top: HERO_TOP + H * 0.5 - W * 1.4, opacity: 0.32 }]}
        />
        <Image source={FAISCEAU} contentFit="fill" style={[styles.backdrop, { width: W * 1.9, height: HERO_TOP + H + W * 0.1, top: 0, opacity: 0.16 }]} />
        <Image
          source={HALO}
          contentFit="fill"
          tintColor={accent}
          style={[styles.backdrop, { width: W * 1.9, height: W * 0.5, top: HERO_TOP + H + FOOT - W * 0.25, opacity: 0.55 }]}
        />
        <Image
          source={SOCLE}
          contentFit="fill"
          style={[styles.backdrop, { width: W * 1.2, height: W * 0.36, top: HERO_TOP + H + FOOT - W * 0.18, opacity: 0.9 }]}
        />
      </View>
      <View
        {...pan.panHandlers}
        style={styles.stage}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Verre des Olympiades ${year}`}
        accessibilityHint="Glisse vers la gauche ou la droite pour le faire tourner"
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onA11y}
      >
        {art !== undefined && VerreGL ? (
          // Vue plus large que le verre : la perspective déborde un peu
          <View style={{ marginHorizontal: -W * 0.25, marginVertical: -H * 0.165 }}>
            <VerreGL key={year} width={W * 1.5} height={H * 1.33} rotation={rotation} art={art} active={active} />
          </View>
        ) : (
          <Verre3D
            width={W}
            height={H}
            rotation={rotation}
            art={art}
            strips={48}
            backStrips={24}
            taper={TAPER}
            tint={FROST}
          >
            <VerreDecor year={year} edition={edition} width={T / Math.PI} />
          </Verre3D>
        )}
      </View>

      {/* La place reste réservée quand la consigne s'efface : rien ne saute dessous */}
      <Animated.View
        style={[styles.hint, { marginTop: FOOT + W * 0.18 + 10 }, hintStyle]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Icon name="rotate-cw" size={12} color={c.muted} />
        <Text style={styles.hintText}>Glisse pour tourner</Text>
      </Animated.View>
      <Text style={[styles.heroKicker, { color: accent }]}>Édition</Text>
      <Text style={styles.heroYear} accessibilityRole="header">
        {year}
      </Text>
      <Text style={styles.heroPlace}>
        {edition.date}, {edition.lieu.charAt(0).toLowerCase() + edition.lieu.slice(1)}
      </Text>

      <View style={styles.winner}>
        <Icon name="award" size={18} color={c.yellow} />
        {champion ? (
          <>
            <View style={[styles.dot, { backgroundColor: colorHex(champion.couleur) }]} />
            <Text style={styles.winnerText} numberOfLines={1}>
              {champion.nom}
            </Text>
            <Text style={styles.winnerPts}>{champion.totalPoints} pts</Text>
          </>
        ) : (
          <Text style={styles.winnerText} numberOfLines={2}>
            {championOf(edition)}
          </Text>
        )}
      </View>
    </Card>
  );
}

// ─── Étagère : un petit verre par édition, pour choisir l'année ───

function Shelf({
  years,
  data,
  current,
  onPick,
}: {
  years: string[];
  data: Olympiades;
  current: string;
  onPick: (y: string) => void;
}) {
  const still = useSharedValue(-24);
  const W = 46;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
      {years.map((y) => {
        const on = y === current;
        const art = verreArt(y, data[y]);
        return (
          <Pressable
            key={y}
            onPress={() => onPick(y)}
            style={({ pressed }) => [styles.shelfItem, on && { backgroundColor: c.card }, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Olympiades ${y}`}
          >
            <View style={{ opacity: on ? 1 : 0.45 }}>
              {art !== undefined && VerreGL ? (
                // Même rendu que la vitrine, figé : une seule image, pas d'animation
                <View style={{ marginHorizontal: -W * 0.25, marginVertical: -W * TALL * 0.165 }}>
                  <VerreGL width={W * 1.5} height={W * TALL * 1.33} rotation={still} art={art} active={false} />
                </View>
              ) : (
                <Verre3D width={W} height={W * TALL} rotation={still} art={art} strips={12} taper={TAPER} tint={FROST}>
                  <VerreDecor year={y} edition={data[y]} width={decorWidth(W, TAPER) / Math.PI} />
                </Verre3D>
              )}
            </View>
            <Text style={[styles.shelfYear, on && { color: c.text }]}>{y}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ─── Briques de mise en page ───

function Heading({ children, count }: { children: string; count?: number }) {
  return (
    <SectionTitle count={count} style={styles.heading}>
      {children}
    </SectionTitle>
  );
}

/** Long texte replié sur quelques lignes */
function Reading({ text, lines = 5 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280;
  return (
    <View>
      <Text style={styles.body} numberOfLines={long && !open ? lines : undefined}>
        {text}
      </Text>
      {long && (
        <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" style={styles.more}>
          <Text style={styles.moreText}>{open ? 'Réduire' : 'Lire la suite'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function TeamName({ t, style }: { t?: RankedTeam; style?: object }) {
  if (!t) return null;
  return (
    <View style={styles.teamInline}>
      <View style={[styles.dot, { backgroundColor: colorHex(t.couleur) }]} />
      <Text style={[styles.teamInlineText, style]} numberOfLines={1}>
        {t.nom}
      </Text>
    </View>
  );
}

function IconLine({ icon, children }: { icon: FeatherName; children: React.ReactNode }) {
  return (
    <View style={styles.iconLine}>
      <View style={styles.iconBox}>
        <Icon name={icon} size={20} color={c.text} />
      </View>
      <Text style={[styles.body, { flex: 1 }]}>{children}</Text>
    </View>
  );
}

// ─── Onglet Classement ───

function Classement({ d }: { d: Edition }) {
  const { ranked } = computeYear(d);
  const byId = Object.fromEntries(ranked.map((t) => [t.id, t]));
  const max = Math.max(1, ...ranked.map((t) => t.totalPoints));
  return (
    <View>
      {ranked.map((t) => {
        const first = t.classement === 1;
        return (
          <Card key={t.id} style={styles.rankCard}>
            <Text style={[styles.rankPos, first && { color: c.yellow }]}>{t.classement}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.rankHead}>
                <Text style={[styles.rankName, first && { fontSize: 18 }]} numberOfLines={1}>
                  {t.nom}
                </Text>
                <Text style={styles.rankPts}>
                  {t.totalPoints}
                  <Text style={styles.rankUnit}> pts</Text>
                </Text>
              </View>
              <View style={styles.barTrack}>
                <View
                  style={[styles.bar, { width: `${(Math.max(0, t.totalPoints) / max) * 100}%`, backgroundColor: colorHex(t.couleur) }]}
                />
              </View>
              {!!t.capitaine && <Text style={styles.small}>Capitaine : {t.capitaine}</Text>}
            </View>
          </Card>
        );
      })}

      {!!d.extras?.length && (
        <>
          <Heading count={d.extras.length}>Bonus et malus</Heading>
          <Card style={styles.listCard}>
            {d.extras.map((ex, i) => (
              <View key={i} style={[styles.adjRow, i > 0 && styles.divider]}>
                <Text style={[styles.adjPts, { color: ex.points > 0 ? c.teal : c.danger }]}>
                  {ex.points > 0 ? '+' : '−'}
                  {Math.abs(ex.points)}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <TeamName t={byId[ex.equipeId]} />
                  <Text style={styles.small}>{ex.motif}</Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}
    </View>
  );
}

// ─── Onglet Épreuves ───

function Epreuves({ d }: { d: Edition }) {
  const { ranked, winners } = useMemo(() => computeYear(d), [d]);
  const byId = Object.fromEntries(ranked.map((t) => [t.id, t]));
  const [open, setOpen] = useState<number | null>(null);

  return (
    <View>
      {!d.legacy && (
        <View style={styles.legend}>
          {ranked.map((t) => (
            <TeamName key={t.id} t={t} style={styles.legendText} />
          ))}
        </View>
      )}
      {d.epreuves.map((ep, i) => {
        const expanded = open === i;
        const total = ranked.reduce((sum, t) => sum + Math.max(0, ep.scores?.[t.id ?? ''] ?? 0), 0);
        return (
          <Pressable
            key={i}
            onPress={() => setOpen(expanded ? null : i)}
            style={({ pressed }) => [styles.epCard, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityHint={expanded ? 'Masquer les règles' : 'Afficher les règles'}
          >
            <View style={styles.epHead}>
              <Text style={styles.epNum}>{ep.num ?? i + 1}</Text>
              <Text style={styles.epName}>{ep.nom}</Text>
              {!!ep.desc && <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={c.muted} />}
            </View>

            {!d.legacy && total > 0 && (
              <>
                {/* Points de l'épreuve : une barre, une part par équipe, dans l'ordre du classement */}
                <View style={styles.split}>
                  {ranked.map((t) => {
                    const v = ep.scores?.[t.id ?? ''] ?? 0;
                    return v > 0 ? (
                      <View key={t.id} style={[styles.splitPart, { flex: v, backgroundColor: colorHex(t.couleur) }]}>
                        <Text style={styles.splitText}>{v}</Text>
                      </View>
                    ) : null;
                  })}
                </View>
                {!!winners[i] && (
                  <View style={styles.epWinner}>
                    <Text style={styles.small}>Gagnée par</Text>
                    <TeamName t={byId[winners[i] ?? '']} style={styles.smallStrong} />
                  </View>
                )}
              </>
            )}
            {expanded && !!ep.desc && <Text style={[styles.body, { marginTop: 12 }]}>{ep.desc}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Onglet Équipes ───

function Equipes({ d }: { d: Edition }) {
  const { ranked } = computeYear(d);
  const byId = Object.fromEntries(ranked.map((t) => [t.id, t]));
  const teams: (RankedTeam | (Edition['teams'][number] & { classement?: number }))[] = d.legacy ? d.teams : ranked;

  return (
    <View>
      {teams.map((t, i) => (
        <Card key={t.id ?? i} style={styles.teamCard}>
          <View style={styles.teamHead}>
            {!d.legacy && <View style={[styles.teamDot, { backgroundColor: colorHex(t.couleur) }]} />}
            <Text style={styles.teamName}>{d.legacy ? `Équipe ${i + 1}` : t.nom}</Text>
            {d.legacy
              ? t.vainqueur && <Badge label="Gagnante" style={{ alignSelf: 'center' }} />
              : <Text style={[styles.teamRank, t.classement === 1 && { color: c.yellow }]}>{t.classement === 1 ? '1er' : `${t.classement}e`}</Text>}
          </View>
          {!!t.capitaine && <Text style={[styles.small, { marginTop: 2 }]}>Capitaine : {t.capitaine}</Text>}
          <Text style={[styles.body, { marginTop: 8 }]}>{t.membres.join(', ')}</Text>
        </Card>
      ))}

      {!!d.absents?.length && (
        <>
          <Heading count={d.absents.length}>Absents et blessés</Heading>
          <Card style={styles.listCard}>
            {d.absents.map((a, i) => (
              <View key={i} style={[styles.adjRow, i > 0 && styles.divider]}>
                <View style={[styles.iconBox, { backgroundColor: c.raised }]}>
                  <Icon
                    name={a.type === 'blessure' ? 'activity' : 'user-x'}
                    size={20}
                    color={a.type === 'blessure' ? c.danger : c.muted}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.absHead}>
                    <Text style={styles.smallStrong}>{a.nom}</Text>
                    {a.equipeId && byId[a.equipeId] && <TeamName t={byId[a.equipeId]} style={styles.small} />}
                  </View>
                  <Text style={styles.small}>{a.raison}</Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}
    </View>
  );
}

// ─── Onglet La journée ───

function Journee({ d }: { d: Edition }) {
  const participants = d.teams.reduce((sum, t) => sum + t.membres.length, 0);
  return (
    <View>
      <Card style={styles.factsCard}>
        {!!d.meteo?.desc && <IconLine icon="thermometer">{d.meteo.desc}</IconLine>}
        <IconLine icon="users">
          {participants} participants, {d.teams.length} équipes, {d.epreuves.length} épreuves
        </IconLine>
      </Card>

      {!!d.resume && (
        <>
          <Heading>L’édition</Heading>
          <Reading text={d.resume} />
        </>
      )}

      {(d.citations ?? []).filter((q) => !!q.text).map((q, i) => (
        <Card key={i} style={styles.quote}>
          <Text style={styles.quoteMark}>“</Text>
          <Text style={styles.quoteText}>{q.text.replace(/^"|"$/g, '')}</Text>
          {!!q.auteur && <Text style={styles.small}>{q.auteur.replace(/^[—–-]\s*/, '')}</Text>}
        </Card>
      ))}

      {!!d.loto?.quines.length && (
        <>
          <Heading>Le loto</Heading>
          {!!d.loto.intro && <Reading text={d.loto.intro} lines={3} />}
          {d.loto.quines.map((q, qi) => (
            <Card key={qi} style={styles.quine}>
              <Text style={styles.quineTitle}>{q.titre}</Text>
              {q.lignes.map((l, i) => (
                <View key={i} style={[styles.quineRow, i > 0 && styles.divider]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.small}>{l.type}</Text>
                    <Text style={styles.smallStrong}>{l.nom}</Text>
                    {!!l.contenu && <Text style={styles.small}>{l.contenu}</Text>}
                  </View>
                  <Text style={styles.quineWinner}>{l.gagnant}</Text>
                </View>
              ))}
            </Card>
          ))}
          {!!d.superQuine && (
            <Card style={styles.quine}>
              <Badge label="Super Quine" style={{ marginBottom: 6 }} />
              <View style={styles.quineRow}>
                <Text style={[styles.smallStrong, { flex: 1 }]}>{d.superQuine.lot}</Text>
                <Text style={styles.quineWinner}>{d.superQuine.gagnant}</Text>
              </View>
            </Card>
          )}
        </>
      )}

      {!!d.bbq && (
        <>
          <Heading>Le barbecue</Heading>
          <Reading text={d.bbq} lines={4} />
        </>
      )}
      {!!d.repas && (
        <>
          <Heading>L’auberge espagnole</Heading>
          <Reading text={d.repas} lines={4} />
        </>
      )}
      {!!d.anecdote && (
        <>
          <Heading>À retenir</Heading>
          <Reading text={d.anecdote} />
        </>
      )}
    </View>
  );
}

// ─── Onglet Photos ───

const GAP = 4;

function Photos({ d, onPhoto }: { d: Edition; onPhoto: (i: number) => void }) {
  const { width } = useWindowDimensions();
  // Arrondi : une largeur fractionnaire renvoie la 3e vignette à la ligne sur Android
  const size = Math.floor((width - theme.gutter * 2 - GAP * 2) / 3);
  return (
    <View style={styles.grid}>
      {(d.photos ?? []).map((p, i) => (
        <Pressable
          key={`${i}-${p.url}`}
          onPress={() => onPhoto(i)}
          accessibilityRole="imagebutton"
          accessibilityLabel={p.caption ? `Ouvrir la photo ${p.caption}` : `Photo ${i + 1}`}
          style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
        >
          <Image source={{ uri: p.url }} style={{ width: size, height: size }} contentFit="cover" transition={150} />
        </Pressable>
      ))}
    </View>
  );
}

// ─── Palmarès, sous chaque onglet ───

function Palmares({
  years,
  data,
  current,
  onPick,
}: {
  years: string[];
  data: Olympiades;
  current: string;
  onPick: (y: string) => void;
}) {
  return (
    <View>
      <Heading>Palmarès</Heading>
      {[...years].reverse().map((y) => {
        const d = data[y];
        const on = y === current;
        return (
          <ListRow
            key={y}
            onPress={() => onPick(y)}
            left={<Text style={[styles.palmaYear, { color: on ? yearColor(y) : c.text }]}>{y}</Text>}
            title={championOf(d, 'palmares')}
            sub={d.lieu}
            right={on ? <Badge label="Affichée" color={c.rail} textColor={c.text} /> : undefined}
            style={styles.palmaRow}
          />
        );
      })}
    </View>
  );
}

// ─── Photos en plein écran, on passe de l'une à l'autre en glissant ───

const DARK = 'rgba(0,0,0,0.45)';

function PhotoViewer({
  photos,
  index,
  onClose,
}: {
  photos: { url: string; caption?: string }[];
  index: number | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={index !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={['portrait']}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {index !== null && <ViewerBody photos={photos} start={index} onClose={onClose} />}
    </Modal>
  );
}

function ViewerBody({ photos, start, onClose }: { photos: { url: string; caption?: string }[]; start: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [shown, setShown] = useState(start);
  const caption = photos[shown]?.caption;
  return (
    <View style={styles.viewer}>
      <FlatList
        // Filet de sécurité : initialScrollIndex est ignoré sur le web
        ref={(list) => list?.scrollToOffset({ offset: start * width, animated: false })}
        data={photos}
        horizontal
        pagingEnabled
        initialScrollIndex={start}
        // Sans ça, la photo 0 s'affiche une frame avant le saut
        contentOffset={{ x: start * width, y: 0 }}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(p, i) => `${i}-${p.url}`}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setShown(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <Image source={{ uri: item.url }} style={{ width, height }} contentFit="contain" />}
      />
      <View style={[styles.viewerBar, { top: insets.top + 8 }]}>
        {photos.length > 1 ? (
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {shown + 1} / {photos.length}
            </Text>
          </View>
        ) : (
          <View />
        )}
        <IconButton name="x" label="Fermer" onPress={onClose} bg={DARK} color="#fff" />
      </View>
      {!!caption && (
        <View style={[styles.caption, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.captionText}>{caption}</Text>
        </View>
      )}
    </View>
  );
}

const HERO_TOP = 20;
// Le pied du verre est un peu sous le bas de sa boîte (perspective)
const FOOT = 14;
const HALO = require('@/assets/olympiades/halo.png');
const FAISCEAU = require('@/assets/olympiades/faisceau.png');
const SOCLE = require('@/assets/olympiades/socle.png');

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: theme.gutter,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: c.card,
  },
  offlineText: { flex: 1, color: c.muted, fontFamily: f.bodyBold, fontSize: 14, lineHeight: 19 },

  // Vitrine
  hero: {
    marginHorizontal: theme.gutter,
    marginTop: 18,
    alignItems: 'center',
    paddingTop: HERO_TOP,
    paddingBottom: 20,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  backdrop: { position: 'absolute', alignSelf: 'center' },
  stage: { paddingHorizontal: 48 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintText: { color: c.muted, fontFamily: f.body, fontSize: 12 },
  heroKicker: { fontFamily: f.bodyBold, fontSize: 12, letterSpacing: 3, textTransform: 'uppercase', marginTop: 10 },
  heroYear: { color: c.text, fontFamily: f.serifBlack, fontSize: 44, lineHeight: 50, letterSpacing: -0.5 },
  heroPlace: { color: c.muted, fontFamily: f.body, fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 2 },
  winner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: c.raised,
    maxWidth: '100%',
  },
  winnerText: { color: c.text, fontFamily: f.bodyBold, fontSize: 15, flexShrink: 1 },
  winnerPts: { color: c.yellow, fontFamily: f.bodyBold, fontSize: 14 },

  // Étagère
  shelf: { flexGrow: 1, justifyContent: 'center', gap: 6, paddingHorizontal: theme.gutter, paddingTop: 12 },
  shelfItem: { alignItems: 'center', paddingTop: 10, paddingBottom: 8, paddingHorizontal: 12, borderRadius: 18 },
  shelfYear: { color: c.muted, fontFamily: f.bodyBold, fontSize: 13, marginTop: 6 },

  // Onglets collés en haut
  tabsBar: { backgroundColor: c.deep, paddingVertical: 12 },
  tabs: { paddingHorizontal: theme.gutter, gap: 8 },
  tab: { height: 44, borderRadius: 22 },

  content: { paddingHorizontal: theme.gutter, paddingTop: 4 },
  heading: { marginTop: 24, marginBottom: 10 },
  body: { color: c.text, fontFamily: f.body, fontSize: 16, lineHeight: 23 },
  small: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 20 },
  smallStrong: { color: c.text, fontFamily: f.bodyBold, fontSize: 14, lineHeight: 20 },
  more: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  moreText: { color: c.coralSoft, fontFamily: f.bodyBold, fontSize: 15 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  teamInline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  teamInlineText: { color: c.text, fontFamily: f.bodyBold, fontSize: 14, flexShrink: 1 },
  iconLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 14, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' },
  listCard: { paddingHorizontal: 16 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },

  // Classement
  rankCard: { flexDirection: 'row', gap: 14, padding: 16, marginBottom: 10 },
  rankPos: { color: c.muted, fontFamily: f.serifBlack, fontSize: 30, lineHeight: 34, width: 24, textAlign: 'center' },
  rankHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  rankName: { color: c.text, fontFamily: f.bodyBold, fontSize: 16, flexShrink: 1 },
  rankPts: { color: c.text, fontFamily: f.serifBlack, fontSize: 22 },
  rankUnit: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: c.raised, marginTop: 8, marginBottom: 6, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  adjRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  adjPts: { fontFamily: f.serifBlack, fontSize: 20, width: 40 },
  absHead: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },

  // Épreuves
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8, marginBottom: 14 },
  legendText: { color: c.muted, fontFamily: f.bodyMedium, fontSize: 14 },
  epCard: { backgroundColor: c.card, borderRadius: theme.radius.card, padding: 16, marginBottom: 10 },
  epHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 28 },
  epNum: { color: c.muted, fontFamily: f.serifBlack, fontSize: 20, width: 22 },
  epName: { color: c.text, fontFamily: f.bodyBold, fontSize: 16, lineHeight: 21, flex: 1 },
  split: { flexDirection: 'row', height: 24, borderRadius: 8, overflow: 'hidden', marginTop: 12, gap: 2 },
  splitPart: { alignItems: 'center', justifyContent: 'center' },
  splitText: { color: c.ink, fontFamily: f.bodyBold, fontSize: 12 },
  epWinner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },

  // Équipes
  teamCard: { padding: 16, marginBottom: 10 },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teamDot: { width: 14, height: 14, borderRadius: 7 },
  teamName: { color: c.text, fontFamily: f.serif, fontSize: 20, lineHeight: 25, flex: 1 },
  teamRank: { color: c.muted, fontFamily: f.serifBlack, fontSize: 18 },

  // Journée
  factsCard: { padding: 16, gap: 12 },
  quote: { marginTop: 12, padding: 16 },
  quoteMark: { color: c.violet, fontFamily: f.serifBlack, fontSize: 48, lineHeight: 44, height: 30 },
  quoteText: { color: c.text, fontFamily: f.serif, fontSize: 18, lineHeight: 27, marginBottom: 8 },
  quine: { padding: 16, paddingBottom: 6, marginTop: 10 },
  quineTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 16, lineHeight: 21, marginBottom: 4 },
  quineRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'flex-start' },
  quineWinner: { color: c.text, fontFamily: f.bodyBold, fontSize: 14, maxWidth: 110, textAlign: 'right' },

  // Photos
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { backgroundColor: c.card, borderRadius: 10, overflow: 'hidden' },

  // Palmarès
  palmaRow: { marginBottom: 8 },
  palmaYear: { fontFamily: f.serifBlack, fontSize: 22, width: 60 },

  // Visionneuse
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: { paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: DARK, justifyContent: 'center' },
  counterText: { color: '#fff', fontFamily: f.bodyBold, fontSize: 13 },
  caption: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: theme.gutter, paddingTop: 16 },
  captionText: { color: '#fff', fontFamily: f.bodyBold, fontSize: 15, lineHeight: 21, textAlign: 'center' },
});
