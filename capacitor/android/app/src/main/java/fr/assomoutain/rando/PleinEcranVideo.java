package fr.assomoutain.rando;

import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Plein écran des vidéos (film du survol, album, messages) : le client Capacitor refuse le plein écran
 * (il referme aussitôt la vue). Ici on la pose par-dessus tout, barres du téléphone cachées, et l'écran
 * suit le téléphone (couché pour un film horizontal). Retour ou bouton du lecteur pour sortir.
 */
public class PleinEcranVideo extends BridgeWebChromeClient {
    private final AppCompatActivity activite;
    private View vue;
    private CustomViewCallback rappel;
    private int orientationAvant;
    private final OnBackPressedCallback retour = new OnBackPressedCallback(false) {
        @Override
        public void handleOnBackPressed() { onHideCustomView(); }
    };

    public PleinEcranVideo(Bridge bridge, AppCompatActivity activite) {
        super(bridge);
        this.activite = activite;
        activite.getOnBackPressedDispatcher().addCallback(activite, retour);
    }

    @Override
    public void onShowCustomView(View view, CustomViewCallback callback) {
        if (vue != null) { callback.onCustomViewHidden(); return; }
        vue = view;
        rappel = callback;
        view.setBackgroundColor(Color.BLACK);
        FrameLayout decor = (FrameLayout) activite.getWindow().getDecorView();
        decor.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        WindowInsetsControllerCompat barres = WindowCompat.getInsetsController(activite.getWindow(), decor);
        barres.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        barres.hide(WindowInsetsCompat.Type.systemBars());
        orientationAvant = activite.getRequestedOrientation();
        activite.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);
        retour.setEnabled(true);
    }

    @Override
    public void onHideCustomView() {
        if (vue == null) return;
        FrameLayout decor = (FrameLayout) activite.getWindow().getDecorView();
        decor.removeView(vue);
        WindowCompat.getInsetsController(activite.getWindow(), decor).show(WindowInsetsCompat.Type.systemBars());
        activite.setRequestedOrientation(orientationAvant);
        retour.setEnabled(false);
        CustomViewCallback r = rappel;
        vue = null;
        rappel = null;
        if (r != null) r.onCustomViewHidden();
    }
}
