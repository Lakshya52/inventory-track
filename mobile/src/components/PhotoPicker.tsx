import React from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './ui';
import { colors, radius, spacing } from '../theme';

export function PhotoPicker({
  uris,
  onChange,
  max = 5,
}: {
  uris: string[];
  onChange: (uris: string[]) => void;
  max?: number;
}) {
  const remaining = Math.max(0, max - uris.length);

  const addFromCamera = async () => {
    if (remaining === 0) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Allow camera access to attach a QC or dispatch photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!result.canceled && result.assets[0]) {
      onChange([...uris, result.assets[0].uri].slice(0, max));
    }
  };

  const addFromLibrary = async () => {
    if (remaining === 0) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Allow photo access to attach a QC or dispatch photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.6,
    });
    if (!result.canceled) {
      const picked = result.assets.map((asset) => asset.uri);
      onChange([...uris, ...picked].slice(0, max));
    }
  };

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Photos (optional)</Text>
        <Text style={styles.count}>{uris.length}/{max}</Text>
      </View>
      <View style={styles.row}>
        {uris.map((uri, index) => (
          <View key={`${uri}-${index}`} style={styles.thumbWrap}>
            <Image source={{ uri }} style={styles.thumb} />
            <Pressable
              onPress={() => onChange(uris.filter((_, itemIndex) => itemIndex !== index))}
              style={styles.remove}
              hitSlop={6}
            >
              <Ionicons name="close-circle" size={20} color={colors.danger} />
            </Pressable>
          </View>
        ))}
        {uris.length < max ? (
          <Pressable onPress={addFromCamera} style={styles.addBox}>
            <Ionicons name="camera-outline" size={20} color={colors.primary} />
            <Text style={styles.addText}>Camera</Text>
          </Pressable>
        ) : null}
      </View>
      {uris.length < max ? (
        <Button title="Add from gallery" variant="ghost" small onPress={addFromLibrary} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  count: { fontSize: 11, color: colors.textFaint },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbWrap: { width: 68, height: 68 },
  thumb: { width: 68, height: 68, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  remove: { position: 'absolute', top: -6, right: -6, backgroundColor: colors.surface, borderRadius: 10 },
  addBox: {
    width: 68,
    height: 68,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addText: { fontSize: 10, color: colors.primary, fontWeight: '600' },
});
