import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DuelJeu } from '@/lib/duel';
import { sb, sessionUser, type ProfileMini } from '@/lib/supabase';

// Mini-jeux : chacun garde son meilleur score par jeu, le classement compare les records.
// Puissance 4 et les échecs se jouent à deux et se classent à l'Elo. Le classement général additionne des points
// de place sur tous les jeux.
// Tables : minijeux_scores, vue minijeux_records, minijeux_elo (supabase/13 et 14) ; un score
// passe par une session ouverte au début de la partie (supabase/18).

export type JeuId = 'reflexes' | 'flappy' | 'basket' | 'stack' | 'stop10';

export type JeuMeta = {
  id: JeuId;
  nom: string;
  pitch: string;
  /** Réflexes, Stop à 10 s : le plus petit gagne */
  lowerIsBetter: boolean;
  /** Unité au singulier et au pluriel */
  unit: [string, string];
  color: string;
};

export const JEUX: JeuMeta[] = [
  {
    id: 'stack',
    nom: 'Stack',
    pitch: 'Touche pour poser le bloc qui glisse. Ce qui dépasse tombe : vise juste.',
    lowerIsBetter: false,
    unit: ['étage', 'étages'],
    color: '#C77DFF',
  },
  {
    id: 'flappy',
    nom: 'Flappy',
    pitch: 'Touche pour battre des ailes et passe entre les tuyaux.',
    lowerIsBetter: false,
    unit: ['tuyau', 'tuyaux'],
    color: '#FFD93D',
  },
  {
    id: 'basket',
    nom: 'Basket',
    pitch: 'Lance le ballon d’un geste vers le haut. 30 secondes, le panier bouge. Un panier vaut 1 point, 2 points dès le 4e d’affilée.',
    lowerIsBetter: false,
    unit: ['point', 'points'],
    color: '#FF6B6B',
  },
  {
    id: 'stop10',
    nom: 'Stop à 10 secondes',
    pitch: 'Arrête le chrono pile à 10,00 s. Il disparaît au bout de 3 secondes, et s’arrête seul à 20 s.',
    lowerIsBetter: true,
    unit: ['', ''], // affiché en secondes d'écart (formatScore)
    color: '#FF9EBC',
  },
  {
    id: 'reflexes',
    nom: 'Réflexes',
    pitch: 'Touche dès que l’écran passe au vert. Cinq essais, on garde la moyenne.',
    lowerIsBetter: true,
    unit: ['ms', 'ms'],
    color: '#4ECDC4',
  },
];

export const jeuMeta = (id: string) => JEUX.find((j) => j.id === id);

// Logos dessinés par gpt-image-2.5 (scripts/minijeux_logos.py : direction artistique et prompts)
export const LOGOS: Record<JeuId | DuelJeu | 'classement', number> = {
  stack: require('@/assets/minijeux/logos/stack.webp'),
  flappy: require('@/assets/minijeux/logos/flappy.webp'),
  basket: require('@/assets/minijeux/logos/basket.webp'),
  stop10: require('@/assets/minijeux/logos/stop10.webp'),
  reflexes: require('@/assets/minijeux/logos/reflexes.webp'),
  puissance4: require('@/assets/minijeux/logos/puissance4.webp'),
  echecs: require('@/assets/minijeux/logos/echecs.webp'),
  classement: require('@/assets/minijeux/logos/classement.webp'),
};

export const secondes = (ms: number) => (ms / 1000).toFixed(2).replace('.', ',');

/** « 3 victoires », « 1 nul » */
export const plural = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

/** Or, argent, bronze */
export const MEDALS = ['#FFD93D', '#D9D4E2', '#E0A070'];

export function formatScore(jeu: JeuMeta, score: number) {
  if (jeu.id === 'stop10') return `${secondes(score)} s d’écart`;
  return `${score} ${score > 1 ? jeu.unit[1] : jeu.unit[0]}`;
}

