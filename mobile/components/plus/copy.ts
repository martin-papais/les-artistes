import { Share, TurboModuleRegistry } from 'react-native';

type ClipboardModule = { setString: (s: string) => void };

/**
 * Copie un texte sans nouvelle dépendance : le module natif Clipboard est
 * encore livré avec React Native 0.81. S'il manque, on ouvre la feuille de
 * partage (qui propose « Copier »).
 * Renvoie true si le texte est dans le presse-papiers.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const mod = TurboModuleRegistry.get('Clipboard') as unknown as ClipboardModule | null;
    if (mod?.setString) {
      mod.setString(text);
      return true;
    }
  } catch {}
  try {
    await Share.share({ message: text });
  } catch {}
  return false;
}
