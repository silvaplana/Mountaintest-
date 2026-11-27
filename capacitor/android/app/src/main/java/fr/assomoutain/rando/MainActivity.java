package fr.assomoutain.rando;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins maison : à enregistrer avant super.onCreate().
        registerPlugin(EcoLocationPlugin.class);
        registerPlugin(BenchLogPlugin.class);
        registerPlugin(BatterySettingsPlugin.class);
        registerPlugin(PocketModePlugin.class);
        registerPlugin(PhotoPlugin.class);
        registerPlugin(WeatherPlugin.class);
        registerPlugin(StorageUsagePlugin.class);
        registerPlugin(TraceFilePlugin.class);
        registerPlugin(PhotosRecuesPlugin.class);
        registerPlugin(TraceWakePlugin.class);
        registerPlugin(TraceSharePlugin.class);
        registerPlugin(BuddiesPlugin.class);
        Saveur.plugins(this);
        super.onCreate(savedInstanceState);
        // ⛶ Plein écran des vidéos (Capacitor le refuse par défaut).
        getBridge().getWebView().setWebChromeClient(new PleinEcranVideo(getBridge(), this));
        // APK : mise à jour par GitHub ; Play Store : rien (Saveur.java de chaque build).
        Saveur.demarrer(this);
        // Mode poche : écran noir dans la poche, rallumage à plat ou par deux secousses.
        PocketMode.init(this);
        // 📞 Ouverte par un appel qui sonne (AppelService) : par-dessus l'écran verrouillé, écran allumé.
        if (getIntent() != null && getIntent().hasExtra("appel") && android.os.Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
    }
}
