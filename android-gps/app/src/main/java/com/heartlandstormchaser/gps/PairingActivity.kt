package com.heartlandstormchaser.gps

import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.heartlandstormchaser.gps.databinding.ActivityPairingBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PairingActivity : AppCompatActivity() {
    private lateinit var binding: ActivityPairingBinding
    private lateinit var preferences: GpsPreferences

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPairingBinding.inflate(layoutInflater)
        setContentView(binding.root)
        preferences = GpsPreferences(this)

        binding.serverUrlInput.setText(preferences.serverUrl)
        binding.pinInput.setText(preferences.pin)
        binding.deviceNameInput.setText(
            preferences.deviceName.ifBlank { android.os.Build.MODEL },
        )

        binding.pairButton.setOnClickListener {
            attemptPairing()
        }
    }

    private fun attemptPairing() {
        val serverUrl = ApiUrlHelper.normalizeServerUrl(
            binding.serverUrlInput.text?.toString().orEmpty(),
        )
        val pin = binding.pinInput.text?.toString()?.trim().orEmpty()
        val deviceName = binding.deviceNameInput.text?.toString()?.trim().orEmpty()

        binding.pairingMessage.visibility = View.GONE
        binding.pairingMessage.text = ""

        when {
            serverUrl.isBlank() -> showError("Server URL is required")
            pin.isBlank() -> showError("Pairing PIN is required")
            deviceName.isBlank() -> showError("Device name is required")
            else -> pairWithBackend(serverUrl, pin, deviceName)
        }
    }

    private fun pairWithBackend(serverUrl: String, pin: String, deviceName: String) {
        setLoading(true)

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                GpsApiClient(serverUrl).pairDevice(
                    pin = pin,
                    deviceName = deviceName,
                    existingDeviceId = preferences.deviceId.takeIf { it.isNotBlank() },
                )
            }

            setLoading(false)

            if (result.success) {
                preferences.savePairingResult(
                    serverUrl = serverUrl,
                    pin = pin,
                    deviceName = result.deviceName ?: deviceName,
                    deviceId = result.deviceId.orEmpty(),
                    deviceToken = result.deviceToken.orEmpty(),
                )
                startActivity(
                    android.content.Intent(this@PairingActivity, MainActivity::class.java).apply {
                        addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP or android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    },
                )
                finish()
                return@launch
            }

            showError(result.error ?: "Pairing failed")
        }
    }

    private fun setLoading(loading: Boolean) {
        binding.pairButton.isEnabled = !loading
        binding.serverUrlInput.isEnabled = !loading
        binding.pinInput.isEnabled = !loading
        binding.deviceNameInput.isEnabled = !loading
        binding.pairingProgress.visibility = if (loading) View.VISIBLE else View.GONE
    }

    private fun showError(message: String) {
        binding.pairingMessage.text = message
        binding.pairingMessage.visibility = View.VISIBLE
    }
}
