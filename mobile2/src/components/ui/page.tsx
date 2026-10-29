import { ArrowLeft, ChevronDown } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { cx } from '@/lib/cx';

import { AppText } from './app-text';

type PageHeadingProps = {
  title: string;
  subtitle: string;
  className?: string;
};

export function PageHeading({ title, subtitle, className }: PageHeadingProps) {
  return (
    <View className={cx('', className)}>
      <AppText
        variant="display"
        className="text-[30px] leading-[38px] font-extrabold"
        style={{ fontFamily: 'Manrope_800ExtraBold', fontWeight: '800' }}>
        {title}
      </AppText>
      <AppText variant="body" className="mt-0.5 text-[11px] leading-[16px]">
        {subtitle}
      </AppText>
    </View>
  );
}

type BackHeadingProps = PageHeadingProps & {
  onBack: () => void;
};

export function BackHeading({ title, subtitle, onBack, className }: BackHeadingProps) {
  return (
    <View className={cx('', className)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={onBack}
        className="-ml-2 mb-2 h-9 w-9 items-center justify-center"
        style={({ pressed }) => (pressed ? { opacity: 0.65 } : undefined)}>
        <ArrowLeft size={23} color="#001A6E" strokeWidth={1.9} />
      </Pressable>
      <PageHeading title={title} subtitle={subtitle} />
    </View>
  );
}

export function SectionLabel({ children, className }: { children: string; className?: string }) {
  return (
    <AppText variant="label" className={cx('text-[11px]', className)}>
      {children}
    </AppText>
  );
}

type SelectFieldProps = {
  value: string;
  onPress: () => void;
  variant?: 'primary' | 'soft';
  prefix?: string;
  className?: string;
};

export function SelectField({
  value,
  onPress,
  variant = 'primary',
  prefix,
  className,
}: SelectFieldProps) {
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={cx(
        'flex-row items-center justify-between',
        isPrimary
          ? 'h-[63px] rounded-[10px] bg-navy px-4'
          : 'h-[35px] rounded-[4px] bg-[#E3E3E3] px-3',
        className,
      )}
      style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}>
      {isPrimary ? (
        <AppText
          className="flex-1 text-[18px] leading-[24px] text-white"
          style={{ fontFamily: 'Manrope_700Bold' }}>
          {value}
        </AppText>
      ) : (
        <View className="flex-1 flex-row items-center">
          {prefix ? (
            <AppText variant="caption" className="text-[11px] text-[#4E5D76]">
              {prefix}
            </AppText>
          ) : null}
          <AppText
            variant="link"
            className="text-[11px]"
            style={{ fontFamily: 'Manrope_700Bold' }}>
            {value}
          </AppText>
        </View>
      )}
      <ChevronDown
        size={isPrimary ? 19 : 15}
        color={isPrimary ? '#FFFFFF' : '#001A6E'}
        strokeWidth={isPrimary ? 2.4 : 2.2}
      />
    </Pressable>
  );
}

type FilterChipsProps<T extends string> = {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
};

export function FilterChips<T extends string>({ options, value, onChange }: FilterChipsProps<T>) {
  return (
    <View className="flex-row flex-wrap gap-[7px]">
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            onPress={() => onChange(option)}
            className={cx(
              'h-[32px] items-center justify-center rounded-[8px] px-[13px]',
              active ? 'bg-navy' : 'border-[1.5px] border-navy bg-white',
            )}
            style={({ pressed }) => (pressed ? { opacity: 0.8 } : undefined)}>
            <AppText
              className="text-[11px] leading-4"
              tone={active ? 'white' : 'navy'}
              style={{ fontFamily: 'Manrope_700Bold' }}>
              {option}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyPanel({ className }: { className?: string }) {
  return <View className={cx('min-h-[375px] rounded-[12px] bg-[#F4F4FD]', className)} />;
}
