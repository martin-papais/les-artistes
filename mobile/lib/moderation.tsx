import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable } from 'react-native';

import { sb } from '@/lib/supabase';
import { theme } from '@/lib/theme';

export type ReportKind = 'news' | 'news_comment' | 'event_comment' | 'photo' | 'note';

// Membres bloqués par l'utilisateur connecté, chargés une fois par session
let blockedCache: Promise<Set<string>> | null = null;

export function getBlocked(): Promise<Set<string>> {
  if (!blockedCache) {
    blockedCache = (async () => {
      const { data, error } = await sb.from('user_blocks').select('blocked_id');
      if (error) {
        blockedCache = null;
        return new Set<string>();
      }
      return new Set((data ?? []).map((r: { blocked_id: string }) => r.blocked_id));
    })();
  }
  return blockedCache;
}

/** À appeler à la déconnexion : le compte suivant a ses propres blocages. */
export function resetBlocked() {
  blockedCache = null;
}

async function report(kind: ReportKind, itemId: string, authorId: string, excerpt: string) {
  const { error } = await sb.from('content_reports').insert({
    kind,
    item_id: itemId,
    author_id: authorId,
    excerpt: excerpt.slice(0, 300),
  });
  if (error) {
    Alert.alert('Erreur', error.message);
    return;
  }
  Alert.alert('Merci', 'Le contenu est signalé. Il sera examiné et retiré sous 24 h s’il enfreint les règles.');
}

async function block(authorId: string, authorName: string, onBlocked: () => void) {
  const { error } = await sb.from('user_blocks').insert({ blocked_id: authorId });
  if (error && error.code !== '23505') {
    Alert.alert('Erreur', error.message);
    return;
  }
  (await getBlocked()).add(authorId);
  Alert.alert('Membre bloqué', `Tu ne verras plus les contenus de ${authorName}.`);
  onBlocked();
}

export function openModerationMenu(opts: {
  kind: ReportKind;
  itemId: string;
  authorId: string;
  authorName: string;
  excerpt: string;
  onBlocked: () => void;
}) {
  const { kind, itemId, authorId, authorName, excerpt, onBlocked } = opts;
  Alert.alert(authorName, undefined, [
    { text: 'Signaler ce contenu', onPress: () => report(kind, itemId, authorId, excerpt) },
    {
      text: `Bloquer ${authorName}`,
      style: 'destructive',
      onPress: () =>
        Alert.alert(
          `Bloquer ${authorName} ?`,
          'Ses publications, photos et commentaires seront masqués pour toi.',
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Bloquer', style: 'destructive', onPress: () => block(authorId, authorName, onBlocked) },
          ],
        ),
    },
    { text: 'Annuler', style: 'cancel' },
  ]);
}

/** Bouton « … » affiché sur les contenus des autres membres. */
export function ModerationButton(props: Parameters<typeof openModerationMenu>[0] & {
  currentUserId: string | null;
  color?: string;
}) {
  const { currentUserId, color, ...opts } = props;
  if (!opts.authorId || opts.authorId === currentUserId) return null;
  return (
    <Pressable
      onPress={() => openModerationMenu(opts)}
      hitSlop={10}
      accessibilityLabel="Signaler ou bloquer"
      style={({ pressed }) => [{ padding: 4 }, pressed && { opacity: 0.5 }]}
    >
      <Ionicons name="ellipsis-horizontal" size={18} color={color ?? theme.colors.muted} />
    </Pressable>
  );
}
