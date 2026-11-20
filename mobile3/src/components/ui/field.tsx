import { TextInput, View, type TextInputProps } from 'react-native';

import { cx } from '@/lib/cx';
import { colors } from '@/theme';
import { AppText } from './app-text';

type FieldProps = TextInputProps & {
  label: string;
  className?: string;
  inputClassName?: string;
};

export function Field({ label, className, inputClassName, ...rest }: FieldProps) {
  return (
    <View className={cx('mb-[22px]', className)}>
      <AppText variant="label" className="mb-[6px] text-[12px]">
        {label}
      </AppText>
      <TextInput
        className={cx(
          'h-[46px] rounded-[6px] bg-input px-[14px] font-lexend text-[14px] text-ink',
          inputClassName,
        )}
        placeholderTextColor={colors.placeholder}
        selectionColor={colors.brand}
        {...rest}
      />
    </View>
  );
}
