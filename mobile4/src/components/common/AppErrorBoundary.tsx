import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Shows runtime errors on-device instead of leaving a silent white screen. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crash:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ScrollView className="flex-1 bg-canvas">
          <View className="px-6 py-16">
            <Text className="text-xl font-lexend-bold text-danger">App failed to start</Text>
            <Text className="mt-3 text-sm font-lexend text-ink">{this.state.error.message}</Text>
          </View>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}
