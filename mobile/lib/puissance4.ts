import { duelApi, type DuelPartie, rpc } from '@/lib/duel';
import { invalidateClassements } from '@/lib/minijeux';

// Puissance 4 à deux : le serveur garde la partie (supabase/14_minijeux_p4_elo.sql),
// l'appli envoie les coups par des fonctions et suit la partie en temps réel.

export const COLS = 7;
export const ROWS = 6;

export type Partie = DuelPartie & {
  /** 42 cases, ligne 0 en haut : '0' vide, '1' et '2' */
  plateau: string;
  dernier_coup: number | null;
  ligne_gagnante: number[] | null;
};

export const p4 = duelApi<Partie>(
  'p4_parties',
  'p4',
  'id,joueur1,joueur2,statut,plateau,tour,coups,dernier_coup,gagnant,ligne_gagnante,elo_delta,created_at,updated_at',
);

// Un coup peut finir la partie : l'Elo a pu changer
export const jouer = (partie: string, colonne: number) => rpc<void>('p4_jouer', { partie, colonne }).finally(invalidateClassements);

/** Ligne où tomberait un jeton dans cette colonne, ou -1 si elle est pleine */
export function landingRow(plateau: string, col: number) {
  for (let r = ROWS - 1; r >= 0; r--) if (plateau[r * COLS + col] === '0') return r;
  return -1;
}
