import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  View,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Laisse la place au clavier en ajoutant sa hauteur sous le contenu.
 *
 * Le KeyboardAvoidingView de React Native calcule la position du champ par
 * rapport à la fiche (pageSheet) au lieu de l'écran : il remontait trop peu
 * et le clavier cachait le champ de commentaire. Ici, pas de calcul de
 * position : le bas du conteneur est le bas de l'écran (fiche, écran sans
 * onglets), moins la marge du bas de la SafeAreaView quand il est dedans.
 */
export function KeyboardAware({
  children,
  style,
  insideSafeArea = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** false si le conteneur n'est pas dans une SafeAreaView avec le bord du bas */
  insideSafeArea?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const animate = (e: KeyboardEvent) => {
      if (ios && e.duration) {
        LayoutAnimation.configureNext({
          duration: e.duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
    };
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      animate(e);
      setKeyboard(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
      animate(e);
      setKeyboard(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const bottomGap = insideSafeArea ? insets.bottom : 0;
  return (
    <View style={[{ flex: 1, paddingBottom: Math.max(0, keyboard - bottomGap) }, style]}>
      {children}
    </View>
  );
}
