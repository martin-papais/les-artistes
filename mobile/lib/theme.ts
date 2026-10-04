export const theme = {
  colors: {
    coral: '#FF6B6B',
    yellow: '#FFD93D',
    teal: '#4ECDC4',
    violet: '#C77DFF',
    pink: '#FF9EBC',
    deep: '#1A1025',
    surface: 'rgba(255,255,255,0.05)',
    surface2: 'rgba(255,255,255,0.10)',
    cardBg: 'rgba(255,255,255,0.07)',
    border: 'rgba(255,255,255,0.15)',
    text: '#fff',
    muted: 'rgba(255,255,255,0.55)',
    inputBg: 'rgba(255,255,255,0.10)',
    danger: '#ff9b9b',
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
  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  s: (n: number) => n * 4,
} as const;

export type Theme = typeof theme;
