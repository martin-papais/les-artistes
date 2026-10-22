/**
 * Photo de profil et couleur choisie de chaque membre, chargées une fois pour
 * toute l'appli : la Pastille du kit les lit ici à partir du seul id.
 * Colonnes profiles.avatar_url / avatar_color (supabase/12_avatars.sql).
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type * as ImagePicker from 'expo-image-picker';
import { useSyncExternalStore } from 'react';

import { ecrireCache, lireCache } from '@/lib/cache';
import { sb } from '@/lib/supabase';

export const AVATAR_COLORS = ['teal', 'yellow', 'pink', 'violet', 'coral'] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];
export type Avatar = { url: string | null; color: AvatarColor | null };

let avatars: Record<string, Avatar> = {};
let loading: Promise<void> | null = null;
let loaded = false;
let loadedAt = 0;
const listeners = new Set<() => void>();
// Les photos changent rarement : pas plus d'un rechargement toutes les 10 minutes au retour
// dans l'appli (la base gratuite est lente) ; celles gardées sur le téléphone s'affichent d'abord
const FRAIS_MS = 10 * 60_000;

lireCache<Record<string, Avatar>>('avatars').then((a) => {
  if (a && !loaded) {
    avatars = a;
    emit();
  }
});

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  // Premier abonné : on charge (sans session, la RLS renvoie une liste vide)
  if (!loaded && !loading) void loadAvatars();
  return () => {
    listeners.delete(l);
  };
}

/** Recharge les avatars de tout le groupe. Sans les colonnes (SQL pas appliqué) : rien. */
export function loadAvatars(): Promise<void> {
  if (loading) return loading;
  // Réponse vide comprise (écran de connexion, sans session) : sinon chaque abonné relance
  if (loadedAt && Date.now() - loadedAt < FRAIS_MS) return Promise.resolve();
  loading = (async () => {
    try {
      const { data, error } = await sb.from('profiles').select('id, avatar_url, avatar_color');
      if (error || !data) return;
      const next: Record<string, Avatar> = {};
      for (const r of data as { id: string; avatar_url: string | null; avatar_color: string | null }[]) {
        const color = (AVATAR_COLORS as readonly string[]).includes(r.avatar_color ?? '') ? (r.avatar_color as AvatarColor) : null;
        if (r.avatar_url || color) next[r.id] = { url: r.avatar_url, color };
      }
      avatars = next;
      loaded = data.length > 0;
      loadedAt = Date.now();
      if (loaded) ecrireCache('avatars', next);
      emit();
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Vide le cache (déconnexion) */
export function resetAvatars() {
  avatars = {};
  loaded = false;
  loadedAt = 0;
  emit();
}

export function useAvatar(id: string | null | undefined): Avatar | undefined {
  return useSyncExternalStore(subscribe, () => (id ? avatars[id] : undefined));
}

function setLocal(id: string, patch: Partial<Avatar>) {
  const cur = avatars[id] ?? { url: null, color: null };
  avatars = { ...avatars, [id]: { ...cur, ...patch } };
  ecrireCache('avatars', avatars);
  emit();
}

const FOLDER = (uid: string) => `${uid}/avatar`;

async function removeOldFiles(uid: string, keep?: string) {
  const { data: files } = await sb.storage.from('media').list(FOLDER(uid), { limit: 100 });
  const paths = (files ?? []).filter((f) => f.id && `${FOLDER(uid)}/${f.name}` !== keep).map((f) => `${FOLDER(uid)}/${f.name}`);
  if (paths.length) await sb.storage.from('media').remove(paths);
}

/** Recadre en carré au centre, réduit à 400 px, envoie, puis enregistre l'URL. */
export async function uploadAvatar(uid: string, asset: ImagePicker.ImagePickerAsset) {
  const side = Math.min(asset.width, asset.height);
  const ctx = ImageManipulator.manipulate(asset.uri);
  ctx.crop({ originX: Math.floor((asset.width - side) / 2), originY: Math.floor((asset.height - side) / 2), width: side, height: side });
  ctx.resize({ width: 400, height: 400 });
  const out = await (await ctx.renderAsync()).saveAsync({ compress: 0.8, format: SaveFormat.JPEG });

  // Nouveau nom à chaque fois : l'ancienne image en cache ne réapparaît pas
  const path = `${FOLDER(uid)}/${Date.now()}.jpg`;
  const body = await fetch(out.uri).then((r) => r.arrayBuffer());
  const up = await sb.storage.from('media').upload(path, body, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw up.error;
  const url = sb.storage.from('media').getPublicUrl(path).data.publicUrl;

  const { error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', uid);
  if (error) {
    await sb.storage.from('media').remove([path]);
    throw new Error(error.message);
  }
  setLocal(uid, { url });
  removeOldFiles(uid, path).catch(() => {});
}

export async function removeAvatar(uid: string) {
  const { error } = await sb.from('profiles').update({ avatar_url: null }).eq('id', uid);
  if (error) throw new Error(error.message);
  setLocal(uid, { url: null });
  removeOldFiles(uid).catch(() => {});
}

export async function setAvatarColor(uid: string, color: AvatarColor | null) {
  const prev = avatars[uid]?.color ?? null;
  setLocal(uid, { color });
  const { error } = await sb.from('profiles').update({ avatar_color: color }).eq('id', uid);
  if (error) {
    setLocal(uid, { color: prev });
    throw new Error(error.message);
  }
}
