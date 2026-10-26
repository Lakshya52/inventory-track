import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edges } from 'react-native-safe-area-context';
import { colors, radius, spacing, statusColors } from '../theme';

export function Screen({
  children,
  style,
  edges = ['top'],
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  edges?: Edges;
}) {
  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges}>
      {children}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  style,
  small = false,
  large = false,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  large?: boolean;
}) {
  const palette = {
    primary: { background: colors.primary, text: '#ffffff', border: colors.primary },
    secondary: { background: colors.surface, text: colors.text, border: colors.border },
    danger: { background: colors.dangerSoft, text: colors.danger, border: '#fecdd3' },
    ghost: { background: 'transparent', text: colors.primary, border: 'transparent' },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        large && styles.buttonLarge,
        {
          backgroundColor: palette.background,
          borderColor: palette.border,
          opacity: disabled || loading ? 0.5 : pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={palette.text} /> : icon}
      <Text style={[styles.buttonText, { color: palette.text }, small && styles.buttonTextSmall, large && styles.buttonTextLarge]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Badge({ status, label }: { status: string; label?: string }) {
  const palette = statusColors[status] || { bg: colors.surfaceAlt, text: colors.textMuted, label: status };
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.text }]}>{label || palette.label}</Text>
    </View>
  );
}

export function StatCard({
  label,
  value,
  icon,
  accent = colors.primary,
  soft = colors.primarySoft,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: string;
  soft?: string;
}) {
  return (
    <View style={[styles.statCard, { backgroundColor: colors.surface }]}>
      <View style={[styles.statIcon, { backgroundColor: soft }]}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={[styles.statAccent, { backgroundColor: accent }]} />
    </View>
  );
}

export function Field({
  label,
  hint,
  containerStyle,
  ...props
}: TextInputProps & { label?: string; hint?: string; containerStyle?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.fieldContainer, containerStyle]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textFaint}
        {...props}
        accessibilityLabel={props.accessibilityLabel || label}
        accessibilityHint={props.accessibilityHint || hint}
        style={[styles.input, props.style]}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
    </View>
  );
}

export function LoadingView({ label = 'Loading...' }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export function KeyValue({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <View style={styles.keyValue}>
      <Text style={styles.keyValueLabel}>{label}</Text>
      <Text style={styles.keyValueValue} numberOfLines={2}>{value ?? '-'}</Text>
    </View>
  );
}

export const uiStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  gap: { gap: spacing.sm },
  flex1: { flex: 1 },
  muted: { color: colors.textMuted, fontSize: 13 },
  tiny: { color: colors.textFaint, fontSize: 11 },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  button: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonSmall: {
    minHeight: 42,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  buttonLarge: {
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
  },
  buttonTextSmall: {
    fontSize: 13,
  },
  buttonTextLarge: {
    fontSize: 16,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statCard: {
    flex: 1,
    minWidth: '44%',
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statAccent: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 4,
    opacity: 0.65,
  },
  fieldContainer: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  fieldHint: {
    fontSize: 12,
    color: colors.textFaint,
  },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    color: colors.text,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 13,
    color: colors.textFaint,
    textAlign: 'center',
    marginTop: 4,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 60,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  keyValue: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 4,
  },
  keyValueLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  keyValueValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'right',
  },
});
