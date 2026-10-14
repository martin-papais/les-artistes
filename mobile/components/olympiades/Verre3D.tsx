import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

// Verre en 3D sans moteur 3D (pas de module natif, part en mise à jour à distance) :
// le décor, à plat, est découpé en bandes verticales posées sur un cylindre.
// Chaque bande est placée, rétrécie et ombrée selon son angle ; les bandes du dos
// restent visibles en transparence, à l'envers, comme sur un vrai gobelet.

type Props = {
  width: number;
  height: number;
  /** Angle en degrés (0 = milieu du décor face à soi) */
  rotation: SharedValue<number>;
  /** Décor déroulé : image (largeur = π × diamètre) ou rendu fourni */
  art?: string;
  children?: ReactNode;
  strips?: number;
  /** Bandes du dos, vu en transparence (0 = pas de transparence) */
  backStrips?: number;
  tint?: string;
};

type Geo = { R: number; e: number; n: number; height: number };

const LIGHT = (-38 * Math.PI) / 180; // lumière venant de l'avant gauche

export function Verre3D({
  width,
  height,
  rotation,
  art,
  children,
  strips = 32,
  backStrips = 0,
  tint = 'rgba(255,255,255,0.07)',
}: Props) {
  const R = width / 2;
  const T = Math.PI * width;
  const e = width * 0.13; // demi-hauteur de l'ellipse du bord (vu d'un peu au-dessus)
  const flat = (2 * e) / width;

  const texture = art ? (
    <Image source={{ uri: art }} style={{ width: T, height }} contentFit="cover" />
  ) : (
    <View style={{ width: T, height }}>{children}</View>
  );

  const ellipse = (top: number) => ({
    width,
    height: width,
    borderRadius: width / 2,
    top,
    transform: [{ scaleY: flat }],
  });

  return (
    // Le décor est répété dans chaque bande : on le cache aux lecteurs d'écran
    <View
      style={{ width, height: height + 2 * e, paddingTop: e }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {/* Ombre portée */}
      <View
        style={[
          styles.abs,
          {
            width: width * 1.1,
            height: width * 1.1,
            borderRadius: width,
            left: -width * 0.05,
            top: e + height - width * 0.55,
            backgroundColor: 'rgba(0,0,0,0.45)',
            transform: [{ scaleY: (2 * e) / (width * 1.1) }],
          },
        ]}
      />
      <View style={{ width, height }}>
        <View style={[styles.abs, { width, height, backgroundColor: tint }]} />
        <View style={[styles.abs, ellipse(height - width / 2), { backgroundColor: tint }]} />
        {backStrips > 0 &&
          Array.from({ length: backStrips }, (_, k) => (
            <BackStrip key={k} k={k} geo={{ R, e, n: backStrips, height }} rotation={rotation}>
              {texture}
            </BackStrip>
          ))}
        {/* Bord arrière du gobelet, vu à travers l'ouverture */}
        <View
          style={[
            styles.abs,
            ellipse(-width / 2),
            { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(255,255,255,0.04)' },
          ]}
        />
        {Array.from({ length: strips }, (_, k) => (
          <FrontStrip key={k} k={k} geo={{ R, e, n: strips, height }} rotation={rotation}>
            {texture}
          </FrontStrip>
        ))}
        {/* Liseré avant du bord */}
        <View
          pointerEvents="none"
          style={[
            styles.abs,
            ellipse(-width / 2),
            { borderWidth: 2, borderColor: 'transparent', borderBottomColor: 'rgba(255,255,255,0.7)' },
          ]}
        />
      </View>
    </View>
  );
}

const angleOf = (k: number, n: number) => ((k + 0.5) / n - 0.5) * 360;

function useStripStyle(k: number, geo: Geo, rotation: SharedValue<number>, back: boolean) {
  const { R, e, n } = geo;
  const base = angleOf(k, n);
  return useAnimatedStyle(() => {
    const a = ((base + rotation.get()) * Math.PI) / 180;
    const c = Math.cos(a);
    const visible = back ? c < 0 : c > 0;
    return {
      opacity: visible ? (back ? 0.32 : 1) : 0,
      transform: [
        { translateX: R * Math.sin(a) },
        { translateY: e * c },
        // Négatif au dos : la bande apparaît à l'envers, comme vue à travers le plastique
        { scaleX: Math.abs(c) < 0.001 ? 0.001 : c },
      ],
    };
  });
}

type StripProps = { k: number; geo: Geo; rotation: SharedValue<number>; children: ReactNode };

function StripBox({
  k,
  geo,
  style,
  children,
  overlay,
}: {
  k: number;
  geo: Geo;
  style: ReturnType<typeof useStripStyle>;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  const sw = (2 * Math.PI * geo.R) / geo.n;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.strip,
        // Léger recouvrement, sinon de fines lignes apparaissent entre les bandes
        { left: geo.R - sw / 2, width: sw + 0.6, height: geo.height },
        style,
      ]}
    >
      {/* Le décor ne change pas : il reste en texture, seul son cadre bouge */}
      <View style={{ position: 'absolute', left: -k * sw, top: 0 }} shouldRasterizeIOS renderToHardwareTextureAndroid>
        {children}
      </View>
      {overlay}
    </Animated.View>
  );
}

function FrontStrip({ k, geo, rotation, children }: StripProps) {
  const style = useStripStyle(k, geo, rotation, false);
  const base = angleOf(k, geo.n);
  // Ombre sur les côtés, reflet à gauche : une seule couche, mélange continu
  const light = useAnimatedStyle(() => {
    const a = ((base + rotation.get()) * Math.PI) / 180;
    const shine = 0.3 * Math.pow(Math.max(0, Math.cos(a - LIGHT)), 30);
    const shade = 0.55 * (1 - Math.max(0, Math.cos(a)));
    const net = shine - shade;
    return { backgroundColor: net >= 0 ? `rgba(255,255,255,${net})` : `rgba(0,0,0,${-net})` };
  });
  return (
    <StripBox k={k} geo={geo} style={style} overlay={<Animated.View style={[StyleSheet.absoluteFill, light]} />}>
      {children}
    </StripBox>
  );
}

function BackStrip({ k, geo, rotation, children }: StripProps) {
  const style = useStripStyle(k, geo, rotation, true);
  return (
    <StripBox k={k} geo={geo} style={style}>
      {children}
    </StripBox>
  );
}

const styles = StyleSheet.create({
  strip: { position: 'absolute', top: 0, overflow: 'hidden' },
  abs: { position: 'absolute', left: 0 },
});
