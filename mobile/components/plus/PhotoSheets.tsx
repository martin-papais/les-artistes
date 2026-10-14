/**
 * Feuilles de l'écran Photos : légende avant l'envoi, modification et
 * suppression d'une photo par son auteur.
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { CalendarPicker, dayLabel } from '@/components/ui/CalendarPicker';
import { Button, Field, FieldLabel, Sheet } from '@/components/ui/kit';
import { sb, type PhotoRow } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const c = theme.colors;

/** Légende facultative avant l'envoi (iOS et Android). */
export function CaptionSheet({
  uri,
  onPublish,
  onCancel,
}: {
  uri: string | null;
  onPublish: (sujet: string | null) => void;
  onCancel: () => void;
}) {
  const [sujet, setSujet] = useState('');
  function send(withText: boolean) {
    const t = withText ? sujet.trim() : '';
    setSujet('');
    onPublish(t || null);
  }
  return (
    <Sheet
      visible={!!uri}
      onClose={() => {
        setSujet('');
        onCancel();
      }}
      title="Ajouter une légende"
      sub="Facultatif. Sans légende, la photo prend la date du jour."
      footer={
        <View style={{ gap: 4 }}>
          <Button label="Publier" icon="upload" onPress={() => send(true)} />
          <Button label="Publier sans légende" variant="ghost" onPress={() => send(false)} />
        </View>
      }
    >
      {!!uri && <Image source={{ uri }} style={styles.preview} contentFit="cover" />}
      <FieldLabel>Sujet</FieldLabel>
      <Field
        value={sujet}
        onChangeText={setSujet}
        placeholder="Un petit mot pour cette photo"
        onDark
        returnKeyType="done"
        onSubmitEditing={() => send(true)}
      />
    </Sheet>
  );
}

/** Modifier le sujet, la description, la date ; supprimer. Monté seulement quand une photo est ouverte en édition. */
export function PhotoEditSheet({
  photo,
  onClose,
  onSaved,
  onDeleted,
}: {
  photo: PhotoRow;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [sujet, setSujet] = useState(photo.sujet ?? '');
  const [description, setDescription] = useState(photo.description ?? '');
  const [date, setDate] = useState(photo.date_media ? photo.date_media.split('T')[0] : '');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      Alert.alert('Date invalide', 'Format attendu : AAAA-MM-JJ');
      return;
    }
    setSaving(true);
    try {
      const { error } = await sb
        .from('photos')
        .update({
          sujet: sujet.trim() || photo.sujet,
          description: description.trim() || null,
          // date_media est une date simple côté web (AAAA-MM-JJ)
          date_media: date.trim() || null,
        })
        .eq('id', photo.id);
      if (error) throw error;
      onSaved();
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.');
    } finally {
      setSaving(false);
    }
  }

  function deletePhoto() {
    Alert.alert('Supprimer cette photo ?', 'Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            const url = photo.file_url ?? '';
            const idx = url.indexOf('/media/');
            const path = idx >= 0 ? url.slice(idx + '/media/'.length) : null;
            const del = await sb.from('photos').delete().eq('id', photo.id);
            if (del.error) throw del.error;
            if (path) await sb.storage.from('media').remove([path]);
            onDeleted();
          } catch (e) {
            Alert.alert('Erreur', e instanceof Error ? e.message : 'Réessaie.');
          }
        },
      },
    ]);
  }

  const validDay = /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Modifier la photo"
      footer={
        <View style={{ gap: 4 }}>
          <Button label="Enregistrer" icon="check" onPress={save} loading={saving} />
          <Button label="Supprimer la photo" icon="trash-2" variant="danger" onPress={deletePhoto} disabled={saving} />
        </View>
      }
    >
      <Image source={{ uri: photo.file_url ?? undefined }} style={styles.preview} contentFit="cover" />
      <FieldLabel>Sujet</FieldLabel>
      <Field value={sujet} onChangeText={setSujet} placeholder="Un petit mot" onDark />
      <View style={{ height: 16 }} />
      <FieldLabel hint="facultatif">Description</FieldLabel>
      <Field value={description} onChangeText={setDescription} placeholder="Ce qui se passe sur la photo" onDark multiline />
      <View style={{ height: 16 }} />
      <FieldLabel>Date</FieldLabel>
      <Text style={styles.dateLine}>
        {validDay ? dayLabel(date, true) : 'Sans date'}
        {validDay ? <Text style={styles.dateHint}>  (retape le jour pour l&apos;enlever)</Text> : null}
      </Text>
      <CalendarPicker selected={validDay ? [date] : []} onToggle={(d) => setDate((cur) => (cur === d ? '' : d))} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 200, borderRadius: 18, marginBottom: 18, backgroundColor: c.raised },
  dateLine: { color: c.text, fontFamily: theme.fonts.bodyMedium, fontSize: 15, marginBottom: 10 },
  dateHint: { color: c.muted, fontFamily: theme.fonts.body, fontSize: 13 },
});
