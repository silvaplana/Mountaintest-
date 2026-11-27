import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { envoyerAuServeur, journal, noter } from './journal';
import { Natif } from './Buddies';

/**
 * 📓 « Envoyer le journal » (Seb, 27/11) : au serveur, où Claude le lit ; sans réseau, un fichier texte partagé avec le
 * menu du téléphone, à joindre dans la conversation.
 */
export async function envoyerJournal(onToast: (m: string) => void) {
  noter('journal envoyé', navigator.userAgent);
  // Au serveur d'abord : Claude le lit de là. Sans réseau, en fichier par le menu du téléphone.
  try { await envoyerAuServeur('bouton', true); onToast('Journal envoyé'); return; } catch { /* sans réseau : en fichier */ }
  const nom = `journal-carte-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt`;
  try {
    if (Capacitor.isNativePlatform()) {
      await Filesystem.writeFile({ path: `partage/${nom}`, data: journal(), directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
      await Natif.partagerFichier({ chemin: `partage/${nom}`, mime: 'text/plain', titre: 'Envoyer le journal' });
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([journal()], { type: 'text/plain' }));
      a.download = nom; a.click();
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') onToast(`Envoi impossible : ${(e as Error).message}`);
  }
}
