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
  elo_delta: number | null;
  created_at: string;
  updated_at: string;
};

/** Mon numéro dans la partie (1 ou 2), ou 0 si je n'y joue pas */
export const seat = (p: DuelPartie, me: string | null) => (p.joueur1 === me ? 1 : p.joueur2 === me ? 2 : 0);
export const opponentOf = (p: DuelPartie, me: string | null) => (p.joueur1 === me ? p.joueur2 : p.joueur1);
export const isOver = (p: DuelPartie) => p.statut === 'finie' || p.statut === 'abandon';

/** Défis reçus et parties où c'est à moi de jouer */
export const aFaire = (parties: DuelPartie[], me: string | null) =>
  parties.filter((p) => (p.statut === 'invitation' && p.joueur2 === me) || (p.statut === 'en_cours' && p.tour === seat(p, me)));

export async function rpc<T>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type DuelApi<P extends DuelPartie> = ReturnType<typeof duelApi<P>>;

/** Appels communs d'un jeu à deux : table `table`, fonctions `${prefix}_defier`, etc. */
export function duelApi<P extends DuelPartie>(table: string, prefix: string, fields: string) {
  return {
    /** Mes parties, les plus récentes d'abord (les refus sont écartés) */
    async fetchMesParties(me: string): Promise<P[]> {
      const { data, error } = await sb
        .from(table)
        .select(fields)
        .or(`joueur1.eq.${me},joueur2.eq.${me}`)
        .neq('statut', 'refusee')
        .order('updated_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as P[];
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

    /** Suit toutes mes parties (invitations comprises). Renvoie la fonction pour arrêter. */
    suivreMesParties(me: string, onChange: (p: P) => void) {
      const on = (col: 'joueur1' | 'joueur2') => ({ event: '*', schema: 'public', table, filter: `${col}=eq.${me}` }) as const;
      // Une suppression n'apporte pas de nouvelle ligne : rien à montrer
      const relay = (payload: { new: unknown }) => {
        if ((payload.new as P | undefined)?.id) onChange(payload.new as P);
      };
      const channel = sb
        .channel(`${prefix}-mes:${me}:${Math.random()}`)
        .on('postgres_changes', on('joueur1'), relay)
        .on('postgres_changes', on('joueur2'), relay)
        .subscribe();
      return () => {
        sb.removeChannel(channel);
      };
    },

    /** Suit une partie : chaque coup arrive dès qu'il est joué. Renvoie la fonction pour arrêter. */
    suivre(id: string, onChange: (p: P) => void) {
      const channel = sb
        .channel(`${prefix}:${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${id}` }, (payload) =>
          onChange(payload.new as P),
        )
        .subscribe();
      return () => {
        sb.removeChannel(channel);
      };
    },
  };
}
