package com.heartlandstormchaser.gps

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
    private lateinit var cityAdapter: ArrayAdapter<String>
    private var suppressCityFiltering = false

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

        setupStateDropdown()
        setupCityAutocomplete()

        binding.saveLocationButton.setOnClickListener { saveLocation() }
        binding.saveTickerButton.setOnClickListener { saveTicker() }

        loadSettings()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private fun setupStateDropdown() {
        val states = resources.getStringArray(R.array.us_state_codes).toList()
        val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_list_item_1, states)
        binding.stateInput.setAdapter(adapter)

        binding.stateInput.setOnItemClickListener { _, _, _, _ ->
            refreshCitySuggestions(binding.cityInput.text?.toString().orEmpty())
        }

        binding.stateInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                refreshCitySuggestions(binding.cityInput.text?.toString().orEmpty())
            }
        })
    }

    private fun setupCityAutocomplete() {
        cityAdapter = ArrayAdapter(requireContext(), android.R.layout.simple_list_item_1, mutableListOf())
        binding.cityInput.setAdapter(cityAdapter)

        binding.cityInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                if (suppressCityFiltering) {
                    return
                }
                refreshCitySuggestions(s?.toString().orEmpty())
            }
        })

        binding.cityInput.setOnItemClickListener { _, _, position, _ ->
            val label = cityAdapter.getItem(position) ?: return@setOnItemClickListener
            UsCitySuggestions.parseSelection(label)?.let { suggestion ->
                suppressCityFiltering = true
                binding.cityInput.setText(suggestion.city)
                binding.stateInput.setText(suggestion.state, false)
                suppressCityFiltering = false
            }
        }
    }

    private fun refreshCitySuggestions(query: String) {
        val state = binding.stateInput.text?.toString()?.trim()?.uppercase()?.takeIf { it.length == 2 }
        val suggestions = UsCitySuggestions.filter(query, state)
        cityAdapter.clear()
        cityAdapter.addAll(suggestions.map { it.label })
        cityAdapter.notifyDataSetChanged()
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
                showLocationStatus(result.error ?: getString(R.string.error_load_overlay_settings), false)
                return@launch
            }

            applySettings(result.settings)
        }
    }

    private fun applySettings(settings: OverlaySettings) {
        suppressCityFiltering = true
        binding.cityInput.setText(settings.targetCity)
        binding.stateInput.setText(settings.targetState, false)
        binding.tickerInput.setText(settings.tickerText)
        suppressCityFiltering = false

        if (settings.targetCity.isNotBlank() || settings.targetState.isNotBlank()) {
            val label = listOf(settings.targetCity, settings.targetState)
                .filter { it.isNotBlank() }
                .joinToString(", ")
            showLocationStatus(getString(R.string.overlay_location_saved_preview, label), true)
        } else {
            binding.locationStatusText.visibility = View.GONE
        }

        if (settings.tickerText.isNotBlank()) {
            showTickerStatus(getString(R.string.overlay_ticker_saved_preview), true)
        } else {
            binding.tickerStatusText.visibility = View.GONE
        }
    }

    private fun saveLocation() {
        val city = binding.cityInput.text?.toString()?.trim().orEmpty()
        val state = binding.stateInput.text?.toString()?.trim()?.uppercase().orEmpty()

        binding.cityInputLayout.error = null
        binding.stateInputLayout.error = null

        when {
            city.isBlank() -> {
                binding.cityInputLayout.error = getString(R.string.error_overlay_city_required)
                return
            }
            state.isBlank() -> {
                binding.stateInputLayout.error = getString(R.string.error_overlay_state_required)
                return
            }
            state.length != 2 -> {
                binding.stateInputLayout.error = getString(R.string.error_overlay_state_invalid)
                return
            }
        }

        setLoading(true)
        lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl)
            val result = withContext(Dispatchers.IO) {
                client.updateOverlaySettings(
                    targetCity = city,
                    targetState = state,
                )
            }
            setLoading(false)

            if (!result.success || result.settings == null) {
                showLocationStatus(result.error ?: getString(R.string.error_save_overlay_location), false)
                return@launch
            }

            applySettings(result.settings)
            showLocationStatus(getString(R.string.overlay_location_saved), true)
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

    private fun setLoading(loading: Boolean) {
        binding.overlaysProgress.visibility = if (loading) View.VISIBLE else View.GONE
        binding.saveLocationButton.isEnabled = !loading
        binding.saveTickerButton.isEnabled = !loading
        binding.cityInput.isEnabled = !loading
        binding.stateInput.isEnabled = !loading
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
