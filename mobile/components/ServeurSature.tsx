import { StyleSheet, View } from 'react-native';

import { Button, EmptyState } from '@/components/ui/kit';
import { relancerAppli, useServeurSature } from '@/lib/serveur';
import { theme } from '@/lib/theme';

/** Par-dessus toute l'appli tant que la base gratuite ne répond plus (voir lib/serveur.ts) */
export function ServeurSature() {
  const sature = useServeurSature();
  if (!sature) return null;
  return (
    <View style={styles.fond}>
      <EmptyState
        icon="cloud-off"
        iconColor={theme.colors.coral}
        title="Serveur plein"
        text="L’appli tourne sur la version gratuite de Supabase, qui a atteint sa limite. Elle se recharge toute seule, ça peut prendre quelques heures : réessaie plus tard."
        action={<Button label="Réessayer" onPress={relancerAppli} height={48} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fond: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: theme.colors.deep,
    justifyContent: 'center',
  },
});
