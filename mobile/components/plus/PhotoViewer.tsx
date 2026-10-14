/**
 * Visionneuse plein écran : une photo par page, on glisse pour passer à la
 * suivante. Le parent suit la photo affichée par son id.
 */
import { Image } from 'expo-image';
import { FlatList, Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/kit';
import { ModerationButton } from '@/lib/moderation';
import type { PhotoRow } from '@/lib/supabase';
import { theme } from '@/lib/theme';

const DARK = 'rgba(0,0,0,0.45)';

export function PhotoViewer({
  photos,
  openId,
  userId,
  onChange,
  onClose,
  onEdit,
  onBlocked,
  onDismiss,
}: {
  photos: PhotoRow[];
  openId: string | null;
  userId: string | null;
  onChange: (id: string) => void;
  onClose: () => void;
  onEdit: (p: PhotoRow) => void;
  onBlocked: () => void;
  onDismiss: () => void;
}) {
  const opened = openId !== null ? (photos.find((p) => p.id === openId) ?? null) : null;
  return (
    <Modal
      visible={!!opened}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={onDismiss}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {!!opened && (
        <ViewerBody
          photos={photos}
          opened={opened}
          userId={userId}
          onChange={onChange}
          onClose={onClose}
          onEdit={onEdit}
          onBlocked={onBlocked}
        />
      )}
    </Modal>
  );
}

function ViewerBody({
  photos,
  opened,
  userId,
  onChange,
  onClose,
  onEdit,
  onBlocked,
}: {
  photos: PhotoRow[];
  opened: PhotoRow;
  userId: string | null;
  onChange: (id: string) => void;
  onClose: () => void;
  onEdit: (p: PhotoRow) => void;
  onBlocked: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const index = Math.max(
    0,
    photos.findIndex((p) => p.id === opened.id),
  );
  const isOwner = opened.created_by === userId;

  return (
    <View style={styles.viewer}>
      <FlatList
        data={photos}
        keyExtractor={(p) => p.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialNumToRender={1}
        windowSize={3}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.x / width);
          const p = photos[i];
          if (p && p.id !== opened.id) onChange(p.id);
        }}
        renderItem={({ item }) => (
          <Image
            source={{ uri: item.file_url ?? undefined }}
            style={{ width, height }}
            contentFit="contain"
            accessibilityLabel={item.sujet ?? 'Photo'}
          />
        )}
      />

      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        {isOwner ? (
          <IconButton name="edit-2" label="Modifier la photo" onPress={() => onEdit(opened)} bg={DARK} color="#fff" />
        ) : (
          <View style={styles.modWrap}>
            <ModerationButton
              kind="photo"
              itemId={opened.id}
              authorId={opened.created_by}
              authorName={opened.pris_par || 'ce membre'}
              excerpt={opened.sujet || opened.file_url || ''}
              currentUserId={userId}
              color="#fff"
              onBlocked={() => {
                onClose();
                onBlocked();
              }}
            />
          </View>
        )}
        {photos.length > 1 && (
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {index + 1} / {photos.length}
            </Text>
          </View>
        )}
        <IconButton name="x" label="Fermer" onPress={onClose} bg={DARK} color="#fff" />
      </View>

      {(!!opened.sujet || !!opened.description) && (
        <View style={[styles.caption, { paddingBottom: insets.bottom + 16 }]}>
          {!!opened.sujet && <Text style={styles.captionTitle}>{opened.sujet}</Text>}
          {!!opened.description && <Text style={styles.captionText}>{opened.description}</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: DARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: { paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: DARK, justifyContent: 'center' },
  counterText: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 13 },
  caption: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: theme.gutter,
    paddingTop: 16,
  },
  captionTitle: { color: '#fff', fontFamily: theme.fonts.bodyBold, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  captionText: { color: 'rgba(255,255,255,0.8)', fontFamily: theme.fonts.body, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 4 },
});
