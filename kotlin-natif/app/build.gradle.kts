plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "fr.assomoutain.proto"
    compileSdk = 35

    defaultConfig {
        applicationId = "fr.assomoutain.proto.kotlin"
        minSdk = 26
        targetSdk = 35
        // Numéro de build GitHub Actions (-PversionCode=…) : sert à détecter les mises à jour (Updater.java).
        versionCode = (project.findProperty("versionCode") as String?)?.toInt() ?: 1
        versionName = "0.1.$versionCode"
        // Mot de passe du relais IA intégré par la CI (secret IA_MOT_DE_PASSE) : rien à taper dans l'appli.
        val iaMdp = (System.getenv("IA_MOT_DE_PASSE") ?: "").replace("\\", "\\\\").replace("\"", "\\\"")
        buildConfigField("String", "IA_MOT_DE_PASSE", "\"$iaMdp\"")
        buildConfigField("String", "IGN_SCAN_KEY", "\"${project.findProperty("ignScanKey") ?: "ign_scan_ws"}\"")
    }

    // Clé fixe d'une version à l'autre (sinon Android refuse la mise à jour), voir signing/README.md.
    // Sans clé (build local), signature debug.
    val storePath = System.getenv("SIGNING_STORE")
    signingConfigs {
        if (storePath != null) create("proto") {
            storeFile = file(storePath)
            storePassword = System.getenv("SIGNING_PASSWORD")
            keyAlias = "proto"
            keyPassword = System.getenv("SIGNING_PASSWORD")
            storeType = "pkcs12"
        }
    }

    buildTypes {
        release {
            // Même réglage que le prototype Capacitor pour comparer la taille d'APK :
            // minification R8 activée.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName(if (storePath != null) "proto" else "debug")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("org.maplibre.gl:android-sdk:13.7.1")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.work:work-runtime:2.10.1")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
