import { Circle, Path, Rect, Svg } from 'react-native-svg';

import { colors } from '@/theme';

export type TabIconName =
  | 'home'
  | 'batches'
  | 'qr-print'
  | 'dispatch'
  | 'loading'
  | 'scan'
  | 'settings';

type TabIconProps = {
  name: TabIconName;
  color: string;
  size?: number;
  filled?: boolean;
};

const STROKE_WIDTH = 1.8;
const CUTOUT = colors.navPill;

/**
 * Exact Lucide paths (24x24) with hand-built filled variants.
 * Outline = inactive tab, filled = active tab.
 */
export function TabIcon({ name, color, size = 25, filled = false }: TabIconProps) {
  switch (name) {
    case 'home':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          {filled ? (
            <Path
              d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8z"
              fill={color}
              fillRule="evenodd"
            />
          ) : (
            <>
              <Path
                d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"
                stroke={color}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                stroke={color}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}
        </Svg>
      );

    case 'batches':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
            fill={filled ? color : 'none'}
            stroke={filled ? color : color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="m3.3 7 8.7 5 8.7-5"
            stroke={filled ? CUTOUT : color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M12 22V12"
            stroke={filled ? CUTOUT : color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );

    case 'qr-print':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
            fill={filled ? color : 'none'}
            stroke={color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"
            fill={filled ? color : 'none'}
            stroke={filled ? color : color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Rect
            x="6"
            y="14"
            width="12"
            height="8"
            rx="1"
            fill={filled ? color : 'none'}
            stroke={filled ? CUTOUT : color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );

    case 'dispatch':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"
            fill={filled ? color : 'none'}
            stroke={color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M14 2v5a1 1 0 0 0 1 1h5"
            stroke={filled ? CUTOUT : color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M10 9H8"
            stroke={filled ? CUTOUT : color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M16 13H8"
            stroke={filled ? CUTOUT : color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M16 17H8"
            stroke={filled ? CUTOUT : color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );

    case 'scan':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          {[
            'M3 7V5a2 2 0 0 1 2-2h2',
            'M17 3h2a2 2 0 0 1 2 2v2',
            'M21 17v2a2 2 0 0 1-2 2h-2',
            'M7 21H5a2 2 0 0 1-2-2v-2',
            'M7 12h10',
          ].map((d) => (
            <Path
              key={d}
              d={d}
              stroke={color}
              strokeWidth={filled ? 2.4 : STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      );

    case 'settings':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
            stroke={color}
            strokeWidth={filled ? 2.4 : STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle
            cx="12"
            cy="12"
            r="3"
            stroke={color}
            strokeWidth={filled ? 2.4 : STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );

    case 'loading':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Path
            d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"
            fill={filled ? color : 'none'}
            stroke={color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M15 18H9"
            stroke={filled ? CUTOUT : color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"
            fill={filled ? color : 'none'}
            stroke={color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle
            cx="17"
            cy="18"
            r="2"
            fill={filled ? CUTOUT : 'none'}
            stroke={color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle
            cx="7"
            cy="18"
            r="2"
            fill={filled ? CUTOUT : 'none'}
            stroke={color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      );
  }
}
