/**
 * Pièces communes de la DA « Nuit d'affiche ». Tous les écrans s'en servent :
 * même en-tête, mêmes boutons, mêmes pastilles, mêmes feuilles du bas.
 */
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { forwardRef, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAvatar } from '@/lib/avatars';
import { KeyboardAware } from '@/lib/keyboard';
import { memberColor, memberColorByName, theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

export type FeatherName = ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 22, color = c.text }: { name: FeatherName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

/* ------------------------------------------------------------------ texte */

export function T({
  children,
  style,
  numberOfLines,
  variant = 'body',
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  variant?: 'display' | 'title' | 'section' | 'body' | 'detail' | 'label';
}) {
  return (
    <Text style={[txt[variant], style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

const txt = StyleSheet.create({
  display: { fontFamily: f.serifBlack, fontSize: 40, lineHeight: 46, letterSpacing: -0.5, color: c.text },
  title: { fontFamily: f.serif, fontSize: 20, lineHeight: 25, color: c.text },
  section: { fontFamily: f.bodyBold, fontSize: 18, lineHeight: 24, color: c.text },
  body: { fontFamily: f.body, fontSize: 16, lineHeight: 23, color: c.text },
  detail: { fontFamily: f.body, fontSize: 14, lineHeight: 20, color: c.muted },
  label: { fontFamily: f.bodyBold, fontSize: 14, lineHeight: 19, color: c.text },
});

/* --------------------------------------------------------------- en-tête */

/**
 * En-tête d'écran : grand titre Playfair, sous-titre gris, action à droite.
 * `back` affiche le chevron de retour (écrans hors onglets).
 * À placer en haut d'une ScrollView : il gère la marge de l'encoche.
 */
export function ScreenHeader({
  title,
  sub,
  right,
  back,
  onBack,
  style,
}: {
  title: string;
  sub?: string | null;
  right?: ReactNode;
  back?: boolean;
  onBack?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/plus')));
  return (
    <View style={[{ paddingTop: insets.top + (back ? 4 : 14), paddingHorizontal: theme.gutter }, style]}>
      {back && (
        <Pressable onPress={goBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Retour" style={s.back}>
          <Feather name="chevron-left" size={28} color={c.coral} />
        </Pressable>
      )}
      <View style={s.headRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={txt.display} accessibilityRole="header" numberOfLines={2}>
            {title}
          </Text>
          {!!sub && <Text style={[txt.detail, { fontSize: 15, marginTop: 2 }]}>{sub}</Text>}
        </View>
        {right}
      </View>
    </View>
  );
}

/** Titre de section, en minuscules, avec un compteur gris optionnel. */
export function SectionTitle({
  children,
  count,
  right,
  style,
}: {
  children: ReactNode;
  count?: number | string | null;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.sectionRow, style]}>
      <Text style={txt.section} accessibilityRole="header">
        {children}
        {count != null && count !== '' && <Text style={{ color: c.muted, fontFamily: f.bodyMedium }}> {count}</Text>}
      </Text>
      {right}
    </View>
  );
}

/* --------------------------------------------------------------- pastilles */

export function initialOf(name: string | null | undefined) {
  const t = (name ?? '').trim();
  return t ? t[0].toUpperCase() : '?';
}

/** Pastille d'un membre : sa photo, sinon sa couleur et son initiale, la même partout. */
export function Pastille({
  id,
  name,
  size = 44,
  ring,
  style,
  serif,
}: {
  id: string | null | undefined;
  name: string | null | undefined;
  size?: number;
  /** contour (ex. couleur de la carte, pour les piles) */
  ring?: string;
  style?: StyleProp<ViewStyle>;
  serif?: boolean;
}) {
  const avatar = useAvatar(id);
  const col = avatar?.color ? memberColorByName(avatar.color) : memberColor(id);
  const [broken, setBroken] = useState<string | null>(null);
  const url = avatar?.url && avatar.url !== broken ? avatar.url : null;
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        accessible={false}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
        onError={() => setBroken(url)}
        style={[
          { width: size, height: size, borderRadius: size / 2, backgroundColor: col.bg },
          ring ? { borderWidth: 2, borderColor: ring } : null,
          style as object,
        ]}
      />
    );
  }
  return (
    <View
      accessible={false}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: col.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ring ? { borderWidth: 2, borderColor: ring } : null,
        style,
      ]}
    >
      <Text
        style={{
          color: col.fg,
          fontFamily: serif ? f.serifBlack : f.bodyBold,
          fontSize: Math.round(size * (serif ? 0.46 : 0.4)),
          lineHeight: Math.round(size * (serif ? 0.6 : 0.52)),
        }}
      >
        {initialOf(name)}
      </Text>
    </View>
  );
}

/** Pile de pastilles qui se chevauchent, avec « +N » au bout. */
export function PastilleStack({
  people,
  max = 3,
  size = 28,
  ring = c.card,
}: {
  people: { id: string; name: string | null | undefined }[];
  max?: number;
  size?: number;
  ring?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <View style={{ flexDirection: 'row' }} accessible={false}>
      {shown.map((p, i) => (
        <Pastille key={p.id} id={p.id} name={p.name} size={size} ring={ring} style={i ? { marginLeft: -size * 0.28 } : null} />
      ))}
      {rest > 0 && (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: c.rail,
            borderWidth: 2,
            borderColor: ring,
            marginLeft: -size * 0.28,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: c.text, fontFamily: f.bodyBold, fontSize: Math.round(size * 0.38) }}>+{rest}</Text>
        </View>
      )}
    </View>
  );
}