/** Petit mot sous le score, selon le jeu */
export function verdict(jeu: JeuMeta, score: number): string | null {
  switch (jeu.id) {
    case 'reflexes':
      if (score < 200) return 'Réflexes de chat';
      if (score < 250) return 'Très vif';
      if (score < 300) return 'Dans la bonne moyenne';
      if (score < 400) return 'Encore un peu endormi';
      return 'Il est l’heure d’aller se coucher';
    case 'flappy':
      if (score >= 40) return 'Légendaire';
      if (score >= 20) return 'Pilote confirmé';
      if (score >= 10) return 'Ça plane';
      if (score >= 3) return 'Premiers battements';
      return 'Le tuyau a gagné';
    case 'basket':
      if (score >= 30) return 'Le panier est à toi';
      if (score >= 15) return 'Main chaude';
      if (score >= 6) return 'Bonne adresse';
      return 'On s’échauffe';
    case 'stack':
      if (score >= 50) return 'Gratte-ciel';
      if (score >= 30) return 'Architecte';
      if (score >= 15) return 'Belle tour';
      if (score >= 5) return 'Ça tient debout';
      return 'Effondrement';
    case 'stop10':
      if (score === 0) return 'Pile poil. Incroyable.';
      if (score <= 50) return 'Horloge atomique';
      if (score <= 200) return 'Très précis';
      if (score <= 500) return 'Pas mal du tout';
      if (score <= 1000) return 'À une seconde près';
      return 'Le temps file';
  }
}

/** Vrai si a bat b */
export const beats = (jeu: JeuMeta, a: number, b: number) => (jeu.lowerIsBetter ? a < b : a > b);

export type Record_ = {
  jeu: JeuId;
  user_id: string;
  best: number;
  parties: number;
  last_played: string;
  /** Première partie où le record a été atteint : départage les égalités */
  record_at: string;
};
/** rang : place au classement, partagée par les ex æquo */
export type Ligne = Record_ & { profile?: ProfileMini; rang: number };
export type EloLigne = {
  user_id: string;
  elo: number;
  parties: number;
  victoires: number;
  nuls: number;
  updated_at: string;
  profile?: ProfileMini;
  rang?: number;
};

export type Classements = { scores: Record<JeuId, Ligne[]>; elo: Record<DuelJeu, EloLigne[]> };

export const defaites = (e: EloLigne) => e.parties - e.victoires - e.nuls;

/** Profils (prénom, pseudo) des membres demandés, par id */
export async function fetchProfiles(ids: string[]): Promise<Record<string, ProfileMini>> {
  if (!ids.length) return {};
  const { data } = await sb.from('profiles').select('id,prenom,nom,pseudo').in('id', ids);
  return Object.fromEntries(((data ?? []) as ProfileMini[]).map((p) => [p.id, p]));
}

/** Elo de quelques joueurs (ceux qui n'ont jamais joué n'ont pas de ligne) */
export async function fetchElo(jeu: DuelJeu, ids: string[]): Promise<Record<string, number>> {
  const { data } = await sb.from('minijeux_elo').select('user_id,elo').eq('jeu', jeu).in('user_id', ids);
  return Object.fromEntries(((data ?? []) as { user_id: string; elo: number }[]).map((e) => [e.user_id, e.elo]));
}

// Plusieurs écrans lisent les classements coup sur coup (onglet, partie, classement général) :
// une seule requête toutes les 20 s, et une nouvelle dès qu'un score ou un Elo change
let cache: { at: number; data: Promise<Classements> } | null = null;
export const invalidateClassements = () => {
  cache = null;
};

/** Records de tous les jeux et Elo des jeux à deux, classés du meilleur au moins bon */
export function fetchClassements(): Promise<Classements> {
  if (cache && Date.now() - cache.at < 20_000) return cache.data;
  const data = loadClassements();
  cache = { at: Date.now(), data };
  data.catch(invalidateClassements);
  return data;
}

/** Pose le rang de chaque ligne déjà triée : même rang que la précédente si elles sont à égalité */
function classer<T extends { rang?: number }>(lignes: T[], egal: (a: T, b: T) => boolean) {
  lignes.forEach((l, i) => {
    (l as { rang?: number }).rang = i > 0 && egal(lignes[i - 1], l) ? (lignes[i - 1].rang ?? i) : i + 1;
  });
}

