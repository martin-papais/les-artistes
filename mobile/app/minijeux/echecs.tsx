import { DuelLobby } from '@/components/minijeux/DuelLobby';
import { echecs, type Partie } from '@/lib/echecs';

// Dans la liste des dernières parties : « mat » ou « abandon »
const finLabel = ({ fin }: Partie) => (fin === 'mat' ? ' (mat)' : fin === 'abandon' ? ' (abandon)' : '');

export default function EchecsLobby() {
  return (
    <DuelLobby
      jeu="echecs"
      titre="Échecs"
      sub="À deux, en direct, classé à l’Elo"
      api={echecs}
      route="/minijeux/echiquier/[id]"
      finLabel={finLabel}
    />
  );
}
