export type PastelTone = 'mint' | 'blue' | 'purple' | 'peach' | 'sky';

export const pastelClasses: Record<
  PastelTone,
  { container: string; icon: string; border: string }
> = {
  mint: {
    container: 'bg-pastel-mint',
    border: 'border-pastel-mint-line',
    icon: 'bg-pastel-mint-icon',
  },
  blue: {
    container: 'bg-pastel-blue',
    border: 'border-pastel-blue-line',
    icon: 'bg-pastel-blue-icon',
  },
  purple: {
    container: 'bg-pastel-purple',
    border: 'border-pastel-purple-line',
    icon: 'bg-pastel-purple-icon',
  },
  peach: {
    container: 'bg-pastel-peach',
    border: 'border-pastel-peach-line',
    icon: 'bg-pastel-peach-icon',
  },
  sky: {
    container: 'bg-pastel-sky',
    border: 'border-pastel-sky-line',
    icon: 'bg-pastel-sky-icon',
  },
};

export const pastelText: Record<PastelTone, string> = {
  mint: 'text-success-text',
  blue: 'text-info-text',
  purple: 'text-violet-text',
  peach: 'text-warn-text',
  sky: 'text-info-text',
};