async function loadClassements(): Promise<Classements> {
  const [rec, elo] = await Promise.all([
    sb.from('minijeux_records').select('jeu,user_id,best,parties,last_played,record_at'),
    sb.from('minijeux_elo').select('jeu,user_id,elo,parties,victoires,nuls,updated_at'),
  ]);
  if (rec.error) throw rec.error;
  if (elo.error) throw elo.error;
  const rows = (rec.data ?? []) as Record_[];
  const elos = ((elo.data ?? []) as (EloLigne & { jeu: DuelJeu })[]).filter((e) => e.parties > 0);
  const byId = await fetchProfiles([...new Set([...rows.map((r) => r.user_id), ...elos.map((e) => e.user_id)])]);
  const scores = Object.fromEntries(JEUX.map((j) => [j.id, [] as Ligne[]])) as Record<JeuId, Ligne[]>;
  for (const r of rows) scores[r.jeu]?.push({ ...r, profile: byId[r.user_id], rang: 0 });
  for (const j of JEUX) {
    // À égalité, le premier à avoir atteint ce score passe devant : rejouer moins bien ne fait rien perdre
    scores[j.id].sort((a, b) =>
      a.best === b.best ? a.record_at.localeCompare(b.record_at) : j.lowerIsBetter ? a.best - b.best : b.best - a.best,
    );
    classer(scores[j.id], (a, b) => a.best === b.best && a.record_at === b.record_at);
  }
  // Elo égal : même place ; dans l'affichage, celui qui a le plus joué d'abord
  const eloDe = (jeu: DuelJeu) => {
    const l = elos
      .filter((e) => e.jeu === jeu)
      .map((e) => ({ ...e, profile: byId[e.user_id] }))
      .sort((a, b) => b.elo - a.elo || b.parties - a.parties);
    classer(l, (a, b) => a.elo === b.elo);
    return l;
  };
  return { scores, elo: { puissance4: eloDe('puissance4'), echecs: eloDe('echecs') } };
}

// ─── Classement général : des points de place sur chaque jeu, comme en Formule 1 ───

export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

export type General = {
  user_id: string;
  profile?: ProfileMini;
  points: number;
  /** Nombre de jeux où il est premier (ex æquo compris) */
  titres: number;
  /** Place par jeu (1 = premier), pour le détail */
  places: Partial<Record<JeuId | DuelJeu, number>>;
  /** Place au classement général, partagée à égalité de points et de titres */
  rang: number;
};

export function classementGeneral(c: Classements): General[] {
  const out: Record<string, General> = {};
  // Des ex æquo ont la même place, donc les mêmes points
  const add = (jeu: JeuId | DuelJeu, ids: { user_id: string; profile?: ProfileMini; rang?: number }[]) => {
    ids.forEach((l, i) => {
      const rang = l.rang ?? i + 1;
      const g = (out[l.user_id] ??= { user_id: l.user_id, profile: l.profile, points: 0, titres: 0, places: {}, rang: 0 });
      g.points += POINTS[rang - 1] ?? 0;
      if (rang === 1) g.titres += 1;
      g.places[jeu] = rang;
    });
  };
  for (const j of JEUX) add(j.id, c.scores[j.id]);
  add('puissance4', c.elo.puissance4);
  add('echecs', c.elo.echecs);
  const rows = Object.values(out).sort((a, b) => b.points - a.points || b.titres - a.titres);
  classer(rows, (a, b) => a.points === b.points && a.titres === b.titres);
  return rows;
}

// ─── Enregistrement d'un score ───
// Le serveur ouvre la partie (minijeux_commencer) et mesure sa durée jusqu'à l'envoi du score
// (minijeux_enregistrer). Un score qui n'a pas pu partir attend dans le téléphone et repart
// tout seul ; la session ne sert qu'une fois, un renvoi ne fait donc jamais de doublon.

