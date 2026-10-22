import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CaptionSheet, PhotoEditSheet } from '@/components/plus/PhotoSheets';
import { PhotoViewer } from '@/components/plus/PhotoViewer';
import { Button, Fab, Icon, ScreenHeader } from '@/components/ui/kit';
import { localDateString, sb, type PhotoRow, sessionUser } from '@/lib/supabase';
import { getBlocked } from '@/lib/moderation';
import { usePageCache } from '@/lib/cache';
import { theme } from '@/lib/theme';
import { useRefreshOnFocus } from '@/lib/useRefresh';

const c = theme.colors;
const f = theme.fonts;

const COLS = 3;
const GAP = 4;
// marge latérale de l'écran de chaque côté + un espace entre deux vignettes
const TILE = Math.floor((Dimensions.get('window').width - theme.gutter * 2 - GAP * (COLS - 1)) / COLS);

const MAX_SIDE = 1920;

/**
 * Réduit la photo (côté le plus long ≤ 1920 px, JPEG 85 %) avant envoi, comme le site :
 * moins de stockage et de bande passante sur le plan gratuit Supabase.
 * En cas d'échec, renvoie l'original.
 */
async function prepareImage(asset: ImagePicker.ImagePickerAsset) {
  const original = {
    uri: asset.uri,
    mimeType: asset.mimeType || 'image/jpeg',
    fileName: asset.fileName ?? null,
  };
  try {
    const ctx = ImageManipulator.manipulate(asset.uri);
    if (Math.max(asset.width, asset.height) > MAX_SIDE) {
      ctx.resize(asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
    }
    const rendered = await ctx.renderAsync();
    const out = await rendered.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
    const base = (asset.fileName || 'photo').replace(/\.[^.]+$/, '');
    return { uri: out.uri, mimeType: 'image/jpeg', fileName: `${base}.jpg` };
  } catch {
    return original;
  }
}

export default function PhotosScreen() {
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PhotoRow | null>(null);
  const [uploading, setUploading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  // Photo choisie, en attente de sa légende
  const [pending, setPending] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const insets = useSafeAreaInsets();
  // iOS refuse d'ouvrir la fiche d'édition tant que la visionneuse est affichée :
  // on ferme d'abord, puis on ouvre l'édition dans onDismiss
  const pendingEdit = useRef<PhotoRow | null>(null);
  function flushPendingEdit() {
    if (pendingEdit.current) {
      setEditing(pendingEdit.current);
      pendingEdit.current = null;
    }
  }

  const montrer = useCallback((d: { userId: string | null; photos: PhotoRow[] }) => {
    setUserId(d.userId);
    setPhotos(d.photos);
    setLoading(false);
  }, []);
  const { garder, echec } = usePageCache('photos', montrer);

  const loadPhotos = useCallback(async () => {
    const user = await sessionUser();
    const [{ data, error }, blocked] = await Promise.all([
      sb.from('photos').select('*').order('date_media', { ascending: false }),
      getBlocked(),
    ]);
    if (error) {
      setLoading(false);
      echec();
      return;
    }
    // Pas de lecteur vidéo dans l'appli : on n'affiche que les photos (vidéos et fichiers restent sur le site)
    const rows = ((data as PhotoRow[] | null) ?? []).filter(
      (p) => p.type === 'photo' && !!p.file_url && !blocked.has(p.created_by),
    );
    garder({ userId: user?.id ?? null, photos: rows });
  }, [garder, echec]);

  useRefreshOnFocus(loadPhotos);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await loadPhotos();
    } finally {
      setRefreshing(false);
    }
  }

  function chooseSource() {
    if (uploading) return;
    Alert.alert(
      'Ajouter une photo',
      undefined,
      [
        { text: 'Prendre une photo', onPress: () => takePhoto() },
        { text: 'Choisir dans la pellicule', onPress: () => pickFromLibrary() },
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
      quality: 1, // compression unique ensuite, dans prepareImage
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    setPending(result.assets[0]);
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
      quality: 1, // compression unique ensuite, dans prepareImage
      allowsMultipleSelection: false,
    });
    if (result.canceled || !result.assets[0]) return;
    setPending(result.assets[0]);
  }

  function publishPending(sujet: string | null) {
    const asset = pending;
    setPending(null);
    if (asset) uploadPhoto(asset, sujet);
  }

  async function uploadPhoto(
    asset: ImagePicker.ImagePickerAsset,
    sujet: string | null,
  ) {
    setUploading(true);
    try {
      const user = await sessionUser();
      if (!user) throw new Error('Pas connecté');

      const img = await prepareImage(asset);
      const ext = img.uri.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${user.id}/${Date.now()}.${ext}`;
      const contentType = img.mimeType;

      const arrayBuffer = await fetch(img.uri).then((r) => r.arrayBuffer());
      const up = await sb.storage.from('media').upload(path, arrayBuffer, {
        contentType,
        upsert: false,
      });
      if (up.error) throw up.error;

      const publicUrl = sb.storage.from('media').getPublicUrl(path).data.publicUrl;
      const fileName = img.fileName || path.split('/').pop() || `photo.${ext}`;
      const today = localDateString();
      // Même payload que l'upload web (photos.html) ; sujet obligatoire côté web
      const ins = await sb.from('photos').insert({
        sujet: sujet || `Photo du ${today.split('-').reverse().join('/')}`,
        date_media: today,
        pris_par: null,
        description: null,
        file_name: fileName,
        file_url: publicUrl,
        file_size: arrayBuffer.byteLength,
        mime_type: contentType,
        type: 'photo',
        created_by: user.id,
      });
      if (ins.error) {
        await sb.storage.from('media').remove([path]);
        throw ins.error;
      }
      await loadPhotos();
    } catch (e) {
      Alert.alert('Échec de l’envoi', e instanceof Error ? e.message : 'Réessaie.');
    } finally {
      setUploading(false);
    }
  }

  function editFromViewer(p: PhotoRow) {
    pendingEdit.current = p;
    setOpenId(null);
    // onDismiss n'existe que sur iOS (RN 0.81)
    if (Platform.OS !== 'ios') setTimeout(flushPendingEdit, 300);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={c.teal} />
      </View>
    );
  }

  const n = photos.length;

  return (
    <View style={styles.flex}>
      <FlatList
        data={photos}
        keyExtractor={(p) => p.id}
        numColumns={COLS}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: theme.gutter }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        ListHeaderComponent={
          <ScreenHeader
            back
            title="Photos"
            sub={n ? `${n} souvenir${n > 1 ? 's' : ''} partagé${n > 1 ? 's' : ''}` : 'Les souvenirs du groupe'}
            style={{ marginBottom: 18 }}
          />
        }
        ListEmptyComponent={<EmptyPhotos onAdd={chooseSource} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setOpenId(item.id)}
            accessibilityRole="imagebutton"
            accessibilityLabel={item.sujet ? `Ouvrir la photo ${item.sujet}` : 'Ouvrir la photo'}
            style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
          >
            <Image
              source={{ uri: item.file_url ?? undefined }}
              style={{ width: TILE, height: TILE }}
              contentFit="cover"
              transition={120}
              onError={(e) => console.warn('[photos] image fail:', item.file_url, e.error)}
            />
          </Pressable>
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.teal} />}
      />

      {(n > 0 || uploading) && (
        <Fab
          label={uploading ? 'Envoi en cours' : 'Ajouter'}
          icon={uploading ? 'upload-cloud' : 'plus'}
          onPress={chooseSource}
          // Écran de pile bord à bord : pas de barre d'onglets pour protéger le bas
          bottom={insets.bottom + 16}
        />
      )}

      <PhotoViewer
        photos={photos}
        openId={openId}
        userId={userId}
        onChange={setOpenId}
        onClose={() => setOpenId(null)}
        onEdit={editFromViewer}
        onBlocked={loadPhotos}
        onDismiss={flushPendingEdit}
      />

      <CaptionSheet uri={pending?.uri ?? null} onPublish={publishPending} onCancel={() => setPending(null)} />

      {!!editing && (
        <PhotoEditSheet
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
    </View>
  );
}

/** Écran vide : deux polaroïds, et le bouton pour publier. */
function EmptyPhotos({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={styles.empty}>
      <View style={styles.polaroids} accessible={false}>
        <View style={[styles.polaroid, { left: 14, top: 16, transform: [{ rotate: '-9deg' }] }]}>
          <View style={[styles.polaroidPic, { backgroundColor: c.violet }]} />
        </View>
        <View style={[styles.polaroid, { left: 66, top: 6, transform: [{ rotate: '7deg' }] }]}>
          <View style={[styles.polaroidPic, { backgroundColor: c.yellow }]}>
            <Icon name="camera" size={34} color={c.ink} />
          </View>
        </View>
      </View>
      <Text style={styles.emptyTitle}>Aucune photo pour l&apos;instant</Text>
      <Text style={styles.emptyText}>Partage le premier souvenir. Tout le groupe pourra le voir.</Text>
      <Button label="Ajouter une photo" icon="plus" onPress={onAdd} height={54} style={{ marginTop: 24, paddingHorizontal: 28 }} />
      <Text style={styles.emptyHint}>Prendre une photo ou choisir dans la pellicule</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: c.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.deep },
  tile: {
    marginBottom: GAP,
    backgroundColor: c.card,
    borderRadius: 10,
    overflow: 'hidden',
  },
  empty: { marginTop: 52, alignItems: 'center', paddingHorizontal: 36 },
  polaroids: { width: 190, height: 150 },
  polaroid: {
    position: 'absolute',
    width: 110,
    height: 124,
    borderRadius: 10,
    backgroundColor: c.text,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  polaroidPic: { margin: 8, height: 82, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 28, fontFamily: f.serifBlack, fontSize: 26, lineHeight: 32, color: c.text, textAlign: 'center' },
  emptyText: { marginTop: 8, fontFamily: f.body, fontSize: 15, lineHeight: 22, color: c.muted, textAlign: 'center' },
  emptyHint: { marginTop: 12, fontFamily: f.body, fontSize: 13, lineHeight: 18, color: c.muted, textAlign: 'center' },
});
