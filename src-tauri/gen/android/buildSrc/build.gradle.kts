plugins {
    `kotlin-dsl`
}

gradlePlugin {
    plugins {
        create("pluginsForCoolKids") {
            id = "rust"
            implementationClass = "RustPlugin"
        }
    }
}

repositories {
    google()
    mavenCentral()
}

dependencies {
    compileOnly(gradleApi())
    // Keep in sync with the AGP classpath in ../build.gradle.kts.
    implementation("com.android.tools.build:gradle:8.13.2")
}

