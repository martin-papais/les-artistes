import { Asset } from 'expo-asset';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useEffect, useRef } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import * as THREE from 'three';

// Le vrai verre en 3D : un écocup tourné (lèvre roulée, pied, paroi épaisse) en plastique
// dépoli translucide, avec l'impression déroulée posée sur la paroi extérieure.
// L'encre du dos se voit à travers le plastique, à l'envers, comme sur le vrai.

type Props = {
  width: number;
  height: number;
  /** Angle en degrés (0 = milieu du décor face à soi) */
  rotation: SharedValue<number>;
  /** Décor déroulé : adresse ou image embarquée, fond transparent */
  art: string | number;
  /** Le rendu s'arrête quand le verre n'est pas à l'écran */
  active: boolean;
};

// Ecocup « Eco 30 » (25 cl utiles), en cm : bord Ø 7,4, hauteur 11,8 (fiche revendeur),
// fond Ø 4,8 (mesuré sur la vidéo du verre 2025)
const R_TOP = 3.7;
const R_FOOT = 2.4;
const Y_FOOT = 0.08;
const Y_RIM = 11.6;
const WALL = 0.08;

const outerAt = (y: number) => R_FOOT + ((R_TOP - R_FOOT) * (y - Y_FOOT)) / (Y_RIM - Y_FOOT);

/** Paroi extérieure : dessous, pied, flanc et lèvre roulée (normales vers l'extérieur) */
function outerProfile() {
  const pts: [number, number][] = [
    [0, 0.14],
    [R_FOOT - 0.3, 0.14],
    [R_FOOT - 0.18, 0.03],
    [R_FOOT - 0.08, 0],
    [R_FOOT, Y_FOOT],
  ];
  for (let i = 1; i <= 24; i++) {
    const y = Y_FOOT + ((Y_RIM - Y_FOOT) * i) / 24;
    pts.push([outerAt(y), y]);
  }
  const lc = [R_TOP - 0.02, Y_RIM + 0.11];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (Math.PI * 1.15 * i) / 10;
    pts.push([lc[0] + 0.13 * Math.cos(a), lc[1] + 0.13 * Math.sin(a)]);
  }
  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}

/** Paroi intérieure et fond du verre (normales vers l'axe) */
function innerProfile() {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const y = Y_RIM + 0.05 - ((Y_RIM + 0.05 - 0.6) * i) / 24;
    pts.push([outerAt(y) - WALL, y]);
  }
  pts.push([outerAt(0.6) - WALL - 0.12, 0.55], [0, 0.55]);
  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}

