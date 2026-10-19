import { invalidateClassements } from '@/lib/minijeux';
import { sb } from '@/lib/supabase';

// Puissance 4 à deux : le serveur garde la partie (supabase/14_minijeux_p4_elo.sql),
// l'appli envoie les coups par des fonctions et suit la partie en temps réel.

export const COLS = 7;
export const ELO_DEPART = 1000;
export const ROWS = 6;

export type Statut = 'invitation' | 'en_cours' | 'finie' | 'refusee' | 'abandon';

export type Partie = {
  id: string;
  joueur1: string;
  joueur2: string;
  statut: Statut;
  /** 42 cases, ligne 0 en haut : '0' vide, '1' et '2' */
  plateau: string;
  tour: 1 | 2;
  coups: number;
  dernier_coup: number | null;
  gagnant: 0 | 1 | 2 | null;
  ligne_gagnante: number[] | null;
  elo_delta: number | null;
  created_at: string;
  updated_at: string;
};

const FIELDS =
  'id,joueur1,joueur2,statut,plateau,tour,coups,dernier_coup,gagnant,ligne_gagnante,elo_delta,created_at,updated_at';

/** Mon numéro dans la partie (1 ou 2), ou 0 si je n'y joue pas */
export const seat = (p: Partie, me: string | null) => (p.joueur1 === me ? 1 : p.joueur2 === me ? 2 : 0);
export const opponentOf = (p: Partie, me: string | null) => (p.joueur1 === me ? p.joueur2 : p.joueur1);

/** Mes parties, les plus récentes d'abord (les refus et vieilles parties finies sont écartés) */
export async function fetchMesParties(me: string): Promise<Partie[]> {
  const { data, error } = await sb
    .from('p4_parties')
    .select(FIELDS)
    .or(`joueur1.eq.${me},joueur2.eq.${me}`)
    .neq('statut', 'refusee')
    .order('updated_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []) as Partie[];
}

export async function fetchPartie(id: string): Promise<Partie | null> {
  const { data, error } = await sb.from('p4_parties').select(FIELDS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Partie | null;
}

async function rpc<T>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const defier = (adversaire: string) => rpc<string>('p4_defier', { adversaire });
export const repondre = (partie: string, accepte: boolean) => rpc<void>('p4_repondre', { partie, accepte });
// Un coup peut finir la partie, un abandon la finit : l'Elo a pu changer
export const jouer = (partie: string, colonne: number) =>
  rpc<void>('p4_jouer', { partie, colonne }).finally(invalidateClassements);
export const abandonner = (partie: string) => rpc<void>('p4_abandonner', { partie }).finally(invalidateClassements);

/** Défis reçus et parties où c'est à moi de jouer */
export const aFaire = (parties: Partie[], me: string | null) =>
  parties.filter((p) => (p.statut === 'invitation' && p.joueur2 === me) || (p.statut === 'en_cours' && p.tour === seat(p, me)));

/** Suit toutes mes parties (invitations comprises). Renvoie la fonction pour arrêter. */
export function suivreMesParties(me: string, onChange: (p: Partie) => void) {
  const on = (col: 'joueur1' | 'joueur2') =>
    ({ event: '*', schema: 'public', table: 'p4_parties', filter: `${col}=eq.${me}` }) as const;
  // Une suppression n'apporte pas de nouvelle ligne : rien à montrer
  const relay = (payload: { new: unknown }) => {
    if ((payload.new as Partie | undefined)?.id) onChange(payload.new as Partie);
  };
  const channel = sb
    .channel(`p4-mes:${me}:${Math.random()}`)
    .on('postgres_changes', on('joueur1'), relay)
    .on('postgres_changes', on('joueur2'), relay)
    .subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}

/** Suit une partie : chaque coup arrive dès qu'il est joué. Renvoie la fonction pour arrêter. */
export function suivre(id: string, onChange: (p: Partie) => void) {
  const channel = sb
    .channel(`p4:${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'p4_parties', filter: `id=eq.${id}` }, (payload) =>
      onChange(payload.new as Partie),
    )
    .subscribe();
  return () => {
    sb.removeChannel(channel);
  };
}

/** Ligne où tomberait un jeton dans cette colonne, ou -1 si elle est pleine */
export function landingRow(plateau: string, col: number) {
  for (let r = ROWS - 1; r >= 0; r--) if (plateau[r * COLS + col] === '0') return r;
  return -1;
}
