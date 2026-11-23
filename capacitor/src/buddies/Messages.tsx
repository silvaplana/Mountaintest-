import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap } from 'maplibre-gl';
import { Capacitor } from '@capacitor/core';
import { EcoLocation } from '../gps/ecoLocation';
import { deposer, Image as PhotoImage } from './Album';
import { couleur, useBuddies, Visage } from './Buddies';
import { useDictee } from './Carnet';
import { iconeHebergement, prixHebergement } from './Hebergements';
import { apercu, cle, fil, heureMessage, longueurTrace, type Bulle, type Dest } from './messages';
import { agir, annuler, contexte, demander, pourBud } from './bud';
import {
  appliquer, envoyerMessage, lire, marquerLu, noterActionsBud, nonLus, proposerHebergement, retirerMessage, synchroniser, vue, type Buddy, type Groupe, type Hebergement,
  type Sortie, type TraceBuddy,
} from './store';

/**
 * Messagerie (spec/buddies.md §5.6, écrans 6 et 24) : une conversation par Buddy Group et par Buddy Time.
 * Celle d'un Buddy Time s'ouvre sur sa carte (bandeau du bas) ; celle d'un Buddy Group dans le panneau.
 * Mêmes écrans côté Kotlin (Messages.kt, BuddiesPanel.kt, BandeauSortie.kt).
 */

/** Ma position du moment, pour « je suis ici ». */
function maPosition(): Promise<{ lon: number; lat: number }> {
  return new Promise((ok, ko) => {
    const lire = () => navigator.geolocation?.getCurrentPosition((p) => ok({ lon: p.coords.longitude, lat: p.coords.latitude }), ko,
      { maximumAge: 60_000, timeout: 20_000, enableHighAccuracy: true }) ?? ko(new Error('gps'));
    if (Capacitor.isNativePlatform()) void EcoLocation.requestPermissions().then(lire, ko); else lire();
  });
}

export type Actions = {
  onPoint: (p: { lon: number; lat: number; nom: string }) => void;
  onTrace: (t: TraceBuddy) => void;
  onHebergement?: (h: Hebergement) => void;
  onPhoto?: () => void;
};

