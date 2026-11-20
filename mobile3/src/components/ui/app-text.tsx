import { Text, type TextProps } from 'react-native';

import { cx } from '@/lib/cx';

export type TextVariant =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'label'
  | 'button'
  | 'caption'
  | 'link';

export type TextTone = 'brand' | 'ink' | 'muted' | 'white' | 'danger' | 'success';

const variantClasses: Record<TextVariant, string> = {
  display: 'font-lexend-semibold text-[24px] leading-[32px]',
  h1: 'font-lexend-semibold text-[22px] leading-[30px]',
  h2: 'font-lexend-semibold text-[18px] leading-[26px]',
  h3: 'font-lexend-semibold text-[15px] leading-[22px]',
  body: 'font-lexend text-[13px] leading-[20px]',
  label: 'font-lexend-medium text-[13px] leading-[18px]',
  button: 'font-lexend-medium text-[15px] leading-[20px]',
  caption: 'font-lexend text-[11px] leading-[16px]',
  link: 'font-lexend-medium text-[13px] leading-[18px]',
};

const defaultTone: Record<TextVariant, TextTone> = {
  display: 'brand',
  h1: 'brand',
  h2: 'brand',
  h3: 'brand',
  body: 'ink',
  label: 'brand',
  button: 'white',
  caption: 'muted',
  link: 'brand',
};

const toneClasses: Record<TextTone, string> = {
  brand: 'text-brand',
  ink: 'text-ink',
  muted: 'text-muted',
  white: 'text-white',
  danger: 'text-danger',
  success: 'text-success',
};

export type AppTextProps = TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
};

export function AppText({ variant = 'body', tone, className, ...rest }: AppTextProps) {
  return (
    <Text
      className={cx(variantClasses[variant], toneClasses[tone ?? defaultTone[variant]], className)}
      {...rest}
    />
  );
}
