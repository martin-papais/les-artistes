// Edge Function Supabase : joue un coup d'échecs après l'avoir vérifié.
//
// Endpoint : POST /functions/v1/echecs-jouer (JWT de l'utilisateur, vérifié par Supabase)
// Body : { partie: string, coup: string }  — coup en notation e2e4, e7e8q pour une promotion
//
// La partie est rejouée depuis le début avec chess.js (la répétition de position a besoin de
// tout l'historique), le coup est refusé s'il est illégal, puis echecs_appliquer
// (supabase/15_minijeux_echecs.sql, réservée au service_role) l'enregistre, finit la partie
// au besoin et met l'Elo à jour.
// Variables d'env fournies par Supabase : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2.105.4';
import { Chess } from 'npm:chess.js@1.4.0';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const parse = (uci: string) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST attendu' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
  const { data: who } = await user.auth.getUser(auth.replace(/^Bearer /, ''));
  const me = who.user?.id;
  if (!me) return json({ error: 'Connexion requise' }, 401);

  const { partie, coup } = await req.json().catch(() => ({}));
  if (typeof partie !== 'string' || typeof coup !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(coup)) {
    return json({ error: 'Coup invalide' }, 400);
  }

  // Lue avec les droits du joueur : seuls les deux joueurs voient la partie
  const { data: p } = await user
    .from('echecs_parties')
    .select('joueur1,joueur2,statut,tour,coups,historique')
    .eq('id', partie)
    .maybeSingle();
  if (!p || p.statut !== 'en_cours') return json({ error: 'Partie terminée ou introuvable' }, 409);
  const seat = p.joueur1 === me ? 1 : p.joueur2 === me ? 2 : 0;
  if (p.tour !== seat) return json({ error: 'Ce n’est pas ton tour' }, 409);

  const chess = new Chess();
  for (const m of p.historique as string[]) chess.move(parse(m));
  let lan: string;
  try {
    lan = chess.move(parse(coup)).lan;
  } catch {
    return json({ error: 'Coup illégal' }, 400);
  }

  const fin = chess.isCheckmate()
    ? 'mat'
    : chess.isStalemate()
      ? 'pat'
      : chess.isThreefoldRepetition()
        ? 'repetition'
        : chess.isInsufficientMaterial()
          ? 'materiel'
          : chess.isDrawByFiftyMoves()
            ? '50coups'
            : null;

  const admin = createClient(URL_, SERVICE);
  const { error } = await admin.rpc('echecs_appliquer', {
    partie,
    joueur: me,
    avant: p.coups,
    uci: lan,
    fen_: chess.fen(),
    fin_: fin,
  });
  if (error) return json({ error: error.message }, 409);
  return json({ ok: true, fin });
});
