import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';

import { BottomSheet } from './bottom-sheet';
import { Field } from './field';
import { PrimaryButton } from './buttons';

export type FormField = {
  key: string;
  label: string;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  secureTextEntry?: boolean;
  multiline?: boolean;
};

type FormSheetProps = {
  visible: boolean;
  title: string;
  fields: FormField[];
  submitLabel: string;
  initialValues?: Record<string, string>;
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
};

export function FormSheet({
  visible,
  title,
  fields,
  submitLabel,
  initialValues,
  onSubmit,
  onClose,
}: FormSheetProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [wasVisible, setWasVisible] = useState(visible);

  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setValues({
        ...Object.fromEntries(fields.map((field) => [field.key, ''])),
        ...initialValues,
      });
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {fields.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            placeholder={field.placeholder}
            keyboardType={field.keyboardType}
            secureTextEntry={field.secureTextEntry}
            multiline={field.multiline}
            value={values[field.key] ?? ''}
            onChangeText={(text) => setValues((current) => ({ ...current, [field.key]: text }))}
          />
        ))}
        <PrimaryButton
          label={submitLabel}
          className="mt-2"
          onPress={() => onSubmit(values)}
        />
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}
