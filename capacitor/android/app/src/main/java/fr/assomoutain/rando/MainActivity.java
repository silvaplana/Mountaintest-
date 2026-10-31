package fr.assomoutain.rando;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins maison : à enregistrer avant super.onCreate().
        registerPlugin(EcoLocationPlugin.class);
        registerPlugin(BenchLogPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
