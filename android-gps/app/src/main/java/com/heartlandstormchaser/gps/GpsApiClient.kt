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

data class GeocodeSuggestionsResult(
    val success: Boolean,
    val suggestions: List<CitySuggestion> = emptyList(),
    val error: String? = null,
)

data class WarningAlert(
    val id: String,
    val event: String,
    val severity: String,
    val urgency: String,
    val headline: String,
    val description: String,
    val instruction: String?,
    val areaDesc: String,
    val areaLabel: String,
    val senderName: String,
    val sent: String,
    val effective: String,
    val expires: String,
    val ends: String?,
    val distanceMiles: Double,
    val color: String,
)

data class WarningsSettings(
    val pollIntervalSeconds: Int,
    val radiusMiles: Int,
    val eventFilters: Map<String, Boolean>,
    val fetchedAt: String?,
    val cachedAlertCount: Int,
)

data class WarningsSettingsResult(
    val success: Boolean,
    val settings: WarningsSettings? = null,
    val error: String? = null,
)

data class PlatformWarningsResult(
    val success: Boolean,
    val alerts: List<WarningAlert> = emptyList(),
    val message: String? = null,
    val fetchedAt: String? = null,
    val settings: WarningsSettings? = null,
    val error: String? = null,
)

data class ChaseSummary(
    val id: String,
    val deviceId: String,
    val chaseName: String,
    val status: String,
    val startTime: String,
    val endTime: String?,
    val startLat: Double?,
    val startLng: Double?,
    val endLat: Double?,
    val endLng: Double?,
    val totalDistanceMiles: Double,
    val totalExpenses: Double,
    val notes: String,
    val createdAt: String,
    val updatedAt: String,
)

data class ChaseExpense(
    val id: String,
    val chaseId: String,
    val category: String,
    val amount: Double,
    val description: String,
    val expenseTime: String,
    val createdAt: String,
    val updatedAt: String,
)

data class ChaseGpsPoint(
    val lat: Double,
    val lng: Double,
    val accuracy: Double?,
    val speed: Double?,
    val heading: Double?,
    val altitude: Double?,
    val recordedAt: String,
)

data class ChaseDetail(
    val chase: ChaseSummary,
    val points: List<ChaseGpsPoint>,
    val expenses: List<ChaseExpense>,
    val expenseBreakdown: Map<String, Double>,
)

data class ChaseResult(
    val success: Boolean,
    val chase: ChaseSummary? = null,
    val error: String? = null,
)

data class ChaseListResult(
    val success: Boolean,
    val chases: List<ChaseSummary> = emptyList(),
    val error: String? = null,
)

data class ChaseDetailResult(
    val success: Boolean,
    val detail: ChaseDetail? = null,
    val error: String? = null,
)

data class ChaseExpenseResult(
    val success: Boolean,
    val expense: ChaseExpense? = null,
    val error: String? = null,
)

data class ChasePointsSyncResult(
    val success: Boolean,
    val recordedCount: Int = 0,
    val error: String? = null,
)

