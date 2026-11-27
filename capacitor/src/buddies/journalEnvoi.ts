import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { journal, noter } from './journal';
import { Natif } from './Buddies';

/**
 * 📓 « Envoyer le journal » : un fichier texte partagé avec le menu du téléphone (WhatsApp, mail, Drive…), à joindre
 * dans la conversation avec Claude quand quelque chose a coincé (Seb, 27/11).
 */
export async function envoyerJournal(onToast: (m: string) => void) {
  noter('journal envoyé', navigator.userAgent);
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
