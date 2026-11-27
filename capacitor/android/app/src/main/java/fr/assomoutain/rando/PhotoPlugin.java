package fr.assomoutain.rando;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Photo.open() ouvre l'application Appareil photo (PhotoCapture). Les photos restent dans la galerie du téléphone ;
 * on les dépose ensuite dans une sortie depuis son album (Seb, 27/11 : l'appli ne lit plus la galerie, ce que le
 * Play Store refuse).
 */
@CapacitorPlugin(name = "Photo")
public class PhotoPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        if (PhotoCapture.open(getActivity())) call.resolve();
        else call.reject("Pas d'appareil photo disponible");
    }
}