/** Plastique dépoli : plus opaque sur les bords, là où le regard traverse plus de matière */
function frosted(side: THREE.Side) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xf4f6fb,
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.35,
    transparent: true,
    // Presque clair de face : on voit à travers ; le dépoli se lit sur les bords
    opacity: 0.07,
    depthWrite: false,
    side,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      float fres = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
      diffuseColor.a = mix(diffuseColor.a, 0.6, fres);`,
    );
  };
  return m;
}

async function loadTexture(art: string | number) {
  const asset = typeof art === 'number' ? Asset.fromModule(art) : Asset.fromURI(art);
  await asset.downloadAsync();
  const tex = new THREE.Texture();
  // expo-gl envoie l'image au GPU à partir de son fichier local
  tex.image = { data: asset, width: asset.width ?? 1, height: asset.height ?? 1 };
  (tex as unknown as { isDataTexture: boolean }).isDataTexture = true;
  // expo-gl ne retourne pas l'image : on la retourne par les coordonnées
  tex.flipY = false;
  tex.repeat.set(1, -1);
  tex.offset.set(0, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function VerreGL({ width, height, rotation, art, active }: Props) {
  const activeRef = useRef(active);
  const raf = useRef<number | null>(null);
  const draw = useRef<(() => void) | null>(null);
  // La texture se charge après la création du contexte : si la vue a disparu entre-temps,
  // on ne lance pas la boucle de rendu sur un contexte détruit
  const mounted = useRef(true);
  const dispose = useRef<(() => void) | null>(null);

  useEffect(() => {
    activeRef.current = active;
    if (active && raf.current === null && draw.current) draw.current();
  }, [active]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      draw.current = null;
      dispose.current?.();
      dispose.current = null;
    };
  }, []);

  async function onContextCreate(gl: ExpoWebGLRenderingContext) {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    // three.js attend un canvas : on lui en donne l'essentiel
    const canvas = {
      width: w,
      height: h,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      clientHeight: h,
      getContext: () => gl,
    } as unknown as HTMLCanvasElement;
    // expo-gl ignore quelques réglages de WebGL et le signale à chaque image
    const pixelStorei = gl.pixelStorei.bind(gl);
    gl.pixelStorei = (p: number, v: number | boolean) => {
      if (p === gl.UNPACK_ALIGNMENT || p === gl.PACK_ALIGNMENT) pixelStorei(p, v as number);
    };

    const renderer = new THREE.WebGLRenderer({ canvas, context: gl as unknown as WebGL2RenderingContext, antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    // Presque à hauteur d'yeux, longue focale : le verre garde ses proportions
    // (vu de trop haut, l'ouverture mange la hauteur et il paraît tassé)
    const camera = new THREE.PerspectiveCamera(16, w / h, 1, 200);
    camera.position.set(0, 10.2, 50);
    camera.lookAt(0, 6, 0);

    scene.add(new THREE.HemisphereLight(0xfff4ea, 0x3a2a48, 1.35));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-8, 14, 12);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xc9d6ff, 1.4);
    rim.position.set(9, 6, -10);
    scene.add(rim);

    const cup = new THREE.Group();
    scene.add(cup);
    // Une surface transparente se dessine du fond vers l'avant. Les deux parois sont des objets
    // séparés : dans un seul objet, leurs triangles se mêlent et une arête nette apparaît.
    const outer = new THREE.LatheGeometry(outerProfile(), 128);
    const inner = new THREE.LatheGeometry(innerProfile(), 128);
    const layer = (geo: THREE.BufferGeometry, side: THREE.Side, order: number) => {
      const m = new THREE.Mesh(geo, frosted(side));
      m.renderOrder = order;
      cup.add(m);
    };
    layer(outer, THREE.BackSide, 1); // paroi du fond, vue de l'intérieur
    layer(inner, THREE.FrontSide, 3); // intérieur du fond
    layer(inner, THREE.BackSide, 4); // intérieur de l'avant
    layer(outer, THREE.FrontSide, 5); // paroi de l'avant

    // Image introuvable (hors connexion, adresse du site cassée) : le verre reste nu
    const tex = await loadTexture(art).catch(() => null);
    const hh = Y_RIM - Y_FOOT;
    // Un cheveu au-dessus de la paroi, du pied au bord
    const printGeo = new THREE.CylinderGeometry(R_TOP + 0.012, R_FOOT + 0.012, hh, 160, 1, true);
    printGeo.translate(0, Y_FOOT + hh / 2, 0);
    const ink = (side: THREE.Side, order: number, opacity: number) => {
      const m = new THREE.Mesh(
        printGeo,
        new THREE.MeshStandardMaterial({
          map: tex,
          transparent: true,
          opacity,
          roughness: 0.6,
          side,
          depthWrite: false,
          alphaTest: 0.02,
          // L'encre garde ses couleurs : pas d'écrasement par le rendu filmique
          toneMapped: false,
        }),
      );
      m.renderOrder = order;
      return m;
    };
    // L'encre du dos, vue à travers le plastique dépoli, reste discrète
    if (tex) cup.add(ink(THREE.BackSide, 2, 0.3), ink(THREE.FrontSide, 6, 1));

    // Pas d'ombre ici : le verre est posé sur le socle éclairé de l'écran

    const frame = () => {
      raf.current = null;
      if (!draw.current) return;
      // Le décor commence au dos (u = 0) : un demi-tour met son milieu face à la caméra.
      // Un angle qui grandit fait passer l'avant vers la droite, comme le doigt.
      cup.rotation.y = Math.PI + (rotation.get() * Math.PI) / 180;
      renderer.render(scene, camera);
      gl.endFrameEXP();
      if (activeRef.current) raf.current = requestAnimationFrame(frame);
    };
    // Libère la mémoire du GPU quand le verre quitte l'écran (changement d'année)
    const release = () => {
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      tex?.dispose();
      renderer.dispose();
    };
    if (!mounted.current) {
      release();
      return;
    }
    dispose.current = release;
    draw.current = frame;
    frame();
  }

  return <GLView style={{ width, height }} onContextCreate={onContextCreate} />;
}
