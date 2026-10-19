import { sb, type ProfileMini } from '@/lib/supabase';

// Mini-jeux : chacun garde son meilleur score par jeu, le classement compare les records.
// Tables : minijeux_scores (une ligne par partie) et la vue minijeux_records (supabase/13_minijeux.sql).

export type JeuId = 'reflexes' | 'flappy' | 'basket';

export type JeuMeta = {
  id: JeuId;
  nom: string;
  pitch: string;
  /** Réflexes : le plus petit temps gagne */
  lowerIsBetter: boolean;
  /** Unité au singulier et au pluriel */
  unit: [string, string];
  color: string;
  ink: string;
  icon: 'zap' | 'feather' | 'target';
};

export const JEUX: JeuMeta[] = [
  {
    id: 'reflexes',
    nom: 'Réflexes',
    pitch: 'Touche dès que l’écran passe au vert. Cinq essais, on garde la moyenne.',
    lowerIsBetter: true,
    unit: ['ms', 'ms'],
    color: '#4ECDC4',
    ink: '#10302E',
    icon: 'zap',
  },
  {
    id: 'flappy',
    nom: 'Flappy',
    pitch: 'Touche pour battre des ailes et passe entre les tuyaux.',
    lowerIsBetter: false,
    unit: ['tuyau', 'tuyaux'],
    color: '#FFD93D',
    ink: '#1A1025',
    icon: 'feather',
  },
  {
    id: 'basket',
    nom: 'Basket',
    pitch: 'Lance le ballon d’un geste vers le haut. 30 secondes, le panier bouge.',
    lowerIsBetter: false,
    unit: ['panier', 'paniers'],
    color: '#FF6B6B',
    ink: '#FFFFFF',
    icon: 'target',
  },
];

export const jeuMeta = (id: string) => JEUX.find((j) => j.id === id);

export function formatScore(jeu: JeuMeta, score: number) {
  return `${score} ${score > 1 ? jeu.unit[1] : jeu.unit[0]}`;
}

/** Petit mot sous le score, selon le jeu */
export function verdict(jeu: JeuMeta, score: number): string | null {
  if (jeu.id === 'reflexes') {
    if (score < 200) return 'Réflexes de chat';
    if (score < 250) return 'Très vif';
    if (score < 300) return 'Dans la bonne moyenne';
    if (score < 400) return 'Encore un peu endormi';
    return 'Il est l’heure d’aller se coucher';
  }
  if (jeu.id === 'flappy') {
    if (score >= 40) return 'Légendaire';
    if (score >= 20) return 'Pilote confirmé';
    if (score >= 10) return 'Ça plane';
    if (score >= 3) return 'Premiers battements';
    return 'Le tuyau a gagné';
  }
  if (score >= 30) return 'Le panier est à toi';
  if (score >= 15) return 'Main chaude';
  if (score >= 6) return 'Bonne adresse';
  return 'On s’échauffe';
}

/** Vrai si a bat b */
export const beats = (jeu: JeuMeta, a: number, b: number) => (jeu.lowerIsBetter ? a < b : a > b);

export type Record_ = { jeu: JeuId; user_id: string; best: number; parties: number; last_played: string };
export type Ligne = Record_ & { profile?: ProfileMini };

/** Records de tous les jeux, classés du meilleur au moins bon, avec le profil de chacun */
export async function fetchClassements(): Promise<Record<JeuId, Ligne[]>> {
  const { data, error } = await sb.from('minijeux_records').select('jeu,user_id,best,parties,last_played');
  if (error) throw error;
  const rows = (data ?? []) as Record_[];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const profs = ids.length
    ? ((await sb.from('profiles').select('id,prenom,nom,pseudo').in('id', ids)).data ?? [])
    : [];
  const byId = Object.fromEntries((profs as ProfileMini[]).map((p) => [p.id, p]));
  const out = { reflexes: [], flappy: [], basket: [] } as Record<JeuId, Ligne[]>;
  for (const r of rows) out[r.jeu]?.push({ ...r, profile: byId[r.user_id] });
  for (const j of JEUX) {
    // À égalité, le dernier à avoir joué passe derrière
    out[j.id].sort((a, b) =>
      a.best === b.best ? a.last_played.localeCompare(b.last_played) : j.lowerIsBetter ? a.best - b.best : b.best - a.best,
    );
  }
  return out;
}

export async function saveScore(jeu: JeuId, score: number) {
  const { error } = await sb.from('minijeux_scores').insert({ jeu, score: Math.round(score) });
  if (error) throw error;
}

export const displayName = (p?: ProfileMini) => p?.prenom || p?.pseudo || 'Quelqu’un';
