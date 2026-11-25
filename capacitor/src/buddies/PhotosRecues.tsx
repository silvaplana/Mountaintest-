// 📸 Photos « partagées » vers l'appli depuis WhatsApp, la galerie… (Seb, 25/11 ; PhotosRecuesPlugin.java) :
// on demande dans quel album de Buddy Time les ranger, puis elles suivent le chemin habituel du dépôt.
import { useEffect, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { deposer } from './Album';
import { lire, type Sortie } from './store';

const Recues = registerPlugin<{ addListener(e: 'recues', cb: (r: { chemins: string[] }) => void): Promise<{ remove: () => void }> }>('PhotosRecues');

export function PhotosRecues({ onToast, onAlbum }: { onToast: (m: string) => void; onAlbum: (x: Sortie) => void }) {
  const [chemins, setChemins] = useState<string[]>([]);
  const [occupe, setOccupe] = useState(false);
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    const h = Recues.addListener('recues', (r) => setChemins(r.chemins ?? []));
    return () => { void h.then((x) => x.remove()); };
  }, []);
  if (!chemins.length) return null;
  const albums = [...lire().sorties].sort((a, b) => b.debut.localeCompare(a.debut));
  const ranger = async (x: Sortie) => {
    setOccupe(true);
    try {
      const files: File[] = [];
      for (const [i, c] of chemins.entries()) {
        const b = await fetch(Capacitor.convertFileSrc(c)).then((r) => (r.ok ? r.blob() : null), () => null);
        if (b) files.push(new File([b], `photo-${i + 1}.jpg`, { type: 'image/jpeg' }));
      }
      const l = await deposer(x, files, onToast);
      if (l.length) onAlbum(x); else onToast('Photos illisibles');
    } finally { setOccupe(false); setChemins([]); }
  };
  return <div className="bd-recues-fond">
    <div className="bd-recues">
      <b>{chemins.length} photo{chemins.length > 1 ? 's' : ''} : dans quel album ?</b>
      {occupe ? <p>🕓 Préparation…</p> : albums.length
        ? <div className="bd-recues-liste">{albums.map((x) => <button key={x.id} onClick={() => void ranger(x)}>📸 {x.nom}</button>)}</div>
        : <p>Crée d'abord un Buddy Time : son album recevra les photos.</p>}
      {!occupe && <button onClick={() => setChemins([])}>Annuler</button>}
    </div>
  </div>;
}
