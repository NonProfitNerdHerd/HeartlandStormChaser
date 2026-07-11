plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val gpsApiBaseUrl = (project.findProperty("GPS_API_BASE_URL") as String?)?.trim().orEmpty().ifBlank {
    "https://heartlandstormchaser.ike-j-rebout.workers.dev"
}

android {
    namespace = "com.heartlandstormchaser.gps"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.heartlandstormchaser.gps"
        minSdk = 26
        targetSdk = 34
        versionCode = 9
        versionName = "0.7.1"
        buildConfigField("String", "DEFAULT_API_BASE_URL", "\"$gpsApiBaseUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
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
        buildConfig = true
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.fragment:fragment-ktx:1.8.2")
    implementation("androidx.viewpager2:viewpager2:1.1.0")
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.coordinatorlayout:coordinatorlayout:1.2.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
