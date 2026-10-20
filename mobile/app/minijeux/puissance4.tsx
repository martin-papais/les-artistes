import { DuelLobby } from '@/components/minijeux/DuelLobby';
import { p4 } from '@/lib/puissance4';

export default function Puissance4Lobby() {
  return <DuelLobby jeu="puissance4" titre="Puissance 4" sub="À deux, en direct, classé à l’Elo" api={p4} route="/minijeux/partie/[id]" />;
}
