import { TextInput, View, type TextInputProps } from 'react-native';

import { cx } from '@/lib/cx';
import { AppText } from './app-text';

type FieldProps = TextInputProps & {
  label: string;
  className?: string;
  inputClassName?: string;
};

export function Field({ label, className, inputClassName, ...rest }: FieldProps) {
  return (
    <View className={cx('mb-5', className)}>
      <AppText variant="label" className="mb-[6px] text-[10px]">
        {label}
      </AppText>
      <TextInput
        className={cx(
          'h-[38px] rounded-[5px] bg-input px-3 font-manrope-medium text-[12px] text-navy',
          inputClassName,
        )}
        placeholderTextColor="#93A0B5"
        selectionColor="#011A87"
        {...rest}
      />
    </View>
  );
}
