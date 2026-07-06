package com.heartlandstormchaser.gps

import android.app.Dialog
import android.os.Bundle
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.fragment.app.DialogFragment
import androidx.lifecycle.lifecycleScope
import com.google.android.material.checkbox.MaterialCheckBox
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.materialswitch.MaterialSwitch
import com.heartlandstormchaser.gps.databinding.DialogWarningsSettingsBinding
import com.heartlandstormchaser.gps.databinding.ItemWarningFilterRowBinding
import com.heartlandstormchaser.gps.databinding.ItemWarningSoundRowBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class WarningsSettingsDialogFragment : DialogFragment() {
    private var _binding: DialogWarningsSettingsBinding? = null
    private val binding get() = _binding!!
    private lateinit var preferences: GpsPreferences
    private lateinit var soundHelper: WarningSoundHelper
    private val filterCheckboxes = mutableMapOf<String, MaterialCheckBox>()
    private val soundSwitches = mutableMapOf<String, MaterialSwitch>()

    var initialSettings: WarningsSettings? = null
    var onSettingsSaved: (() -> Unit)? = null

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        _binding = DialogWarningsSettingsBinding.inflate(layoutInflater)
        preferences = GpsPreferences(requireContext())
        soundHelper = WarningSoundHelper(requireContext())

        populateRadiusSpinner()
        populateFilterRows()
        populateSoundRows()

        binding.saveSettingsButton.setOnClickListener { saveSettings() }

        return MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.warnings_settings_title)
            .setView(binding.root)
            .setNegativeButton(android.R.string.cancel, null)
            .create()
    }

    override fun onDestroyView() {
        soundHelper.stop()
        _binding = null
        super.onDestroyView()
    }

    private fun populateRadiusSpinner() {
        val labels = WarningDefinitions.RADIUS_OPTIONS_MILES.map { miles ->
            getString(R.string.warning_radius_option, miles)
        }
        val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_dropdown_item, labels)
        binding.radiusSpinner.adapter = adapter

        val currentRadius = initialSettings?.radiusMiles ?: 700
        val index = WarningDefinitions.RADIUS_OPTIONS_MILES.indexOf(currentRadius).coerceAtLeast(0)
        binding.radiusSpinner.setSelection(index)
    }

    private fun populateFilterRows() {
        binding.filterRowsContainer.removeAllViews()
        filterCheckboxes.clear()

        val filters = initialSettings?.eventFilters.orEmpty()
        WarningDefinitions.COMMON_EVENT_TYPES.forEach { event ->
            val rowBinding = ItemWarningFilterRowBinding.inflate(layoutInflater, binding.filterRowsContainer, false)
            rowBinding.filterCheckbox.text = event
            rowBinding.filterCheckbox.isChecked = filters[event] != false
            rowBinding.playSoundButton.visibility = if (WarningDefinitions.hasSound(event)) {
                View.VISIBLE
            } else {
                View.GONE
            }
            rowBinding.playSoundButton.setOnClickListener {
                soundHelper.play(event)
            }
            filterCheckboxes[event] = rowBinding.filterCheckbox
            binding.filterRowsContainer.addView(rowBinding.root)
        }
    }

    private fun populateSoundRows() {
        binding.soundRowsContainer.removeAllViews()
        soundSwitches.clear()

        WarningDefinitions.SOUND_EVENT_TYPES.forEach { event ->
            val rowBinding = ItemWarningSoundRowBinding.inflate(layoutInflater, binding.soundRowsContainer, false)
            rowBinding.soundEventText.text = event
            rowBinding.soundNotifySwitch.isChecked = preferences.isWarningSoundEnabled(event)
            rowBinding.playSoundButton.setOnClickListener {
                soundHelper.play(event)
            }
            soundSwitches[event] = rowBinding.soundNotifySwitch
            binding.soundRowsContainer.addView(rowBinding.root)
        }
    }

    private fun saveSettings() {
        val radius = WarningDefinitions.RADIUS_OPTIONS_MILES[binding.radiusSpinner.selectedItemPosition]
        val eventFilters = filterCheckboxes.mapValues { (_, checkbox) -> checkbox.isChecked }
        val soundSettings = soundSwitches.mapValues { (_, switch) -> switch.isChecked }

        binding.saveSettingsButton.isEnabled = false

        lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.updateWarningsSettings(
                    radiusMiles = radius,
                    eventFilters = eventFilters,
                )
            }

            if (result.success) {
                preferences.saveWarningSoundSettings(soundSettings)
                Toast.makeText(requireContext(), R.string.warnings_settings_saved, Toast.LENGTH_SHORT).show()
                onSettingsSaved?.invoke()
                dismiss()
            } else {
                Toast.makeText(
                    requireContext(),
                    result.error ?: getString(R.string.error_save_warning_settings),
                    Toast.LENGTH_LONG,
                ).show()
                binding.saveSettingsButton.isEnabled = true
            }
        }
    }

    companion object {
        const val TAG = "WarningsSettingsDialog"

        fun newInstance(settings: WarningsSettings?): WarningsSettingsDialogFragment {
            return WarningsSettingsDialogFragment().apply {
                initialSettings = settings
            }
        }
    }
}
