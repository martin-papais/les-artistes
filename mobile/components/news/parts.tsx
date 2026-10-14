/**
 * Petites pièces de l'onglet Actu : bouton « … » de modération en 44 px,
 * fondu sous la photo, dates lisibles.
 */
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { openModerationMenu, type ReportKind } from '@/lib/moderation';
import { theme } from '@/lib/theme';

const c = theme.colors;

/** Même règle que ModerationButton : rien sur ses propres contenus. */
export function MoreButton({
  kind,
  itemId,
  authorId,
  authorName,
  excerpt,
  currentUserId,
  onBlocked,
  color = c.muted,
  bg = 'transparent',
  size = 44,
  style,
}: {
  kind: ReportKind;
  itemId: string;
  authorId: string;
  authorName: string;
  excerpt: string;
  currentUserId: string | null;
  onBlocked: () => void;
  color?: string;
  bg?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  if (!authorId || authorId === currentUserId) return null;
  return (
    <Pressable
      onPress={() => openModerationMenu({ kind, itemId, authorId, authorName, excerpt, onBlocked })}
      hitSlop={size < 44 ? (44 - size) / 2 : 0}
      accessibilityRole="button"
      accessibilityLabel="Signaler ou bloquer"
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' },
        pressed && { opacity: 0.6 },
        style,
      ]}
    >
      <Feather name="more-horizontal" size={20} color={color} />
    </Pressable>
  );
}

/** Fondu vers le fond de l'écran, en bandes (pas de dégradé natif installé). */
export function BottomFade({ height = 90, color = c.deep }: { height?: number; color?: string }) {
  const steps = 10;
  return (
    <View pointerEvents="none" style={[styles.fade, { height }]}>
      {Array.from({ length: steps }, (_, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: color, opacity: ((i + 1) / steps) ** 1.6 }} />
      ))}
    </View>
  );
}

/** « 6 octobre », avec l'année seulement si ce n'est pas l'année en cours. */
export function dayLabel(iso: string, alwaysYear = false) {
  const d = new Date(iso);
  const showYear = alwaysYear || d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', ...(showYear ? { year: 'numeric' } : null) });
}

/** Heure d'un commentaire : « 18:05 » le jour même, sinon « 6 oct. à 18:05 ». */
export function commentTime(iso: string) {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return hm;
  return `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${hm}`;
}

const styles = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