/* ----------------------------------------------------------------- boutons */

type Variant = 'primary' | 'secondary' | 'yes' | 'ghost' | 'danger' | 'raised';

const VARIANT: Record<Variant, { bg: string; fg: string }> = {
  primary: { bg: c.coral, fg: '#fff' },
  secondary: { bg: c.card, fg: c.text },
  raised: { bg: c.rail, fg: c.text },
  yes: { bg: c.teal, fg: c.tealInk },
  ghost: { bg: 'transparent', fg: c.muted },
  danger: { bg: 'transparent', fg: c.danger },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  height = 52,
  style,
  accessibilityLabel,
  selected,
}: {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: FeatherName;
  disabled?: boolean;
  loading?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** bouton bascule (Je viens / Pas dispo) */
  selected?: boolean;
}) {
  const v = VARIANT[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, selected }}
      style={({ pressed }) => [
        s.btn,
        { height, borderRadius: height / 2, backgroundColor: v.bg },
        off && { opacity: 0.45 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon && <Feather name={icon} size={19} color={v.fg} />}
          <Text style={[s.btnText, { color: v.fg, fontSize: height >= 50 ? 16 : 15 }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** Bouton rond à icône (fermer, envoyer, « … »). 44 px. */
export function IconButton({
  name,
  onPress,
  label,
  color = c.text,
  bg = c.card,
  size = 44,
  disabled,
  style,
}: {
  name: FeatherName;
  onPress?: () => void;
  label: string;
  color?: string;
  bg?: string;
  size?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' },
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Feather name={name} size={Math.round(size * 0.48)} color={color} />
    </Pressable>
  );
}

/** Bouton flottant « Créer », au-dessus de la barre d'onglets. */
export function Fab({ label, onPress, icon = 'plus', bottom = 16 }: { label: string; onPress: () => void; icon?: FeatherName; bottom?: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [s.fab, { bottom }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
    >
      <Feather name={icon} size={22} color="#fff" />
      <Text style={[s.btnText, { color: '#fff', fontSize: 16 }]}>{label}</Text>
    </Pressable>
  );
}

/* ------------------------------------------------------- onglets et puces */

/** Interrupteur à deux ou trois onglets dans une gélule (Alcool / Société). */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  activeColor = c.coral,
  activeText = '#fff',
  style,
}: {
  options: { key: K; label: string; color?: string; textColor?: string }[];
  value: K;
  onChange: (k: K) => void;
  activeColor?: string;
  activeText?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.seg, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[s.segItem, on && { backgroundColor: o.color ?? activeColor }]}
          >
            <Text style={[s.segText, { color: on ? (o.textColor ?? activeText) : c.muted }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Puce de filtre : claire quand elle est choisie. */
export function Chip({
  label,
  active,
  onPress,
  icon,
  color,
  style,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: FeatherName;
  /** couleur de fond quand active (blanc cassé par défaut) */
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = active ? (color ?? c.text) : c.card;
  const fg = active ? (color === c.coral ? '#fff' : c.ink) : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [s.chip, { backgroundColor: bg }, pressed && { opacity: 0.75 }, style]}
    >
      {icon && <Feather name={icon} size={15} color={fg} />}
      <Text style={[s.chipText, { color: fg, fontFamily: active ? f.bodyBold : f.bodyMedium }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Étiquette non cliquable (« À toi de répondre », « En tête »). */
export function Badge({ label, color = c.yellow, textColor = c.ink, style }: { label: string; color?: string; textColor?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.badge, { backgroundColor: color }, style]}>
      <Text style={[s.badgeText, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ cartes */

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [s.card, style, pressed && { opacity: 0.85 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[s.card, style]}>{children}</View>;
}

/** Ligne de liste : icône dans un carré de couleur, titre, détail, chevron. */
export function ListRow({
  icon,
  iconBg = c.raised,
  iconColor,
  title,
  sub,
  onPress,
  right,
  style,
  left,
}: {
  icon?: FeatherName;
  iconBg?: string;
  iconColor?: string;
  title: string;
  sub?: string | null;
  onPress?: () => void;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  left?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => [s.row, style, pressed && { opacity: 0.8 }]}
    >
      {left ??
        (icon && (
          <View style={[s.rowIcon, { backgroundColor: iconBg }]}>
            <Feather name={icon} size={22} color={iconColor ?? (iconBg === c.raised ? c.text : c.ink)} />
          </View>
        ))}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.label, { fontSize: 16 }]} numberOfLines={2}>
          {title}
        </Text>
        {!!sub && <Text style={[txt.detail, { marginTop: 2 }]}>{sub}</Text>}
      </View>
      {right ?? (onPress ? <Feather name="chevron-right" size={20} color={c.muted} /> : null)}
    </Pressable>
  );
}

/** Écran ou liste vide : une phrase qui dit quoi faire, et le bouton. */
export function EmptyState({
  icon = 'inbox',
  iconBg = c.card,
  iconColor = c.muted,
  title,
  text,
  action,
  style,
}: {
  icon?: FeatherName;
  iconBg?: string;
  iconColor?: string;
  title: string;
  text?: string;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.empty, style]}>
      <View style={[s.emptyIcon, { backgroundColor: iconBg }]}>
        <Feather name={icon} size={30} color={iconColor} />
      </View>
      <Text style={[txt.title, { fontFamily: f.serifBlack, fontSize: 24, lineHeight: 30, textAlign: 'center', marginTop: 18 }]}>{title}</Text>
      {!!text && <Text style={[txt.detail, { fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 6 }]}>{text}</Text>}
      {action && <View style={{ marginTop: 20, alignSelf: 'stretch', alignItems: 'center' }}>{action}</View>}
    </View>
  );
}

/* ------------------------------------------------------------------ champs */

export function FieldLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <Text style={s.fieldLabel}>
      {children}
      {hint ? <Text style={{ color: c.muted, fontFamily: f.body }}> {hint}</Text> : null}
    </Text>
  );
}

export const Field = forwardRef<TextInput, TextInputProps & { onDark?: boolean }>(function Field({ style, onDark, multiline, ...rest }, ref) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={c.muted}
      selectionColor={c.coral}
      multiline={multiline}
      style={[s.field, onDark && { backgroundColor: c.deep }, multiline && { height: undefined, minHeight: 96, paddingTop: 13, paddingBottom: 13, textAlignVertical: 'top', borderRadius: 18 }, style]}
      {...rest}
    />
  );
});

/* -------------------------------------------------------- feuille du bas */

/**
 * Feuille qui monte du bas, sur un voile sombre. On la ferme en touchant le
 * voile, avec le retour Android, ou en la glissant vers le bas depuis
 * n'importe où (le contenu défile d'abord, la feuille suit une fois en haut).
 * Le contenu reste au-dessus du clavier.
 */
export function Sheet({
  visible,
  onClose,
  onDismiss,
  title,
  sub,
  children,
  footer,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  /** appelé quand la feuille a fini de disparaître (iOS : avant d'ouvrir une autre Modal) */
  onDismiss?: () => void;
  title?: string;
  sub?: string;
  children: ReactNode;
  /** zone collée en bas de la feuille (boutons) */
  footer?: ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  // La Modal reste montée pendant l'animation de sortie
  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(screenH);
  const sheetH = useSharedValue(screenH);
  const scrollY = useSharedValue(0);
  const dragFrom = useSharedValue(0);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      y.set(withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) }));
    } else {
      y.set(withTiming(sheetH.get(), { duration: 220, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      }));
    }
  }, [visible, mounted, y, sheetH]);

  const close = () => {
    Haptics.selectionAsync().catch(() => {});
    onClose();
  };

  const native = Gesture.Native();
  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .simultaneousWithExternalGesture(native)
    .onStart(() => {
      dragFrom.set(0);
    })
    .onUpdate((e) => {
      // Tant que le contenu n'est pas revenu en haut, c'est lui qui défile
      if (scrollY.get() > 0 && y.get() <= 0) {
        dragFrom.set(e.translationY);
        return;
      }
      y.set(Math.max(0, e.translationY - dragFrom.get()));
    })
    .onEnd((e) => {
      if (y.get() <= 0) return;
      const fling = e.velocityY > 800;
      if (y.get() > Math.min(140, sheetH.get() * 0.3) || fling) {
        runOnJS(close)();
      } else {
        y.set(withSpring(0, { damping: 22, stiffness: 260, mass: 0.8 }));
      }
    });

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.set(e.contentOffset.y);
  });
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [0, sheetH.get()], [1, 0], Extrapolation.CLAMP),
  }));

  const body = (
    <>
      {!!title && <Text style={[txt.display, { fontSize: 28, lineHeight: 34 }]}>{title}</Text>}
      {!!sub && <Text style={[txt.detail, { fontSize: 15, lineHeight: 21, marginTop: 4 }]}>{sub}</Text>}
      <View style={{ height: title || sub ? 16 : 0 }} />
      {children}
    </>
  );
  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      onDismiss={onDismiss}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardAware insideSafeArea={false}>
          <View style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }, scrimStyle]}>
              <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Fermer" accessibilityRole="button" />
            </Animated.View>
            <GestureDetector gesture={pan}>
              <Animated.View
                onLayout={(e) => {
                  sheetH.set(e.nativeEvent.layout.height);
                }}
                accessibilityViewIsModal
                style={[s.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8, maxHeight: '92%', marginTop: insets.top + 24 }, sheetStyle]}
              >
                <View style={s.handleZone} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <View style={s.handle} />
                </View>
                {scroll ? (
                  <GestureDetector gesture={native}>
                    <Animated.ScrollView
                      onScroll={onScroll}
                      scrollEventThrottle={16}
                      bounces={false}
                      overScrollMode="never"
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                      contentContainerStyle={{ paddingHorizontal: theme.gutter, paddingBottom: 8 }}
                    >
                      {body}
                    </Animated.ScrollView>
                  </GestureDetector>
                ) : (
                  <View style={{ paddingHorizontal: theme.gutter, flexShrink: 1 }}>{body}</View>
                )}
                {footer && <View style={{ paddingHorizontal: theme.gutter, paddingTop: 10 }}>{footer}</View>}
              </Animated.View>
            </GestureDetector>
          </View>
        </KeyboardAware>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Barre d'action collée en bas d'une fiche (« Tu viens ? »). */
