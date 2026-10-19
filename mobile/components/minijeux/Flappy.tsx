import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { GameArea, gameStyles, HintPill } from '@/components/minijeux/GameArea';

// Réglages exprimés en fraction de l'aire de jeu : même difficulté sur tous les écrans
const BIRD = 56; // taille du dessin ; la boîte de collision est plus petite
const HIT = 30;
const PIPE_W = 66;
const GROUND = 64;
const GRAVITY = 2.5; // × hauteur / s²
const FLAP = 0.74; // × hauteur / s, vers le haut
const GAP_START = 0.29; // trou entre deux tuyaux, × hauteur, se resserre avec le score
const GAP_MIN = 0.22;
const SPACING = 0.68; // écart entre deux tuyaux, × largeur
const SPEED = 0.42; // défilement, × largeur / s, accélère un peu avec le score

const CIEL = require('@/assets/minijeux/flappy-ciel.png');
const VILLE = require('@/assets/minijeux/flappy-ville.png');
const VILLE_LOIN = require('@/assets/minijeux/flappy-ville-loin.png');
const SOL = require('@/assets/minijeux/flappy-sol.png');
const TUYAU = require('@/assets/minijeux/tuyau.png');
const CHAPEAU = require('@/assets/minijeux/tuyau-chapeau.png');
const AILE_HAUT = require('@/assets/minijeux/oiseau-haut.png');
const AILE_BAS = require('@/assets/minijeux/oiseau-bas.png');

const gapAt = (points: number) => {
  'worklet';
  return Math.max(GAP_MIN, GAP_START - points * 0.003);
};

/** Hauteur du haut du trou, au hasard, sans coller au plafond ni au sol */
const randomGap = (playH: number, gap: number) => {
  'worklet';
  const m = playH * 0.1;
  return m + Math.random() * (playH - gap * playH - m * 2);
};

/** Touche pour battre des ailes ; un tuyau passé = un point. */
export function Flappy({ onEnd }: { onEnd: (score: number) => void }) {
  return <GameArea background="#1A1030">{(w, h) => <Game w={w} h={h} onEnd={onEnd} />}</GameArea>;
}

