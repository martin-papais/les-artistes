import { Chess, type Square } from 'chess.js';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { duelApi, type DuelPartie, rpc } from '@/lib/duel';
import { invalidateClassements } from '@/lib/minijeux';
import { sb } from '@/lib/supabase';

// Échecs à deux : les règles viennent de chess.js (BSD). Le serveur rejoue chaque coup avec
// la même bibliothèque (supabase/functions/echecs-jouer) avant de l'enregistrer
// (supabase/15_minijeux_echecs.sql). Joueur 1 = blancs, joueur 2 = noirs.

export type Fin = 'mat' | 'pat' | 'repetition' | 'materiel' | '50coups' | 'accord' | 'abandon';

export type Partie = DuelPartie & {
  fen: string;
  /** Coups joués, notation e2e4 / e7e8q */
  historique: string[];
  dernier_coup: string | null;
  fin: Fin | null;
  nulle_proposee: 1 | 2 | null;
};

export const echecs = duelApi<Partie>(
  'echecs_parties',
  'echecs',
  'id,joueur1,joueur2,statut,fen,historique,tour,coups,dernier_coup,gagnant,fin,nulle_proposee,elo_delta,created_at,updated_at',
);

export const parse = (uci: string) => ({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] });

/** La partie rejouée depuis le début (la répétition de position a besoin de l'historique) */
export function rejouer(historique: string[]) {
  const g = new Chess();
  for (const m of historique) g.move(parse(m));
  return g;
}

/** Joue un coup : la fonction Edge le vérifie, l'enregistre et finit la partie au besoin */
export async function jouer(partie: string, coup: string) {
  try {
    const send = () => sb.functions.invoke('echecs-jouer', { body: { partie, coup } });
    let { error } = await send();
    // Jeton de connexion expiré à l'instant (vu sur l'émulateur) : on le renouvelle et on rejoue une fois
    if (error instanceof FunctionsHttpError && error.context.status === 401) {
      await sb.auth.refreshSession();
      ({ error } = await send());
    }
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      throw new Error(body?.error ?? 'Coup refusé');
    }
    if (error) throw new Error('Pas de connexion');
  } finally {
    invalidateClassements();
  }
}

/** Proposer la nulle, ou répondre à celle de l'adversaire */
export const nulle = (partie: string, action: 'proposer' | 'accepter' | 'refuser') =>
  rpc<void>('echecs_nulle', { partie, action }).finally(invalidateClassements);

// Notation française : Roi, Dame, Tour, Fou, Cavalier
const FR: Record<string, string> = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };
export const enFrancais = (san: string) => san.replace(/[KQRBN]/g, (l) => FR[l]);

export const FIN_TEXTE: Record<Exclude<Fin, 'mat' | 'abandon'>, string> = {
  pat: 'Pat : partie nulle',
  repetition: 'Nulle par répétition',
  materiel: 'Nulle : plus assez de pièces pour mater',
  '50coups': 'Nulle : 50 coups sans prise ni pion joué',
  accord: 'Nulle d’un commun accord',
};

/** Valeur des pièces, pour l'avance matérielle */
export const VALEUR: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const PIECES: Record<string, number> = {
  wk: require('@/assets/minijeux/echecs/wK.webp'),
  wq: require('@/assets/minijeux/echecs/wQ.webp'),
  wr: require('@/assets/minijeux/echecs/wR.webp'),
  wb: require('@/assets/minijeux/echecs/wB.webp'),
  wn: require('@/assets/minijeux/echecs/wN.webp'),
  wp: require('@/assets/minijeux/echecs/wP.webp'),
  bk: require('@/assets/minijeux/echecs/bK.webp'),
  bq: require('@/assets/minijeux/echecs/bQ.webp'),
  br: require('@/assets/minijeux/echecs/bR.webp'),
  bb: require('@/assets/minijeux/echecs/bB.webp'),
  bn: require('@/assets/minijeux/echecs/bN.webp'),
  bp: require('@/assets/minijeux/echecs/bP.webp'),
};
