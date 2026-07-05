package com.heartlandstormchaser.gps

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

data class PairResult(
    val success: Boolean,
    val deviceId: String? = null,
    val deviceName: String? = null,
    val deviceToken: String? = null,
    val error: String? = null,
)

data class UploadResult(
    val success: Boolean,
    val receivedAtUtc: String? = null,
    val error: String? = null,
)

data class PlatformResult(
    val success: Boolean,
    val isThisDevicePlatform: Boolean = false,
    val error: String? = null,
)

data class PlatformWeather(
    val temperatureF: Double?,
    val conditions: String?,
    val dewPointF: Double?,
    val humidityPercent: Double?,
    val windSpeedMph: Double?,
    val windDirection: String?,
    val windGustsMph: Double?,
    val observationAt: String?,
)

data class WeatherResult(
    val success: Boolean,
    val weather: PlatformWeather? = null,
    val message: String? = null,
    val error: String? = null,
)

data class OverlaySettings(
    val targetCity: String,
    val targetState: String,
    val tickerText: String,
)

data class OverlaySettingsResult(
    val success: Boolean,
    val settings: OverlaySettings? = null,
    val updatedAt: String? = null,
    val error: String? = null,
)

class GpsApiClient(
    private val serverUrl: String,
    private val deviceToken: String? = null,
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    fun pairDevice(
        pin: String,
        deviceName: String,
        existingDeviceId: String? = null,
    ): PairResult {
        val payload = JSONObject().apply {
            put("pin", pin)
            put("device_name", deviceName)
            if (!existingDeviceId.isNullOrBlank()) {
                put("device_id", existingDeviceId)
            }
        }

        return postJson("/api/gps/pair", payload, auth = false) { json, _ ->
            val deviceId = json.optString("device_id").trim()
            val token = json.optString("device_token").trim()
            val name = json.optString("device_name").trim()

            if (deviceId.isBlank() || token.isBlank()) {
                PairResult(success = false, error = "Pairing response missing device credentials")
            } else {
                PairResult(
                    success = true,
                    deviceId = deviceId,
                    deviceName = name.ifBlank { deviceName },
                    deviceToken = token,
                )
            }
        }
    }

    fun uploadGpsUpdate(
        deviceName: String,
        latitude: Double,
        longitude: Double,
        speedMph: Double?,
        headingDegrees: Double?,
        accuracyMeters: Double?,
        altitudeMeters: Double?,
        batteryPercent: Int?,
        timestampUtc: String,
    ): UploadResult {
        val token = deviceToken?.trim().orEmpty()
        if (token.isBlank()) {
            return UploadResult(success = false, error = "Device token is missing. Re-pair this device.")
        }

        val payload = JSONObject().apply {
            put("device_name", deviceName)
            put("latitude", latitude)
            put("longitude", longitude)
            put("speed_mph", speedMph)
            put("heading_degrees", headingDegrees)
            put("accuracy_meters", accuracyMeters)
            put("altitude_meters", altitudeMeters)
            put("battery_percent", batteryPercent)
            put("timestamp_utc", timestampUtc)
        }

        return postJson("/api/gps/update", payload, auth = true) { json, _ ->
            UploadResult(
                success = true,
                receivedAtUtc = json.optString("received_at_utc").ifBlank { null },
            )
        }
    }

    fun setPlatformSource(deviceId: String): PlatformResult {
        val payload = JSONObject().apply {
            put("device_id", deviceId)
        }

        return postJson("/api/gps/platform", payload, auth = false) { json, _ ->
            val platform = json.optJSONObject("platform_source")
            val activeId = platform?.optString("id").orEmpty()
            PlatformResult(
                success = true,
                isThisDevicePlatform = activeId == deviceId,
            )
        }
    }

    fun fetchPlatformStatus(deviceId: String): PlatformResult {
        return getJson("/api/gps/platform") { json, _ ->
            val platform = json.optJSONObject("platform_source")
            val activeId = platform?.optString("id").orEmpty()
            PlatformResult(
                success = true,
                isThisDevicePlatform = activeId.isNotBlank() && activeId == deviceId,
            )
        }
    }

    fun fetchPlatformWeather(): WeatherResult {
        return getJson("/api/weather/platform") { json, _ ->
            val weatherJson = json.optJSONObject("weather")
            if (weatherJson == null) {
                WeatherResult(
                    success = true,
                    weather = null,
                    message = json.optString("message").ifBlank { "Weather unavailable" },
                )
            } else {
                WeatherResult(
                    success = true,
                    weather = PlatformWeather(
                        temperatureF = weatherJson.optNullableDouble("temperature_f"),
                        conditions = weatherJson.optString("conditions").ifBlank { null },
                        dewPointF = weatherJson.optNullableDouble("dew_point_f"),
                        humidityPercent = weatherJson.optNullableDouble("humidity_percent"),
                        windSpeedMph = weatherJson.optNullableDouble("wind_speed_mph"),
                        windDirection = weatherJson.optString("wind_direction").ifBlank { null },
                        windGustsMph = weatherJson.optNullableDouble("wind_gusts_mph"),
                        observationAt = weatherJson.optString("observation_at")
                            .ifBlank { weatherJson.optString("fetched_at").ifBlank { null } },
                    ),
                )
            }
        }
    }

    fun fetchOverlaySettings(): OverlaySettingsResult {
        return getJson("/api/overlay/settings") { json, _ ->
            parseOverlaySettingsResult(json)
        }
    }

    fun updateOverlaySettings(
        targetCity: String? = null,
        targetState: String? = null,
        tickerText: String? = null,
    ): OverlaySettingsResult {
        val payload = JSONObject()
        if (targetCity != null) {
            payload.put("overlay_target_city", targetCity)
        }
        if (targetState != null) {
            payload.put("overlay_target_state", targetState)
        }
        if (tickerText != null) {
            payload.put("overlay_ticker_text", tickerText)
        }

        return putJson("/api/overlay/settings", payload) { json, _ ->
            parseOverlaySettingsResult(json)
        }
    }

    private fun parseOverlaySettingsResult(json: JSONObject): OverlaySettingsResult {
        val settingsJson = json.optJSONObject("settings")
            ?: return OverlaySettingsResult(success = false, error = "Overlay settings missing from response")

        return OverlaySettingsResult(
            success = true,
            settings = OverlaySettings(
                targetCity = settingsJson.optString("overlay_target_city").trim(),
                targetState = settingsJson.optString("overlay_target_state").trim().uppercase(),
                tickerText = settingsJson.optString("overlay_ticker_text").trim(),
            ),
            updatedAt = json.optString("updated_at").ifBlank { null },
        )
    }

    private fun <T> postJson(
        path: String,
        payload: JSONObject,
        auth: Boolean,
        onSuccess: (JSONObject, Int) -> T,
    ): T where T : Any {
        val builder = Request.Builder()
            .url(ApiUrlHelper.apiUrl(serverUrl, path))
            .addHeader("Content-Type", "application/json")
            .post(payload.toString().toRequestBody(JSON_MEDIA_TYPE))

        if (auth) {
            builder.addHeader("Authorization", "Bearer ${deviceToken?.trim().orEmpty()}")
        }

        return execute(builder.build(), onSuccess)
    }

    private fun <T> putJson(
        path: String,
        payload: JSONObject,
        onSuccess: (JSONObject, Int) -> T,
    ): T where T : Any {
        val request = Request.Builder()
            .url(ApiUrlHelper.apiUrl(serverUrl, path))
            .addHeader("Content-Type", "application/json")
            .put(payload.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()

        return execute(request, onSuccess)
    }

    private fun <T> getJson(
        path: String,
        onSuccess: (JSONObject, Int) -> T,
    ): T where T : Any {
        val request = Request.Builder()
            .url(ApiUrlHelper.apiUrl(serverUrl, path))
            .get()
            .build()

        return execute(request, onSuccess)
    }

    private inline fun <T> execute(
        request: Request,
        onSuccess: (JSONObject, Int) -> T,
    ): T where T : Any {
        return try {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                val json = runCatching { JSONObject(body) }.getOrNull()

                if (!response.isSuccessful) {
                    val message = json?.optString("error")?.takeIf { it.isNotBlank() }
                        ?: "Request failed (${response.code})"
                    return failureFor(request, message) as T
                }

                if (json == null || !json.optBoolean("ok", false)) {
                    val message = json?.optString("error") ?: "Invalid server response"
                    return failureFor(request, message) as T
                }

                onSuccess(json, response.code)
            }
        } catch (error: Exception) {
            failureFor(request, error.message ?: "Network error") as T
        }
    }

    private fun failureFor(request: Request, message: String): Any {
        return when {
            request.url.encodedPath.endsWith("/pair") -> PairResult(success = false, error = message)
            request.url.encodedPath.endsWith("/update") -> UploadResult(success = false, error = message)
            request.url.encodedPath.endsWith("/platform") && request.method == "POST" ->
                PlatformResult(success = false, error = message)
            request.url.encodedPath.endsWith("/platform") ->
                PlatformResult(success = false, error = message)
            request.url.encodedPath.endsWith("/weather/platform") ->
                WeatherResult(success = false, error = message)
            request.url.encodedPath.endsWith("/overlay/settings") ->
                OverlaySettingsResult(success = false, error = message)
            else -> PairResult(success = false, error = message)
        }
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

        fun metersPerSecondToMph(speedMetersPerSecond: Float): Double? {
            if (speedMetersPerSecond.isNaN() || speedMetersPerSecond < 0f) {
                return null
            }
            return (speedMetersPerSecond * 2.2369362921).roundToOneDecimal()
        }

        fun nowUtcIso(): String = Instant.now().toString()

        private fun Double.roundToOneDecimal(): Double {
            return (this * 10.0).roundToInt() / 10.0
        }

        private fun JSONObject.optNullableDouble(name: String): Double? {
            if (!has(name) || isNull(name)) {
                return null
            }
            return optDouble(name)
        }
    }
}
