import { StyleSheet, Text, View } from 'react-native';

import { colorHex, type Edition } from '@/lib/olympiades';
import { theme } from '@/lib/theme';

// Décor provisoire d'un verre, en attendant le visuel de chaque écocup.
// Déroulé à plat : largeur = π × diamètre ; le milieu fait face à l'écran.

const YEAR_COLORS = [theme.colors.coral, theme.colors.teal, theme.colors.yellow, theme.colors.violet, theme.colors.pink];

export function yearColor(year: string) {
  return YEAR_COLORS[Number(year) % YEAR_COLORS.length];
}

export function VerreDecor({ year, edition, width }: { year: string; edition: Edition; width: number }) {
  const T = Math.PI * width;
  const accent = yearColor(year);
  const bands = edition.legacy
    ? [theme.colors.coral, theme.colors.yellow, theme.colors.teal, theme.colors.violet]
    : edition.teams.map((t) => colorHex(t.couleur));
  const backText = edition.legacy ? edition.lieu : edition.teams.map((t) => t.nom).filter(Boolean).join('\n');
  // Les bandes de couleur font deux fois le tour
  const segments = [...bands, ...bands];

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[styles.line, { top: '9%' }]} />
      <View style={[styles.center, { left: T / 2 - width * 0.55, width: width * 1.1 }]}>
        <Text allowFontScaling={false} style={[styles.brand, { fontSize: width * 0.095 }]} numberOfLines={1}>
          LES ARTISTES
        </Text>
        <Text allowFontScaling={false} style={[styles.year, { fontSize: width * 0.3, color: accent }]} numberOfLines={1}>
          {year}
        </Text>
        <Text allowFontScaling={false} style={[styles.sub, { fontSize: width * 0.068, letterSpacing: width * 0.012 }]} numberOfLines={1}>
          OLYMPIADES
        </Text>
      </View>
      {/* Au dos : les équipes de l'édition, à cheval sur la couture (deux moitiés d'un même texte) */}
      <Text
        allowFontScaling={false}
        style={[styles.back, { left: -width * 0.45, width: width * 0.9, fontSize: width * 0.06, top: '28%' }]}
        numberOfLines={4}
      >
        {backText}
      </Text>
      <Text
        allowFontScaling={false}
        style={[styles.back, { left: T - width * 0.45, width: width * 0.9, fontSize: width * 0.06, top: '28%' }]}
        numberOfLines={4}
      >
        {backText}
      </Text>
      <View style={[styles.bands, { top: '76%', height: '7%' }]}>
        {segments.map((c, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: c, opacity: 0.85 }} />
        ))}
      </View>
      <View style={[styles.line, { top: '88%' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  line: { position: 'absolute', left: 0, right: 0, height: 1.5, backgroundColor: 'rgba(255,255,255,0.45)' },
  center: { position: 'absolute', top: '20%', alignItems: 'center' },
  brand: { color: '#fff', fontFamily: theme.fonts.serif, letterSpacing: 1 },
  year: { fontFamily: theme.fonts.serifBlack, marginTop: -2 },
  sub: { color: 'rgba(255,255,255,0.8)', fontFamily: theme.fonts.bodyBold, marginTop: -2 },
  back: { position: 'absolute', textAlign: 'center', color: '#fff', fontFamily: theme.fonts.bodyBold },
  bands: { position: 'absolute', left: 0, right: 0, flexDirection: 'row' },
});
