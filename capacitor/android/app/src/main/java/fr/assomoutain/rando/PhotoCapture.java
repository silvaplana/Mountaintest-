package fr.assomoutain.rando;

import android.app.Activity;
import android.content.Intent;
import android.provider.MediaStore;

/**
 * Icône 📷 (copie identique dans les deux prototypes, voir shared/) : ouvre l'application Appareil photo
 * du téléphone, en mode photo. Elle enregistre elle-même dans la galerie ; le bouton Retour ramène à la carte.
 * (La première version passait par ACTION_IMAGE_CAPTURE et bloquait au « OK » sur le téléphone de Seb.)
 */
public final class PhotoCapture {
    private PhotoCapture() {}

    /** true si l'appareil photo s'est ouvert. */
    public static boolean open(Activity a) {
        Intent[] tries = {
            new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA),
            new Intent(MediaStore.ACTION_IMAGE_CAPTURE),
        };
        for (Intent i : tries) {
            try {
                a.startActivity(i);
                return true;
            } catch (Exception ignored) {
                // pas d'appli pour cette action : on essaie la suivante
            }
        }
        return false;
    }
}
