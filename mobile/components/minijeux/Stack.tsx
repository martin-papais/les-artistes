import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { GameArea, gameStyles, HintPill } from '@/components/minijeux/GameArea';
import { theme } from '@/lib/theme';

const f = theme.fonts;

const BH = 30; // hauteur d'un étage
const TOP = 8; // face du dessus, plus claire : donne du volume
const PERFECT = 6; // à moins de 6 px, le bloc se cale tout seul
const HALO = require('@/assets/olympiades/halo.png');

type Block = { x: number; w: number; hue: number };
type Falling = { id: number; x: number; y: number; w: number; hue: number; dir: number; born: number };

const front = (h: number) => `hsl(${h}, 72%, 62%)`;
const topFace = (h: number) => `hsl(${h}, 85%, 78%)`;
const side = (h: number) => `hsl(${h}, 60%, 42%)`;

/** Touche pour poser le bloc qui glisse ; ce qui dépasse tombe, la tour s'affine. */
export function Stack({ onEnd }: { onEnd: (score: number) => void }) {
  return <GameArea background="#1A1025">{(w, h) => <Tower w={w} h={h} onEnd={onEnd} />}</GameArea>;
}

function Tower({ w, h, onEnd }: { w: number; h: number; onEnd: (score: number) => void }) {
  const baseW = Math.round(w * 0.6);
  const baseY = h * 0.78; // haut du socle
  // Du violet au rose et retour, la teinte de son logo
  const hueAt = (n: number) => Math.round(300 + 32 * Math.sin(n / 5));
  const hue0 = hueAt(0);
  const [blocks, setBlocks] = useState<Block[]>([{ x: (w - baseW) / 2, w: baseW, hue: hue0 }]);
  const [falling, setFalling] = useState<Falling[]>([]);
  const [perfect, setPerfect] = useState(0); // série de poses parfaites
  const [over, setOver] = useState(false);
  const fid = useRef(0);

  const level = blocks.length; // étage du bloc qui glisse
  const top = blocks[blocks.length - 1];
  const hue = hueAt(level);

  // Le bloc qui glisse : il entre par un côté, repart dans l'autre sens au bord
  const mx = useSharedValue(-top.w);
  const dir = useSharedValue(1);
  const moving = useSharedValue(true);
  // Largeur et vitesse lues par la boucle d'animation (accélère un peu à chaque étage)
  const tw = useSharedValue(top.w);
  const speed = useSharedValue(w * 0.5);
  // Horloge de la partie : les morceaux coupés tombent selon leur âge, sans animation chacun
  const clock = useSharedValue(0);
  const loop = useFrameCallback((fr) => {
    'worklet';
    const dt = Math.min(0.034, (fr.timeSincePreviousFrame ?? 16) / 1000);
    clock.set(clock.get() + dt);
    if (!moving.get()) return;
    let x = mx.get() + dir.get() * speed.get() * dt;
    const min = -tw.get() * 0.5;
    const max = w - tw.get() * 0.5;
    if (x > max) {
      x = max;
      dir.set(-1);
    } else if (x < min) {
      x = min;
      dir.set(1);
    }
    mx.set(x);
  });

  // La caméra monte avec la tour
  const visible = Math.floor((h * 0.5) / BH);
  const cam = useSharedValue(0);
  useEffect(() => {
    cam.set(withTiming(Math.max(0, level - visible) * BH, { duration: 300 }));
  }, [level, visible, cam]);
  const camStyle = useAnimatedStyle(() => ({ transform: [{ translateY: cam.get() }] }));
  const moveStyle = useAnimatedStyle(() => ({ transform: [{ translateX: mx.get() }] }));

  const flash = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));
  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.get() }] }));

  function place() {
    if (over) return;
    const x = mx.get();
    const prev = top;
    const y = baseY - level * BH;
    const left = Math.max(x, prev.x);
    const right = Math.min(x + prev.w, prev.x + prev.w);
    if (right - left <= 0) {
      // Raté : le bloc entier tombe
      moving.set(false);
      setOver(true);
      setFalling((fl) => [...fl, { id: fid.current++, x, y, w: prev.w, hue, dir: x > prev.x ? 1 : -1, born: clock.get() }]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setTimeout(() => {
        // Le dernier morceau a fini de tomber : la boucle peut s'arrêter
        loop.setActive(false);
        onEnd(blocks.length - 1);
      }, 1100);
      return;
    }
    let next: Block;
    if (Math.abs(x - prev.x) <= PERFECT) {
      // Parfait : il se cale, et après trois de suite le bloc regagne un peu de largeur
      const streak = perfect + 1;
      setPerfect(streak);
      const grow = streak >= 3 ? Math.min(baseW - prev.w, 10) : 0;
      next = { x: prev.x - grow / 2, w: prev.w + grow, hue };
      flash.set(withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 420 })));
      pop.set(withSequence(withTiming(1.3, { duration: 90 }), withTiming(1, { duration: 180 })));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      setPerfect(0);
      next = { x: left, w: right - left, hue };
      // La partie qui dépasse tombe
      const cutX = x < prev.x ? x : right;
      const cutW = prev.w - next.w;
      // Ceux qui ont fini de tomber (plus d'1,1 s) quittent l'écran
      const now = clock.get();
      setFalling((fl) => [
        ...fl.filter((piece) => now - piece.born < 1.1),
        { id: fid.current++, x: cutX, y, w: cutW, hue, dir: x < prev.x ? -1 : 1, born: now },
      ]);
      pop.set(withSequence(withTiming(1.15, { duration: 80 }), withTiming(1, { duration: 160 })));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    setBlocks((b) => [...b, next]);
    // Le suivant part du côté opposé
    const fromRight = level % 2 === 0;
    mx.set(fromRight ? w - next.w * 0.5 : -next.w * 0.5);
    dir.set(fromRight ? -1 : 1);
    tw.set(next.w);
    speed.set(Math.min(w * 1.1, w * 0.5 * (1 + (level + 1) * 0.03)));
  }

  const score = blocks.length - 1;
  // Seuls les derniers étages sont à l'écran
  const shown = blocks.map((b, i) => ({ b, i })).filter(({ i }) => i >= level - visible - 4);
  const movingY = baseY - level * BH;
  return (
    // Le doigt agit dès qu'il touche ; le lecteur d'écran passe par l'action « activer »
    <Pressable
      onPressIn={place}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'activate' && place()}
      style={StyleSheet.absoluteFill}
      accessibilityRole="button"
      accessibilityValue={{ text: `${score} étage${score > 1 ? 's' : ''}` }}
      accessibilityLabel="Poser le bloc"
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `hsl(${hue}, 35%, 12%)` }]} />
      <Image
        source={HALO}
        contentFit="fill"
        tintColor={`hsl(${hue}, 80%, 60%)`}
        style={[styles.halo, { width: w * 1.6, height: w * 1.6, left: -w * 0.3, top: h * 0.05 }]}
      />

      <Animated.View style={[StyleSheet.absoluteFill, camStyle]}>
        {/* Socle */}
        <View style={[styles.base, { top: baseY + BH, left: (w - baseW) / 2 - 12, width: baseW + 24, height: h }]} />
        {shown.map(({ b, i }) => (
          <BlockView key={i} x={b.x} y={baseY - i * BH} w={b.w} hue={b.hue} />
        ))}
        {/* Contour blanc d'une pose parfaite */}
        {level > 1 && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ring,
              { left: top.x - 6, top: baseY - (level - 1) * BH - 6, width: top.w + 12, height: BH + 12 },
              flashStyle,
            ]}
          />
        )}
        {!over && (
          <Animated.View style={[styles.block, { top: movingY, width: top.w }, moveStyle]}>
            <Faces hue={hue} />
          </Animated.View>
        )}
        {falling.map((p) => (
          <FallingPiece key={p.id} p={p} h={h} clock={clock} />
        ))}
      </Animated.View>

      <Animated.Text style={[gameStyles.score, popStyle]} maxFontSizeMultiplier={1.3}>{score}</Animated.Text>
      {perfect >= 2 && !over && <Text style={styles.combo} maxFontSizeMultiplier={1.5}>Parfait ×{perfect}</Text>}
      {score === 0 && !over && <HintPill text="Touche pour poser le bloc" at={{ top: '22%' }} />}
    </Pressable>
  );
}