/** Une conversation : le fil, puis [📷] [📍] [Message] [🎤 / ➤]. `court` : seulement les derniers mots (écran 24). */
export function Conversation({ dest, membres, sortie, court, onToast, ...a }: Actions & {
  dest: Dest; membres: Buddy[]; sortie?: Sortie; court?: boolean; onToast: (m: string) => void;
}) {
  const e = useBuddies();
  const v = vue(e);
  const moi = e.moi ?? 'moi';
  const bulles = fil(dest, v.messages, v.traces, v.hebergements);
  const [texte, setTexte] = useState('');
  const [choisi, setChoisi] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const bas = useRef<HTMLDivElement>(null);
  const fichier = useRef<HTMLInputElement>(null);
  const k = cle(dest);
  const dictee = useDictee((t) => setTexte((x) => `${x}${x && !x.endsWith(' ') ? ' ' : ''}${t}`), onToast);
  const nom = (id: string) => membres.find((b) => b.id === id)?.pseudo ?? '?';
  // Ouverte : on regarde les nouveaux messages toutes les 10 s, et on les marque lus.
  useEffect(() => {
    const t = setInterval(() => { void synchroniser().catch(() => undefined); }, 10_000);
    return () => clearInterval(t);
  }, []);
  const dernier = bulles.at(-1)?.quand;
  useEffect(() => {
    if (nonLus(e, k, v.messages)) marquerLu(k);
    bas.current?.scrollIntoView({ block: 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, dernier, bulles.length]);

  // 🐻 « Bud, … » : la question part comme un message, puis la réponse de Bud arrive dans sa bulle, vue de tous.
  const [budPense, setBudPense] = useState(false);
  const bud = async (question: string) => {
    setBudPense(true);
    try {
      const donnees = { nom: appliquer(e).find((g) => g.id === dest.groupe)?.nom ?? '', sortie, membres, moi, traces: v.traces,
        hebergements: v.hebergements, depenses: v.depenses, plannings: v.plannings, messages: v.messages };
      const r = await demander(question, contexte(dest, donnees));
      // Ce que je lui ai demandé de faire (dépense, Buddy Time, ma dispo) : fait en mon nom, « Annuler » sous sa bulle.
      const { faites, refus } = agir(r.actions, dest, { ...donnees, groupe: appliquer(e).find((g) => g.id === (sortie?.groupe ?? dest.groupe)) });
      const id = envoyerMessage(dest, { texte: r.texte || 'C’est fait.', bud: true });
      if (faites.length && id) noterActionsBud(id, faites);
      if (refus.length) onToast(`Bud n’a pas pu : ${refus.join(' ; ')}`);
      if (r.point) envoyerMessage(dest, { nature: 'point', texte: r.point.nom, lon: r.point.lon, lat: r.point.lat, bud: true });
      if (sortie) for (const h of r.hebergements) proposerHebergement([sortie.id], { ...h, nature: h.type });
      void synchroniser().catch(() => undefined);
    } catch (err) { onToast((err as Error).message); }
    setBudPense(false);
  };
  const envoyer = () => {
    envoyerMessage(dest, { texte });
    if (pourBud(texte)) void bud(texte);
    setTexte('');
  };
  const point = async () => {
    setOccupe(true);
    try { envoyerMessage(dest, { nature: 'point', ...await maPosition() }); } catch { onToast('Position introuvable : le GPS est-il allumé ?'); }
    setOccupe(false);
  };
  const montrees = court ? bulles.slice(-2) : bulles;
  return <div className={`bd-conv${court ? ' court' : ''}`}>
    <div className="bd-fil">
      {!bulles.length && <p className="bd-vide">Pas encore de message. Écris, dicte avec 🎤, ou montre où tu es avec 📍.</p>}
      {montrees.map((b) => <UneBulle key={`${b.genre}${b.genre === 'message' ? b.m.id : b.genre === 'trace' ? b.t.id : b.h.id}`} b={b} moi={moi}
        nom={nom} photos={v.photos} choisi={choisi} onChoisir={setChoisi} {...a} />)}
      {budPense && <div className="bd-bulle bud"><b className="bd-qui-ecrit">🐻 Bud</b><span>…</span></div>}
      <div ref={bas} />
    </div>
    <div className="bd-saisie">
      {sortie && <button aria-label="Envoyer une photo" disabled={occupe} onClick={() => fichier.current?.click()}>📷</button>}
      <button aria-label="Montrer où je suis" disabled={occupe} onClick={() => void point()}>📍</button>
      <input value={texte} onChange={(ev) => setTexte(ev.target.value)} placeholder="Message, ou « Bud, … »" enterKeyHint="send" maxLength={2000}
        onKeyDown={(ev) => { if (ev.key === 'Enter') envoyer(); }} />
      {texte.trim() ? <button className="bd-envoyer" aria-label="Envoyer" onClick={envoyer}>➤</button>
        : <button className={dictee.ecoute ? 'bd-ecoute' : ''} aria-label="Dicter" onClick={() => void dictee.basculer()}>🎤</button>}
      {sortie && <input ref={fichier} type="file" accept="image/*" multiple hidden onChange={(ev) => {
        const f = ev.target.files; if (!f?.length) return;
        setOccupe(true);
        void deposer(sortie, f, onToast).then((ids) => ids.forEach((photo) => envoyerMessage(dest, { nature: 'photo', photo })))
          .finally(() => { setOccupe(false); ev.target.value = ''; });
      }} />}
    </div>
  </div>;
}

function UneBulle({ b, moi, nom, photos, choisi, onChoisir, onPoint, onTrace, onHebergement, onPhoto }: Actions & {
  b: Bulle; moi: string; nom: (id: string) => string; photos: ReturnType<typeof vue>['photos']; choisi: string | null; onChoisir: (id: string | null) => void;
}) {
  if (b.genre === 'trace') {
    const t = b.t;
    return <button className="bd-bulle-carte" onClick={() => onTrace(t)}>
      <span className="bd-icone">〰</span>
      <span className="bd-texte"><b>{t.nom}</b><small>{t.par.pseudo} · {longueurTrace(t.ligne)} · voir sur la carte</small>{t.mot && <small>« {t.mot} »</small>}</span>
    </button>;
  }
  if (b.genre === 'hebergement') {
    const h = b.h;
    return <button className="bd-bulle-carte" onClick={() => onHebergement?.(h)}>
      <span className="bd-icone">{iconeHebergement(h.nature)}</span>
      <span className="bd-texte"><b>{h.nom}{h.retenu ? ' ✅' : ''}</b><small>{nom(h.par)} · {prixHebergement(h)} · {h.lon != null ? 'voir sur la carte' : 'voir'}</small></span>
    </button>;
  }
  const m = b.m;
  if (m.bud) {
    // 🐻 Bud : sa bulle à part, à gauche chez tout le monde ; un point qu'il montre s'ouvre sur la carte.
    const heure = <small className="bd-heure">{heureMessage(m.cree_le)}{m.attente ? ' · 🕓' : ''}</small>;
    if (m.nature === 'point') return <button className="bd-bulle-carte" onClick={() => m.lon != null && m.lat != null && onPoint({ lon: m.lon, lat: m.lat, nom: m.texte || 'Bud montre ici' })}>
      <span className="bd-icone">📍</span><span className="bd-texte"><b>{m.texte || 'Bud montre ici'}</b><small>🐻 Bud · voir sur la carte</small></span>
    </button>;
    // Ce qu'il a fait à ma demande : la liste et « Annuler » (sur mon téléphone seulement : c'est fait en mon nom).
    const fait = lire().actionsBud?.[m.id];
    return <div className="bd-bulle bud"><b className="bd-qui-ecrit">🐻 Bud</b><span>{m.texte}</span>
      {fait && <>{fait.faites.map((a, i) => <small key={i} className="bd-bud-fait">{fait.annule ? <s>{a.texte}</s> : `✓ ${a.texte}`}</small>)}
        {fait.annule ? <small className="bd-bud-fait">Annulé</small>
          : <button className="bd-lien bd-bud-annuler" onClick={() => { annuler(fait.faites); noterActionsBud(m.id, fait.faites, true); void synchroniser().catch(() => undefined); }}>Annuler</button>}</>}
      {heure}</div>;
  }
  const mien = m.par === moi || m.par === 'moi';
  const qui = !mien && <b className="bd-qui-ecrit" style={{ color: couleur(m.par) }}>{nom(m.par)}</b>;
  const pied = <small className="bd-heure">{heureMessage(m.cree_le)}{m.attente ? ' · 🕓 partira au retour du réseau' : ''}</small>;
  const retirer = mien && choisi === m.id && <button className="bd-lien petit" onClick={() => { retirerMessage(m.id); onChoisir(null); }}>Retirer ce message</button>;
  const choisir = () => onChoisir(choisi === m.id ? null : m.id);
  if (m.nature === 'point') {
    const n = mien ? 'Je suis ici' : `${nom(m.par)} est ici`;
    return <div className={`bd-bulle-de${mien ? ' mien' : ''}`}>
      <button className="bd-bulle-carte" onClick={() => m.lon != null && m.lat != null && onPoint({ lon: m.lon, lat: m.lat, nom: n })}
        onContextMenu={(ev) => { ev.preventDefault(); choisir(); }}>
        <span className="bd-icone">📍</span><span className="bd-texte"><b>{n}</b><small>{heureMessage(m.cree_le)} · voir sur la carte{m.attente ? ' · 🕓' : ''}</small></span>
      </button>{retirer}
    </div>;
  }
  if (m.nature === 'photo') {
    const p = photos.find((x) => x.id === m.photo);
    return <div className={`bd-bulle${mien ? ' mien' : ''} photo`} onContextMenu={(ev) => { ev.preventDefault(); choisir(); }}>
      {qui}
      {p ? <button className="bd-bulle-photo" onClick={onPhoto}><PhotoImage p={p} className="bd-bulle-img" /></button> : <small>📷 photo retirée de l'album</small>}
      {pied}{retirer}
    </div>;
  }
  return <div className={`bd-bulle${mien ? ' mien' : ''}${m.attente ? ' attente' : ''}`} onClick={mien ? choisir : undefined}>
    {qui}<span>{m.texte}</span>{pied}{retirer}
  </div>;
}

/** Le point montré sur la carte (« Julie est ici »), le temps de le regarder. */
export function PointSurCarte({ map, p }: { map: MlMap | null; p: { lon: number; lat: number; nom: string } | null }) {
  useEffect(() => {
    if (!map || !p) return;
    const el = document.createElement('div');
    el.className = 'bd-point-carte';
    el.textContent = `📍 ${p.nom}`;
    const mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map);
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
    return () => { mk.remove(); };
  }, [map, p]);
  return null;
}

/** Toutes mes conversations (💬 depuis la liste) : les plus récentes en haut, avec les non lus. */
export function Conversations({ groupes, sorties, onGroupe, onSortie, onRetour, onClose }: {
  groupes: Groupe[]; sorties: Sortie[]; onGroupe: (g: Groupe) => void; onSortie: (x: Sortie) => void; onRetour: () => void; onClose: () => void;
}) {
  const e = useBuddies();
  const v = vue(e);
  const moi = e.moi ?? 'moi';
  const l = [
    ...groupes.filter((g) => g.nature !== 'me_time').map((g) => ({ id: g.id, nom: g.nom, photo: g.photo, membres: g.membres, ouvrir: () => onGroupe(g),
      sous: `${g.membres.length} buddies`, dest: { groupe: g.id } })),
    ...sorties.filter((x) => x.participants.length > 1).map((x) => ({ id: x.id, nom: x.nom, photo: x.photo, membres: x.participants, ouvrir: () => onSortie(x),
      sous: `${x.participants.length} buddies`, dest: { sortie: x.id } })),
  ].map((c) => {
    const f = fil(c.dest, v.messages, v.traces, v.hebergements);
    return { ...c, dernier: f.at(-1), n: nonLus(e, c.id, v.messages) };
  }).filter((c) => c.dernier || 'groupe' in c.dest)
    .sort((a, b) => (b.dernier ? Date.parse(b.dernier.quand) : 0) - (a.dernier ? Date.parse(a.dernier.quand) : 0));
  return <div className="bd-corps">
    <div className="xp-head"><button onClick={onRetour} aria-label="Retour">‹</button><h2>💬 Messages</h2><button onClick={onClose} aria-label="Fermer">✕</button></div>
    {!l.length && <p className="bd-vide">Crée un Buddy Group ou un Buddy Time avec des copains : vous pourrez vous écrire ici.</p>}
    {l.map((c) => <button key={c.id} className="bd-ligne" onClick={c.ouvrir}>
      <Visage b={{ id: c.id, nom: c.nom, photo: c.photo }} taille={48} />
      <span className="bd-texte"><b>{c.nom}</b><small>{c.dernier ? apercu(c.dernier, (id) => c.membres.find((m) => m.id === id)?.pseudo ?? '?', moi) : c.sous}</small></span>
      {c.dernier && <small className="bd-heure">{heureMessage(c.dernier.quand)}</small>}
      {c.n > 0 && <span className="bd-nonlu">{c.n}</span>}
    </button>)}
  </div>;
}
