/**
 * Les 8 réactions des notes. La base garde l'emoji (comme le site, notes.html) ;
 * l'appli l'affiche en icône de couleur.
 */
import { Feather, Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { theme } from '@/lib/theme';

const c = theme.colors;

type Reaction = { emoji: string; label: string; color: string; draw: (size: number, color: string) => React.ReactNode };

export const REACTIONS: Reaction[] = [
  { emoji: '👍', label: "J'aime", color: c.text, draw: (s, col) => <Feather name="thumbs-up" size={s} color={col} /> },
  { emoji: '❤️', label: "J'adore", color: c.coral, draw: (s, col) => <Feather name="heart" size={s} color={col} /> },
  { emoji: '😂', label: 'Mort de rire', color: c.yellow, draw: (s, col) => <Feather name="smile" size={s} color={col} /> },
  // Feather n'a pas de flamme ni de visage surpris
  { emoji: '🔥', label: 'Le feu', color: '#FF9E5E', draw: (s, col) => <Ionicons name="flame-outline" size={s} color={col} /> },
  { emoji: '👀', label: 'Je regarde', color: c.violet, draw: (s, col) => <Feather name="eye" size={s} color={col} /> },
  {
    emoji: '💯',
    label: 'Cent pour cent',
    color: c.coral,
    draw: (s, col) => (
      <Text
        style={{
          color: col,
          fontFamily: theme.fonts.bodyBold,
          fontSize: Math.round(s * 0.7),
          lineHeight: s,
          textDecorationLine: 'underline',
        }}
      >
        100
      </Text>
    ),
  },
  { emoji: '✅', label: 'Validé', color: c.teal, draw: (s, col) => <Feather name="check-circle" size={s} color={col} /> },
  {
    emoji: '😮',
    label: 'Surpris',
    color: c.pink,
    draw: (s, col) => <Surprised size={s} color={col} />,
  },
];

const BY_EMOJI = new Map(REACTIONS.map((r) => [r.emoji, r]));

/** Réaction connue, ou une icône neutre si la base contient autre chose. */
export function reactionOf(emoji: string): Reaction {
  return (
    BY_EMOJI.get(emoji) ?? {
      emoji,
      label: 'Réaction',
      color: c.muted,
      draw: (s, col) => <Feather name="star" size={s} color={col} />,
    }
  );
}

/** Visage surpris dessiné au trait (absent de Feather et des autres jeux d'icônes). */
function Surprised({ size, color }: { size: number; color: string }) {
  const d = size * 0.84;
  const stroke = Math.max(1.6, size / 12);
  const eye = Math.max(2, size / 9);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: d,
          height: d,
          borderRadius: d / 2,
          borderWidth: stroke,
          borderColor: color,
          alignItems: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', gap: d * 0.22, marginTop: d * 0.26 }}>
          <View style={{ width: eye, height: eye, borderRadius: eye / 2, backgroundColor: color }} />
          <View style={{ width: eye, height: eye, borderRadius: eye / 2, backgroundColor: color }} />
        </View>
        <View
          style={{
            width: d * 0.24,
            height: d * 0.24,
            borderRadius: d * 0.12,
            borderWidth: stroke,
            borderColor: color,
            marginTop: d * 0.1,
          }}
        />
      </View>
    </View>
  );
}
