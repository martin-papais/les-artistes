import AsyncStorage from '@react-native-async-storage/async-storage';

// Les Olympiades vivent dans `olympiades.html` du site (objet `var OLYMPIADES = {…}`).
// On relit la page publiée pour garder une seule source : une édition ajoutée sur
// le site apparaît dans l'appli sans mise à jour.

const PAGE_URL = 'https://les--artistes.fr/olympiades.html';
const CACHE_KEY = 'olympiades:v2';

export const TEAM_COLORS: Record<string, { hex: string; label: string }> = {
  rouge: { hex: '#FF6B6B', label: 'Rouge' },
  vert: { hex: '#A8E063', label: 'Vert' },
  jaune: { hex: '#FFD93D', label: 'Jaune' },
  bleu: { hex: '#4ECDC4', label: 'Bleu' },
};
export const colorHex = (key?: string) => (key && TEAM_COLORS[key]?.hex) || '#999999';
export const colorLabel = (key?: string) => (key && TEAM_COLORS[key]?.label) || '';

export type Citation = { text: string; auteur?: string };
export type Team = {
  id?: string;
  nom?: string;
  emoji?: string;
  couleur?: string;
  capitaine?: string;
  membres: string[];
  vainqueur?: boolean;
};
export type Epreuve = { nom: string; num?: number; desc?: string; scores?: Record<string, number> };
export type Extra = { equipeId: string; type: 'bonus' | 'malus'; points: number; motif: string };
export type Absent = { nom: string; equipeId: string | null; type: 'blessure' | 'absent'; raison: string };
export type QuineLigne = { type: string; nom: string; contenu?: string; gagnant: string };
export type Edition = {
  legacy?: boolean;
  date: string;
  lieu: string;
  meteo?: { desc: string };
  format?: string;
  resume?: string;
  citations?: Citation[];
  bbq?: string;
  loto?: { intro?: string; quines: { titre: string; lignes: QuineLigne[] }[] };
  superQuine?: { gagnant: string; lot: string };
  repas?: string;
  anecdote?: string;
  teams: Team[];
  epreuves: Epreuve[];
  extras?: Extra[];
  absents?: Absent[];
  vainqueurs?: string[];
  photos?: { url: string; caption?: string }[];
  /** Visuel déroulé de l'écocup de l'année (largeur = π × diamètre), à ajouter sur le site */
  verre?: string;
};
export type Olympiades = Record<string, Edition>;

// Écocups déroulés à partir d'une vidéo du vrai verre (encre seule, fond transparent).
// Un `verre` posé sur le site passe devant.
const VERRES: Record<string, number> = {
  '2025': require('@/assets/olympiades/verre-2025.png'),
  '2026': require('@/assets/olympiades/verre-2026.png'),
};
export const verreArt = (year: string, d: Edition) => d.verre ?? VERRES[year];

export type RankedTeam = Team & { totalPoints: number; classement: number };

/** Classement et vainqueur de chaque épreuve, calculés comme sur le site. */
export function computeYear(d: Edition) {
  const pts: Record<string, number> = {};
  d.teams.forEach((t) => (pts[t.id ?? ''] = 0));
  const winners: Record<string, string | null> = {};
  d.epreuves.forEach((ep, i) => {
    let best: string | null = null;
    let bestVal = -Infinity;
    Object.entries(ep.scores ?? {}).forEach(([id, v]) => {
      if (id in pts) pts[id] += v;
      if (v > bestVal) {
        bestVal = v;
        best = id;
      }
    });
    winners[i] = best;
  });
  (d.extras ?? []).forEach((ex) => {
    if (ex.equipeId in pts) pts[ex.equipeId] += ex.points;
  });
  const ranked: RankedTeam[] = d.teams
    .map((t) => ({ ...t, totalPoints: pts[t.id ?? ''] ?? 0, classement: 0 }))
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .map((t, i) => ({ ...t, classement: i + 1 }));
  return { ranked, winners };
}

/**
 * Vainqueur d'une édition, comme sur le site : pour les archives, l'encadré
 * nomme les membres de l'équipe gagnante, le palmarès reprend `vainqueurs`.
 */
export function championOf(d: Edition, where: 'edition' | 'palmares' = 'edition'): string {
  if (!d.legacy) {
    const c = computeYear(d).ranked[0];
    return c?.nom || 'Non renseigné';
  }
  const w = d.teams.find((t) => t.vainqueur);
  if (where === 'palmares') return d.vainqueurs?.length ? d.vainqueurs.join(', ') : 'Vainqueur non renseigné';
  if (w) return w.membres.join(', ');
  if (d.vainqueurs?.length) return d.vainqueurs.join(', ');
  return 'Non renseigné';
}

const isIdent = (c: string) => /[A-Za-z0-9_$\u00C0-\u024F]/.test(c);

/**
 * Convertit le littéral JS de la page en JSON : commentaires retirés, clés et
 * chaînes entre guillemets doubles, virgules finales supprimées. Rien n'est
 * exécuté. Renvoie la position de fin pour s'arrêter à l'accolade fermante.
 */
