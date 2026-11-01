package fr.assomoutain.proto;

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

    /** what : "avion", "wifi", "donnees" ou "bluetooth". */
    public static void open(Activity activity, String what) {
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
}
