plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * Versi diambil dari package.json, satu-satunya tempat versi Taut dicatat.
 *
 * Sebelumnya ditulis ulang di sini, dan seperti yang sudah bisa diduga ia
 * tertinggal: APK yang dirilis sebagai 1.6.6 masih menyebut dirinya 1.6.2 di
 * daftar aplikasi Android. Nama berkasnya benar karena CI mengambilnya dari
 * package.json — hanya isinya yang tidak.
 */
val tautVersion: String = run {
    val manifest = rootProject.file("../package.json").readText()
    val marker = "\"version\":"
    require(manifest.contains(marker)) { "Tidak menemukan versi di package.json" }
    manifest.substringAfter(marker).substringAfter('"').substringBefore('"')
}

/**
 * Nomor urut yang wajib selalu naik menurut Android. Disusun dari versinya
 * sendiri supaya tidak ada yang perlu diingat: 1.7.0 menjadi 10700.
 */
val tautVersionCode: Int = tautVersion.split(".").let { parts ->
    require(parts.size >= 3) { "Versi tidak berbentuk x.y.z: $tautVersion" }
    parts[0].toInt() * 10000 + parts[1].toInt() * 100 + parts[2].toInt()
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
        versionCode = tautVersionCode
        versionName = tautVersion
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

    // MediaSessionCompat dan notifikasi bergaya media — inilah yang membuat
    // lagu muncul di layar kunci dengan tombolnya sendiri.
    implementation("androidx.media:media:1.7.0")

    // registerForActivityResult untuk meminta izin notifikasi.
    implementation("androidx.activity:activity-ktx:1.9.3")
}