function literalToJson(src: string, start: number): string {
  let out = '';
  let depth = 0;
  let pendingComma = false;
  let i = start;
  const emit = (s: string) => {
    if (pendingComma) {
      out += ',';
      pendingComma = false;
    }
    out += s;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = '"';
      i++;
      while (i < src.length && src[i] !== c) {
        const ch = src[i];
        if (ch === '\\') {
          const nx = src[i + 1];
          // \' \x \v \0 n'existent pas en JSON ; le reste (\" \\ \n …) passe tel quel
          if (nx === "'") s += "'";
          else if (nx === 'x') {
            s += `\\u00${src.slice(i + 2, i + 4)}`;
            i += 2;
          } else if (nx === 'v') s += '\\u000b';
          else if (nx === '0') s += '\\u0000';
          else if (nx === '\n') s += '';
          else s += ch + nx;
          i += 2;
          continue;
        }
        if (ch === '"') s += '\\"';
        else if (ch === '\n') s += '\\n';
        else if (ch === '\t') s += '\\t';
        else s += ch;
        i++;
      }
      i++;
      emit(s + '"');
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === ',') {
      pendingComma = true;
      i++;
      continue;
    }
    if (c === '}' || c === ']') {
      pendingComma = false; // virgule finale
      out += c;
      i++;
      if (c === '}' && --depth === 0) return out;
      continue;
    }
    if (c === '{') {
      depth++;
      emit(c);
      i++;
      continue;
    }
    if (isIdent(c) || c === '-' || c === '+' || c === '.') {
      let tok = c;
      i++;
      // Le point et l'exposant signé ne servent qu'aux nombres (1.5, 1e-3)
      while (i < src.length && (isIdent(src[i]) || src[i] === '.' || (/[eE]$/.test(tok) && /[-+]/.test(src[i])))) {
        tok += src[i++];
      }
      let j = i;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === ':' && isIdent(c)) emit(`"${tok}"`);
      else if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(tok)) emit(String(Number(tok)));
      else if (tok === 'true' || tok === 'false' || tok === 'null') emit(tok);
      else if (tok === 'undefined') emit('null');
      else throw new Error(`Valeur inattendue : ${tok}`);
      continue;
    }
    emit(c);
    i++;
  }
  throw new Error('Objet OLYMPIADES non terminé');
}

// Les textes du site contiennent des emojis (météo, noms) : l'appli n'en affiche pas
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const str = (v: unknown) =>
  typeof v === 'string' ? v.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim() : '';
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v.filter(Boolean) as T[]) : []);

/** Le site encaisse un champ oublié ; l'appli aussi : tout ce qui est affiché est remis en forme. */
function normalize(d: Edition) {
  d.date = str(d.date);
  d.lieu = str(d.lieu);
  d.teams = list<Team>(d.teams).map((t) => ({
    ...t,
    nom: str(t.nom),
    capitaine: str(t.capitaine),
    membres: list<string>(t.membres).map(str).filter(Boolean),
  }));
  d.epreuves = list<Epreuve>(d.epreuves).map((ep) => ({ ...ep, nom: str(ep.nom), desc: str(ep.desc) }));
  d.citations = list<Citation>(d.citations).map((c) => ({ text: str(c.text), auteur: str(c.auteur) }));
  d.extras = list<Extra>(d.extras).map((ex) => ({ ...ex, points: Number(ex.points) || 0, motif: str(ex.motif) }));
  d.absents = list<Absent>(d.absents).map((a) => ({ ...a, nom: str(a.nom), raison: str(a.raison) }));
  d.photos = list<{ url: string; caption?: string }>(d.photos).filter((p) => typeof p.url === 'string' && !!p.url);
  if (d.loto) {
    d.loto = {
      intro: str(d.loto.intro),
      quines: list<{ titre: string; lignes: QuineLigne[] }>(d.loto.quines).map((q) => ({
        titre: str(q.titre),
        lignes: list<QuineLigne>(q.lignes).map((l) => ({
          type: str(l.type),
          nom: str(l.nom),
          contenu: str(l.contenu),
          gagnant: str(l.gagnant),
        })),
      })),
    };
  }
  if (d.superQuine) d.superQuine = { gagnant: str(d.superQuine.gagnant), lot: str(d.superQuine.lot) };
  if (d.meteo) d.meteo = { desc: str(d.meteo.desc) };
  for (const k of ['resume', 'bbq', 'repas', 'anecdote', 'verre'] as const) {
    if (d[k] !== undefined) d[k] = str(d[k]) || undefined;
  }
}

export function parseOlympiadesPage(html: string): Olympiades {
  const m = /var\s+OLYMPIADES\s*=\s*\{/.exec(html);
  if (!m) throw new Error('OLYMPIADES introuvable');
  const data = JSON.parse(literalToJson(html, m.index + m[0].length - 1)) as Olympiades;
  for (const [year, d] of Object.entries(data)) {
    if (!/^\d{4}$/.test(year) || !d || typeof d !== 'object') {
      throw new Error(`Édition ${year} illisible`);
    }
    normalize(d);
  }
  return data;
}

export async function loadCachedOlympiades(): Promise<Olympiades | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Olympiades) : null;
  } catch {
    return null;
  }
}

export async function fetchOlympiades(): Promise<Olympiades> {
  // Sur Android, une requête sans réponse ne s'arrête jamais d'elle-même
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  let html: string;
  try {
    // Le paramètre contourne le cache HTTP du téléphone (GitHub Pages : 10 min)
    const res = await fetch(`${PAGE_URL}?t=${Date.now()}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timer);
  }
  const data = parseOlympiadesPage(html);
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
  return data;
}