function Faces({ hue }: { hue: number }) {
  return (
    <>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: front(hue), borderBottomWidth: 4, borderBottomColor: side(hue) }]} />
      <View style={[styles.topFace, { backgroundColor: topFace(hue) }]} />
    </>
  );
}

function BlockView({ x, y, w, hue }: { x: number; y: number; w: number; hue: number }) {
  return (
    <View style={[styles.block, { left: x, top: y, width: w }]}>
      <Faces hue={hue} />
    </View>
  );
}

function FallingPiece({ p, h, clock }: { p: Falling; h: number; clock: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = Math.min(1, (clock.get() - p.born) / 1.1);
    return {
      opacity: 1 - t,
      transform: [{ translateX: p.dir * t * 40 }, { translateY: t * t * h * 0.9 }, { rotate: `${p.dir * t * 40}deg` }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.block, { left: p.x, top: p.y, width: p.w }, style]}>
      <Faces hue={p.hue} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  halo: { position: 'absolute', opacity: 0.22 },
  base: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.06)', borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  block: { position: 'absolute', left: 0, height: BH, borderRadius: 3, overflow: 'hidden' },
  topFace: { position: 'absolute', left: 0, right: 0, top: 0, height: TOP },
  ring: { position: 'absolute', borderWidth: 3, borderColor: '#fff', borderRadius: 8 },
  combo: { position: 'absolute', top: 104, alignSelf: 'center', color: '#fff', fontFamily: f.bodyBold, fontSize: 15, letterSpacing: 2, textTransform: 'uppercase' },
});
