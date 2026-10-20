import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ErrorBoundaryProps } from 'expo-router';
import { useRouter } from 'expo-router';
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
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

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

// Une seule page qu'on fait défiler, comme sur le site ; la barre de raccourcis saute à une partie
type Section = 'recit' | 'verre' | 'classement' | 'equipes' | 'epreuves' | 'journee' | 'photos';

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

function sectionsOf(d: Edition, year: string): { key: Section; label: string }[] {
  const s: { key: Section; label: string }[] = [{ key: 'recit', label: 'Récit' }];
  if (verreArt(year, d) !== undefined) s.push({ key: 'verre', label: 'Le verre' });
  if (!d.legacy) s.push({ key: 'classement', label: 'Classement' });
  s.push({ key: 'equipes', label: 'Équipes' }, { key: 'epreuves', label: 'Épreuves' });
  if (d.loto?.quines.length || d.bbq || d.repas || d.anecdote) s.push({ key: 'journee', label: 'Journée' });
  if (d.photos?.length) s.push({ key: 'photos', label: 'Photos' });
  return s;
}

export default function OlympiadesScreen() {
  const [data, setData] = useState<Olympiades | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [year, setYear] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const [section, setSection] = useState<Section>('recit');
  // Le verre ne s'anime que s'il est à l'écran
  const [verreVisible, setVerreVisible] = useState(false);
  // Position de la barre de raccourcis, puis de chaque partie sous elle
  const [barY, setBarY] = useState(0);
  const pos = useRef<Partial<Record<Section, { y: number; h: number }>>>({});
  const scrollRef = useRef<ScrollView>(null);
  // Le raccourci de la partie lue reste visible dans la barre
  const barRef = useRef<ScrollView>(null);
  const chipX = useRef<Partial<Record<Section, number>>>({});
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
  const sections = edition && current ? sectionsOf(edition, current) : [];

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function pick(y: string) {
    if (y === current) return;
    Haptics.selectionAsync().catch(() => {});
    pos.current = {};
    setYear(y);
    setViewer(null);
    setSection('recit');
  }

  function jump(s: Section) {
    Haptics.selectionAsync().catch(() => {});
    const p = pos.current[s];
    if (p) scrollRef.current?.scrollTo({ y: barY + p.y, animated: true });
  }

  const place = (s: Section) => (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    pos.current[s] = { y, h: height };
  };

  function onScroll(ev: NativeSyntheticEvent<NativeScrollEvent>) {
    const top = ev.nativeEvent.contentOffset.y;
    // La partie lue est la dernière dont le titre est passé sous la barre
    let reading: Section = sections[0]?.key ?? 'recit';
    for (const s of sections) {
      const p = pos.current[s.key];
      if (p && barY + p.y <= top + 80) reading = s.key;
    }
    if (reading !== section) {
      setSection(reading);
      barRef.current?.scrollTo({ x: Math.max(0, (chipX.current[reading] ?? 0) - theme.gutter), animated: true });
    }
    const v = pos.current.verre;
    const seen = !!v && barY + v.y < top + windowH && barY + v.y + v.h > top;
    if (seen !== verreVisible) setVerreVisible(seen);
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

  const art = verreArt(current, edition);
  return (
    // Bande sombre sous la barre d'état : les raccourcis collés s'arrêtent dessous
    <GestureHandlerRootView style={[styles.flex, { paddingTop: insets.top }]}>
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        onScroll={onScroll}
        scrollEventThrottle={64}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
      >
        {/* La hauteur de ce bloc donne la position de la barre (une vue collante mesure 0 elle-même) */}
        <View onLayout={(e: LayoutChangeEvent) => setBarY(e.nativeEvent.layout.height)}>
          <Cover key={current} year={current} edition={edition} onPhoto={setViewer} />
          {failed && (
            <View style={styles.offline}>
              <Icon name="wifi-off" size={18} color={c.muted} />
              <Text style={styles.offlineText}>Hors connexion : dernières données enregistrées.</Text>
            </View>
          )}
          <Years years={years} current={current} onPick={pick} />
        </View>

        <View style={styles.bar}>
          <ScrollView ref={barRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.barRow}>
            {sections.map((s) => (
              <View key={s.key} onLayout={(e: LayoutChangeEvent) => (chipX.current[s.key] = e.nativeEvent.layout.x)}>
                <Chip label={s.label} active={s.key === section} onPress={() => jump(s.key)} style={styles.barChip} />
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.content}>
          <View onLayout={place('recit')}>
            <Recit year={current} d={edition} />
          </View>
          {art !== undefined && (
            <View onLayout={place('verre')}>
              <Heading>Le verre de l’édition</Heading>
              <Vitrine year={current} edition={edition} art={art} active={verreVisible && viewer === null} />
            </View>
          )}
          {!edition.legacy && (
            <View onLayout={place('classement')}>
              <Classement d={edition} />
            </View>
          )}
          <View onLayout={place('equipes')}>
            <Equipes d={edition} />
          </View>
          <View onLayout={place('epreuves')}>
            <Epreuves d={edition} />
          </View>
          <View onLayout={place('journee')}>
            <Journee d={edition} />
          </View>
          {!!edition.photos?.length && (
            <View onLayout={place('photos')}>
              <Heading count={edition.photos.length}>Photos</Heading>
              <Photos d={edition} onPhoto={setViewer} />
            </View>
          )}
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
    </GestureHandlerRootView>
  );
}

// ─── En haut : les photos de l'édition, qu'on fait défiler du doigt ───

function Cover({ year, edition, onPhoto }: { year: string; edition: Edition; onPhoto: (i: number) => void }) {
  const { width, height: windowH } = useWindowDimensions();
  const router = useRouter();
  const [shown, setShown] = useState(0);
  const photos = edition.photos ?? [];
  const H = photos.length ? Math.round(Math.min(width * 1.1, windowH * 0.58)) : 280;
  const accent = yearColor(year);
  const champion = edition.legacy ? null : computeYear(edition).ranked[0];

  return (
    <View style={{ width, height: H, backgroundColor: c.card }}>
      {photos.length ? (
        <Carrousel photos={photos} width={width} height={H} shown={shown} onShown={setShown} onPhoto={onPhoto} />
      ) : (
        // Pas de photo : la lueur de l'année tient lieu de fond
        <Image source={HALO} contentFit="fill" tintColor={accent} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} />
      )}

      {/* Le texte reste lisible sur n'importe quelle photo */}
      <View style={[styles.shade, { height: H * 0.62 }]} pointerEvents="none">
        <Image source={OMBRE} contentFit="fill" style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.coverText} pointerEvents="box-none">
        <Text style={[styles.coverKicker, { color: accent }]}>Olympiades</Text>
        <Text style={styles.coverYear} accessibilityRole="header">
          {year}
        </Text>
        <Text style={styles.coverPlace}>
          {edition.date} · {edition.lieu}
        </Text>
        <View style={styles.winner}>
          <Icon name="award" size={16} color={c.yellow} />
          {champion ? (
            <>
              <View style={[styles.dot, { backgroundColor: colorHex(champion.couleur) }]} />
              <Text style={styles.winnerText} numberOfLines={1}>
                {champion.nom}
              </Text>
              <Text style={styles.winnerPts}>{champion.totalPoints} pts</Text>
            </>
          ) : (
            <Text style={styles.winnerText} numberOfLines={1}>
              {championOf(edition)}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.coverBar} pointerEvents="box-none">
        <IconButton
          name="chevron-left"
          label="Retour"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/plus'))}
          bg={DARK}
          color="#fff"
        />
        {photos.length > 1 && (
          <View style={styles.counter}>
            <Icon name="image" size={13} color="#fff" />
            <Text style={styles.counterText}>
              {shown + 1} / {photos.length}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Photos du haut, au doigt. Un FlatList horizontal dans la page qui défile verticalement
 * perdait le geste dès que le doigt descendait un peu (la page, et le « tirer pour actualiser »
 * juste au-dessus, le prenaient). Ici le glissé est à nous dès 8 px à l'horizontale, et
 * laissé à la page s'il part d'abord à la verticale.
 */
function Carrousel({
  photos,
  width,
  height,
  shown,
  onShown,
  onPhoto,
}: {
  photos: { url: string; caption?: string }[];
  width: number;
  height: number;
  shown: number;
  onShown: (i: number) => void;
  onPhoto: (i: number) => void;
}) {
  const index = useSharedValue(0);
  const x = useSharedValue(0);
  const last = photos.length - 1;

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      const base = -index.get() * width;
      let t = base + e.translationX;
      // Au bout de la série, la photo résiste
      if (t > 0) t /= 3;
      if (t < -last * width) t = -last * width + (t + last * width) / 3;
      x.set(t);
    })
    .onEnd((e) => {
      let i = index.get();
      if (e.translationX < -width / 4 || e.velocityX < -500) i += 1;
      else if (e.translationX > width / 4 || e.velocityX > 500) i -= 1;
      i = Math.max(0, Math.min(last, i));
      index.set(i);
      x.set(withTiming(-i * width, { duration: 260, easing: Easing.out(Easing.cubic) }));
      scheduleOnRN(onShown, i);
    });

  const row = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ width, height }, row]}>
        {/* Seules les photos voisines sont montées : une édition en compte des dizaines */}
        {photos.map((p, i) =>
          Math.abs(i - shown) > 1 ? null : (
            <Pressable
              key={`${i}-${p.url}`}
              onPress={() => onPhoto(i)}
              style={{ position: 'absolute', left: i * width, width, height }}
              accessibilityRole="imagebutton"
              accessibilityLabel={p.caption ? `Ouvrir la photo ${p.caption}` : `Ouvrir la photo ${i + 1}`}
            >
              <Image source={{ uri: p.url }} style={{ width, height }} contentFit="cover" transition={200} />
            </Pressable>
          ),
        )}
      </Animated.View>
    </GestureDetector>
  );
}

