package com.heartlandstormchaser.gps

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.heartlandstormchaser.gps.databinding.FragmentOverlaysBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class OverlaysFragment : Fragment() {
    private var _binding: FragmentOverlaysBinding? = null
    private val binding get() = _binding!!
    private lateinit var preferences: GpsPreferences
    private lateinit var locationAdapter: ArrayAdapter<String>
    private var suppressLocationFiltering = false
    private var selectedTarget: CitySuggestion? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentOverlaysBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        preferences = GpsPreferences(requireContext())

        setupLocationAutocomplete()

        binding.updateLocationButton.setOnClickListener { updateTargetLocation() }
        binding.openMapsButton.setOnClickListener { openTargetInGoogleMaps() }
        binding.saveTickerButton.setOnClickListener { saveTicker() }

        restoreCachedTarget()
    }

    override fun onResume() {
        super.onResume()
        loadSettings()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private fun setupLocationAutocomplete() {
        locationAdapter = ArrayAdapter(requireContext(), android.R.layout.simple_list_item_1, mutableListOf())
        binding.locationInput.setAdapter(locationAdapter)

        binding.locationInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                if (suppressLocationFiltering) {
                    return
                }
                selectedTarget = UsCitySuggestions.parseSelection(s?.toString().orEmpty())
                refreshLocationSuggestions(s?.toString().orEmpty())
                updateMapsButtonState()
            }
        })

        binding.locationInput.setOnItemClickListener { _, _, position, _ ->
            val label = locationAdapter.getItem(position) ?: return@setOnItemClickListener
            UsCitySuggestions.parseSelection(label)?.let { suggestion ->
                applyTargetToField(suggestion)
            }
        }

        binding.locationInput.setOnFocusChangeListener { _, hasFocus ->
            if (hasFocus && binding.locationInput.text?.isNotBlank() == true) {
                refreshLocationSuggestions(binding.locationInput.text?.toString().orEmpty())
                binding.locationInput.showDropDown()
            }
        }
    }

    private fun refreshLocationSuggestions(query: String) {
        val suggestions = UsCitySuggestions.filter(query)
        locationAdapter.clear()
        locationAdapter.addAll(suggestions.map { it.label })
        locationAdapter.notifyDataSetChanged()
        if (suggestions.isNotEmpty() && binding.locationInput.hasFocus()) {
            binding.locationInput.showDropDown()
        }
    }

    private fun restoreCachedTarget() {
        preferences.cachedOverlayTarget()?.let { target ->
            applyTargetToField(target, persistCache = false)
        }
    }

    private fun applyTargetToField(target: CitySuggestion, persistCache: Boolean = true) {
        suppressLocationFiltering = true
        binding.locationInput.setText(target.label)
        binding.locationInput.setSelection(binding.locationInput.text?.length ?: 0)
        suppressLocationFiltering = false
        selectedTarget = target
        if (persistCache) {
            preferences.saveOverlayTarget(target.city, target.state)
        }
        updateMapsButtonState()
    }

    private fun applySettings(settings: OverlaySettings) {
        binding.tickerInput.setText(settings.tickerText)

        if (settings.targetCity.isNotBlank() && settings.targetState.isNotBlank()) {
            val target = CitySuggestion(settings.targetCity, settings.targetState)
            applyTargetToField(target)
            showLocationStatus(
                getString(R.string.overlay_location_saved_preview, target.label),
                true,
            )
        } else if (selectedTarget == null) {
            binding.locationInput.text?.clear()
            binding.locationStatusText.visibility = View.GONE
        }

        if (settings.tickerText.isNotBlank()) {
            showTickerStatus(getString(R.string.overlay_ticker_saved_preview), true)
        } else {
            binding.tickerStatusText.visibility = View.GONE
        }

        updateMapsButtonState()
    }

    private fun resolveTargetFromInput(): CitySuggestion? {
        selectedTarget?.let { return it }
        return UsCitySuggestions.parseSelection(binding.locationInput.text?.toString().orEmpty())
    }

    private fun updateTargetLocation() {
        binding.locationInputLayout.error = null

        val target = resolveTargetFromInput()
        if (target == null) {
            binding.locationInputLayout.error = getString(R.string.error_overlay_location_invalid)
            return
        }

        setLoading(true)
        lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl)
            val result = withContext(Dispatchers.IO) {
                client.updateOverlaySettings(
                    targetCity = target.city,
                    targetState = target.state,
                )
            }
            setLoading(false)

            if (!result.success || result.settings == null) {
                showLocationStatus(result.error ?: getString(R.string.error_save_overlay_location), false)
                return@launch
            }

            applyTargetToField(target)
            applySettings(result.settings)
            showLocationStatus(getString(R.string.overlay_location_updated), true)
        }
    }

    private fun openTargetInGoogleMaps() {
        val target = resolveTargetFromInput()
        if (target == null) {
            binding.locationInputLayout.error = getString(R.string.error_overlay_location_invalid)
            return
        }

        val destination = Uri.encode("${target.city}, ${target.state}")
        val navigationIntent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("google.navigation:q=$destination"),
        ).setPackage("com.google.android.apps.maps")

        val mapsIntent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://www.google.com/maps/dir/?api=1&destination=$destination"),
        )

        try {
            startActivity(navigationIntent)
        } catch (_: ActivityNotFoundException) {
            try {
                startActivity(mapsIntent)
            } catch (_: ActivityNotFoundException) {
                showLocationStatus(getString(R.string.error_maps_app_unavailable), false)
            }
        }
    }

    private fun saveTicker() {
        val ticker = binding.tickerInput.text?.toString()?.trim().orEmpty()
        setLoading(true)
        lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl)
            val result = withContext(Dispatchers.IO) {
                client.updateOverlaySettings(tickerText = ticker)
            }
            setLoading(false)

            if (!result.success || result.settings == null) {
                showTickerStatus(result.error ?: getString(R.string.error_save_overlay_ticker), false)
                return@launch
            }

            applySettings(result.settings)
            showTickerStatus(getString(R.string.overlay_ticker_saved), true)
        }
    }

    private fun loadSettings() {
        setLoading(true)
        lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl)
            val result = withContext(Dispatchers.IO) {
                client.fetchOverlaySettings()
            }
            setLoading(false)

            if (!result.success || result.settings == null) {
                preferences.cachedOverlayTarget()?.let { applyTargetToField(it, persistCache = false) }
                showLocationStatus(result.error ?: getString(R.string.error_load_overlay_settings), false)
                return@launch
            }

            applySettings(result.settings)
        }
    }

    private fun updateMapsButtonState() {
        binding.openMapsButton.isEnabled = resolveTargetFromInput() != null
    }

    private fun setLoading(loading: Boolean) {
        binding.overlaysProgress.visibility = if (loading) View.VISIBLE else View.GONE
        binding.updateLocationButton.isEnabled = !loading
        binding.openMapsButton.isEnabled = !loading && resolveTargetFromInput() != null
        binding.saveTickerButton.isEnabled = !loading
        binding.locationInput.isEnabled = !loading
        binding.tickerInput.isEnabled = !loading
    }

    private fun showLocationStatus(message: String, success: Boolean) {
        binding.locationStatusText.text = message
        binding.locationStatusText.setTextColor(
            ContextCompat.getColor(
                requireContext(),
                if (success) R.color.md_theme_success else R.color.md_theme_error,
            ),
        )
        binding.locationStatusText.visibility = View.VISIBLE
    }

    private fun showTickerStatus(message: String, success: Boolean) {
        binding.tickerStatusText.text = message
        binding.tickerStatusText.setTextColor(
            ContextCompat.getColor(
                requireContext(),
                if (success) R.color.md_theme_success else R.color.md_theme_error,
            ),
        )
        binding.tickerStatusText.visibility = View.VISIBLE
    }
}
