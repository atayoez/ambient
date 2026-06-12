buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        // Bumped from the tauri template's 8.11.0 / 1.9.25: the Gradle
        // 9.5 wrapper (required to run the daemon on the system's Java
        // 26) needs KGP 2.x, and AGP 8.13 is the newest classic-wiring
        // line that supports Gradle 9. AGP 9 (built-in Kotlin) is a
        // separate migration. Keep in sync with buildSrc/build.gradle.kts.
        //
        // Kotlin is pinned to 2.2.x: KGP 2.3+ promotes the legacy
        // kotlinOptions DSL to a hard error, and tauri's vendored
        // :tauri-android Gradle script (cargo registry, tauri 2.11)
        // still uses it — 2.2 is the newest line where that's only a
        // warning. Bump once a tauri release ships compilerOptions there.
        classpath("com.android.tools.build:gradle:8.13.2")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.21")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

tasks.register("clean").configure {
    delete("build")
}

