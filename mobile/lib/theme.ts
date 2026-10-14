/**
 * DA « Nuit d'affiche » : une couleur, un rôle.
 * corail = action, soleil = « toi » et à la une, lagon = oui / présent,
 * lilas = anniversaires et souvenirs. Cartes opaques, sans bordure.
 */
export const theme = {
  colors: {
    coral: '#FF6B6B',
    coralSoft: '#FF8A8A', // texte corail sur fond sombre (lisible)
    yellow: '#FFD93D',
    teal: '#4ECDC4',
    tealInk: '#10302E', // texte sur lagon
    violet: '#C77DFF',
    pink: '#FF9EBC',
    deep: '#1A1025', // fond de tous les écrans
    card: '#251A34', // cartes, champs, feuilles
    raised: '#30243F', // élément posé sur une carte
    rail: '#3A2C4B', // boutons secondaires, rails, poignées
    ink: '#1A1025', // texte sur couleur claire
    text: '#F6F1FA',
    muted: '#B3A8C2',
    danger: '#FF8A8A',
    scrim: 'rgba(10,6,16,0.6)',
    hairline: 'rgba(255,255,255,0.08)',
    // Anciens noms, gardés pour les écrans pas encore migrés
    surface: '#251A34',
    surface2: '#30243F',
    cardBg: '#251A34',
    border: 'rgba(255,255,255,0.08)',
    inputBg: '#251A34',
  },
  fonts: {
    serif: 'PlayfairDisplay_700Bold',
    serifBlack: 'PlayfairDisplay_900Black',
    body: 'DMSans_400Regular',
    bodyMedium: 'DMSans_500Medium',
    bodyBold: 'DMSans_700Bold',
    /** @deprecated use serif */
    title: 'PlayfairDisplay_700Bold',
  },
  radius: { sm: 8, md: 12, lg: 16, card: 20, xl: 24, sheet: 28, pill: 999 },
  s: (n: number) => n * 4,
  /** marge latérale des écrans */
  gutter: 20,
} as const;

export type Theme = typeof theme;

/** Couleur de pastille d'un membre : stable, dérivée de son id. */
const MEMBER = [
  { bg: theme.colors.teal, fg: theme.colors.tealInk },
  { bg: theme.colors.yellow, fg: theme.colors.ink },
  { bg: theme.colors.pink, fg: theme.colors.ink },
  { bg: theme.colors.violet, fg: theme.colors.ink },
  { bg: theme.colors.coral, fg: '#fff' },
] as const;

const BY_NAME = { teal: MEMBER[0], yellow: MEMBER[1], pink: MEMBER[2], violet: MEMBER[3], coral: MEMBER[4] } as const;

/** Couleur choisie par le membre (profiles.avatar_color) */
export function memberColorByName(name: keyof typeof BY_NAME) {
  return BY_NAME[name];
}

export function memberColor(id: string | null | undefined) {
  if (!id) return { bg: theme.colors.rail, fg: theme.colors.text };
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return MEMBER[Math.abs(h) % MEMBER.length];
}
