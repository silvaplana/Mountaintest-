import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'fr.assomoutain.rando',
  appName: 'Assomoutain Rando',
  webDir: 'dist',
  android: {
    // Pas de contenu mixte : toutes les tuiles passent par HTTPS ou par le stockage local.
    allowMixedContent: false,
  },
};

export default config;