/** Ouvre une partie côté serveur ; rend l'identifiant de session */
export async function commencerPartie(jeu: JeuId): Promise<string> {
  const { data, error } = await sb.rpc('minijeux_commencer', { jeu });
  if (error) throw error;
  return data as string;
}

type EnAttente = { session: string; jeu: JeuId; score: number; at: number; /** compte qui a joué */ user?: string };
const ATTENTE = 'minijeux_scores_en_attente';

// Une seule lecture-modification-écriture de la file à la fois : un envoi et un renvoi
// simultanés ne s'écrasent pas
let verrou: Promise<unknown> = Promise.resolve();
function enFile<T>(fn: () => Promise<T>): Promise<T> {
  const next = verrou.then(fn, fn);
  verrou = next.catch(() => {});
  return next;
}

async function lireAttente(): Promise<EnAttente[]> {
  try {
    const raw = await AsyncStorage.getItem(ATTENTE);
    return raw ? (JSON.parse(raw) as EnAttente[]) : [];
  } catch {
    return [];
  }
}

async function ecrireAttente(l: EnAttente[]) {
  await (l.length ? AsyncStorage.setItem(ATTENTE, JSON.stringify(l)) : AsyncStorage.removeItem(ATTENTE)).catch(() => {});
}

/** Scores du compte connecté en attente d'envoi, par jeu */
export async function scoresEnAttente(): Promise<Partial<Record<JeuId, number[]>>> {
  const me = (await sessionUser())?.id;
  const out: Partial<Record<JeuId, number[]>> = {};
  for (const p of await lireAttente()) if (!p.user || p.user === me) (out[p.jeu] ??= []).push(p.score);
  return out;
}

/** ok : enregistré ; refuse : le serveur n'en veut pas, inutile de renvoyer ; echec : réseau, à renvoyer */
async function envoyer(p: EnAttente): Promise<'ok' | 'refuse' | 'echec'> {
  try {
    const { error } = await sb.rpc('minijeux_enregistrer', { session: p.session, score: p.score });
    if (!error) return 'ok';
    // Refus explicite de la fonction (partie inconnue, trop ancienne, score impossible)
    return error.code === 'P0001' ? 'refuse' : 'echec';
  } catch {
    return 'echec';
  }
}

export type Envoi = 'ok' | 'attente' | 'refuse';

/** Envoie le score d'une partie ; s'il ne part pas, il est gardé pour plus tard */
export async function saveScore(session: string, jeu: JeuId, score: number): Promise<Envoi> {
  const p: EnAttente = { session, jeu, score: Math.round(score), at: Date.now(), user: (await sessionUser())?.id };
  const r = await envoyer(p);
  invalidateClassements();
  if (r !== 'echec') return r;
  await enFile(async () => ecrireAttente([...(await lireAttente()).filter((x) => x.session !== session), p]));
  return 'attente';
}

type Renvoi = { restants: string[]; refuses: string[] };
let envoiEnCours: Promise<Renvoi> | null = null;

/** Renvoie les scores en attente ; rend les sessions encore en attente et celles refusées */
export function renvoyerScores(): Promise<Renvoi> {
  envoiEnCours ??= enFile(async () => {
    const me = (await sessionUser())?.id;
    const tous = await lireAttente();
    // Les scores d'un autre compte (changement de compte sur ce téléphone) attendent leur propriétaire
    const avant = tous.filter((p) => !p.user || p.user === me);
    const autres = tous.filter((p) => p.user && p.user !== me);
    const restants: EnAttente[] = [];
    const refuses: string[] = [];
    for (const p of avant) {
      const r = await envoyer(p);
      if (r === 'echec') restants.push(p);
      else if (r === 'refuse') refuses.push(p.session);
    }
    await ecrireAttente([...autres, ...restants]);
    if (restants.length < avant.length) invalidateClassements();
    return { restants: restants.map((x) => x.session), refuses };
  }).finally(() => {
    envoiEnCours = null;
  });
  return envoiEnCours;
}

export const displayName = (p?: ProfileMini) => p?.prenom || p?.pseudo || 'Quelqu’un';
