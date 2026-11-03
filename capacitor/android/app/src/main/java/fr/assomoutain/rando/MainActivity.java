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
        super.onCreate(savedInstanceState);
        // Propose les nouvelles versions publiées par GitHub Actions (et notifie en arrière-plan).
        Updater.init(this, "capacitor");
        // Mode poche : écran noir dans la poche, rallumage à plat ou par deux secousses.
        PocketMode.init(this);
    }
}
