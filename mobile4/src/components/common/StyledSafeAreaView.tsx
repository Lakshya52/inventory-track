import { styled } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * react-native-safe-area-context is a third-party component, so NativeWind v5
 * needs `styled()` for `className` to work on it. Without this wrapper the
 * `flex-1` class is ignored on native and screens collapse to zero height.
 */
export const StyledSafeAreaView = styled(SafeAreaView);
