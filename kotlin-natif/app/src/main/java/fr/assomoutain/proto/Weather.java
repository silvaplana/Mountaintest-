package fr.assomoutain.proto;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

/**
 * Icônes météo du menu Voyage (copie identique dans les deux prototypes, voir shared/).
 * Météo : ouvre l'appli Météo-France (sinon son site). Météo montagne : ouvre la page « Météo montagne »
 * de Météo-France, dans l'appli si elle sait l'afficher, sinon dans le navigateur.
 */
public final class Weather {
    private Weather() {}

    static final String PKG = "fr.meteo";
    static final String HOME = "https://meteofrance.com/";
    static final String MOUNTAIN = "https://meteofrance.com/meteo-montagne";

    private static boolean start(Activity a, Intent i) {
        try {
            a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    /** true si quelque chose s'est ouvert. */
    public static boolean open(Activity a, boolean mountain) {
        String url = mountain ? MOUNTAIN : HOME;
        Intent inApp = mountain
            ? new Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(PKG)
            : new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(PKG);
        return start(a, inApp) || start(a, new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }
}
