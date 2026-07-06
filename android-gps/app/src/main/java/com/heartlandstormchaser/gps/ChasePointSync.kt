package com.heartlandstormchaser.gps

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object ChasePointSync {
    fun enqueue(
        context: Context,
        latitude: Double,
        longitude: Double,
        speedMph: Double?,
        headingDegrees: Double?,
        accuracyMeters: Double?,
        altitudeMeters: Double?,
        recordedAt: String,
    ) {
        val preferences = GpsPreferences(context)
        if (!preferences.isChaseTrackingActive) {
            return
        }

        preferences.enqueuePendingChasePoint(
            ChaseGpsPoint(
                lat = latitude,
                lng = longitude,
                accuracy = accuracyMeters,
                speed = speedMph,
                heading = headingDegrees,
                altitude = altitudeMeters,
                recordedAt = recordedAt,
            ),
        )
    }

    suspend fun flushPending(context: Context) {
        val preferences = GpsPreferences(context)
        val chaseId = preferences.activeChaseId ?: return
        val points = preferences.pendingChasePoints()
        if (points.isEmpty()) {
            return
        }

        val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
        val result = withContext(Dispatchers.IO) {
            client.syncChasePointsBatch(chaseId, points)
        }

        if (result.success) {
            preferences.clearPendingChasePoints()
        }
    }
}
