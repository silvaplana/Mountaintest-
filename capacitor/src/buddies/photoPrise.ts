// 📷 Appareil photo du téléphone, ouvert depuis l'appli (PhotoPlugin.java). Les photos restent dans la galerie ;
// on les dépose ensuite dans une sortie depuis son album (Seb, 27/11).
import { registerPlugin } from '@capacitor/core';

export const Photo = registerPlugin<{ open(): Promise<void> }>('Photo');
