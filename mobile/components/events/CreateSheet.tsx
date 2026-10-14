/**
 * Feuille « Créer » : un événement (date fixée) ou un sondage de date.
 * onDismiss : iOS refuse d'ouvrir le formulaire tant que la feuille n'a pas
 * fini de se fermer. Pas de bouton Annuler : voile, glissement ou retour.
 */
import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Sheet } from '@/components/ui/kit';
import { theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

export function CreateSheet({
  visible,
  onClose,
  onDismiss,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onPick: (kind: 'event' | 'sondage') => void;
}) {
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onDismiss={onDismiss}
      title="Créer"
      sub="Tu connais déjà la date, ou tu veux demander au groupe ?"
      scroll={false}
    >
      <Option
        icon="calendar"
        bg={c.coral}
        fg="#fff"
        title="Un événement"
        sub="La date est fixée : chacun dit s’il vient"
        onPress={() => onPick('event')}
      />
      <Option
        icon="grid"
        bg={c.yellow}
        fg={c.ink}
        title="Un sondage de date"
        sub="Tu proposes des dates, le groupe dit quand il est dispo"
        onPress={() => onPick('sondage')}
      />
    </Sheet>
  );
}

function Option({
  icon,
  bg,
  fg,
  title,
  sub,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  bg: string;
  fg: string;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: c.raised }]}
    >
      <View style={[styles.optionIcon, { backgroundColor: bg }]}>
        <Feather name={icon} size={26} color={fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionSub}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={20} color={c.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: theme.radius.card,
    backgroundColor: c.deep,
    marginBottom: 10,
  },
  optionIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 17 },
  optionSub: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 19, marginTop: 2 },
});
