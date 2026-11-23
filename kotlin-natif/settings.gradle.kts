pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // 📞 LiveKit (appels) dépend d'audioswitch, publié seulement sur JitPack.
        maven { url = uri("https://jitpack.io"); content { includeGroup("com.github.davidliu") } }
    }
}
rootProject.name = "assomoutain-kotlin"
include(":app")