export function BottomBar({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) + 4 }, style]}>{children}</View>;
}

const s = StyleSheet.create({
  back: { width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28, gap: 10 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  btnText: { fontFamily: f.bodyBold },
  fab: {
    position: 'absolute',
    right: theme.gutter,
    height: 56,
    paddingLeft: 18,
    paddingRight: 22,
    borderRadius: 28,
    backgroundColor: c.coral,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: c.coral,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  seg: { flexDirection: 'row', padding: 4, borderRadius: 26, backgroundColor: c.card },
  segItem: { flex: 1, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segText: { fontFamily: f.bodyBold, fontSize: 15 },
  chip: { height: 40, paddingHorizontal: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 14 },
  badge: { height: 26, paddingHorizontal: 10, borderRadius: 13, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  badgeText: { fontFamily: f.bodyBold, fontSize: 12 },
  card: { backgroundColor: c.card, borderRadius: theme.radius.card, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: theme.radius.card, backgroundColor: c.card, minHeight: 64 },
  rowIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingHorizontal: 36, paddingVertical: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { fontFamily: f.bodyBold, fontSize: 15, color: c.text, marginBottom: 8 },
  field: {
    height: 50,
    borderRadius: 16,
    backgroundColor: c.card,
    paddingHorizontal: 16,
    color: c.text,
    fontFamily: f.body,
    fontSize: 16,
    ...(Platform.OS === 'android' ? { paddingVertical: 0 } : null),
  },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: theme.radius.sheet, borderTopRightRadius: theme.radius.sheet, paddingTop: 10 },
  handleZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 2, paddingBottom: 18 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: c.rail },
  bottomBar: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: theme.gutter,
    shadowColor: '#0A0610',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -10 },
    elevation: 16,
  },
});
