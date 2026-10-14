/**
 * Feuille « Ma pastille » : photo de profil (pellicule ou appareil) et couleur
 * du rond quand il n'y a pas de photo. Ouverte depuis la pastille du Profil.
 */
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Pastille, Sheet } from '@/components/ui/kit';
import { AVATAR_COLORS, removeAvatar, setAvatarColor, uploadAvatar, useAvatar, type AvatarColor } from '@/lib/avatars';
import { memberColorByName, theme } from '@/lib/theme';

const c = theme.colors;
const f = theme.fonts;

const COLOR_LABEL: Record<AvatarColor, string> = {
  teal: 'Lagon',
  yellow: 'Soleil',
  pink: 'Rose',
  violet: 'Lilas',
  coral: 'Corail',
};

export function AvatarSheet({
  visible,
  onClose,
  userId,
  name,
}: {
  visible: boolean;
  onClose: () => void;
  userId: string;
  name: string;
}) {
  const avatar = useAvatar(userId);
  const [busy, setBusy] = useState(false);

  async function pick(source: 'library' | 'camera') {
    if (busy) return;
    const perm =
      source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission refusée',
        source === 'camera'
          ? 'Autorise l’accès à la caméra dans les réglages.'
          : 'Autorise l’accès aux photos dans les réglages.',
      );
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: true, aspect: [1, 1] };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets[0]) return;
    setBusy(true);
    try {
      await uploadAvatar(userId, result.assets[0]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Alert.alert('Photo non enregistrée', e instanceof Error ? e.message : 'Réessaie.');
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove() {
    Alert.alert('Retirer ta photo ?', 'Ton rond avec ton initiale la remplacera.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Retirer',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await removeAvatar(userId);
          } catch (e) {
            Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function chooseColor(col: AvatarColor) {
    Haptics.selectionAsync().catch(() => {});
    try {
      await setAvatarColor(userId, avatar?.color === col ? null : col);
    } catch (e) {
      Alert.alert('Couleur non enregistrée', e instanceof Error ? e.message : 'Réessaie.');
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Ma pastille" sub="C’est elle que le groupe voit à côté de ton nom.">
      <View style={styles.preview}>
        <Pastille id={userId} name={name} size={104} serif />
        {busy && (
          <View style={styles.busy}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </View>

      <View style={{ gap: 10 }}>
        <Button label="Choisir une photo" icon="image" onPress={() => pick('library')} disabled={busy} />
        <Button label="Prendre une photo" icon="camera" variant="raised" onPress={() => pick('camera')} disabled={busy} />
        {!!avatar?.url && <Button label="Retirer la photo" variant="danger" height={44} onPress={confirmRemove} disabled={busy} />}
      </View>

      <Text style={styles.colorsTitle}>Couleur du rond</Text>
      <Text style={styles.colorsSub}>
        {avatar?.url ? 'Elle s’affiche si tu retires ta photo.' : 'Touche une couleur. Retouche-la pour revenir à celle de départ.'}
      </Text>
      <View style={styles.colors}>
        {AVATAR_COLORS.map((col) => {
          const on = avatar?.color === col;
          const m = memberColorByName(col);
          return (
            <Pressable
              key={col}
              onPress={() => chooseColor(col)}
              accessibilityRole="button"
              accessibilityLabel={COLOR_LABEL[col]}
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.swatchRing, on && { borderColor: c.text }, pressed && { opacity: 0.75 }]}
            >
              <View style={[styles.swatch, { backgroundColor: m.bg }]}>
                {on && <Feather name="check" size={22} color={m.fg} />}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  preview: { alignSelf: 'center', marginBottom: 20 },
  busy: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 52,
    backgroundColor: 'rgba(10,6,16,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorsTitle: { color: c.text, fontFamily: f.bodyBold, fontSize: 16, marginTop: 24 },
  colorsSub: { color: c.muted, fontFamily: f.body, fontSize: 14, lineHeight: 20, marginTop: 2 },
  colors: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  swatchRing: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
