import { type DuelJeu, resync } from '@/lib/duel';
import { sb } from '@/lib/supabase';

// Chat d'une partie en direct (supabase/16) : seuls les joueurs de la partie le lisent et y
// écrivent. Il est attaché à la partie, pas à deux joueurs : un jeu en équipes s'en servira tel quel.

export type Message = {
  id: number;
  partie: string;
  auteur: string;
  texte: string;
  created_at: string;
  /** Choisi par l'appli à l'envoi : un renvoi après une coupure ne double pas le message */
  client_id: string | null;
};

const FIELDS = 'id,partie,auteur,texte,created_at,client_id';

/** Identifiant d'envoi (UUID v4 ; le hasard de Math.random suffit pour éviter les doublons) */
export const nouvelId = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** Réactions et phrases toutes prêtes, un appui suffit */
export const REACTIONS = ['😂', '🔥', '👏', '😱', '🤡', '🍻'];
export const PHRASES = ['Bien joué', 'Joue !', 'Aïe', 'GG', 'Revanche ?'];

/** Message fait seulement d'emojis (3 au plus) : affiché en grand, sans bulle */
export const isEmojiOnly = (t: string) => /^(\p{Extended_Pictographic}\uFE0F?\s*){1,3}$/u.test(t.trim());

/** Les 200 derniers messages, du plus ancien au plus récent */
export async function fetchMessages(partie: string): Promise<Message[]> {
  const { data, error } = await sb
    .from('minijeux_messages')
    .select(FIELDS)
    .eq('partie', partie)
    .order('id', { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as Message[]).reverse();
}

export async function envoyer(jeu: DuelJeu, partie: string, texte: string, clientId: string): Promise<Message> {
  const { data, error } = await sb
    .from('minijeux_messages')
    .insert({ jeu, partie, texte: texte.trim(), client_id: clientId })
    .select(FIELDS)
    .single();
  if (!error) return data as Message;
  // Déjà enregistré lors d'un premier essai dont la réponse s'est perdue
  if (error.code === '23505') {
    const again = await sb.from('minijeux_messages').select(FIELDS).eq('client_id', clientId).maybeSingle();
    if (again.data) return again.data as Message;
  }
  throw new Error(error.message);
}

/** Chaque message arrive dès qu'il est écrit ; `onResync` après une coupure. Renvoie la fonction pour arrêter. */
export function suivreMessages(partie: string, onMessage: (m: Message) => void, onResync?: () => void) {
  const channel = sb
    .channel(`chat:${partie}:${Math.random()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'minijeux_messages', filter: `partie=eq.${partie}` }, (payload) =>
      onMessage(payload.new as Message),
    )
    .subscribe(resync(onResync));
  return () => {
    sb.removeChannel(channel);
  };
}

/**
 * Canal éphémère de la partie, rien en base : « écrit… » et « vu ».
 * Renvoie l'envoi d'un signal et la fonction pour arrêter.
 */
export function canalDirect(
  partie: string,
  me: string,
  on: { ecrit: (uid: string) => void; lu: (uid: string, id: number) => void },
) {
  const channel = sb.channel(`chat-direct:${partie}`, { config: { broadcast: { self: false } } });
  channel
    .on('broadcast', { event: 'ecrit' }, ({ payload }) => on.ecrit(payload.uid))
    .on('broadcast', { event: 'lu' }, ({ payload }) => on.lu(payload.uid, payload.id))
    .subscribe();
  return {
    ecrit: () => channel.send({ type: 'broadcast', event: 'ecrit', payload: { uid: me } }),
    lu: (id: number) => channel.send({ type: 'broadcast', event: 'lu', payload: { uid: me, id } }),
    stop: () => {
      sb.removeChannel(channel);
    },
  };
}