// ─── Les années, en gros boutons comme sur le site ───

function Years({ years, current, onPick }: { years: string[]; current: string; onPick: (y: string) => void }) {
  return (
    <View style={styles.years} accessibilityRole="tablist">
      {[...years].reverse().map((y) => {
        const on = y === current;
        return (
          <Pressable
            key={y}
            onPress={() => onPick(y)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`Olympiades ${y}`}
            style={({ pressed }) => [
              styles.year,
              on && { backgroundColor: c.card, borderColor: yearColor(y) },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.yearText, on && { color: c.text }]}>{y}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Le verre en vitrine : tourne seul, et se fait tourner du doigt ───

function Vitrine({ year, edition, art, active }: { year: string; edition: Edition; art: string | number; active: boolean }) {
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
  return (
    <Card style={styles.vitrine}>
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
        {VerreGL ? (
          // Vue plus large que le verre : la perspective déborde un peu
          <View style={{ marginHorizontal: -W * 0.25, marginVertical: -H * 0.165 }}>
            <VerreGL key={year} width={W * 1.5} height={H * 1.33} rotation={rotation} art={art} active={active} />
          </View>
        ) : (
          <Verre3D width={W} height={H} rotation={rotation} art={art} strips={48} backStrips={24} taper={TAPER} tint={FROST}>
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
    </Card>
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

function Fact({ label, children, first }: { label: string; children: React.ReactNode; first?: boolean }) {
  return (
    <View style={[styles.fact, !first && styles.divider]}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{children}</Text>
    </View>
  );
}

// ─── Le récit de l'édition et sa fiche ───

function Recit({ year, d }: { year: string; d: Edition }) {
  const participants = d.teams.reduce((sum, t) => sum + t.membres.length, 0);
  const rows: [string, string][] = [];
  if (d.meteo?.desc) rows.push(['Météo', d.meteo.desc]);
  rows.push(['Date', d.date], ['Lieu', d.lieu]);
  rows.push(['Équipes', `${d.teams.length} équipes${participants ? ` · ${participants} participants` : ''}`]);
  rows.push(['Épreuves', `${d.epreuves.length} épreuves`]);
  return (
    <View>
      <Text style={styles.title} accessibilityRole="header">
        Olympiades {year}
      </Text>
      {!!d.resume && <Reading text={d.resume} lines={6} />}

      {(d.citations ?? []).filter((q) => !!q.text).map((q, i) => (
        <View key={i} style={styles.quote}>
          <Text style={styles.quoteText}>{q.text.replace(/^"|"$/g, '')}</Text>
          {!!q.auteur && <Text style={styles.small}>{q.auteur.replace(/^[—–-]\s*/, '')}</Text>}
        </View>
      ))}

      <Card style={styles.facts}>
        {rows.map(([k, v], i) => (
          <Fact key={k} label={k} first={i === 0}>
            {v}
          </Fact>
        ))}
        <View style={styles.factWinner}>
          <Icon name="award" size={18} color={c.yellow} />
          <Text style={[styles.smallStrong, { flex: 1 }]}>{championOf(d)}</Text>
        </View>
      </Card>
    </View>
  );
}

// ─── Classement : podium, tableau, bonus et malus ───

const STEP = [118, 92, 70, 50];

function Classement({ d }: { d: Edition }) {
  const { ranked } = computeYear(d);
  const byId = Object.fromEntries(ranked.map((t) => [t.id, t]));
  // Le premier au centre, comme un vrai podium
  const order = [ranked[1], ranked[0], ranked[2], ranked[3]].filter(Boolean) as RankedTeam[];
  return (
    <View>
      <Heading>Classement</Heading>
      <View style={styles.podium}>
        {order.map((t) => {
          const team = colorHex(t.couleur);
          return (
            <View key={t.id} style={styles.podiumCol}>
              <Text style={styles.podiumName} numberOfLines={2}>
                {t.nom}
              </Text>
              <Text style={styles.podiumPts}>{t.totalPoints} pts</Text>
              <View
                style={[
                  styles.step,
                  { height: STEP[t.classement - 1] ?? 40, borderColor: team, backgroundColor: `${team}33` },
                  t.classement === 1 && { borderColor: c.yellow, backgroundColor: `${c.yellow}40` },
                ]}
              >
                <Text style={[styles.stepNum, t.classement === 1 && { color: c.yellow }]}>{t.classement}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <Card style={styles.listCard}>
        {ranked.map((t, i) => (
          <View key={t.id} style={[styles.rankRow, i > 0 && styles.divider]}>
            <Text style={[styles.rankPos, t.classement === 1 && { color: c.yellow }]}>{t.classement}</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <TeamName t={t} style={styles.rankName} />
              {!!t.capitaine && <Text style={styles.small}>Capitaine : {t.capitaine}</Text>}
            </View>
            <Text style={styles.rankPts}>
              {t.totalPoints}
              <Text style={styles.rankUnit}> pts</Text>
            </Text>
          </View>
        ))}
      </Card>

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

// ─── Équipes : membres en pastilles, capitaine en jaune ───

function Equipes({ d }: { d: Edition }) {
  const { ranked } = computeYear(d);
  const byId = Object.fromEntries(ranked.map((t) => [t.id, t]));
  const teams: (RankedTeam | (Edition['teams'][number] & { classement?: number; totalPoints?: number }))[] = d.legacy
    ? d.teams
    : ranked;

  return (
    <View>
      <Heading count={teams.length}>Équipes</Heading>
      {teams.map((t, i) => {
        const team = d.legacy ? c.rail : colorHex(t.couleur);
        return (
          <Card key={t.id ?? i} style={[styles.teamCard, { borderTopColor: team }]}>
            <View style={styles.teamHead}>
              <Text style={styles.teamName}>{d.legacy ? `Équipe ${i + 1}` : t.nom}</Text>
              {d.legacy
                ? t.vainqueur && <Badge label="Gagnante" />
                : <Badge label={`#${t.classement}`} color={t.classement === 1 ? c.yellow : c.raised} textColor={t.classement === 1 ? c.ink : c.text} />}
            </View>
            {!d.legacy && (
              <Text style={styles.small}>
                {t.totalPoints} points{t.capitaine ? ` · capitaine ${t.capitaine}` : ''}
              </Text>
            )}
            <View style={styles.members}>
              {t.membres.map((m, mi) => {
                const cap = !!t.capitaine && m === t.capitaine;
                return (
                  <View key={mi} style={[styles.member, cap && styles.captain]}>
                    {cap && <Icon name="award" size={13} color={c.yellow} />}
                    <Text style={[styles.memberText, cap && { color: c.yellow }]}>{m}</Text>
                  </View>
                );
              })}
            </View>
          </Card>
        );
      })}

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

// ─── Épreuves : règle, vainqueur, points de chaque équipe ───

function Epreuves({ d }: { d: Edition }) {
  const { ranked, winners } = useMemo(() => computeYear(d), [d]);
  const byId = Object.fromEntries(ranked.map((t) => [t.id, t]));

  return (
    <View>
      <Heading count={d.epreuves.length}>Épreuves</Heading>
      {d.epreuves.map((ep, i) => {
        const won = d.legacy ? undefined : byId[winners[i] ?? ''];
        const scored = !d.legacy && ranked.some((t) => ep.scores?.[t.id ?? ''] !== undefined);
        return (
          <Card key={i} style={styles.epCard}>
            <View style={styles.epHead}>
              <View style={styles.epNum}>
                <Text style={styles.epNumText}>{ep.num ?? i + 1}</Text>
              </View>
              <Text style={styles.epName}>{ep.nom}</Text>
            </View>
            {!!ep.desc && (
              <View style={{ marginTop: 8 }}>
                <Reading text={ep.desc} lines={3} />
              </View>
            )}
            {!!won && (
              <View style={styles.epWinner}>
                <Icon name="award" size={14} color={c.yellow} />
                <Text style={styles.smallStrong}>{won.nom}</Text>
              </View>
            )}
            {scored && (
              <View style={styles.scores}>
                {ranked.map((t) => {
                  const best = t.id === winners[i];
                  return (
                    <View key={t.id} style={[styles.score, best && { borderColor: colorHex(t.couleur) }]}>
                      <TeamName t={t} style={styles.scoreTeam} />
                      <Text style={[styles.scorePts, { color: colorHex(t.couleur) }]}>{ep.scores?.[t.id ?? ''] ?? 0}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </Card>
        );
      })}
    </View>
  );
}

// ─── La journée : loto, barbecue, auberge espagnole, anecdote ───

function Journee({ d }: { d: Edition }) {
  return (
    <View>
      {!!d.bbq && (
        <>
          <Heading>Le barbecue</Heading>
          <Reading text={d.bbq} lines={4} />
        </>
      )}

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
            <Card style={[styles.quine, styles.superQuine]}>
              <Badge label="Super Quine" style={{ marginBottom: 6 }} />
              <View style={styles.quineRow}>
                <Text style={[styles.smallStrong, { flex: 1 }]}>{d.superQuine.lot}</Text>
                <Text style={styles.quineWinner}>{d.superQuine.gagnant}</Text>
              </View>
            </Card>
          )}
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
          <Heading>L’anecdote de l’édition</Heading>
          <Reading text={d.anecdote} />
        </>
      )}
    </View>
  );
}

// ─── Galerie ───

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

// ─── Palmarès, en bas de page ───

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
const OMBRE = require('@/assets/olympiades/ombre.png');

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

  // Photos en haut
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  coverText: { position: 'absolute', left: theme.gutter, right: theme.gutter, bottom: 18 },
  coverKicker: { fontFamily: f.bodyBold, fontSize: 12, letterSpacing: 3, textTransform: 'uppercase' },
  coverYear: { color: '#fff', fontFamily: f.serifBlack, fontSize: 52, lineHeight: 58, letterSpacing: -0.5 },
  coverPlace: { color: 'rgba(255,255,255,0.85)', fontFamily: f.bodyMedium, fontSize: 15, lineHeight: 21 },
  coverBar: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  winner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    marginTop: 12,
    minHeight: 38,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(26,16,37,0.75)',
    maxWidth: '100%',
  },
  winnerText: { color: c.text, fontFamily: f.bodyBold, fontSize: 15, flexShrink: 1 },
  winnerPts: { color: c.yellow, fontFamily: f.bodyBold, fontSize: 14 },

  // Années
  years: { flexDirection: 'row', gap: 8, paddingHorizontal: theme.gutter, paddingTop: 16 },
  year: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: c.hairline,
  },
  yearText: { color: c.muted, fontFamily: f.serifBlack, fontSize: 20 },

  // Raccourcis collés en haut
  bar: { backgroundColor: c.deep, paddingVertical: 12 },
  barRow: { paddingHorizontal: theme.gutter, gap: 8 },
  barChip: { height: 40, borderRadius: 20 },

  content: { paddingHorizontal: theme.gutter, paddingTop: 4 },
  heading: { marginTop: 32, marginBottom: 12 },
  title: { color: c.text, fontFamily: f.serif, fontSize: 26, lineHeight: 32, marginTop: 8, marginBottom: 10 },
  body: { color: c.text, fontFamily: f.body, fontSize: 16, lineHeight: 24 },
  small: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 20 },
  smallStrong: { color: c.text, fontFamily: f.bodyBold, fontSize: 14, lineHeight: 20 },
  more: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  moreText: { color: c.coralSoft, fontFamily: f.bodyBold, fontSize: 15 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  teamInline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  teamInlineText: { color: c.text, fontFamily: f.bodyBold, fontSize: 14, flexShrink: 1 },
  iconBox: { width: 40, height: 40, borderRadius: 14, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' },
  listCard: { paddingHorizontal: 16 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairline },

  // Récit
  quote: { marginTop: 16, paddingLeft: 14, borderLeftWidth: 3, borderLeftColor: c.violet, gap: 4 },
  quoteText: { color: c.text, fontFamily: f.serif, fontSize: 17, lineHeight: 25, fontStyle: 'italic' },
  facts: { marginTop: 20, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 0, overflow: 'hidden' },
  fact: { flexDirection: 'row', gap: 12, paddingVertical: 12 },
  factLabel: { width: 76, color: c.muted, fontFamily: f.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', paddingTop: 2 },
  factValue: { flex: 1, color: c.text, fontFamily: f.body, fontSize: 15, lineHeight: 21 },
  factWinner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: -16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,217,61,0.10)',
  },

  // Verre
  vitrine: {
    alignItems: 'center',
    paddingTop: HERO_TOP,
    paddingBottom: 16,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  backdrop: { position: 'absolute', alignSelf: 'center' },
  stage: { paddingHorizontal: 48 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hintText: { color: c.muted, fontFamily: f.body, fontSize: 12 },

  // Classement
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 16 },
  podiumCol: { flex: 1, alignItems: 'center' },
  podiumName: { color: c.text, fontFamily: f.bodyBold, fontSize: 13, lineHeight: 17, textAlign: 'center', minHeight: 34 },
  podiumPts: { color: c.muted, fontFamily: f.body, fontSize: 12, marginBottom: 6 },
  step: {
    alignSelf: 'stretch',
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    alignItems: 'center',
    paddingTop: 8,
  },
  stepNum: { color: c.text, fontFamily: f.serifBlack, fontSize: 26, lineHeight: 30 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  rankPos: { color: c.muted, fontFamily: f.serifBlack, fontSize: 22, width: 20, textAlign: 'center' },
  rankName: { fontSize: 15 },
  rankPts: { color: c.text, fontFamily: f.serifBlack, fontSize: 20 },
  rankUnit: { color: c.muted, fontFamily: f.body, fontSize: 13 },
  adjRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  adjPts: { fontFamily: f.serifBlack, fontSize: 20, width: 40 },
  absHead: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },

  // Équipes
  teamCard: { padding: 16, marginBottom: 10, borderTopWidth: 4 },
  teamHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  teamName: { color: c.text, fontFamily: f.serif, fontSize: 20, lineHeight: 25, flex: 1 },
  members: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: c.raised,
  },
  captain: { backgroundColor: 'rgba(255,217,61,0.14)', borderWidth: 1, borderColor: 'rgba(255,217,61,0.5)' },
  memberText: { color: c.text, fontFamily: f.bodyMedium, fontSize: 14 },

  // Épreuves
  epCard: { padding: 16, marginBottom: 10 },
  epHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  epNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center' },
  epNumText: { color: c.text, fontFamily: f.serifBlack, fontSize: 15 },
  epName: { color: c.text, fontFamily: f.serif, fontSize: 18, lineHeight: 23, flex: 1 },
  epWinner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,217,61,0.12)',
  },
  scores: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  score: {
    width: '48.5%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: c.raised,
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: 2,
  },
  scoreTeam: { color: c.muted, fontFamily: f.bodyMedium, fontSize: 12 },
  scorePts: { fontFamily: f.serifBlack, fontSize: 20, lineHeight: 24 },

  // Journée
  quine: { padding: 16, paddingBottom: 6, marginTop: 10 },
  superQuine: { borderWidth: 1, borderColor: 'rgba(255,217,61,0.45)' },
  quineTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 16, lineHeight: 21, marginBottom: 4 },
  quineRow: { flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'flex-start' },
  quineWinner: { color: c.teal, fontFamily: f.bodyBold, fontSize: 14, maxWidth: 110, textAlign: 'right' },

  // Galerie
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: { backgroundColor: c.card, borderRadius: 10, overflow: 'hidden' },

  // Palmarès
  palmaRow: { marginBottom: 8 },
  palmaYear: { fontFamily: f.serifBlack, fontSize: 22, width: 60 },

  // Visionneuse
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    backgroundColor: DARK,
    justifyContent: 'center',
  },
  counterText: { color: '#fff', fontFamily: f.bodyBold, fontSize: 13 },
  caption: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: theme.gutter, paddingTop: 16 },
  captionText: { color: '#fff', fontFamily: f.bodyBold, fontSize: 15, lineHeight: 21, textAlign: 'center' },
});
