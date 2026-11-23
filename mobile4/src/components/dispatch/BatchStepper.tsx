import { View, Text } from 'react-native';
import { Check } from 'lucide-react-native';

const STEPS = [
  { n: 1, label: 'Select' },
  { n: 2, label: 'Quantity' },
  { n: 3, label: 'Details' },
  { n: 4, label: 'Preview' },
];

export function BatchStepper({ active }: { active: number }) {
  return (
    <View className="mt-5">
      <View className="flex-row items-center">
        {STEPS.map((step, index) => {
          const done = step.n < active;
          const current = step.n === active;
          return (
            <View key={step.n} className="flex-1 flex-row items-center">
              <View
                className={`h-8 w-8 items-center justify-center rounded-full ${
                  done || current ? 'bg-[#0ba178]' : 'bg-[#cfd4e0]'
                }`}>
                <Check size={16} color={done || current ? '#ffffff' : '#9aa1b4'} />
              </View>
              {index !== STEPS.length - 1 ? (
                <View className={`h-1 flex-1 ${step.n < active ? 'bg-[#0ba178]' : 'bg-[#dfe3ee]'}`} />
              ) : null}
            </View>
          );
        })}
      </View>
      <View className="mt-2 flex-row">
        {STEPS.map((step) => (
          <Text
            key={step.n}
            className={`flex-1 text-center text-[11px] font-lexend-semibold ${
              step.n === active ? 'text-brand' : 'text-[#9aa1b4]'
            }`}>
            Step {step.n}
            {'\n'}
            {step.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
