package fr.assomoutain.rando;

import com.getcapacitor.BridgeActivity;

/** APK des copains (build « apk ») : mise à jour par les releases GitHub (Updater). */
final class Saveur {
    private Saveur() {}

    static void plugins(BridgeActivity a) {
        a.registerPlugin(UpdaterPlugin.class);
    }

    static void demarrer(BridgeActivity a) {
        // Nouvelles versions publiées par GitHub Actions : notification en arrière-plan ; appli ouverte, bandeau (miseAJour.ts).
        Updater.init(a, "capacitor");
    }
}
