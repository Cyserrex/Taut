plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.cyserrex.taut"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.cyserrex.taut"
        // Android 8.0: batas termudah agar ikon adaptif cukup satu berkas,
        // dan sudah mencakup hampir semua HP yang beredar.
        minSdk = 26
        targetSdk = 34
        versionCode = 10
        versionName = "1.4.1"
    }

    signingConfigs {
        create("release") {
            storeFile = file(providers.gradleProperty("TAUT_STORE_FILE").get())
            storePassword = providers.gradleProperty("TAUT_STORE_PASSWORD").get()
            keyAlias = providers.gradleProperty("TAUT_KEY_ALIAS").get()
            keyPassword = providers.gradleProperty("TAUT_KEY_PASSWORD").get()
        }
    }

    buildTypes {
        release {
            // Taut kecil dan seluruhnya berjalan di jaringan lokal; menyusutkan
            // kode hanya menambah risiko tanpa keuntungan berarti.
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
}
