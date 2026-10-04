import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { localDateString, sb, type PhotoRow } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const COLS = 3;
const GUTTER = 2;
const TILE = (Dimensions.get('window').width - GUTTER * (COLS + 1)) / COLS;

export default function PhotosScreen() {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PhotoRow | null>(null);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const loadPhotos = useCallback(async () => {
    const { data: u } = await sb.auth.getUser();
    setUserId(u.user?.id ?? null);
    const { data } = await sb
      .from('photos')
      .select('*')
      .order('date_media', { ascending: false });
    // Pas de lecteur vidéo dans l'appli : on n'affiche que les photos (vidéos et fichiers restent sur le site)
    const rows = ((data as PhotoRow[] | null) ?? []).filter(
      (p) => p.type === 'photo' && !!p.file_url,
    );
    setPhotos(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  async function onRefresh() {
    setRefreshing(true);
    await loadPhotos();
    setRefreshing(false);
  }

  function chooseSource() {
    Alert.alert(
      'Ajouter une photo',
      undefined,
      [
        { text: 'Prendre une photo', onPress: () => takePhoto() },
        { text: 'Choisir depuis la pellicule', onPress: () => pickFromLibrary() },
        { text: 'Annuler', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission refusée',
        'Autorise l’accès à la caméra dans les réglages pour prendre des photos.',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    await askCaptionAndUpload(result.assets[0]);
  }

  async function pickFromLibrary() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission refusée',
        'Autorise l’accès aux photos dans les réglages pour publier.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: false,
    });
    if (result.canceled || !result.assets[0]) return;
    await askCaptionAndUpload(result.assets[0]);
  }

  async function askCaptionAndUpload(asset: ImagePicker.ImagePickerAsset) {
    let sujet: string | null = null;
    if (Platform.OS === 'ios') {
      sujet = await new Promise<string | null>((resolve) => {
        Alert.prompt(
          'Sujet (optionnel)',
          'Ajoute un petit mot pour cette photo',
          [
            { text: 'Sans', onPress: () => resolve(null), style: 'cancel' },
            { text: 'Publier', onPress: (v?: string) => resolve(v?.trim() || null) },
          ],
          'plain-text',
        );
      });
    }
    await uploadPhoto(asset, sujet);
  }

  async function uploadPhoto(
    asset: ImagePicker.ImagePickerAsset,
    sujet: string | null,
  ) {
    setUploading(true);
    try {
      const { data: u } = await sb.auth.getUser();
      if (!u.user) throw new Error('Pas connecté');

      const ext = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${u.user.id}/${Date.now()}.${ext}`;
      const contentType = asset.mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg');

      const arrayBuffer = await fetch(asset.uri).then((r) => r.arrayBuffer());
      const up = await sb.storage.from('media').upload(path, arrayBuffer, {
        contentType,
        upsert: false,
      });
      if (up.error) throw up.error;

      const publicUrl = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
      const fileName = asset.fileName || path.split('/').pop() || `photo.${ext}`;
      const today = localDateString();
      // Même payload que l'upload web (photos.html) ; sujet obligatoire côté web
      const ins = await sb.from('photos').insert({
        sujet: sujet || `Photo du ${today.split('-').reverse().join('/')}`,
        date_media: today,
        pris_par: null,
        description: null,
        file_name: fileName,
        file_url: publicUrl,
        file_size: asset.fileSize ?? arrayBuffer.byteLength,
        mime_type: contentType,
        type: 'photo',
        created_by: u.user.id,
      });
      if (ins.error) {
        await sb.storage.from('media').remove([path]);
        throw ins.error;
      }
      await loadPhotos();
    } catch (e) {
      Alert.alert('Échec upload', e instanceof Error ? e.message : 'Réessaie.');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={theme.colors.teal} />
      </SafeAreaView>
    );
  }

  // Suivi par id : modifier la date retrie la liste, un index pointerait sur une autre photo
  const opened = openId !== null ? photos.find((p) => p.id === openId) ?? null : null;
  const isOwner = !!opened && opened.created_by === userId;

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.titleBlock}>
        <Text style={styles.bigTitle}>Photos</Text>
        <Text style={styles.bigSub}>{photos.length} souvenirs partagés</Text>
      </View>
      <FlatList
        data={photos}
        keyExtractor={(p) => p.id}
        numColumns={COLS}
        contentContainerStyle={{ padding: GUTTER, paddingBottom: theme.s(20) }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>Aucune photo pour l&apos;instant.</Text>
            <Text style={styles.emptySub}>Tap sur + pour en publier une.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => setOpenId(item.id)} style={styles.tile}>
            <Image
              source={{ uri: item.file_url ?? undefined }}
              style={{ width: TILE, height: TILE }}
              contentFit="cover"
              transition={120}
              onError={(e) => console.warn('[photos] image fail:', item.file_url, e.error)}
            />
          </Pressable>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.teal} />
        }
      />
      <Pressable
        onPress={chooseSource}
        disabled={uploading}
        style={({ pressed }) => [
          styles.fab,
          pressed && { transform: [{ scale: 0.96 }] },
          uploading && { opacity: 0.7 },
        ]}
      >
        {uploading ? <ActivityIndicator color="#fff" /> : <Ionicons name="add" size={32} color="#fff" />}
      </Pressable>
      <Modal
        visible={!!opened}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenId(null)}
      >
        {!!opened && (
          <View style={styles.viewer}>
            <Pressable onPress={() => setOpenId(null)} style={styles.viewerClose} hitSlop={20}>
              <Ionicons name="close" size={32} color="#fff" />
            </Pressable>
            {!!isOwner && (
              <Pressable onPress={() => setEditing(opened)} style={styles.viewerEdit} hitSlop={20}>
                <Ionicons name="create-outline" size={28} color="#fff" />
              </Pressable>
            )}
            <Image
              source={{ uri: opened.file_url ?? undefined }}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
            />
            {(opened.sujet || opened.description) && (
              <View style={styles.viewerCaption}>
                {!!opened.sujet && <Text style={styles.viewerCaptionText}>{opened.sujet}</Text>}
                {!!opened.description && (
                  <Text style={[styles.viewerCaptionText, { opacity: 0.75, marginTop: 4 }]}>
                    {opened.description}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </Modal>
      <Modal
        visible={!!editing}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setEditing(null)}
      >
        {!!editing && (
          <PhotoEdit
            photo={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              loadPhotos();
            }}
            onDeleted={() => {
              setEditing(null);
              setOpenId(null);
              loadPhotos();
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

function PhotoEdit({
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
  const [date, setDate] = useState(
    photo.date_media ? photo.date_media.split('T')[0] : '',
  );
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

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.modalHeader}>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={28} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.modalTitle}>Modifier la photo</Text>
        <Pressable onPress={deletePhoto} hitSlop={10}>
          <Ionicons name="trash-outline" size={24} color={theme.colors.danger} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: theme.s(5) }}>
          <Image source={{ uri: photo.file_url ?? undefined }} style={styles.editPreview} contentFit="cover" />
          <Text style={styles.editLabel}>Sujet</Text>
          <TextInput
            value={sujet}
            onChangeText={setSujet}
            placeholder="Un petit mot…"
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={styles.editInput}
          />
          <Text style={styles.editLabel}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Optionnel"
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={styles.editInput}
            multiline
          />
          <Text style={styles.editLabel}>Date (AAAA-MM-JJ)</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="2026-05-09"
            placeholderTextColor="rgba(255,255,255,0.3)"
            style={styles.editInput}
            autoCapitalize="none"
          />
          <Pressable
            onPress={save}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveBtn,
              (pressed || saving) && { opacity: 0.7 },
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveText}>Enregistrer ✓</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.colors.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.deep },
  titleBlock: { padding: theme.s(4) },
  bigTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.title,
    fontSize: 32,
    fontWeight: '800',
  },
  bigSub: { color: theme.colors.muted, marginTop: 2 },
  tile: {
    margin: GUTTER / 2,
    backgroundColor: theme.colors.surface,
    borderRadius: 4,
    overflow: 'hidden',
  },
  emptyWrap: { padding: theme.s(10), alignItems: 'center' },
  emptyText: { color: theme.colors.muted, fontSize: 15 },
  emptySub: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.coral,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerClose: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
  },
  viewerEdit: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 10,
  },
  viewerCaption: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: theme.s(4),
  },
  viewerCaptionText: { color: '#fff', textAlign: 'center', fontSize: 14 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.s(4),
    paddingTop: theme.s(2),
    paddingBottom: theme.s(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  modalTitle: {
    color: theme.colors.text,
    fontFamily: theme.fonts.title,
    fontSize: 18,
    fontWeight: '700',
  },
  editPreview: {
    width: '100%',
    height: 220,
    borderRadius: theme.radius.lg,
    marginBottom: theme.s(4),
  },
  editLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.muted,
    marginBottom: 6,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  editInput: {
    backgroundColor: theme.colors.inputBg,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    color: theme.colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: theme.s(4),
  },
  saveBtn: {
    backgroundColor: theme.colors.coral,
    borderRadius: theme.radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: theme.s(2),
  },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