function Game({ w, h, onEnd }: { w: number; h: number; onEnd: (score: number) => void }) {
  const playH = h - GROUND;
  const birdX = w * 0.28;
  const [score, setScore] = useState(0);
  const [started, setStarted] = useState(false);

  const y = useSharedValue(playH * 0.42);
  const vy = useSharedValue(0);
  const running = useSharedValue(false);
  const alive = useSharedValue(true);
  const points = useSharedValue(0);
  const dist = useSharedValue(0); // distance parcourue, pour les décors qui défilent
  const clock = useSharedValue(0);
  const flapAt = useSharedValue(-1);
  const shake = useSharedValue(0);
  const flash = useSharedValue(0);
  const pop = useSharedValue(1);
  // Trois paires de tuyaux qui reviennent à droite une fois sorties de l'écran
  const x0 = useSharedValue(w * 1.15);
  const x1 = useSharedValue(w * 1.15 + w * SPACING);
  const x2 = useSharedValue(w * 1.15 + w * SPACING * 2);
  const g0 = useSharedValue(randomGap(playH, GAP_START));
  const g1 = useSharedValue(randomGap(playH, GAP_START));
  const g2 = useSharedValue(randomGap(playH, GAP_START));
  const h0 = useSharedValue(GAP_START);
  const h1 = useSharedValue(GAP_START);
  const h2 = useSharedValue(GAP_START);
  const p0 = useSharedValue(false);
  const p1 = useSharedValue(false);
  const p2 = useSharedValue(false);
  // Regroupés une fois pour toutes : la boucle ne recrée pas de tableau à chaque image
  const pipes = [
    { x: x0, g: g0, h: h0, p: p0 },
    { x: x1, g: g1, h: h1, p: p1 },
    { x: x2, g: g2, h: h2, p: p2 },
  ];

  const frame = useFrameCallback((fr) => {
    'worklet';
    const dt = Math.min(0.034, (fr.timeSincePreviousFrame ?? 16) / 1000);
    clock.set(clock.get() + dt);
    if (!alive.get()) {
      // Il tombe jusqu'au sol après le choc, puis plus rien ne bouge : la boucle s'arrête
      if (y.get() + HIT < playH) {
        vy.set(vy.get() + GRAVITY * playH * dt);
        y.set(Math.min(playH - HIT, y.get() + vy.get() * dt));
      } else {
        scheduleOnRN(halt);
      }
      return;
    }
    const speed = w * SPEED * (1 + Math.min(points.get(), 40) * 0.012);
    if (!running.get()) {
      // En attendant la première touche : il flotte et le décor défile doucement
      y.set(playH * 0.42 + Math.sin(clock.get() * 4) * 8);
      dist.set(dist.get() + speed * 0.5 * dt);
      return;
    }
    dist.set(dist.get() + speed * dt);
    const nvy = vy.get() + GRAVITY * playH * dt;
    vy.set(nvy);
    const ny = Math.max(-HIT, y.get() + nvy * dt);
    y.set(ny);
    // Boîte de collision au centre du dessin
    const top = ny + (BIRD - HIT) / 2;
    const left = birdX + (BIRD - HIT) / 2;
    let dead = top + HIT >= playH;
    for (const pipe of pipes) {
      let px = pipe.x.get() - speed * dt;
      if (px < -PIPE_W - 20) {
        px += w * SPACING * 3;
        const gap = gapAt(points.get());
        pipe.h.set(gap);
        pipe.g.set(randomGap(playH, gap));
        pipe.p.set(false);
      }
      pipe.x.set(px);
      const gy = pipe.g.get();
      const gh = pipe.h.get() * playH;
      const overlapX = left + HIT > px && left < px + PIPE_W;
      if (overlapX && (top < gy || top + HIT > gy + gh)) dead = true;
      if (!pipe.p.get() && px + PIPE_W < left) {
        pipe.p.set(true);
        points.set(points.get() + 1);
        scheduleOnRN(scored, points.get());
      }
    }
    if (dead) {
      alive.set(false);
      vy.set(Math.min(vy.get(), 0) - playH * 0.2);
      shake.set(withSequence(withTiming(1, { duration: 40 }), withTiming(-1, { duration: 60 }), withTiming(0.6, { duration: 60 }), withTiming(0, { duration: 80 })));
      flash.set(withSequence(withTiming(0.85, { duration: 50 }), withTiming(0, { duration: 350 })));
      scheduleOnRN(crash, points.get());
    }
  }, true);

  function scored(n: number) {
    setScore(n);
    pop.set(withSequence(withTiming(1.35, { duration: 90 }), withTiming(1, { duration: 160 })));
    Haptics.selectionAsync().catch(() => {});
  }

  function crash(final: number) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setTimeout(() => onEnd(final), 1100);
  }

  function halt() {
    frame.setActive(false);
  }

  useEffect(() => () => frame.setActive(false), [frame]);

  function flap() {
    if (!alive.get()) return;
    if (!running.get()) {
      running.set(true);
      setStarted(true);
    }
    vy.set(-FLAP * playH);
    flapAt.set(clock.get());
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }

  const birdStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: y.get() },
      // Le nez monte quand il bat des ailes, pique quand il tombe
      { rotate: `${Math.max(-25, Math.min(80, (vy.get() / playH) * 70))}deg` },
    ],
  }));
  // Aile levée juste après un battement, et en vol plané au repos
  const wingUp = useAnimatedStyle(() => {
    const since = clock.get() - flapAt.get();
    const up = since >= 0 && since < 0.12 ? 1 : !running.get() ? (Math.sin(clock.get() * 14) > 0 ? 1 : 0) : 0;
    return { opacity: up };
  });
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() * 10 }, { translateY: shake.get() * -6 }] }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));

  const stars = useMemo(
    () =>
      Array.from({ length: 28 }, () => ({
        left: Math.random() * w,
        top: Math.random() * playH * 0.45,
        size: Math.random() < 0.2 ? 3 : 2,
        opacity: 0.35 + Math.random() * 0.5,
      })),
    [w, playH],
  );

  const cityH = playH * 0.3;
  return (
    <Pressable onPressIn={flap} style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Battre des ailes">
      <Animated.View style={[StyleSheet.absoluteFill, shakeStyle]}>
        <Image source={CIEL} contentFit="fill" style={StyleSheet.absoluteFill} />
        {stars.map((s, i) => (
          <View key={i} style={[styles.star, { left: s.left, top: s.top, width: s.size, height: s.size, opacity: s.opacity }]} />
        ))}
        <View style={[styles.moon, { left: w * 0.1, top: playH * 0.2 }]} />
        <Strip source={VILLE_LOIN} dist={dist} factor={0.12} tileW={(cityH * 1.1 * 512) / 220} height={cityH * 1.1} bottom={GROUND} w={w} />
        <Strip source={VILLE} dist={dist} factor={0.3} tileW={(cityH * 512) / 200} height={cityH} bottom={GROUND} w={w} />

        <Pipe x={x0} gap={g0} gapH={h0} playH={playH} />
        <Pipe x={x1} gap={g1} gapH={h1} playH={playH} />
        <Pipe x={x2} gap={g2} gapH={h2} playH={playH} />

        <Strip source={SOL} dist={dist} factor={1} tileW={GROUND * 2} height={GROUND} bottom={0} w={w} />

        <Animated.View style={[styles.bird, { left: birdX }, birdStyle]}>
          <Image source={AILE_BAS} style={StyleSheet.absoluteFill} />
          <Animated.View style={[StyleSheet.absoluteFill, wingUp]}>
            <Image source={AILE_HAUT} style={StyleSheet.absoluteFill} />
          </Animated.View>
        </Animated.View>

        <Animated.Text style={[gameStyles.score, popStyle]}>{score}</Animated.Text>
        {!started && <HintPill text="Touche pour t’envoler" at={{ top: '60%' }} />}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} pointerEvents="none" />
    </Pressable>
  );
}

