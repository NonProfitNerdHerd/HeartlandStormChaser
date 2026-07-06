package com.heartlandstormchaser.gps

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.location.Location
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicLong

class LocationForegroundService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val fusedClient by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private val preferences by lazy { GpsPreferences(this) }
    private val lastUploadAt = AtomicLong(0L)

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val location = result.lastLocation ?: return
            maybeUpload(location)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
        }

        if (!preferences.isPaired) {
            preferences.broadcasting = false
            stopSelf()
            return START_NOT_STICKY
        }

        preferences.broadcasting = true
        startForeground(NOTIFICATION_ID, buildNotification(getString(R.string.notification_waiting_fix)))
        startLocationUpdates()
        return START_STICKY
    }

    override fun onDestroy() {
        fusedClient.removeLocationUpdates(locationCallback)
        serviceScope.cancel()
        preferences.broadcasting = false
        sendBroadcast(Intent(ACTION_STATUS_CHANGED).setPackage(packageName))
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startLocationUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, UPLOAD_INTERVAL_MS)
            .setMinUpdateIntervalMillis(UPLOAD_INTERVAL_MS)
            .setMaxUpdateDelayMillis(UPLOAD_INTERVAL_MS * 2)
            .build()

        fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
            .addOnFailureListener { error ->
                preferences.lastUploadSuccess = false
                preferences.lastUploadError = error.message ?: "Unable to start location updates"
                updateNotification(getString(R.string.notification_gps_error))
                sendStatusChanged()
            }
    }

    private fun maybeUpload(location: Location) {
        val now = System.currentTimeMillis()
        if (now - lastUploadAt.get() < UPLOAD_INTERVAL_MS) {
            return
        }
        lastUploadAt.set(now)

        serviceScope.launch {
            val speedMph = if (location.hasSpeed()) {
                GpsApiClient.metersPerSecondToMph(location.speed)
            } else {
                null
            }
            val heading = if (location.hasBearing()) location.bearing.toDouble() else null
            val accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null
            val altitude = if (location.hasAltitude()) location.altitude else null
            val battery = preferences.currentBatteryPercent()
            val timestampUtc = GpsApiClient.nowUtcIso()

            preferences.lastLatitude = location.latitude
            preferences.lastLongitude = location.longitude
            preferences.lastSpeedMph = speedMph
            preferences.lastHeadingDegrees = heading
            preferences.lastAccuracyMeters = accuracy
            preferences.lastAltitudeMeters = altitude
            preferences.lastBatteryPercent = battery

            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.uploadGpsUpdate(
                    deviceName = preferences.deviceName,
                    latitude = location.latitude,
                    longitude = location.longitude,
                    speedMph = speedMph,
                    headingDegrees = heading,
                    accuracyMeters = accuracy,
                    altitudeMeters = altitude,
                    batteryPercent = battery,
                    timestampUtc = timestampUtc,
                )
            }

            preferences.lastSentAtMillis = System.currentTimeMillis()
            preferences.lastUploadSuccess = result.success
            preferences.lastUploadError = if (result.success) null else result.error

            if (result.success) {
                ChasePointSync.flushPending(this@LocationForegroundService)
                updateNotification(getString(R.string.notification_broadcasting))
            } else {
                if (preferences.isChaseTrackingActive) {
                    ChasePointSync.enqueue(
                        context = this@LocationForegroundService,
                        latitude = location.latitude,
                        longitude = location.longitude,
                        speedMph = speedMph,
                        headingDegrees = heading,
                        accuracyMeters = accuracy,
                        altitudeMeters = altitude,
                        recordedAt = timestampUtc,
                    )
                }
                updateNotification(getString(R.string.notification_upload_failed))
            }
            sendStatusChanged()
        }
    }

    private fun sendStatusChanged() {
        sendBroadcast(Intent(ACTION_STATUS_CHANGED).setPackage(packageName))
    }

    private fun updateNotification(content: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(content))
    }

    private fun buildNotification(content: String): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, LocationForegroundService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(content)
            .setContentIntent(openAppIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, getString(R.string.action_stop_broadcast), stopIntent)
            .build()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_STOP = "com.heartlandstormchaser.gps.action.STOP"
        const val ACTION_STATUS_CHANGED = "com.heartlandstormchaser.gps.action.STATUS_CHANGED"

        private const val CHANNEL_ID = "heartland_gps_broadcast"
        private const val NOTIFICATION_ID = 1001
        private const val UPLOAD_INTERVAL_MS = 10_000L

        fun start(context: Context) {
            val intent = Intent(context, LocationForegroundService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, LocationForegroundService::class.java).setAction(ACTION_STOP)
            context.startService(intent)
        }
    }
}
