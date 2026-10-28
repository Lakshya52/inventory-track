import { Text, type TextProps } from 'react-native';

import { cx } from '@/lib/cx';

export type TextVariant =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodyDark'
  | 'label'
  | 'caption'
  | 'tiny'
  | 'button'
  | 'navLabel'
  | 'value'
  | 'link';

export type TextTone =
  | 'navy'
  | 'body'
  | 'muted'
  | 'faint'
  | 'white'
  | 'whiteMuted'
  | 'danger'
  | 'success'
  | 'warn'
  | 'info'
  | 'violet';

const variantClasses: Record<TextVariant, string> = {
  display: 'font-manrope-extrabold text-[30px] leading-[38px]',
  h1: 'font-manrope-extrabold text-[26px] leading-[34px]',
  h2: 'font-manrope-extrabold text-[20px] leading-[28px]',
  h3: 'font-manrope-extrabold text-[16px] leading-[22px]',
  body: 'font-manrope text-xs leading-[18px]',
  bodyDark: 'font-manrope-medium text-xs leading-[18px]',
  label: 'font-manrope-semibold text-[11px] leading-4',
  caption: 'font-manrope-medium text-[10px] leading-[14px]',
  tiny: 'font-manrope-medium text-[9px] leading-[13px]',
  button: 'font-manrope-semibold text-[15px] leading-5',
  navLabel: 'font-manrope-semibold text-[11px] leading-4',
  value: 'font-manrope-bold text-[28px] leading-[34px]',
  link: 'font-manrope-semibold text-xs leading-[18px]',
};

const defaultTone: Record<TextVariant, TextTone> = {
  display: 'navy',
  h1: 'navy',
  h2: 'navy',
  h3: 'navy',
  body: 'muted',
  bodyDark: 'body',
  label: 'navy',
  caption: 'muted',
  tiny: 'muted',
  button: 'white',
  navLabel: 'navy',
  value: 'navy',
  link: 'navy',
};

const toneClasses: Record<TextTone, string> = {
  navy: 'text-navy',
  body: 'text-body',
  muted: 'text-muted',
  faint: 'text-faint',
  white: 'text-white',
  whiteMuted: 'text-white/70',
  danger: 'text-danger-text',
  success: 'text-success-text',
  warn: 'text-warn-text',
  info: 'text-info-text',
  violet: 'text-violet-text',
};

export type AppTextProps = TextProps & {
  variant?: TextVariant;
  tone?: TextTone;
};

export function AppText({
  variant = 'body',
  tone,
  className,
  ...rest
}: AppTextProps) {
  return (
    <Text
      className={cx(variantClasses[variant], toneClasses[tone ?? defaultTone[variant]], className)}
      {...rest}
    />
  );
}
