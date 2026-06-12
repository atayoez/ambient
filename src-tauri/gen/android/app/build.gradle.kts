import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "me.oezcan.ambient"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "me.oezcan.ambient"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    // 17 to match compileOptions (javac/kotlinc must agree). Kotlin 2.4
    // removed the kotlinOptions DSL and the 1.8 target the template
    // shipped, hence compilerOptions here instead.
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

rust {
    rootDirRel = "../../../"
}

// rustls-platform-verifier (TLS trust for ambient-core's reqwest on
// Android) is split: the Rust crate calls a bundled Kotlin component
// at runtime, and that AAR ships INSIDE the cargo registry checkout of
// rustls-platform-verifier-android. Locate it via cargo metadata so
// crate bumps keep the two halves in lockstep automatically.
// Returns (local maven repo dir, version). The bundled repo carries no
// maven-metadata.xml, so the version is pinned from the crate dir name
// rather than a `latest.release` dynamic lookup.
fun rustlsPlatformVerifierAndroid(): Pair<String, String> {
    val json = providers.exec {
        workingDir = file("../../..") // src-tauri — owns the dependency
        commandLine(
            "cargo", "metadata", "--format-version", "1",
            "--filter-platform", "aarch64-linux-android",
        )
    }.standardOutput.asText.get()
    val manifest =
        Regex(""""manifest_path"\s*:\s*"([^"]*rustls-platform-verifier-android-([0-9.]+)[^"]*)"""")
            .find(json)
            ?: error("rustls-platform-verifier-android missing from cargo metadata")
    val mavenDir = File(File(manifest.groupValues[1]).parentFile, "maven").path
    return mavenDir to manifest.groupValues[2]
}

val rustlsPvAndroid = rustlsPlatformVerifierAndroid()

repositories {
    maven {
        url = uri(rustlsPvAndroid.first)
        metadataSources { artifact() }
    }
}

dependencies {
    // @aar: with artifact-only metadata Gradle would otherwise probe
    // for a .jar; the bundled artifact is an Android library.
    implementation("rustls:rustls-platform-verifier:${rustlsPvAndroid.second}@aar")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")