import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { App } from './App';
import { charger } from './buddies/store';

// La copie locale des Buddies est lue (IndexedDB) avant le premier écran ; 3 s au plus, pour ne jamais bloquer l'ouverture.
void Promise.race([charger(), new Promise((r) => setTimeout(r, 3000))])
  .finally(() => createRoot(document.getElementById('root')!).render(<App />));
