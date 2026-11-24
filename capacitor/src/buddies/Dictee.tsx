import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Natif } from './Buddies';

/**
 * 🎤 Dictée dans l'appli (choix de Seb, 24 novembre ; spec/buddies.md §5.6) : plus de fenêtre Google. On parle,
 * l'onde bouge dans la conversation, les mots s'écrivent pendant qu'on parle. Gratuit, et hors ligne quand le
 * téléphone a le français (Android : SpeechRecognizer, sans sa fenêtre). Navigateur : sa reconnaissance vocale.
 * L'écoute continue phrase après phrase jusqu'à ■ ou deux silences (comme la dictée d'AppBase).
 */

type SR = {
  lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((ev: { error: string }) => void) | null;
};
const Reconnaissance = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

/** `ajouter` reçoit chaque phrase finie ; `partiel` : la phrase en cours ; `niveau` : 0 à 1, pour l'onde. */
export function useDictee(ajouter: (t: string) => void, onToast: (m: string) => void) {
  const [ecoute, setEcoute] = useState(false);
  const [partiel, setPartiel] = useState('');
  const [niveau, setNiveau] = useState(0);
  const sr = useRef<SR | null>(null);
  const ajout = useRef(ajouter);
  ajout.current = ajouter;

  // Android : les phrases et le niveau du son arrivent en événements.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const hs = [
      Natif.addListener('dictee', (x) => {
        if (x.fini) { setPartiel(''); if (x.texte.trim()) ajout.current(x.texte.trim()); } else setPartiel(x.texte);
      }),
      // rms en dB, à peu près de -2 (silence) à 10 (voix forte).
      Natif.addListener('dicteeNiveau', (x) => setNiveau(Math.max(0, Math.min(1, (x.niveau + 2) / 12)))),
      Natif.addListener('dicteeFin', (x) => {
        setEcoute(false); setPartiel(''); setNiveau(0);
        if (x.erreur === 9) onToast('Autorise le micro pour dicter');
        else if (x.erreur != null) onToast('Dictée indisponible : touche 🎤 sur le clavier');
      }),
    ];
    return () => { hs.forEach((h) => void h.then((x) => x.remove())); void Natif.arreterEcoute().catch(() => undefined); };
  }, [onToast]);

  const basculer = async () => {
    if (ecoute) {
      if (Capacitor.isNativePlatform()) void Natif.arreterEcoute().catch(() => undefined); else sr.current?.stop();
      return;
    }
    if (Capacitor.isNativePlatform()) {
      setEcoute(true);
      try { await Natif.ecouter(); } catch (e) { setEcoute(false); onToast((e as Error).message === 'micro' ? 'Autorise le micro pour dicter' : 'Dictée indisponible : touche 🎤 sur le clavier'); }
      return;
    }
    if (!Reconnaissance) { onToast('Touche 🎤 sur le clavier pour dicter'); return; }
    const r = new Reconnaissance();
    r.lang = 'fr-FR'; r.continuous = true; r.interimResults = true;
    r.onresult = (ev) => {
      let p = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) ajout.current(ev.results[i][0].transcript.trim()); else p += ev.results[i][0].transcript;
      }
      setPartiel(p); setNiveau(p ? 0.6 : 0.2);
    };
    r.onerror = (ev) => { if (ev.error === 'not-allowed') onToast('Autorise le micro pour dicter'); };
    r.onend = () => { setEcoute(false); setPartiel(''); setNiveau(0); };
    sr.current = r; r.start(); setEcoute(true);
  };
  useEffect(() => () => sr.current?.stop(), []);
  return { ecoute, partiel, niveau, basculer };
}

/** L'onde pendant qu'on parle, et la phrase en cours. */
export function Onde({ niveau, partiel, avant }: { niveau: number; partiel: string; avant?: string }) {
  const barres = [0.5, 0.8, 1, 0.7, 0.9, 0.6, 1, 0.75, 0.55, 0.85, 0.65, 0.95];
  return <div className="bd-onde" aria-live="polite">
    <span className="bd-onde-barres">{barres.map((b, i) =>
      <i key={i} style={{ height: `${Math.round(6 + 26 * Math.max(0.15, niveau) * b)}px`, animationDelay: `${i * 70}ms` }} />)}</span>
    <span className="bd-onde-texte">{avant}{avant && partiel ? ' ' : ''}<i>{partiel || (avant ? '' : 'Je t’écoute…')}</i></span>
  </div>;
}