/** Bande de décor qui se répète et défile à sa vitesse (parallaxe) */
function Strip({
  source,
  dist,
  factor,
  tileW,
  height,
  bottom,
  w,
}: {
  source: number;
  dist: SharedValue<number>;
  factor: number;
  tileW: number;
  height: number;
  bottom: number;
  w: number;
}) {
  const n = Math.ceil(w / tileW) + 1;
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -((dist.get() * factor) % tileW) }] }));
  return (
    <Animated.View style={[styles.strip, { bottom, height, width: tileW * n }, style]} pointerEvents="none">
      {Array.from({ length: n }, (_, i) => (
        <Image key={i} source={source} contentFit="fill" style={{ width: tileW + 1, height }} />
      ))}
    </Animated.View>
  );
}

function Pipe({ x, gap, gapH, playH }: { x: SharedValue<number>; gap: SharedValue<number>; gapH: SharedValue<number>; playH: number }) {
  const topStyle = useAnimatedStyle(() => ({ height: gap.get(), transform: [{ translateX: x.get() }] }));
  const bottomStyle = useAnimatedStyle(() => ({
    top: gap.get() + playH * gapH.get(),
    height: Math.max(0, playH - gap.get() - playH * gapH.get()),
    transform: [{ translateX: x.get() }],
  }));
  return (
    <>
      <Animated.View style={[styles.pipe, { top: 0 }, topStyle]}>
        <Image source={TUYAU} contentFit="fill" style={StyleSheet.absoluteFill} />
        <Image source={CHAPEAU} contentFit="fill" style={[styles.cap, { bottom: 0 }]} />
      </Animated.View>
      <Animated.View style={[styles.pipe, bottomStyle]}>
        <Image source={TUYAU} contentFit="fill" style={StyleSheet.absoluteFill} />
        <Image source={CHAPEAU} contentFit="fill" style={[styles.cap, { top: 0 }]} />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  star: { position: 'absolute', borderRadius: 2, backgroundColor: '#fff' },
  moon: { position: 'absolute', width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFE9C2', opacity: 0.9 },
  strip: { position: 'absolute', left: 0, flexDirection: 'row' },
  pipe: { position: 'absolute', left: 0, width: PIPE_W },
  cap: { position: 'absolute', left: -8, right: -8, height: 26 },
  bird: { position: 'absolute', top: 0, width: BIRD, height: BIRD },
  flash: { backgroundColor: '#fff' },
});
