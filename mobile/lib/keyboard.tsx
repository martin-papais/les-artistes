import { useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * KeyboardAvoidingView qui tient compte de sa position réelle à l'écran.
 * Celui de React Native compare sa position relative à son parent avec celle,
 * absolue, du clavier : sous un en-tête ou dans une fiche (pageSheet), il
 * remonte trop peu et le clavier cache le champ ou le bouton du bas.
 */
export function KeyboardAware({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  return (
    <View
      ref={ref}
      style={[{ flex: 1 }, style]}
      onLayout={() => ref.current?.measureInWindow((_x, y) => setOffset(y))}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        // Android aussi : en edge-to-edge (SDK 54) la fenêtre ne se redimensionne plus sous le clavier
        behavior="padding"
        keyboardVerticalOffset={offset}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
