// 📸 Photos qui arrivent dans l'appli sans passer par « Déposer » (Seb, 25/11) :
// « partagées » depuis WhatsApp, la galerie… (PhotosRecuesPlugin.java) : on demande dans quel album les ranger.
// (Les photos prises avec 📷 ne sont plus rangées seules au retour, Seb 27/11 : elles restent dans la galerie.)
// Une photo sans lieu reçoit la position du téléphone.
import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { deposer } from './Album';
import { aujourdhui, lire, retirerPhoto, type Sortie } from './store';

const Recues = registerPlugin<{ addListener(e: 'recues', cb: (r: { chemins: string[] }) => void): Promise<{ remove: () => void }> }>('PhotosRecues');
type Ici = { lon: number; lat: number } | null;

export function PhotosRecues({ ici, onToast, onAlbum }: { ici: Ici; onToast: (m: string) => void; onAlbum: (x: Sortie) => void }) {
  const [lot, setLot] = useState<{ chemins: string[]; prises: boolean } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [fait, setFait] = useState<{ x: Sortie; ids: string[] } | null>(null);
  const position = useRef<Ici>(ici);
  position.current = ici;

  const ranger = async (x: Sortie, l: { chemins: string[]; prises: boolean }) => {
    setOccupe(true);
    try {
      const files: File[] = [];
      for (const [i, c] of l.chemins.entries()) {
        const b = await fetch(Capacitor.convertFileSrc(c)).then((r) => (r.ok ? r.blob() : null), () => null);
        if (b) files.push(new File([b], `photo-${i + 1}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }));
      }
      // Sans position connue de l'appli (GPS pas encore lancé), on la demande au téléphone, 4 secondes au plus.
      let ou = l.prises ? position.current : null;
      if (l.prises && !ou) ou = await new Promise<Ici>((ok) => navigator.geolocation.getCurrentPosition(
        (g) => ok({ lon: g.coords.longitude, lat: g.coords.latitude }), () => ok(null), { timeout: 4000, maximumAge: 120_000 }));
      const ids = await deposer(x, files, onToast, ou, l.prises);
      if (!ids.length) onToast('Photos illisibles');
      else if (l.prises) setFait({ x, ids });
      else onAlbum(x);
    } finally { setOccupe(false); setLot(null); }
  };
  const rangerRef = useRef(ranger);
  rangerRef.current = ranger;

  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    const h = Recues.addListener('recues', (r) => { if (r.chemins?.length) setLot({ chemins: r.chemins, prises: false }); });
    return () => { void h.then((x) => x.remove()); };
  }, []);
  // Le bandeau « Annuler » reste 8 secondes.
  useEffect(() => { if (!fait) return; const t = window.setTimeout(() => setFait(null), 8000); return () => window.clearTimeout(t); }, [fait]);

  const n = (k: number) => `${k} photo${k > 1 ? 's' : ''}`;
  if (fait && !lot) return <div className="bd-prises">
    <button onClick={() => { onAlbum(fait.x); setFait(null); }}>📸 {n(fait.ids.length)} dans « {fait.x.nom} »</button>
    <button onClick={() => { fait.ids.forEach(retirerPhoto); setFait(null); }}>Annuler</button>
  </div>;
  if (!lot) return null;
  const j = aujourdhui();
  const albums = [...lire().sorties].sort((a, b) => Number(b.debut <= j && j <= b.fin) - Number(a.debut <= j && j <= a.fin) || b.debut.localeCompare(a.debut));
  return <div className="bd-recues-fond">
    <div className="bd-recues">
      <b>{n(lot.chemins.length)} : dans quel album ?</b>
      {occupe ? <p>🕓 Préparation…</p> : albums.length
        ? <div className="bd-recues-liste">{albums.map((x) => <button key={x.id} onClick={() => void ranger(x, lot)}>📸 {x.nom}</button>)}</div>
        : <p>Crée d'abord une sortie : son album recevra les photos.</p>}
      {!occupe && <button onClick={() => setLot(null)}>{lot.prises ? 'Ne pas ranger' : 'Annuler'}</button>}
    </div>
  </div>;
}