data class ChaseVoidResult(
    val success: Boolean,
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

    fun fetchGeocodeSuggestions(query: String): GeocodeSuggestionsResult {
        val trimmed = query.trim()
        if (trimmed.length < 2) {
            return GeocodeSuggestionsResult(success = true, suggestions = emptyList())
        }

        val encoded = java.net.URLEncoder.encode(trimmed, Charsets.UTF_8.name())
        return getJson("/api/geocode/suggest?q=$encoded") { json, _ ->
            val suggestions = json.optJSONArray("suggestions").toCitySuggestions()
            GeocodeSuggestionsResult(success = true, suggestions = suggestions)
        }
    }

    fun fetchWarningsSettings(): WarningsSettingsResult {
        return getJson("/api/warnings/settings") { json, _ ->
            parseWarningsSettingsResult(json)
        }
    }

    fun updateWarningsSettings(
        radiusMiles: Int? = null,
        eventFilters: Map<String, Boolean>? = null,
        pollIntervalSeconds: Int? = null,
    ): WarningsSettingsResult {
        val payload = JSONObject()
        radiusMiles?.let { payload.put("radius_miles", it) }
        pollIntervalSeconds?.let { payload.put("poll_interval_seconds", it) }
        eventFilters?.let { filters ->
            val filtersJson = JSONObject()
            filters.forEach { (event, enabled) ->
                filtersJson.put(event, enabled)
            }
            payload.put("event_filters", filtersJson)
        }

        return putJson("/api/warnings/settings", payload) { json, _ ->
            parseWarningsSettingsResult(json)
        }
    }

    fun fetchPlatformWarnings(force: Boolean = false): PlatformWarningsResult {
        val path = if (force) {
            "/api/warnings/platform?force=1"
        } else {
            "/api/warnings/platform"
        }

        return getJson(path) { json, _ ->
            val alerts = json.optJSONArray("alerts").toWarningAlerts()
            PlatformWarningsResult(
                success = true,
                alerts = alerts,
                message = json.optString("message").ifBlank { null },
                fetchedAt = json.optString("fetched_at").ifBlank { null },
                settings = json.optJSONObject("settings")?.let { parseWarningsSettings(it) },
            )
        }
    }

    fun fetchActiveChase(): ChaseResult {
        return getJson("/api/chases/active", auth = true) { json, _ ->
            val chaseJson = json.optJSONObject("chase")
            ChaseResult(
                success = true,
                chase = chaseJson?.let { parseChaseSummary(it) },
            )
        }
    }

    fun fetchAllChases(): ChaseListResult {
        return getJson("/api/chases") { json, _ ->
            ChaseListResult(
                success = true,
                chases = json.optJSONArray("chases").toChaseSummaries(),
            )
        }
    }

    fun fetchChaseDetail(chaseId: String): ChaseDetailResult {
        return getJson("/api/chases/$chaseId") { json, _ ->
            val chaseJson = json.optJSONObject("chase")
                ?: return@getJson ChaseDetailResult(success = false, error = "Chase missing from response")

            ChaseDetailResult(
                success = true,
                detail = ChaseDetail(
                    chase = parseChaseSummary(chaseJson),
                    points = json.optJSONArray("points").toChaseGpsPoints(),
                    expenses = json.optJSONArray("expenses").toChaseExpenses(chaseId),
                    expenseBreakdown = json.optJSONObject("expense_breakdown").toExpenseBreakdown(),
                ),
            )
        }
    }

    fun createChase(name: String, notes: String? = null): ChaseResult {
        val payload = JSONObject().apply {
            put("chase_name", name.trim())
            if (!notes.isNullOrBlank()) {
                put("notes", notes.trim())
            }
        }

        return postJson("/api/chases", payload, auth = true) { json, _ ->
            val chaseJson = json.optJSONObject("chase")
                ?: return@postJson ChaseResult(success = false, error = "Chase missing from response")
            ChaseResult(success = true, chase = parseChaseSummary(chaseJson))
        }
    }

    fun updateChase(
        chaseId: String,
        chaseName: String? = null,
        notes: String? = null,
        status: String? = null,
    ): ChaseResult {
        val payload = JSONObject()
        chaseName?.let { payload.put("chase_name", it.trim()) }
        notes?.let { payload.put("notes", it.trim()) }
        status?.let { payload.put("status", it) }

        return putJson("/api/chases/$chaseId", payload) { json, _ ->
            val chaseJson = json.optJSONObject("chase")
                ?: return@putJson ChaseResult(success = false, error = "Chase missing from response")
            ChaseResult(success = true, chase = parseChaseSummary(chaseJson))
        }
    }

    fun completeChase(chaseId: String): ChaseResult {
        return postJson("/api/chases/$chaseId/complete", JSONObject(), auth = true) { json, _ ->
            val chaseJson = json.optJSONObject("chase")
                ?: return@postJson ChaseResult(success = false, error = "Chase missing from response")
            ChaseResult(success = true, chase = parseChaseSummary(chaseJson))
        }
    }

    fun addExpense(
        chaseId: String,
        category: String,
        amount: Double,
        description: String? = null,
        expenseTime: String? = null,
    ): ChaseExpenseResult {
        val payload = JSONObject().apply {
            put("category", category)
            put("amount", amount)
            put("description", description?.trim().orEmpty())
            if (!expenseTime.isNullOrBlank()) {
                put("expense_time", expenseTime)
            }
        }

        return postJson("/api/chases/$chaseId/expenses", payload, auth = false) { json, _ ->
            val expenseJson = json.optJSONObject("expense")
                ?: return@postJson ChaseExpenseResult(success = false, error = "Expense missing from response")
            ChaseExpenseResult(success = true, expense = parseChaseExpense(expenseJson))
        }
    }

    fun updateExpense(
        chaseId: String,
        expenseId: String,
        category: String? = null,
        amount: Double? = null,
        description: String? = null,
        expenseTime: String? = null,
    ): ChaseExpenseResult {
        val payload = JSONObject()
        category?.let { payload.put("category", it) }
        amount?.let { payload.put("amount", it) }
        description?.let { payload.put("description", it.trim()) }
        expenseTime?.let { payload.put("expense_time", it) }

        return putJson("/api/chases/$chaseId/expenses/$expenseId", payload) { json, _ ->
            val expenseJson = json.optJSONObject("expense")
                ?: return@putJson ChaseExpenseResult(success = false, error = "Expense missing from response")
            ChaseExpenseResult(success = true, expense = parseChaseExpense(expenseJson))
        }
    }

    fun deleteExpense(chaseId: String, expenseId: String): ChaseVoidResult {
        return deleteJson("/api/chases/$chaseId/expenses/$expenseId") { _, _ ->
            ChaseVoidResult(success = true)
        }
    }

    fun syncChasePointsBatch(chaseId: String, points: List<ChaseGpsPoint>): ChasePointsSyncResult {
        val pointsArray = org.json.JSONArray()
        points.forEach { point ->
            pointsArray.put(
                JSONObject().apply {
                    put("lat", point.lat)
                    put("lng", point.lng)
                    put("accuracy", point.accuracy)
                    put("speed", point.speed)
                    put("heading", point.heading)
                    put("altitude", point.altitude)
                    put("recorded_at", point.recordedAt)
                },
            )
        }

        val payload = JSONObject().apply {
            put("points", pointsArray)
        }

        return postJson("/api/chases/$chaseId/points/batch", payload, auth = true) { json, _ ->
            ChasePointsSyncResult(
                success = true,
                recordedCount = json.optInt("recorded_count", 0),
            )
        }
    }

    private fun parseChaseSummary(json: JSONObject): ChaseSummary {
        return ChaseSummary(
            id = json.optString("id"),
            deviceId = json.optString("device_id"),
            chaseName = json.optString("chase_name"),
            status = json.optString("status"),
            startTime = json.optString("start_time"),
            endTime = json.optString("end_time").ifBlank { null },
            startLat = json.optNullableDouble("start_lat"),
            startLng = json.optNullableDouble("start_lng"),
            endLat = json.optNullableDouble("end_lat"),
            endLng = json.optNullableDouble("end_lng"),
            totalDistanceMiles = json.optDouble("total_distance_miles"),
            totalExpenses = json.optDouble("total_expenses"),
            notes = json.optString("notes"),
            createdAt = json.optString("created_at"),
            updatedAt = json.optString("updated_at"),
        )
    }

    private fun parseChaseExpense(json: JSONObject): ChaseExpense {
        return ChaseExpense(
            id = json.optString("id"),
            chaseId = json.optString("chase_id"),
            category = json.optString("category"),
            amount = json.optDouble("amount"),
            description = json.optString("description"),
            expenseTime = json.optString("expense_time"),
            createdAt = json.optString("created_at"),
            updatedAt = json.optString("updated_at"),
        )
    }

    private fun org.json.JSONArray?.toCitySuggestions(): List<CitySuggestion> {
        if (this == null) {
            return emptyList()
        }

        return buildList {
            for (index in 0 until length()) {
                val item = optJSONObject(index) ?: continue
                val city = item.optString("city").trim()
                val state = item.optString("state").trim()
                if (city.isBlank() || state.isBlank()) {
                    continue
                }
                add(CitySuggestion(city, state))
            }
        }
    }

    private fun org.json.JSONArray?.toChaseSummaries(): List<ChaseSummary> {
        if (this == null) {
            return emptyList()
        }

        return buildList {
            for (index in 0 until length()) {
                val item = optJSONObject(index) ?: continue
                add(parseChaseSummary(item))
            }
        }
    }

    private fun org.json.JSONArray?.toChaseGpsPoints(): List<ChaseGpsPoint> {
        if (this == null) {
            return emptyList()
        }

        return buildList {
            for (index in 0 until length()) {
                val item = optJSONObject(index) ?: continue
                add(
                    ChaseGpsPoint(
                        lat = item.optDouble("lat"),
                        lng = item.optDouble("lng"),
                        accuracy = item.optNullableDouble("accuracy"),
                        speed = item.optNullableDouble("speed"),
                        heading = item.optNullableDouble("heading"),
                        altitude = item.optNullableDouble("altitude"),
                        recordedAt = item.optString("recorded_at"),
                    ),
                )
            }
        }
    }

    private fun org.json.JSONArray?.toChaseExpenses(defaultChaseId: String): List<ChaseExpense> {
        if (this == null) {
            return emptyList()
        }

        return buildList {
            for (index in 0 until length()) {
                val item = optJSONObject(index) ?: continue
                val expense = parseChaseExpense(item)
                add(
                    if (expense.chaseId.isBlank()) {
                        expense.copy(chaseId = defaultChaseId)
                    } else {
                        expense
                    },
                )
            }
        }
    }

    private fun JSONObject?.toExpenseBreakdown(): Map<String, Double> {
        if (this == null) {
            return emptyMap()
        }

        return buildMap {
            keys().forEach { key ->
                put(key, optDouble(key))
            }
        }
    }

    private fun parseWarningsSettingsResult(json: JSONObject): WarningsSettingsResult {
        val settingsJson = json.optJSONObject("settings")
            ?: return WarningsSettingsResult(success = false, error = "Warnings settings missing from response")

        return WarningsSettingsResult(
            success = true,
            settings = parseWarningsSettings(settingsJson),
        )
    }

    private fun parseWarningsSettings(json: JSONObject): WarningsSettings {
        val filtersJson = json.optJSONObject("event_filters")
        val filters = mutableMapOf<String, Boolean>()
        if (filtersJson != null) {
            filtersJson.keys().forEach { key ->
                filters[key] = filtersJson.optBoolean(key, true)
            }
        }

        return WarningsSettings(
            pollIntervalSeconds = json.optInt("poll_interval_seconds", 3600),
            radiusMiles = json.optInt("radius_miles", 700),
            eventFilters = filters,
            fetchedAt = json.optString("fetched_at").ifBlank { null },
            cachedAlertCount = json.optInt("cached_alert_count", 0),
        )
    }

    private fun org.json.JSONArray?.toWarningAlerts(): List<WarningAlert> {
        if (this == null) {
            return emptyList()
        }

        return buildList {
            for (index in 0 until length()) {
                val item = optJSONObject(index) ?: continue
                add(
                    WarningAlert(
                        id = item.optString("id"),
                        event = item.optString("event"),
                        severity = item.optString("severity"),
                        urgency = item.optString("urgency"),
                        headline = item.optString("headline"),
                        description = item.optString("description"),
                        instruction = item.optString("instruction").ifBlank { null },
                        areaDesc = item.optString("area_desc"),
                        areaLabel = item.optString("area_label"),
                        senderName = item.optString("sender_name"),
                        sent = item.optString("sent"),
                        effective = item.optString("effective"),
                        expires = item.optString("expires"),
                        ends = item.optString("ends").ifBlank { null },
                        distanceMiles = item.optDouble("distance_miles"),
                        color = item.optString("color").ifBlank { "#ff8c00" },
                    ),
                )
            }
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

    private fun Request.Builder.withOptionalDeviceAuth(path: String): Request.Builder {
        if (!path.endsWith("/gps/pair")) {
            val token = deviceToken?.trim().orEmpty()
            if (token.isNotEmpty()) {
                addHeader("Authorization", "Bearer $token")
            }
        }
        return this
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
            .withOptionalDeviceAuth(path)

        if (auth) {
            builder.addHeader("Authorization", "Bearer ${deviceToken?.trim().orEmpty()}")
        }

        return execute(builder.build(), onSuccess)
    }

    private fun <T> putJson(
        path: String,
        payload: JSONObject,
        auth: Boolean = false,
        onSuccess: (JSONObject, Int) -> T,
    ): T where T : Any {
        val builder = Request.Builder()
            .url(ApiUrlHelper.apiUrl(serverUrl, path))
            .addHeader("Content-Type", "application/json")
            .put(payload.toString().toRequestBody(JSON_MEDIA_TYPE))
            .withOptionalDeviceAuth(path)

        if (auth) {
            builder.addHeader("Authorization", "Bearer ${deviceToken?.trim().orEmpty()}")
        }

        return execute(builder.build(), onSuccess)
    }

    private fun <T> getJson(
        path: String,
        auth: Boolean = false,
        onSuccess: (JSONObject, Int) -> T,
    ): T where T : Any {
        val builder = Request.Builder()
            .url(ApiUrlHelper.apiUrl(serverUrl, path))
            .get()
            .withOptionalDeviceAuth(path)

        if (auth) {
            builder.addHeader("Authorization", "Bearer ${deviceToken?.trim().orEmpty()}")
        }

        return execute(builder.build(), onSuccess)
    }

    private fun <T> deleteJson(
        path: String,
        onSuccess: (JSONObject, Int) -> T,
    ): T where T : Any {
        val request = Request.Builder()
            .url(ApiUrlHelper.apiUrl(serverUrl, path))
            .delete()
            .withOptionalDeviceAuth(path)
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
            request.url.encodedPath.endsWith("/warnings/settings") ->
                WarningsSettingsResult(success = false, error = message)
            request.url.encodedPath.contains("/warnings/platform") ->
                PlatformWarningsResult(success = false, error = message)
            request.url.encodedPath.endsWith("/chases/active") ->
                ChaseResult(success = false, error = message)
            request.url.encodedPath.endsWith("/chases") && request.method == "GET" ->
                ChaseListResult(success = false, error = message)
            request.url.encodedPath.endsWith("/chases") && request.method == "POST" ->
                ChaseResult(success = false, error = message)
            request.url.encodedPath.contains("/points/batch") ->
                ChasePointsSyncResult(success = false, error = message)
            request.url.encodedPath.contains("/complete") ->
                ChaseResult(success = false, error = message)
            request.url.encodedPath.contains("/expenses") && request.method == "DELETE" ->
                ChaseVoidResult(success = false, error = message)
            request.url.encodedPath.contains("/expenses") ->
                ChaseExpenseResult(success = false, error = message)
            request.url.encodedPath.contains("/chases/") && request.method == "GET" ->
                ChaseDetailResult(success = false, error = message)
            request.url.encodedPath.contains("/chases/") && request.method == "PUT" ->
                ChaseResult(success = false, error = message)
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
