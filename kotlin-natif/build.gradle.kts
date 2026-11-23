plugins {
    id("com.android.application") version "8.10.1" apply false
    id("org.jetbrains.kotlin.android") version "2.1.21" apply false
    // 📞 Sonnerie des appels (Firebase) : appliqué par app/ seulement si app/google-services.json est là.
    id("com.google.gms.google-services") version "4.4.4" apply false
}
