import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { Button, ListRow, Sheet } from '@/components/ui/kit';
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
  if (error) throw new Error(error.message);
}

async function block(authorId: string) {
  const { error } = await sb.from('user_blocks').insert({ blocked_id: authorId });
  if (error && error.code !== '23505') throw new Error(error.message);
  (await getBlocked()).add(authorId);
}

type ModerationOpts = {
  kind: ReportKind;
  itemId: string;
  authorId: string;
  authorName: string;
  excerpt: string;
  onBlocked: () => void;
};

/** Message après coup : attend que la feuille soit fermée (iOS n'affiche rien sinon) */
function notice(title: string, msg: string) {
  setTimeout(() => Alert.alert(title, msg, undefined, { cancelable: true }), 450);
}

/**
 * Feuille « … » : signaler le contenu ou bloquer son auteur (confirmation dans
 * la même feuille). Se ferme comme toutes les feuilles : voile, glissement, retour.
 */
export function ModerationSheet({ visible, onClose, ...opts }: ModerationOpts & { visible: boolean; onClose: () => void }) {
  const { kind, itemId, authorId, authorName, excerpt, onBlocked } = opts;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  function close() {
    onClose();
    setConfirm(false);
  }

  async function run(action: 'report' | 'block') {
    if (busy) return;
    setBusy(true);
    try {
      if (action === 'report') {
        await report(kind, itemId, authorId, excerpt);
        close();
        notice('Merci', 'Le contenu est signalé. Il sera examiné et retiré sous 24 h s’il enfreint les règles.');
      } else {
        await block(authorId);
        close();
        onBlocked();
        notice('Membre bloqué', `Tu ne verras plus les contenus de ${authorName}.`);
      }
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.', undefined, { cancelable: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={confirm ? `Bloquer ${authorName} ?` : authorName}
      sub={confirm ? 'Ses publications, photos et commentaires seront masqués pour toi.' : undefined}
      scroll={false}
    >
      {confirm ? (
        <View style={{ gap: 10 }}>
          <Button label="Bloquer" variant="primary" onPress={() => run('block')} loading={busy} />
          <Button label="Annuler" variant="ghost" onPress={() => setConfirm(false)} disabled={busy} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <ListRow
            icon="flag"
            iconBg={theme.colors.raised}
            title="Signaler ce contenu"
            sub="Il sera examiné sous 24 h"
            onPress={() => run('report')}
            right={<View />}
            style={{ backgroundColor: theme.colors.deep }}
          />
          <ListRow
            icon="slash"
            iconBg={theme.colors.raised}
            iconColor={theme.colors.danger}
            title={`Bloquer ${authorName}`}
            sub="Tu ne verras plus ses contenus"
            onPress={() => setConfirm(true)}
            right={<View />}
            style={{ backgroundColor: theme.colors.deep }}
          />
        </View>
      )}
    </Sheet>
  );
}

/** Bouton « … » affiché sur les contenus des autres membres. */
export function ModerationButton(props: ModerationOpts & {
  currentUserId: string | null;
  color?: string;
}) {
  const { currentUserId, color, ...opts } = props;
  const [open, setOpen] = useState(false);
  if (!opts.authorId || opts.authorId === currentUserId) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Signaler ou bloquer"
        style={({ pressed }) => [{ padding: 4 }, pressed && { opacity: 0.5 }]}
      >
        <Ionicons name="ellipsis-horizontal" size={18} color={color ?? theme.colors.muted} />
      </Pressable>
      <ModerationSheet visible={open} onClose={() => setOpen(false)} {...opts} />
    </>
  );
}
