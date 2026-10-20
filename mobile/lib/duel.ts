import { invalidateClassements } from '@/lib/minijeux';
import { sb } from '@/lib/supabase';

// Jeux à deux en direct (Puissance 4, échecs) : même cycle de vie côté serveur
// (supabase/14 et 15) : défi, réponse, coups, abandon, Elo. Chaque jeu a sa table et
// ses fonctions préfixées (p4_…, echecs_…) ; ce module en tire les appels communs.

export const ELO_DEPART = 1000;

export type DuelJeu = 'puissance4' | 'echecs';
export type Statut = 'invitation' | 'en_cours' | 'finie' | 'refusee' | 'abandon';

export type DuelPartie = {
  id: string;
  joueur1: string;
  joueur2: string;
  statut: Statut;
  tour: 1 | 2;
  coups: number;
  gagnant: 0 | 1 | 2 | null;
  /** Comment la partie s'est finie ; 'temps', 'absence' et 'expire' sont communs aux jeux */
  fin: string | null;
  elo_delta: number | null;
  /** Gain d'Elo de chaque joueur (négatif s'il perd), nulles comprises */
  delta1: number | null;
  delta2: number | null;
  /** Pendule (supabase/17) : temps restant au début du trait, et début du trait en cours */
  temps1_ms: number | null;
  temps2_ms: number | null;
  tour_depuis: string | null;
  /** Dernier signe de vie de chaque joueur sur l'écran de la partie */
  vu1: string | null;
  vu2: string | null;
  /** Incrémentée à chaque changement : une lecture plus ancienne est écartée */
  rev: number;
  created_at: string;
  updated_at: string;
};

/** Colonnes communes à lire */
export const DUEL_FIELDS =
  'id,joueur1,joueur2,statut,tour,coups,gagnant,fin,elo_delta,delta1,delta2,temps1_ms,temps2_ms,tour_depuis,vu1,vu2,rev,created_at,updated_at';

/** Un joueur parti depuis une minute est éliminé (supabase/17) ; on l'annonce dès 20 s */
export const ABSENCE_MS = 60_000;
export const ABSENCE_ALERTE_MS = 20_000;
/** Un défi non accepté expire au bout de 10 minutes */
export const DEFI_MS = 10 * 60_000;
/** Temps de chaque joueur */
export const PENDULE: Record<DuelJeu, number> = { echecs: 10 * 60_000, puissance4: 3 * 60_000 };

/** Mon numéro dans la partie (1 ou 2), ou 0 si je n'y joue pas */
export const seat = (p: DuelPartie, me: string | null) => (p.joueur1 === me ? 1 : p.joueur2 === me ? 2 : 0);
export const opponentOf = (p: DuelPartie, me: string | null) => (p.joueur1 === me ? p.joueur2 : p.joueur1);
export const isOver = (p: DuelPartie) => p.statut === 'finie' || p.statut === 'abandon';

/** Mon gain d'Elo dans une partie finie (null si inconnu) */
export function monDelta(p: DuelPartie, me: string | null): number | null {
  const s = seat(p, me);
  if (!s || !isOver(p)) return null;
  const d = s === 1 ? p.delta1 : p.delta2;
  if (d !== null) return d;
  // Parties d'avant les gains par joueur : elo_delta = gain du vainqueur
  if (p.elo_delta === null || p.gagnant === 0 || p.gagnant === null) return null;
  return p.gagnant === s ? p.elo_delta : -p.elo_delta;
}

/** Temps restant de chaque joueur à l'instant `now` (heure du serveur), ou null sans pendule */
export function pendules(p: DuelPartie, now: number): [number, number] | null {
  if (p.temps1_ms === null || p.temps2_ms === null) return null;
  const t: [number, number] = [p.temps1_ms, p.temps2_ms];
  if (p.statut === 'en_cours' && p.tour_depuis) t[p.tour - 1] -= now - new Date(p.tour_depuis).getTime();
  return [Math.max(0, t[0]), Math.max(0, t[1])];
}

