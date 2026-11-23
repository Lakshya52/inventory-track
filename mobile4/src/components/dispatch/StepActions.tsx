import { View, Text, Pressable } from 'react-native';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react-native';

export function StepActions({
  onPrevious,
  onNext,
  nextLabel = 'Next',
  nextDisabled = false,
}: {
  onPrevious: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
}) {
  return (
    <View className="mt-7 flex-row gap-3">
      <Pressable
        onPress={onPrevious}
        className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-brand">
        <ArrowLeft size={18} color="#0b218c" />
        <Text className="text-base font-lexend-semibold text-brand">Previous</Text>
      </Pressable>
      <Pressable
        onPress={onNext}
        disabled={nextDisabled}
        className={`h-12 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-brand ${
          nextDisabled ? 'opacity-50' : ''
        }`}>
        <Text className="text-base font-lexend-semibold text-white">{nextLabel}</Text>
        {nextLabel === 'Next' ? <ArrowRight size={18} color="#ffffff" /> : <Check size={18} color="#ffffff" />}
      </Pressable>
    </View>
  );
}
