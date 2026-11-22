package fr.assomoutain.rando;

import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

/**
 * Raccourcis « Économie batterie » (copie identique dans les deux prototypes, voir shared/).
 * Depuis Android 10, une appli ne peut plus couper elle-même Wi-Fi, données ou Bluetooth :
 * on ouvre le réglage (ou le panneau rapide quand il existe) et l'utilisateur appuie.
 * Le mode avion coupe toutes les radios ; le GPS, lui, continue de fonctionner.
 */
public final class BatterySettings {
    private BatterySettings() {}

    /** what : "avion", "wifi", "donnees", "bluetooth" ou "doubletap". */
    public static void open(Activity activity, String what) {
        if ("doubletap".equals(what)) { openDoubleTap(activity); return; }
        Intent i;
        switch (what) {
            case "wifi":
                i = new Intent(Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_WIFI : Settings.ACTION_WIFI_SETTINGS);
                break;
            case "donnees":
                i = new Intent(Build.VERSION.SDK_INT >= 29 ? Settings.Panel.ACTION_INTERNET_CONNECTIVITY : Settings.ACTION_DATA_ROAMING_SETTINGS);
                break;
            case "bluetooth":
                i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
                break;
            default:
                i = new Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS);
        }
        try {
            activity.startActivity(i);
        } catch (Exception e) {
            activity.startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS));
        }
    }

    /**
     * « Appuyer deux fois pour allumer l'écran » : aucune appli ne peut l'activer, et Android n'a pas de lien
     * officiel vers ce réglage. On essaie la page Mouvements et gestes de Samsung, puis Gestes (Pixel et autres),
     * sinon la page Affichage.
     */
    private static void openDoubleTap(Activity activity) {
        Intent[] tries = {
            new Intent().setClassName("com.android.settings", "com.android.settings.Settings$MotionAndGestureSettingsActivity"),
            new Intent().setClassName("com.android.settings", "com.android.settings.Settings$GestureSettingsActivity"),
            new Intent(Settings.ACTION_DISPLAY_SETTINGS),
            new Intent(Settings.ACTION_SETTINGS),
        };
        for (Intent i : tries) {
            try {
                activity.startActivity(i);
                return;
            } catch (Exception ignored) {
                // page absente sur ce téléphone : on essaie la suivante
            }
        }
    }
}
