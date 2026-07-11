package com.heartlandstormchaser.gps

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.heartlandstormchaser.gps.databinding.FragmentGpsBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class GpsFragment : Fragment() {
    private var _binding: FragmentGpsBinding? = null
    private val binding get() = _binding!!
    private lateinit var preferences: GpsPreferences
    private var weatherRefreshJob: Job? = null
    private var suppressSwitchCallback = false

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            renderStatus()
        }
    }

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { results ->
        val granted = REQUIRED_LOCATION_PERMISSIONS.all { permission ->
            results[permission] == true
        }
        if (granted) {
            startBroadcastIfRequested()
        } else {
            suppressSwitchCallback = true
            binding.broadcastSwitch.isChecked = false
            suppressSwitchCallback = false
            preferences.broadcasting = false
            showUploadError(getString(R.string.error_location_permission))
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { _ ->
        startBroadcastIfRequested()
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentGpsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        preferences = GpsPreferences(requireContext())

        binding.broadcastSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (suppressSwitchCallback) {
                return@setOnCheckedChangeListener
            }
            if (isChecked) {
                requestLocationPermissionsAndStart()
            } else {
                stopBroadcast()
            }
        }

        binding.setPlatformButton.setOnClickListener {
            setPlatformSource()
        }

        syncBroadcastSwitch()
        renderStatus()
        refreshPlatformStatus()
        refreshWeather()
    }

    override fun onStart() {
        super.onStart()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requireContext().registerReceiver(
                statusReceiver,
                IntentFilter(LocationForegroundService.ACTION_STATUS_CHANGED),
                Context.RECEIVER_NOT_EXPORTED,
            )
        } else {
            @Suppress("DEPRECATION")
            requireContext().registerReceiver(
                statusReceiver,
                IntentFilter(LocationForegroundService.ACTION_STATUS_CHANGED),
            )
        }
    }

    override fun onStop() {
        requireContext().unregisterReceiver(statusReceiver)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        syncBroadcastSwitch()
        renderStatus()
        refreshPlatformStatus()
        startWeatherRefreshLoop()
    }

    override fun onPause() {
        weatherRefreshJob?.cancel()
        super.onPause()
    }

    override fun onDestroyView() {
        weatherRefreshJob?.cancel()
        _binding = null
        super.onDestroyView()
    }

    private fun syncBroadcastSwitch() {
        suppressSwitchCallback = true
        binding.broadcastSwitch.isChecked = preferences.broadcasting
        suppressSwitchCallback = false
        if (preferences.broadcasting && hasLocationPermissions()) {
            LocationForegroundService.start(requireContext())
        }
    }

    private fun requestLocationPermissionsAndStart() {
        if (hasLocationPermissions()) {
            startBroadcastIfRequested()
            return
        }
        locationPermissionLauncher.launch(REQUIRED_LOCATION_PERMISSIONS)
    }

    private fun startBroadcastIfRequested() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(requireContext(), Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        preferences.broadcasting = true
        LocationForegroundService.start(requireContext())
        renderStatus()
    }

    private fun stopBroadcast() {
        preferences.broadcasting = false
        LocationForegroundService.stop(requireContext())
        renderStatus()
    }

    private fun setPlatformSource() {
        binding.setPlatformButton.isEnabled = false
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.setPlatformSource(preferences.deviceId)
            }
            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.setPlatformButton.isEnabled = true
            preferences.isPlatformSource = result.success && result.isThisDevicePlatform
            updatePlatformStatusText()
            if (!result.success) {
                showUploadError(result.error ?: getString(R.string.error_set_platform))
            }
        }
    }

    private fun refreshPlatformStatus() {
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.fetchPlatformStatus(preferences.deviceId)
            }
            if (_binding == null || !isAdded) {
                return@launch
            }
            if (result.success) {
                preferences.isPlatformSource = result.isThisDevicePlatform
            }
            updatePlatformStatusText()
        }
    }

    private fun refreshWeather() {
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.fetchPlatformWeather()
            }
            if (_binding == null || !isAdded) {
                return@launch
            }
            if (!result.success) {
                binding.weatherSummaryText.text = result.error ?: getString(R.string.weather_unavailable)
                binding.weatherDetailsText.text = ""
                return@launch
            }

            val weather = result.weather
            if (weather == null) {
                binding.weatherSummaryText.text = result.message ?: getString(R.string.weather_unavailable)
                binding.weatherDetailsText.text = ""
                return@launch
            }

            binding.weatherSummaryText.text = buildString {
                append(formatNullable(weather.temperatureF, suffix = "°F"))
                if (!weather.conditions.isNullOrBlank()) {
                    append(" · ")
                    append(weather.conditions)
                }
            }
            binding.weatherDetailsText.text = buildString {
                append(getString(R.string.weather_dew, formatNullable(weather.dewPointF, suffix = "°F")))
                append('\n')
                append(getString(R.string.weather_humidity, formatNullable(weather.humidityPercent, suffix = "%")))
                append('\n')
                append(
                    getString(
                        R.string.weather_wind,
                        formatWind(weather.windSpeedMph, weather.windDirection),
                    ),
                )
                append('\n')
                append(getString(R.string.weather_gusts, formatNullable(weather.windGustsMph, suffix = " mph")))
                if (!weather.observationAt.isNullOrBlank()) {
                    append('\n')
                    append(getString(R.string.weather_updated, CentralTime.formatIso(weather.observationAt)))
                }
            }
        }
    }

    private fun startWeatherRefreshLoop() {
        weatherRefreshJob?.cancel()
        weatherRefreshJob = viewLifecycleOwner.lifecycleScope.launch {
            while (isActive) {
                delay(WEATHER_REFRESH_MS)
                refreshWeather()
            }
        }
    }

    private fun renderStatus() {
        binding.latitudeText.text = getString(
            R.string.status_latitude,
            formatCoordinate(preferences.lastLatitude),
        )
        binding.longitudeText.text = getString(
            R.string.status_longitude,
            formatCoordinate(preferences.lastLongitude),
        )
        binding.speedText.text = getString(
            R.string.status_speed,
            formatNullable(preferences.lastSpeedMph, suffix = " mph"),
        )
        binding.headingText.text = getString(
            R.string.status_heading,
            formatNullable(preferences.lastHeadingDegrees, suffix = "°"),
        )
        binding.accuracyText.text = getString(
            R.string.status_accuracy,
            formatNullable(preferences.lastAccuracyMeters, suffix = " m"),
        )
        binding.batteryText.text = getString(
            R.string.status_battery,
            preferences.lastBatteryPercent?.let { "$it%" } ?: "—",
        )
        binding.lastSentText.text = getString(
            R.string.status_last_sent,
            formatLastSent(preferences.lastSentAtMillis),
        )

        if (preferences.lastUploadSuccess) {
            binding.uploadStatusText.text = getString(R.string.upload_status_success)
            binding.uploadStatusText.setTextColor(
                ContextCompat.getColor(requireContext(), R.color.md_theme_success),
            )
            binding.uploadErrorText.visibility = View.GONE
        } else if (!preferences.lastUploadError.isNullOrBlank()) {
            binding.uploadStatusText.text = getString(R.string.upload_status_failed)
            binding.uploadStatusText.setTextColor(
                ContextCompat.getColor(requireContext(), R.color.md_theme_error),
            )
            showUploadError(preferences.lastUploadError)
        } else {
            binding.uploadStatusText.text = getString(R.string.upload_status_idle)
            binding.uploadStatusText.setTextColor(
                ContextCompat.getColor(requireContext(), R.color.md_theme_on_surface),
            )
            binding.uploadErrorText.visibility = View.GONE
        }

        updatePlatformStatusText()
    }

    private fun updatePlatformStatusText() {
        binding.platformStatusText.text = if (preferences.isPlatformSource) {
            getString(R.string.platform_status_active)
        } else {
            getString(R.string.platform_status_inactive)
        }
    }

    private fun showUploadError(message: String?) {
        if (message.isNullOrBlank()) {
            binding.uploadErrorText.visibility = View.GONE
            return
        }
        binding.uploadErrorText.text = message
        binding.uploadErrorText.visibility = View.VISIBLE
    }

    private fun formatCoordinate(value: Double?): String {
        return value?.let { String.format("%.5f", it) } ?: "—"
    }

    private fun formatNullable(value: Double?, suffix: String = ""): String {
        return value?.let { String.format("%.1f%s", it, suffix) } ?: "—"
    }

    private fun formatWind(speedMph: Double?, direction: String?): String {
        val speed = formatNullable(speedMph, suffix = " mph")
        return if (!direction.isNullOrBlank()) {
            "$speed $direction"
        } else {
            speed
        }
    }

    private fun formatLastSent(lastSentAtMillis: Long): String {
        return CentralTime.formatMillis(lastSentAtMillis)
    }

    private fun hasLocationPermissions(): Boolean {
        return REQUIRED_LOCATION_PERMISSIONS.all { permission ->
            ContextCompat.checkSelfPermission(requireContext(), permission) == PackageManager.PERMISSION_GRANTED
        }
    }

    companion object {
        private val REQUIRED_LOCATION_PERMISSIONS = arrayOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
        private const val WEATHER_REFRESH_MS = 60_000L
    }
}