/** « 9:58 », « 0:07 » */
export function chrono(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Signe de vie de l'écran de partie ; renvoie l'heure du serveur (ms) */
export const present = (jeu: DuelJeu, partie: string) =>
  rpc<string>('duel_present', { jeu, partie }).then((t) => new Date(t).getTime());

/** Défis reçus et parties où c'est à moi de jouer */
export const aFaire = (parties: DuelPartie[], me: string | null) =>
  parties.filter((p) => (p.statut === 'invitation' && p.joueur2 === me) || (p.statut === 'en_cours' && p.tour === seat(p, me)));

export async function rpc<T>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/**
 * Relit à chaque abonnement réussi, le premier compris : ce qui change entre la lecture
 * initiale et l'abonnement, ou pendant une coupure, n'arrive pas par le direct
 */
export function resync(fn?: () => void) {
  return (status: string) => {
    if (status === 'SUBSCRIBED') fn?.();
  };
}

/** Pendules après mon coup joué à l'instant `now`, en attendant la confirmation du serveur */
export function apresCoup(p: DuelPartie, now: number): Pick<DuelPartie, 'temps1_ms' | 'temps2_ms' | 'tour_depuis'> {
  const t = pendules(p, now);
  if (!t || !p.tour_depuis) return { temps1_ms: p.temps1_ms, temps2_ms: p.temps2_ms, tour_depuis: p.tour_depuis };
  return { temps1_ms: t[0], temps2_ms: t[1], tour_depuis: new Date(now).toISOString() };
}

export type DuelApi<P extends DuelPartie> = ReturnType<typeof duelApi<P>>;

/** Appels communs d'un jeu à deux : table `table`, fonctions `${prefix}_defier`, etc. */
export function duelApi<P extends DuelPartie>(table: string, prefix: string, fields: string) {
  return {
    /** Mes parties, les plus récentes d'abord : toutes celles ouvertes, les 20 dernières finies (refus écartés) */
    async fetchMesParties(me: string): Promise<P[]> {
      const base = () => sb.from(table).select(fields).or(`joueur1.eq.${me},joueur2.eq.${me}`).order('updated_at', { ascending: false });
      const [ouvertes, finies] = await Promise.all([
        base().in('statut', ['invitation', 'en_cours']),
        base().in('statut', ['finie', 'abandon']).limit(20),
      ]);
      if (ouvertes.error) throw ouvertes.error;
      if (finies.error) throw finies.error;
      return [...(ouvertes.data ?? []), ...(finies.data ?? [])] as unknown as P[];
    },

    async fetchPartie(id: string): Promise<P | null> {
      const { data, error } = await sb.from(table).select(fields).eq('id', id).maybeSingle();
      if (error) throw error;
      return data as unknown as P | null;
    },

    defier: (adversaire: string) => rpc<string>(`${prefix}_defier`, { adversaire }),
    repondre: (partie: string, accepte: boolean) => rpc<void>(`${prefix}_repondre`, { partie, accepte }),
    // Un abandon finit la partie : l'Elo a changé
    abandonner: (partie: string) => rpc<void>(`${prefix}_abandonner`, { partie }).finally(invalidateClassements),

    /**
     * Suit toutes mes parties (invitations comprises). `onResync` est appelée à chaque
     * (ré)abonnement : ce qui a changé pendant une coupure doit être relu.
     * Renvoie la fonction pour arrêter.
     */
    suivreMesParties(me: string, onChange: (p: P) => void, onResync?: () => void) {
      const on = (col: 'joueur1' | 'joueur2') => ({ event: '*', schema: 'public', table, filter: `${col}=eq.${me}` }) as const;
      // Une suppression n'apporte pas de nouvelle ligne : rien à montrer
      const relay = (payload: { new: unknown }) => {
        if ((payload.new as P | undefined)?.id) onChange(payload.new as P);
      };
      const channel = sb
        .channel(`${prefix}-mes:${me}:${Math.random()}`)
        .on('postgres_changes', on('joueur1'), relay)
        .on('postgres_changes', on('joueur2'), relay)
        .subscribe(resync(onResync));
      return () => {
        sb.removeChannel(channel);
      };
    },

    /** Suit une partie : chaque coup arrive dès qu'il est joué. Renvoie la fonction pour arrêter. */
    suivre(id: string, onChange: (p: P) => void, onResync?: () => void) {
      const channel = sb
        .channel(`${prefix}:${id}:${Math.random()}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${id}` }, (payload) =>
          onChange(payload.new as P),
        )
        .subscribe(resync(onResync));
      return () => {
        sb.removeChannel(channel);
      };
    },
  };
}
