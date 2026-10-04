// Edge Function Supabase : envoie une push notification via Expo Push API.
//
// Endpoint : POST /functions/v1/send-push
// Headers requis : Authorization: Bearer <PUSH_INTERNAL_SECRET>
// Body : {
//   title: string,
//   body: string,
//   data?: Record<string, any>,    // arbitraire, utilisé pour deeplink (ex: { route: '/(tabs)/events', eventId: '...' })
//   userIds?: string[],            // si fourni : push uniquement à ces users. Sinon : à tous les users avec un token.
//   excludeUserId?: string,        // exclut ce user (typiquement, l'auteur de l'event ne reçoit pas sa propre notif)
// }
//
// Variables d'env requises (à configurer dans Supabase > Edge Functions > Secrets) :
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   PUSH_INTERNAL_SECRET (optionnel : à défaut, lu dans public._app_config, la même ligne
//                         que celle utilisée par notify_push ; utile quand le compte n'a
//                         pas le droit de gérer les secrets des Edge Functions)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ENV_PUSH_SECRET = Deno.env.get('PUSH_INTERNAL_SECRET') ?? '';

// Secret partagé : variable d'env si présente, sinon _app_config (mis en cache par instance)
let cachedSecret: string | null = null;
async function pushSecret(): Promise<string> {
  if (ENV_PUSH_SECRET) return ENV_PUSH_SECRET;
  if (cachedSecret) return cachedSecret;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await admin
    .from('_app_config')
    .select('push_internal_secret')
    .eq('id', 1)
    .maybeSingle();
  cachedSecret = data?.push_internal_secret ?? '';
  return cachedSecret;
}

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  userIds?: string[];
  excludeUserId?: string;
};

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data?: Record<string, unknown>;
  priority?: 'default' | 'normal' | 'high';
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  // Auth interne
  const auth = req.headers.get('authorization') ?? '';
  const secret = await pushSecret();
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: PushPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!payload?.title || !payload?.body) {
    return new Response('Missing title/body', { status: 400 });
  }

  // userIds absent/null = tout le monde ; tableau vide = personne (pas un broadcast)
  if (Array.isArray(payload.userIds) && payload.userIds.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let q = sb.from('push_tokens').select('user_id, token');
  if (payload.userIds?.length) q = q.in('user_id', payload.userIds);
  const { data: tokens, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Un même téléphone peut porter plusieurs comptes (ancien token jamais retiré) :
  // on n'envoie qu'une fois par token, et jamais à un appareil de l'auteur.
  const authorTokens = new Set<string>();
  if (payload.excludeUserId) {
    const { data: own } = await sb
      .from('push_tokens')
      .select('token')
      .eq('user_id', payload.excludeUserId);
    (own ?? []).forEach((t) => authorTokens.add(t.token));
  }
  const seen = new Set<string>();
  const filtered = (tokens ?? []).filter((t) => {
    if (t.user_id === payload.excludeUserId || authorTokens.has(t.token)) return false;
    if (seen.has(t.token)) return false;
    seen.add(t.token);
    return true;
  });
  if (filtered.length === 0) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const messages: ExpoMessage[] = filtered.map((t) => ({
    to: t.token,
    title: payload.title,
    body: payload.body,
    sound: 'default',
    data: payload.data ?? {},
    priority: 'high',
  }));

  // Expo accepte 100 messages max par request
  const results: unknown[] = [];
  for (const batch of chunk(messages, 100)) {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'accept-encoding': 'gzip, deflate',
        'content-type': 'application/json',
      },
      body: JSON.stringify(batch),
    });
    const json = await resp.json().catch(() => ({}));
    results.push(json);

    // Best-effort cleanup : si Expo dit DeviceNotRegistered, on supprime le token
    const data = (json as { data?: Array<{ status: string; details?: { error?: string } }> })
      .data;
    if (data?.length) {
      const toDelete: string[] = [];
      data.forEach((r, i) => {
        if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') {
          toDelete.push(batch[i].to);
        }
      });
      if (toDelete.length) {
        await sb.from('push_tokens').delete().in('token', toDelete);
      }
    }
  }

  return new Response(JSON.stringify({ sent: messages.length, results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
