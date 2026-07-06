package com.heartlandstormchaser.gps

import android.content.Context
import android.os.BatteryManager

class GpsPreferences(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val appContext = context.applicationContext

    var serverUrl: String
        get() {
            val stored = prefs.getString(KEY_SERVER_URL, null)
            val raw = stored?.trim().takeUnless { it.isNullOrEmpty() }
                ?: BuildConfig.DEFAULT_API_BASE_URL.ifBlank { DEFAULT_SERVER_URL }
            return ApiUrlHelper.normalizeServerUrl(raw)
        }
        set(value) {
            prefs.edit()
                .putString(KEY_SERVER_URL, ApiUrlHelper.normalizeServerUrl(value))
                .apply()
        }

    var pin: String
        get() = prefs.getString(KEY_PIN, "").orEmpty()
        set(value) {
            prefs.edit().putString(KEY_PIN, value.trim()).apply()
        }

    var deviceName: String
        get() = prefs.getString(KEY_DEVICE_NAME, "").orEmpty()
        set(value) {
            prefs.edit().putString(KEY_DEVICE_NAME, value.trim()).apply()
        }

    var deviceId: String
        get() = prefs.getString(KEY_DEVICE_ID, "").orEmpty()
        set(value) {
            prefs.edit().putString(KEY_DEVICE_ID, value.trim()).apply()
        }

    var deviceToken: String
        get() = prefs.getString(KEY_DEVICE_TOKEN, "").orEmpty()
        set(value) {
            prefs.edit().putString(KEY_DEVICE_TOKEN, value.trim()).apply()
        }

    var broadcasting: Boolean
        get() = prefs.getBoolean(KEY_BROADCASTING, false)
        set(value) {
            prefs.edit().putBoolean(KEY_BROADCASTING, value).apply()
        }

    var isPlatformSource: Boolean
        get() = prefs.getBoolean(KEY_IS_PLATFORM_SOURCE, false)
        set(value) {
            prefs.edit().putBoolean(KEY_IS_PLATFORM_SOURCE, value).apply()
        }

    var lastLatitude: Double?
        get() = prefs.getString(KEY_LAST_LATITUDE, null)?.toDoubleOrNull()
        set(value) = putNullableDouble(KEY_LAST_LATITUDE, value)

    var lastLongitude: Double?
        get() = prefs.getString(KEY_LAST_LONGITUDE, null)?.toDoubleOrNull()
        set(value) = putNullableDouble(KEY_LAST_LONGITUDE, value)

    var lastSpeedMph: Double?
        get() = prefs.getString(KEY_LAST_SPEED_MPH, null)?.toDoubleOrNull()
        set(value) = putNullableDouble(KEY_LAST_SPEED_MPH, value)

    var lastHeadingDegrees: Double?
        get() = prefs.getString(KEY_LAST_HEADING_DEGREES, null)?.toDoubleOrNull()
        set(value) = putNullableDouble(KEY_LAST_HEADING_DEGREES, value)

    var lastAccuracyMeters: Double?
        get() = prefs.getString(KEY_LAST_ACCURACY_METERS, null)?.toDoubleOrNull()
        set(value) = putNullableDouble(KEY_LAST_ACCURACY_METERS, value)

    var lastAltitudeMeters: Double?
        get() = prefs.getString(KEY_LAST_ALTITUDE_METERS, null)?.toDoubleOrNull()
        set(value) = putNullableDouble(KEY_LAST_ALTITUDE_METERS, value)

    var lastBatteryPercent: Int?
        get() = if (prefs.contains(KEY_LAST_BATTERY_PERCENT)) {
            prefs.getInt(KEY_LAST_BATTERY_PERCENT, -1).takeIf { it >= 0 }
        } else {
            null
        }
        set(value) {
            prefs.edit().apply {
                if (value == null) {
                    remove(KEY_LAST_BATTERY_PERCENT)
                } else {
                    putInt(KEY_LAST_BATTERY_PERCENT, value)
                }
            }.apply()
        }

    var lastSentAtMillis: Long
        get() = prefs.getLong(KEY_LAST_SENT_AT, 0L)
        set(value) {
            prefs.edit().putLong(KEY_LAST_SENT_AT, value).apply()
        }

    var lastUploadSuccess: Boolean
        get() = prefs.getBoolean(KEY_LAST_UPLOAD_SUCCESS, false)
        set(value) {
            prefs.edit().putBoolean(KEY_LAST_UPLOAD_SUCCESS, value).apply()
        }

    var lastUploadError: String?
        get() = prefs.getString(KEY_LAST_UPLOAD_ERROR, null)
        set(value) {
            prefs.edit().apply {
                if (value.isNullOrBlank()) {
                    remove(KEY_LAST_UPLOAD_ERROR)
                } else {
                    putString(KEY_LAST_UPLOAD_ERROR, value)
                }
            }.apply()
        }

    val isPaired: Boolean
        get() = deviceId.isNotBlank() && deviceToken.isNotBlank() && deviceName.isNotBlank()

    fun currentBatteryPercent(): Int? {
        val manager = appContext.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
            ?: return null
        val level = manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return level.takeIf { it in 0..100 }
    }

    fun savePairingResult(
        serverUrl: String,
        pin: String,
        deviceName: String,
        deviceId: String,
        deviceToken: String,
    ) {
        prefs.edit()
            .putString(KEY_SERVER_URL, ApiUrlHelper.normalizeServerUrl(serverUrl))
            .putString(KEY_PIN, pin.trim())
            .putString(KEY_DEVICE_NAME, deviceName.trim())
            .putString(KEY_DEVICE_ID, deviceId.trim())
            .putString(KEY_DEVICE_TOKEN, deviceToken.trim())
            .apply()
    }

    fun clearPairing() {
        prefs.edit()
            .remove(KEY_DEVICE_ID)
            .remove(KEY_DEVICE_TOKEN)
            .remove(KEY_IS_PLATFORM_SOURCE)
            .apply()
    }

    var overlayTargetCity: String
        get() = prefs.getString(KEY_OVERLAY_TARGET_CITY, "").orEmpty()
        set(value) {
            prefs.edit().putString(KEY_OVERLAY_TARGET_CITY, value.trim()).apply()
        }

    var overlayTargetState: String
        get() = prefs.getString(KEY_OVERLAY_TARGET_STATE, "").orEmpty()
        set(value) {
            prefs.edit().putString(KEY_OVERLAY_TARGET_STATE, value.trim().uppercase()).apply()
        }

    fun saveOverlayTarget(city: String, state: String) {
        overlayTargetCity = city
        overlayTargetState = state
    }

    fun cachedOverlayTarget(): CitySuggestion? {
        val city = overlayTargetCity
        val state = overlayTargetState
        if (city.isBlank() || state.isBlank()) {
            return null
        }
        return CitySuggestion(city, state)
    }

    fun isWarningSoundEnabled(event: String): Boolean {
        if (!WarningDefinitions.hasSound(event)) {
            return false
        }
        return prefs.getBoolean(soundKey(event), true)
    }

    fun setWarningSoundEnabled(event: String, enabled: Boolean) {
        if (!WarningDefinitions.hasSound(event)) {
            return
        }
        prefs.edit().putBoolean(soundKey(event), enabled).apply()
    }

    fun allWarningSoundSettings(): Map<String, Boolean> {
        return WarningDefinitions.SOUND_EVENT_TYPES.associateWith { isWarningSoundEnabled(it) }
    }

    fun saveWarningSoundSettings(settings: Map<String, Boolean>) {
        val editor = prefs.edit()
        settings.forEach { (event, enabled) ->
            if (WarningDefinitions.hasSound(event)) {
                editor.putBoolean(soundKey(event), enabled)
            }
        }
        editor.apply()
    }

    private fun soundKey(event: String): String = "warning_sound_${event.lowercase().replace(" ", "_")}"

    private fun putNullableDouble(key: String, value: Double?) {
        prefs.edit().apply {
            if (value == null) {
                remove(key)
            } else {
                putString(key, value.toString())
            }
        }.apply()
    }

    companion object {
        private const val PREFS_NAME = "heartland_gps_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_PIN = "pin"
        private const val KEY_DEVICE_NAME = "device_name"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_BROADCASTING = "broadcasting"
        private const val KEY_IS_PLATFORM_SOURCE = "is_platform_source"
        private const val KEY_LAST_LATITUDE = "last_latitude"
        private const val KEY_LAST_LONGITUDE = "last_longitude"
        private const val KEY_LAST_SPEED_MPH = "last_speed_mph"
        private const val KEY_LAST_HEADING_DEGREES = "last_heading_degrees"
        private const val KEY_LAST_ACCURACY_METERS = "last_accuracy_meters"
        private const val KEY_LAST_ALTITUDE_METERS = "last_altitude_meters"
        private const val KEY_LAST_BATTERY_PERCENT = "last_battery_percent"
        private const val KEY_LAST_SENT_AT = "last_sent_at"
        private const val KEY_LAST_UPLOAD_SUCCESS = "last_upload_success"
        private const val KEY_LAST_UPLOAD_ERROR = "last_upload_error"
        private const val KEY_OVERLAY_TARGET_CITY = "overlay_target_city"
        private const val KEY_OVERLAY_TARGET_STATE = "overlay_target_state"
        private const val DEFAULT_SERVER_URL = "https://heartlandstormchaser.ike-j-rebout.workers.dev"
    }
}
