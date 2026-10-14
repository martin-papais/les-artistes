import { useEffect, useRef, useState, type ReactNode } from 'react';
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
 * position sur iOS : le bas du conteneur est le bas de l'écran (fiche, écran
 * sans onglets), moins la marge du bas de la SafeAreaView quand il est dedans.
 *
 * Android : la fenêtre d'une Modal se rétrécit déjà sous le clavier, celle
 * des écrans en edge-to-edge non. On ne compte donc que la partie du
 * conteneur réellement couverte (bas du conteneur moins haut du clavier),
 * sinon la hauteur du clavier était retirée deux fois dans les Modal.
 * Limite : Android 11+ ne prévient pas quand le clavier change de hauteur
 * (emojis, suggestions) sans se fermer.
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
  // Android : haut du clavier et bas du conteneur, en coordonnées de l'écran
  const ref = useRef<View>(null);
  const [kbTop, setKbTop] = useState<number | null>(null);
  const [bottom, setBottom] = useState<number | null>(null);
  const measure = () => ref.current?.measureInWindow((_x, y, _w, h) => setBottom(y + h));

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
      if (!ios) {
        setKbTop(e.endCoordinates.screenY);
        ref.current?.measureInWindow((_x, y, _w, h) => setBottom(y + h));
      }
    });
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) => {
      animate(e);
      setKeyboard(0);
      setKbTop(null);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const bottomGap = insideSafeArea ? insets.bottom : 0;
  const pad =
    Platform.OS === 'ios'
      ? Math.max(0, keyboard - bottomGap)
      : kbTop !== null && bottom !== null
        ? Math.max(0, bottom - kbTop)
        : 0;
  return (
    // Le padding ne change pas le cadre du conteneur : pas de boucle avec onLayout
    <View ref={ref} onLayout={Platform.OS === 'android' ? measure : undefined} style={[{ flex: 1, paddingBottom: pad }, style]}>
      {children}
    </View>
  );
}
