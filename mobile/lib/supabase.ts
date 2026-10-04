import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ldchxxkmvepvbvhdokot.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxkY2h4eGttdmVwdmJ2aGRva290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NDQwNTMsImV4cCI6MjA4OTAyMDA1M30.HJw5-GsHCildEQ28HAB30_YKdiZOdeRJIml5wgLvHos';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type Profile = {
  id: string;
  prenom: string | null;
  nom: string | null;
  pseudo: string | null;
  email: string | null;
  tel: string | null;
  dob: string | null;
};

export type ProfileMini = {
  id: string;
  prenom: string | null;
  nom: string | null;
  pseudo: string | null;
};

export type EventRow = {
  id: string;
  categorie: string | null;
  date_event: string;
  heure: string | null;
  lieu: string | null;
  chez_qui: string | null;
  duree: string | null;
  anniversaire_qui: string | null;
  feria_ville: string | null;
  sport_type: string | null;
  raison: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
};

export type VotePresent = 'oui' | 'non';

export type EventVote = {
  id?: string;
  event_id: string;
  user_id: string;
  present: VotePresent;
};

export type EventComment = {
  id: string;
  event_id: string;
  user_id: string;
  contenu: string;
  created_at: string;
};

// Mêmes colonnes que photos.html (le web n'a jamais eu de colonne caption)
export type PhotoRow = {
  id: string;
  file_url: string | null;
  sujet: string | null;
  description: string | null;
  pris_par: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  type: 'photo' | 'video' | 'audio' | 'file' | 'folder' | null;
  date_media: string | null;
  created_by: string;
  created_at: string;
};

/** Date locale AAAA-MM-JJ (toISOString() donnerait la veille entre 0 h et 2 h à Paris). */
export function localDateString(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type NewsRow = {
  id: string;
  titre: string;
  contenu: string;
  tags: string | null;
  cover_url: string | null;
  created_by: string;
  created_at: string;
};

export type NewsLike = {
  id?: string; // le web n'utilise pas cette colonne : on passe par (news_id, user_id)
  news_id: string;
  user_id: string;
};

export type NewsComment = {
  id: string;
  news_id: string;
  user_id: string;
  contenu: string;
  created_at: string;
};

export type Note = {
  id: string;
  user_id: string;
  contenu: string;
  categorie: string | null;
  created_at: string;
};

export type NoteReaction = {
  id: string;
  note_id: string;
  user_id: string;
  emoji: string;
};

export type JeuAlcool = {
  id: string;
  categorie: string;
  nom: string;
  regles: string;
  joueurs: string | null;
  niveau: string | null;
  materiel: string | null;
  created_by: string;
  created_at: string;
};

export type JeuSociete = {
  id: string;
  nom: string;
  regles: string;
  joueurs_max: string | null;
  duree: string | null;
  detenteur: string | null;
  a_acheter: string | null;
  note: number | null;
  avis: string | null;
  created_by: string;
  created_at: string;
};

export type JeuSocieteVote = {
  id: string;
  jeu_id: string;
  user_id: string;
  note: number;
};

export type ShopArticle = {
  id: string;
  nom: string;
  prix: number | null;
  description: string | null;
  image: string | null;
  image2: string | null;
  image3: string | null;
  image4: string | null;
  badge: string | null;
  tailles: string | null;
  created_at: string;
};

export type ShopOrder = {
  id: string;
  article_id: string;
  user_id: string;
  taille: string;
  personnalisation: string | null;
};

export type ShopConfig = {
  key: string;
  value: string;
};

export type SondageCandidat = {
  id: string;
  nom: string;
  categorie: string;
  image: string | null;
  image2: string | null;
  image3: string | null;
  image4: string | null;
  description: string | null;
};

export type SondageVote = {
  id: string;
  candidat_id: string;
  user_id: string;
  categorie: string;
};

export type AnnuaireExtra = {
  user_id: string;
  addresses: string | null;
  rib: string | null;
};
