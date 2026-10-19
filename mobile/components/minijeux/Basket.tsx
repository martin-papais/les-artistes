import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useFrameCallback, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

const DURATION = 30; // secondes, le chrono part au premier lancer
// Le panier vu de face : le ballon part de près (gros) et rapetisse en s'éloignant vers l'arceau
const RIM_Y = 0.27; // × hauteur
const START_Y = 0.8;
const GRAVITY = 2.6; // × hauteur / s²
const FIRE = 3; // paniers d'affilée pour passer « en feu » : chaque panier compte double

const BALLON = require('@/assets/minijeux/ballon.png');
const FILET = require('@/assets/minijeux/filet.png');
const SALLE = require('@/assets/minijeux/salle.png');
const HALO = require('@/assets/olympiades/halo.png');

type Shout = { text: string; color: string; key: number } | null;

/** Un geste vers le haut lance le ballon ; trop mou il retombe, trop fort il passe au-dessus. */
export function Basket({ onEnd }: { onEnd: (score: number) => void }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  return (
    <View
      style={styles.area}
      onLayout={(e: LayoutChangeEvent) => setSize((s) => s ?? { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size && <Court w={size.w} h={size.h} onEnd={onEnd} />}
    </View>
  );
}

function Court({ w, h, onEnd }: { w: number; h: number; onEnd: (score: number) => void }) {
  const R = Math.min(w * 0.12, 50); // rayon du ballon au départ
  const rimY = h * RIM_Y;
  const rimHalf = R * 0.95; // demi-largeur intérieure de l'arceau
  const rimW = rimHalf * 2 + R * 0.55;
  const startX = w / 2;
  const startY = h * START_Y;

  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(DURATION);
  const [started, setStarted] = useState(false);
  const [onFire, setOnFire] = useState(false);
  const [shout, setShout] = useState<Shout>(null);
  const done = useRef(false);

  const bx = useSharedValue(startX);
  const by = useSharedValue(startY);
  const vx = useSharedValue(0);
  const vy = useSharedValue(0);
  const t = useSharedValue(0); // temps de vol
  const tCross = useSharedValue(1); // instant où le ballon redescend au niveau de l'arceau
  const flying = useSharedValue(false);
  const judged = useSharedValue(false);
  const touched = useSharedValue(false); // a touché le cercle (pas de « swish »)
  const behind = useSharedValue(false); // passé derrière l'arceau (en redescendant)
  const top = useSharedValue(startY); // point le plus haut du lancer
  const hoopX = useSharedValue(w / 2);
  const hoopT = useSharedValue(0);
  const made = useSharedValue(0); // paniers réussis (fait bouger l'arceau)
  const points = useSharedValue(0);
  const streak = useSharedValue(0);
  const over = useSharedValue(false);
  const swish = useSharedValue(0); // le filet se tend au passage du ballon
  const timeLeft = useSharedValue(1);

  function reset() {
    'worklet';
    flying.set(false);
    judged.set(false);
    behind.set(false);
    touched.set(false);
    t.set(0);
    top.set(startY);
    bx.set(startX);
    by.set(startY);
  }

  useFrameCallback((fr) => {
    'worklet';
    const dt = Math.min(0.034, (fr.timeSincePreviousFrame ?? 16) / 1000);
    // L'arceau se met à bouger à partir de 5 paniers, de plus en plus vite et loin
    const m = made.get();
    if (m >= 5) {
      hoopT.set(hoopT.get() + dt * Math.min(2.6, 0.9 + (m - 5) * 0.12));
      hoopX.set(w / 2 + Math.sin(hoopT.get()) * w * Math.min(0.3, 0.12 + (m - 5) * 0.015));
    }
    if (!flying.get()) return;
    t.set(t.get() + dt);
    if (by.get() < top.get()) top.set(by.get());
    const nvy = vy.get() + GRAVITY * h * dt;
    const ny = by.get() + vy.get() * dt;
    const nx = bx.get() + vx.get() * dt;
    // Passage de l'arceau en redescendant : panier, cercle touché ou raté
    if (!judged.get() && vy.get() > 0 && by.get() < rimY && ny >= rimY) {
      judged.set(true);
      behind.set(true);
      const dx = nx - hoopX.get();
      const ball = R * 0.55;
      const overBoard = top.get() < rimY - h * 0.2;
      if (overBoard) {
        streak.set(0);
        scheduleOnRN(missed, 'over');
      } else if (Math.abs(dx) <= rimHalf - ball * 0.5) {
        const s = streak.get() + 1;
        streak.set(s);
        const gain = s > FIRE ? 2 : 1;
        points.set(points.get() + gain);
        made.set(made.get() + 1);
        swish.set(withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 380 })));
        scheduleOnRN(scoredJs, points.get(), gain, s, !touched.get());
        // Il tombe dans le filet
        vx.set(vx.get() * 0.15);
      } else if (Math.abs(dx) <= rimHalf + ball) {
        if (!touched.get()) {
          // Premier contact avec le cercle : il rebondit et peut encore retomber dedans
          touched.set(true);
          judged.set(false);
          behind.set(false);
          vx.set(-Math.sign(dx || 1) * w * 0.12 + Math.sign(dx || 1) * w * 0.25 * Math.random());
          vy.set(-Math.abs(nvy) * 0.45);
          bx.set(nx);
          by.set(rimY - 1);
          scheduleOnRN(rimJs);
          return;
        }
        streak.set(0);
        scheduleOnRN(missed, 'rim');
      } else {
        streak.set(0);
        scheduleOnRN(missed, 'air');
      }
    }
    vy.set(nvy);
    bx.set(nx);
    by.set(ny);
    // Ballon retombé hors du jeu : on en redonne un
    if (ny > h + R || nx < -R * 2 || nx > w + R * 2 || (behind.get() && ny > rimY + h * 0.32)) {
      if (!judged.get()) {
        streak.set(0);
        scheduleOnRN(missed, 'short');
      }
      reset();
      if (over.get()) scheduleOnRN(finish);
    }
  });

  function say(text: string, color: string) {
    setShout({ text, color, key: Date.now() });
  }

  function scoredJs(total: number, gain: number, s: number, clean: boolean) {
    setScore(total);
    setOnFire(s >= FIRE);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (s === FIRE) say('En feu ! Points doublés', c.coral);
    else if (gain === 2) say(clean ? 'Swish ! +2' : '+2', c.coral);
    else say(clean ? 'Swish !' : 'Panier !', c.yellow);
  }
  function rimJs() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  }
  function missed(why: 'over' | 'rim' | 'air' | 'short') {
    setOnFire(false);
    if (why === 'over') say('Trop fort', c.muted);
    else if (why === 'short') say('Trop court', c.muted);
  }
  function finish() {
    if (done.current) return;
    done.current = true;
    onEnd(points.get());
  }

  // Chrono : à zéro, le ballon en l'air finit sa course avant le score final
  useEffect(() => {
    if (!started) return;
    timeLeft.set(withTiming(0, { duration: DURATION * 1000 }));
    const id = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          over.set(true);
          if (!flying.get()) setTimeout(finish, 0);
          return 0;
        }
        if (s <= 6) Haptics.selectionAsync().catch(() => {});
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  useEffect(() => {
    if (!shout) return;
    const id = setTimeout(() => setShout(null), 900);
    return () => clearTimeout(id);
  }, [shout]);

  function launch() {
    if (!started) setStarted(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }

  // Vitesse du doigt mesurée nous-mêmes : si le doigt s'arrête avant de se lever,
  // la vitesse donnée à la fin du geste tombe à zéro
  const fingerVx = useSharedValue(0);
  const fingerVy = useSharedValue(0);
  const prev = useSharedValue({ x: 0, y: 0, t: 0 });
  const pan = Gesture.Pan()
    .minDistance(12)
    .onBegin(() => {
      'worklet';
      fingerVx.set(0);
      fingerVy.set(0);
      prev.set({ x: 0, y: 0, t: Date.now() });
    })
    .onUpdate((e) => {
      'worklet';
      const now = Date.now();
      const p = prev.get();
      const dt = (now - p.t) / 1000;
      if (dt < 0.008) return; // trop rapproché : la mesure serait un à-coup
      const ivx = (e.translationX - p.x) / dt;
      const ivy = (e.translationY - p.y) / dt;
      // Moyenne glissante : on garde l'élan des derniers instants, pas un à-coup isolé
      fingerVx.set(fingerVx.get() * 0.4 + ivx * 0.6);
      fingerVy.set(Math.min(fingerVy.get() * 0.4 + ivy * 0.6, fingerVy.get()));
      prev.set({ x: e.translationX, y: e.translationY, t: now });
    })
    .onEnd((e) => {
      'worklet';
      const evy = Math.min(e.velocityY, fingerVy.get());
      const evx = Math.abs(e.velocityX) > Math.abs(fingerVx.get()) ? e.velocityX : fingerVx.get();
      if (flying.get() || over.get() || evy > -300) return;
      // La force du geste fixe la hauteur atteinte : il faut passer l'arceau sans dépasser la planche
      const k = Math.max(0, Math.min(1, (-evy - 600) / 3400));
      const apex = h * (0.45 + 0.45 * k); // au-dessus du point de départ
      const g = GRAVITY * h;
      const v0 = Math.sqrt(2 * g * apex);
      // Temps pour monter puis redescendre jusqu'à l'arceau
      const climb = startY - rimY;
      const disc = v0 * v0 - 2 * g * climb;
      const tc = disc > 0 ? (v0 + Math.sqrt(disc)) / g : v0 / g;
      tCross.set(tc);
      vy.set(-v0);
      // Le geste vise : sa pente fixe où le ballon arrive à hauteur de l'arceau
      const aim = Math.max(-1.2, Math.min(1.2, evx / -evy));
      vx.set((aim * w * 0.55) / tc);
      t.set(0);
      top.set(startY);
      judged.set(false);
      touched.set(false);
      behind.set(false);
      flying.set(true);
      scheduleOnRN(launch);
    });

  const scaleOf = () => {
    'worklet';
    // Rapetisse jusqu'à l'arceau, puis reste à cette taille
    return 1 - 0.45 * Math.min(1, t.get() / tCross.get());
  };
  const ballStyle = useAnimatedStyle(() => ({
    zIndex: behind.get() ? 1 : 3,
    transform: [{ translateX: bx.get() - R }, { translateY: by.get() - R }, { scale: scaleOf() }, { rotate: `${t.get() * -540}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    zIndex: behind.get() ? 1 : 3,
    opacity: streak.get() >= FIRE ? 0.9 : 0,
    transform: [{ translateX: bx.get() - R * 2 }, { translateY: by.get() - R * 2 }, { scale: scaleOf() }],
  }));
  // Ombre sur le parquet : suit le ballon, pâlit quand il monte
  const shadowStyle = useAnimatedStyle(() => {
    const lift = Math.max(0, startY - by.get()) / (startY - rimY);
    return {
      opacity: Math.max(0, 0.45 - lift * 0.35),
      transform: [{ translateX: bx.get() - R }, { translateY: startY + R * 0.85 - lift * h * 0.06 }, { scaleX: scaleOf() * (1 - lift * 0.3) }],
    };
  });
  const hoopStyle = useAnimatedStyle(() => ({ transform: [{ translateX: hoopX.get() - w / 2 }] }));
  const netStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: 1 + swish.get() * 0.35 }, { scaleX: 1 - swish.get() * 0.15 }] }));
  const barStyle = useAnimatedStyle(() => ({ width: `${timeLeft.get() * 100}%` }));

  const boardW = rimW * 2;
  const boardH = rimW * 1.25;
  const boardTop = rimY - boardH * 0.86;
  const netH = rimW * 0.62;
  return (
    <GestureDetector gesture={pan}>
      <View style={StyleSheet.absoluteFill}>
        {/* Salle : projecteurs, gradins dans l'ombre, parquet */}
        <Image source={SALLE} contentFit="fill" style={StyleSheet.absoluteFill} />
        {[0.15, 0.5, 0.85].map((x) => (
          <Image
            key={x}
            source={HALO}
            contentFit="fill"
            tintColor="#FFE2B8"
            style={[styles.spot, { left: w * x - w * 0.35, top: -w * 0.3, width: w * 0.7, height: w * 0.7 }]}
          />
        ))}
        <View style={[styles.circle, { left: w / 2 - w * 0.36, top: h * 0.84, width: w * 0.72, height: w * 0.2, borderRadius: w * 0.36 }]} />
        <View style={[styles.line, { top: h * 0.62 }]} />

        <View style={styles.timerTrack}>
          <Animated.View style={[styles.timerBar, left <= 5 && started && { backgroundColor: c.coral }, barStyle]} />
        </View>
        <View style={styles.hud}>
          <View>
            <Text style={styles.score}>{score}</Text>
            {onFire && <Text style={styles.fire}>En feu ×2</Text>}
          </View>
          <Text style={[styles.timer, left <= 5 && started && { color: c.coral }]}>{left}s</Text>
        </View>

        <Animated.View style={[StyleSheet.absoluteFill, hoopStyle]} pointerEvents="none">
          {/* Potence, planche en verre, carré peint */}
          <View style={[styles.post, { left: w / 2 - 4, height: boardTop }]} />
          <View style={[styles.board, { width: boardW, height: boardH, left: w / 2 - boardW / 2, top: boardTop }]}>
            <View style={[styles.square, { width: rimW * 0.95, height: boardH * 0.42 }]} />
          </View>
          <View style={[styles.rimBack, { width: rimW, left: w / 2 - rimW / 2, top: rimY - 6 }]} />
        </Animated.View>

        <Animated.View style={[styles.shadow, { width: R * 2, height: R * 0.5, borderRadius: R }, shadowStyle]} pointerEvents="none" />
        <Animated.View style={[styles.glow, { width: R * 4, height: R * 4 }, glowStyle]} pointerEvents="none">
          <Image source={HALO} contentFit="fill" tintColor="#FF7A2E" style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={[styles.ball, { width: R * 2, height: R * 2 }, ballStyle]} pointerEvents="none">
          <Image source={BALLON} style={StyleSheet.absoluteFill} />
        </Animated.View>

        {/* L'avant de l'arceau et le filet passent devant le ballon qui retombe */}
        <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 2 }, hoopStyle]} pointerEvents="none">
          <Animated.View style={[styles.net, { left: w / 2 - rimW * 0.5, top: rimY, width: rimW, height: netH }, netStyle]}>
            <Image source={FILET} contentFit="fill" style={StyleSheet.absoluteFill} />
          </Animated.View>
          <View style={[styles.rimFront, { width: rimW + 6, left: w / 2 - rimW / 2 - 3, top: rimY - 5 }]} />
        </Animated.View>

        {shout && (
          <Text key={shout.key} style={[styles.shout, { top: rimY + netH + 16, color: shout.color }]} pointerEvents="none">
            {shout.text}
          </Text>
        )}
        {!started && (
          <View style={styles.hintBox} pointerEvents="none">
            <Text style={styles.hint}>Lance d’un geste vers le haut</Text>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  area: { flex: 1, overflow: 'hidden', backgroundColor: '#140C22' },
  spot: { position: 'absolute', opacity: 0.18 },
  circle: { position: 'absolute', borderWidth: 3, borderColor: 'rgba(255,255,255,0.35)' },
  line: { position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  timerTrack: { position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.1)', zIndex: 4 },
  timerBar: { height: 4, backgroundColor: c.teal },
  hud: { position: 'absolute', top: 14, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 4 },
  score: { color: '#fff', fontFamily: f.serifBlack, fontSize: 52, lineHeight: 58 },
  fire: { color: c.coral, fontFamily: f.bodyBold, fontSize: 13, letterSpacing: 1.5, textTransform: 'uppercase' },
  timer: { color: c.text, fontFamily: f.bodyBold, fontSize: 22, marginTop: 10 },
  post: { position: 'absolute', top: 0, width: 8, backgroundColor: '#3A2C4B' },
  board: {
    position: 'absolute',
    borderRadius: 10,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(200,220,255,0.12)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 8,
  },
  square: { borderWidth: 4, borderBottomWidth: 0, borderColor: c.coral, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  rimBack: { position: 'absolute', height: 12, borderRadius: 6, borderWidth: 3, borderColor: '#B84A2E' },
  rimFront: { position: 'absolute', height: 9, borderRadius: 5, backgroundColor: '#FF6A2E', borderBottomWidth: 3, borderBottomColor: '#B84A2E' },
  net: { position: 'absolute', transformOrigin: 'top' },
  shadow: { position: 'absolute', left: 0, top: 0, backgroundColor: '#000' },
  glow: { position: 'absolute', left: 0, top: 0 },
  ball: { position: 'absolute', left: 0, top: 0 },
  shout: {
    position: 'absolute',
    alignSelf: 'center',
    fontFamily: f.serifBlack,
    fontSize: 30,
    zIndex: 4,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 0,
  },
  hintBox: { position: 'absolute', left: 0, right: 0, bottom: '30%', alignItems: 'center', zIndex: 4 },
  hint: {
    color: c.text,
    fontFamily: f.bodyBold,
    fontSize: 17,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
});
