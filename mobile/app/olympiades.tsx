import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
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
import { useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Verre3D } from '@/components/olympiades/Verre3D';
import { VerreDecor, yearColor } from '@/components/olympiades/VerreDecor';
import {
  championOf,
  colorHex,
  computeYear,
  fetchOlympiades,
  loadCachedOlympiades,
  type Edition,
  type Olympiades,
  type RankedTeam,
} from '@/lib/olympiades';
import { theme } from '@/lib/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type Tab = 'classement' | 'epreuves' | 'equipes' | 'journee' | 'photos';

const SPIN = 28; // degrés par seconde, au repos
const C = theme.colors;
const F = theme.fonts;

// Une donnée inattendue sur le site ne doit pas fermer l'appli
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.center}>
      <Text style={styles.muted}>Les Olympiades n’ont pas pu s’afficher.</Text>
      <Pressable onPress={retry} style={styles.retry}>
        <Text style={styles.retryText}>Réessayer</Text>
      </Pressable>
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
      <View style={styles.center}>
        {failed ? (
          <>
            <Text style={styles.muted}>Impossible de charger les Olympiades. Vérifie ta connexion.</Text>
            <Pressable onPress={load} style={styles.retry}>
              <Text style={styles.retryText}>Réessayer</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={C.coral} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: theme.s(10) + insets.bottom }}
        onScroll={onScroll}
        scrollEventThrottle={64}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.coral} />}
      >
        {/* La hauteur de ce bloc donne la position des onglets (une vue collante mesure 0 elle-même) */}
        <View onLayout={(e: LayoutChangeEvent) => setTabsY(e.nativeEvent.layout.height)}>
          {failed && <Text style={styles.offline}>Hors connexion : dernières données enregistrées.</Text>}
          <Hero year={current} edition={edition} active={heroVisible && viewer === null} />
          <Shelf years={years} data={data} current={current} onPick={pick} />
        </View>

        <View style={styles.tabsBar} accessibilityRole="tablist">
          {tabs.map((t) => {
            const on = t.key === activeTab;
            return (
              <Pressable
                key={t.key}
                onPress={() => chooseTab(t.key)}
                style={styles.tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>
                  {t.label}
                </Text>
                <View style={[styles.tabMark, on && { backgroundColor: yearColor(current) }]} />
              </Pressable>
            );
          })}
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
  const H = W * 1.28;
  const T = Math.PI * W;
  const rotation = useSharedValue(0);
  const velocity = useSharedValue(SPIN);
  const dragging = useSharedValue(false);
  const reduced = useReducedMotion();
  const rest = reduced ? 0 : SPIN;

  const frame = useFrameCallback((f) => {
    if (dragging.get()) return;
    const v = velocity.get();
    // Animations réduites : rien à écrire une fois le verre arrêté
    if (rest === 0 && Math.abs(v) < 0.5) return;
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
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
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragging.set(true);
          lastDx.set(0);
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
    [T, dragging, lastDx, rotation, velocity],
  );

  // Lecteur d'écran : glisser vers le haut ou le bas fait tourner le verre
  function onA11y(e: { nativeEvent: { actionName: string } }) {
    const step = e.nativeEvent.actionName === 'increment' ? 45 : -45;
    rotation.set((rotation.get() + step) % 360);
  }

  const accent = yearColor(year);
  const champion = edition.legacy ? null : computeYear(edition).ranked[0];
  return (
    <View style={styles.hero}>
      {/* Halo de la couleur de l'année derrière le verre */}
      {[2.3, 1.7, 1.2].map((f) => (
        <View
          key={f}
          style={[
            styles.halo,
            { backgroundColor: accent, width: W * f, height: W * f, borderRadius: W * f, top: theme.s(4) + H / 2 - (W * f) / 2 },
          ]}
        />
      ))}
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
        <Verre3D width={W} height={H} rotation={rotation} art={edition.verre} strips={48} backStrips={24}>
          <VerreDecor year={year} edition={edition} width={W} />
        </Verre3D>
      </View>

      <Text style={styles.heroYear}>{year}</Text>
      <Text style={styles.heroPlace}>
        {edition.date}, {edition.lieu.charAt(0).toLowerCase() + edition.lieu.slice(1)}
      </Text>

      <View style={styles.winner}>
        <Ionicons name="trophy" size={16} color={C.yellow} />
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
    </View>
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
    <View style={styles.shelfWrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
        {years.map((y) => {
          const on = y === current;
          return (
            <Pressable
              key={y}
              onPress={() => onPick(y)}
              hitSlop={6}
              style={({ pressed }) => [styles.shelfItem, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Olympiades ${y}`}
            >
              <View style={{ opacity: on ? 1 : 0.45 }}>
                <Verre3D width={W} height={W * 1.28} rotation={still} art={data[y].verre} strips={12}>
                  <VerreDecor year={y} edition={data[y]} width={W} />
                </Verre3D>
              </View>
              <Text style={[styles.shelfYear, on && { color: C.text }]}>{y}</Text>
              <View style={[styles.shelfMark, on && { backgroundColor: yearColor(y) }]} />
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.plank} />
    </View>
  );
}

// ─── Briques de mise en page ───

function Heading({ children }: { children: string }) {
  return <Text style={styles.heading}>{children}</Text>;
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
        <Pressable onPress={() => setOpen(!open)} hitSlop={8} style={styles.more}>
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

function IconLine({ icon, children }: { icon: IoniconName; children: React.ReactNode }) {
  return (
    <View style={styles.iconLine}>
      <Ionicons name={icon} size={17} color={C.muted} style={{ marginTop: 2 }} />
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
          <View key={t.id} style={styles.rankRow}>
            <Text style={[styles.rankPos, first && { color: C.yellow }]}>{t.classement}</Text>
            <View style={{ flex: 1 }}>
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
          </View>
        );
      })}

      {!!d.extras?.length && (
        <>
          <Heading>Bonus et malus</Heading>
          {d.extras.map((ex, i) => (
            <View key={i} style={styles.adjRow}>
              <Text style={[styles.adjPts, { color: ex.points > 0 ? '#A8E063' : C.coral }]}>
                {ex.points > 0 ? '+' : '−'}
                {Math.abs(ex.points)}
              </Text>
              <View style={{ flex: 1 }}>
                <TeamName t={byId[ex.equipeId]} />
                <Text style={styles.small}>{ex.motif}</Text>
              </View>
            </View>
          ))}
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
        const total = ranked.reduce((n, t) => n + Math.max(0, ep.scores?.[t.id ?? ''] ?? 0), 0);
        return (
          <Pressable
            key={i}
            onPress={() => setOpen(expanded ? null : i)}
            style={styles.epRow}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityHint={expanded ? 'Masquer les règles' : 'Afficher les règles'}
          >
            <View style={styles.epHead}>
              <Text style={styles.epNum}>{ep.num ?? i + 1}</Text>
              <Text style={styles.epName}>{ep.nom}</Text>
              {!!ep.desc && <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />}
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
            {expanded && !!ep.desc && <Text style={[styles.body, { marginTop: theme.s(3) }]}>{ep.desc}</Text>}
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
      {teams.map((t, i) => {
        const color = d.legacy ? (t.vainqueur ? C.yellow : C.border) : colorHex(t.couleur);
        return (
          <View key={t.id ?? i} style={[styles.teamBlock, { borderLeftColor: color }]}>
            <View style={styles.teamHead}>
              <Text style={styles.teamName}>{d.legacy ? `Équipe ${i + 1}` : t.nom}</Text>
              {d.legacy
                ? t.vainqueur && <Ionicons name="trophy" size={16} color={C.yellow} accessibilityLabel="Équipe gagnante" />
                : <Text style={[styles.teamRank, { color }]}>{t.classement === 1 ? '1er' : `${t.classement}e`}</Text>}
            </View>
            {!!t.capitaine && <Text style={styles.small}>Capitaine : {t.capitaine}</Text>}
            <Text style={[styles.body, { marginTop: theme.s(2) }]}>{t.membres.join(', ')}</Text>
          </View>
        );
      })}

      {!!d.absents?.length && (
        <>
          <Heading>Absents et blessés</Heading>
          {d.absents.map((a, i) => (
            <View key={i} style={styles.adjRow}>
              <Ionicons
                name={a.type === 'blessure' ? 'bandage-outline' : 'airplane-outline'}
                size={20}
                color={a.type === 'blessure' ? C.coral : C.muted}
                style={{ width: 34, marginTop: 1 }}
              />
              <View style={{ flex: 1 }}>
                <View style={styles.absHead}>
                  <Text style={styles.smallStrong}>{a.nom}</Text>
                  {a.equipeId && byId[a.equipeId] && <TeamName t={byId[a.equipeId]} style={styles.small} />}
                </View>
                <Text style={styles.small}>{a.raison}</Text>
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

// ─── Onglet La journée ───

function Journee({ d }: { d: Edition }) {
  const participants = d.teams.reduce((n, t) => n + t.membres.length, 0);
  return (
    <View>
      {!!d.meteo?.desc && <IconLine icon="partly-sunny-outline">{d.meteo.desc}</IconLine>}
      <IconLine icon="people-outline">
        {participants} participants, {d.teams.length} équipes, {d.epreuves.length} épreuves
      </IconLine>

      {!!d.resume && (
        <>
          <Heading>L’édition</Heading>
          <Reading text={d.resume} />
        </>
      )}

      {(d.citations ?? []).filter((c) => !!c.text).map((c, i) => (
        <View key={i} style={styles.quote}>
          <Text style={styles.quoteMark}>“</Text>
          <Text style={styles.quoteText}>{c.text.replace(/^"|"$/g, '')}</Text>
          {!!c.auteur && <Text style={styles.small}>{c.auteur.replace(/^[—–-]\s*/, '')}</Text>}
        </View>
      ))}

      {!!d.loto?.quines.length && (
        <>
          <Heading>Le loto</Heading>
          {!!d.loto.intro && <Reading text={d.loto.intro} lines={3} />}
          {d.loto.quines.map((q, qi) => (
            <View key={qi} style={styles.quine}>
              <Text style={styles.quineTitle}>{q.titre}</Text>
              {q.lignes.map((l, i) => (
                <View key={i} style={styles.quineRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.small}>{l.type}</Text>
                    <Text style={styles.smallStrong}>{l.nom}</Text>
                    {!!l.contenu && <Text style={styles.small}>{l.contenu}</Text>}
                  </View>
                  <Text style={styles.quineWinner}>{l.gagnant}</Text>
                </View>
              ))}
            </View>
          ))}
          {!!d.superQuine && (
            <View style={[styles.quine, { borderColor: C.yellow }]}>
              <Text style={[styles.quineTitle, { color: C.yellow }]}>Super Quine</Text>
              <View style={styles.quineRow}>
                <Text style={[styles.smallStrong, { flex: 1 }]}>{d.superQuine.lot}</Text>
                <Text style={styles.quineWinner}>{d.superQuine.gagnant}</Text>
              </View>
            </View>
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

function Photos({ d, onPhoto }: { d: Edition; onPhoto: (i: number) => void }) {
  const { width } = useWindowDimensions();
  const gap = 3;
  // Arrondi : une largeur fractionnaire renvoie la 3e vignette à la ligne sur Android
  const size = Math.floor((width - theme.s(8) - gap * 2) / 3);
  return (
    <View style={[styles.grid, { gap }]}>
      {(d.photos ?? []).map((p, i) => (
        <Pressable key={`${i}-${p.url}`} onPress={() => onPhoto(i)} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1}`}>
          <Image source={{ uri: p.url }} style={{ width: size, height: size, borderRadius: 4 }} contentFit="cover" transition={150} />
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
    <View style={styles.palma}>
      <Heading>Palmarès</Heading>
      {[...years].reverse().map((y) => {
        const d = data[y];
        const champ = d.legacy ? null : computeYear(d).ranked[0];
        const on = y === current;
        return (
          <Pressable
            key={y}
            onPress={() => onPick(y)}
            accessibilityRole="button"
            accessibilityLabel={`Olympiades ${y}`}
            style={({ pressed }) => [styles.palmaRow, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.palmaYear, { color: on ? yearColor(y) : C.text }]}>{y}</Text>
            <View style={{ flex: 1 }}>
              {champ ? (
                <TeamName t={champ} style={styles.smallStrong} />
              ) : (
                <Text style={styles.smallStrong} numberOfLines={1}>
                  {championOf(d, 'palmares')}
                </Text>
              )}
              <Text style={styles.small} numberOfLines={1}>
                {d.lieu}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.muted} />
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Photos en plein écran, on passe de l'une à l'autre en glissant ───

function PhotoViewer({
  photos,
  index,
  onClose,
}: {
  photos: { url: string }[];
  index: number | null;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={index !== null} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait']}>
      {index !== null && (
        <View style={styles.viewer}>
          <FlatList
            // Filet de sécurité : initialScrollIndex est ignoré sur le web
            ref={(list) => list?.scrollToOffset({ offset: index * width, animated: false })}
            data={photos}
            horizontal
            pagingEnabled
            initialScrollIndex={index}
            // Sans ça, la photo 0 s'affiche une frame avant le saut
            contentOffset={{ x: index * width, y: 0 }}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(p, i) => `${i}-${p.url}`}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => <Image source={{ uri: item.url }} style={{ width, height }} contentFit="contain" />}
          />
          <Pressable
            onPress={onClose}
            style={[styles.viewerClose, { top: insets.top + 8 }]}
            hitSlop={20}
            accessibilityRole="button"
            accessibilityLabel="Fermer"
          >
            <Ionicons name="close" size={32} color="#fff" />
          </Pressable>
        </View>
      )}
    </Modal>
  );
}

const PAD = theme.s(4);

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: C.deep },
  center: { flex: 1, backgroundColor: C.deep, alignItems: 'center', justifyContent: 'center', padding: theme.s(6) },
  muted: { color: C.muted, fontFamily: F.body, textAlign: 'center', fontSize: 15 },
  retry: { marginTop: theme.s(4), paddingHorizontal: theme.s(5), paddingVertical: theme.s(3), borderRadius: theme.radius.pill, backgroundColor: C.coral },
  retryText: { color: '#fff', fontFamily: F.bodyBold },
  offline: { color: C.muted, fontFamily: F.body, fontSize: 12, textAlign: 'center', marginTop: theme.s(2) },

  hero: { alignItems: 'center', paddingTop: theme.s(4), paddingHorizontal: PAD, overflow: 'hidden' },
  halo: { position: 'absolute', opacity: 0.06 },
  stage: { paddingHorizontal: theme.s(12) },
  heroYear: { color: C.text, fontFamily: F.serifBlack, fontSize: 44, lineHeight: 50, marginTop: theme.s(4) },
  heroPlace: { color: C.muted, fontFamily: F.body, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: theme.s(1) },
  winner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.s(2),
    marginTop: theme.s(4),
    paddingHorizontal: theme.s(4),
    paddingVertical: theme.s(2.5),
    borderRadius: theme.radius.pill,
    backgroundColor: 'rgba(255,217,61,0.10)',
    maxWidth: '100%',
  },
  winnerText: { color: C.text, fontFamily: F.bodyBold, fontSize: 15, flexShrink: 1 },
  winnerPts: { color: C.yellow, fontFamily: F.bodyBold, fontSize: 13 },

  shelfWrap: { marginTop: theme.s(6) },
  shelf: { flexGrow: 1, justifyContent: 'center', gap: theme.s(6), paddingHorizontal: PAD },
  shelfItem: { alignItems: 'center', paddingTop: theme.s(1) },
  shelfYear: { color: C.muted, fontFamily: F.bodyBold, fontSize: 13, marginTop: theme.s(2) },
  shelfMark: { width: 18, height: 3, borderRadius: 2, marginTop: theme.s(1.5), backgroundColor: 'transparent' },
  plank: { height: StyleSheet.hairlineWidth, backgroundColor: C.border, marginHorizontal: PAD, marginTop: theme.s(4) },

  tabsBar: {
    flexDirection: 'row',
    backgroundColor: C.deep,
    paddingHorizontal: theme.s(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  // Largeur selon le libellé : « Classement » ne doit pas être coupé
  tab: { flexGrow: 1, alignItems: 'center', paddingTop: theme.s(3.5), paddingHorizontal: theme.s(1) },
  tabText: { color: C.muted, fontFamily: F.bodyMedium, fontSize: 13.5 },
  tabTextOn: { color: C.text, fontFamily: F.bodyBold },
  tabMark: { height: 3, borderRadius: 2, alignSelf: 'stretch', marginHorizontal: theme.s(1), marginTop: theme.s(3), backgroundColor: 'transparent' },

  content: { paddingHorizontal: PAD, paddingTop: theme.s(4) },
  heading: { color: C.text, fontFamily: F.serif, fontSize: 20, marginTop: theme.s(8), marginBottom: theme.s(3) },
  body: { color: 'rgba(255,255,255,0.86)', fontFamily: F.body, fontSize: 15, lineHeight: 23 },
  small: { color: C.muted, fontFamily: F.body, fontSize: 13, lineHeight: 19 },
  smallStrong: { color: C.text, fontFamily: F.bodyBold, fontSize: 14, lineHeight: 20 },
  more: { marginTop: theme.s(2), alignSelf: 'flex-start' },
  moreText: { color: C.coral, fontFamily: F.bodyBold, fontSize: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  teamInline: { flexDirection: 'row', alignItems: 'center', gap: theme.s(2), flexShrink: 1 },
  teamInlineText: { color: C.text, fontFamily: F.bodyBold, fontSize: 14, flexShrink: 1 },
  iconLine: { flexDirection: 'row', gap: theme.s(3), marginTop: theme.s(3) },

  rankRow: { flexDirection: 'row', gap: theme.s(4), paddingVertical: theme.s(3.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  rankPos: { color: C.muted, fontFamily: F.serifBlack, fontSize: 30, lineHeight: 34, width: 24, textAlign: 'center' },
  rankHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.s(3) },
  rankName: { color: C.text, fontFamily: F.bodyBold, fontSize: 16, flexShrink: 1 },
  rankPts: { color: C.text, fontFamily: F.serifBlack, fontSize: 22 },
  rankUnit: { color: C.muted, fontFamily: F.body, fontSize: 12 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: C.surface, marginTop: theme.s(2), marginBottom: theme.s(1.5), overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  adjRow: { flexDirection: 'row', gap: theme.s(2), marginBottom: theme.s(4) },
  adjPts: { fontFamily: F.serifBlack, fontSize: 20, width: 34 },
  absHead: { flexDirection: 'row', alignItems: 'center', gap: theme.s(3), flexWrap: 'wrap' },

  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.s(4), rowGap: theme.s(2), marginBottom: theme.s(2) },
  legendText: { color: C.muted, fontFamily: F.bodyMedium, fontSize: 13 },
  epRow: { paddingVertical: theme.s(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  epHead: { flexDirection: 'row', alignItems: 'center', gap: theme.s(3) },
  epNum: { color: C.coral, fontFamily: F.serifBlack, fontSize: 18, width: 18 },
  epName: { color: C.text, fontFamily: F.bodyBold, fontSize: 16, flex: 1 },
  split: { flexDirection: 'row', height: 24, borderRadius: 6, overflow: 'hidden', marginTop: theme.s(3), gap: 2 },
  splitPart: { alignItems: 'center', justifyContent: 'center' },
  splitText: { color: C.deep, fontFamily: F.bodyBold, fontSize: 12 },
  epWinner: { flexDirection: 'row', alignItems: 'center', gap: theme.s(2), marginTop: theme.s(2) },

  teamBlock: { borderLeftWidth: 3, paddingLeft: theme.s(4), paddingVertical: theme.s(1), marginBottom: theme.s(6) },
  teamHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.s(3) },
  teamName: { color: C.text, fontFamily: F.serif, fontSize: 19, flexShrink: 1 },
  teamRank: { fontFamily: F.serifBlack, fontSize: 18 },

  quote: { marginTop: theme.s(6), paddingLeft: theme.s(1) },
  quoteMark: { color: C.coral, fontFamily: F.serifBlack, fontSize: 48, lineHeight: 44, height: 30 },
  quoteText: { color: C.text, fontFamily: F.serif, fontSize: 18, lineHeight: 27, marginBottom: theme.s(2) },
  quine: { borderWidth: 1, borderColor: C.border, borderRadius: theme.radius.md, padding: theme.s(4), marginTop: theme.s(3) },
  quineTitle: { color: C.text, fontFamily: F.serif, fontSize: 16, marginBottom: theme.s(1) },
  quineRow: { flexDirection: 'row', gap: theme.s(3), paddingVertical: theme.s(2), alignItems: 'flex-start' },
  quineWinner: { color: C.teal, fontFamily: F.bodyBold, fontSize: 14, maxWidth: 100, textAlign: 'right' },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },

  palma: { marginTop: theme.s(6), paddingTop: theme.s(2), borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  palmaRow: { flexDirection: 'row', alignItems: 'center', gap: theme.s(4), paddingVertical: theme.s(3) },
  palmaYear: { fontFamily: F.serifBlack, fontSize: 22, width: 60 },

  viewer: { flex: 1, backgroundColor: '#000' },
  viewerClose: { position: 'absolute', right: 20, zIndex: 10 },
});
