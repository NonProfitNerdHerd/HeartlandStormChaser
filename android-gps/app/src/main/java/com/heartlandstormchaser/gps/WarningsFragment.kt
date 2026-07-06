package com.heartlandstormchaser.gps

import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.heartlandstormchaser.gps.databinding.DialogWarningDetailBinding
import com.heartlandstormchaser.gps.databinding.FragmentWarningsBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class WarningsFragment : Fragment() {
    private var _binding: FragmentWarningsBinding? = null
    private val binding get() = _binding!!
    private lateinit var preferences: GpsPreferences
    private lateinit var soundHelper: WarningSoundHelper
    private lateinit var adapter: WarningAdapter
    private val seenAlertIds = mutableSetOf<String>()
    private var alertsInitialized = false
    private var latestSettings: WarningsSettings? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentWarningsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        preferences = GpsPreferences(requireContext())
        soundHelper = WarningSoundHelper(requireContext())

        adapter = WarningAdapter { alert -> showWarningDetail(alert) }
        binding.warningsList.layoutManager = LinearLayoutManager(requireContext())
        binding.warningsList.adapter = adapter

        binding.warningsRefresh.setOnRefreshListener { refreshWarnings(force = true) }
        binding.warningsSettingsButton.setOnClickListener { openSettingsDialog() }
    }

    override fun onResume() {
        super.onResume()
        refreshWarnings(force = false)
    }

    override fun onDestroyView() {
        soundHelper.stop()
        _binding = null
        super.onDestroyView()
    }

    private fun refreshWarnings(force: Boolean) {
        if (!binding.warningsRefresh.isRefreshing) {
            binding.warningsProgress.isVisible = true
        }

        lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.fetchPlatformWarnings(force = force)
            }

            binding.warningsProgress.isVisible = false
            binding.warningsRefresh.isRefreshing = false

            if (!result.success) {
                binding.warningsMetaText.text = result.error ?: getString(R.string.error_load_warnings)
                adapter.submitList(emptyList())
                binding.warningsEmptyText.isVisible = true
                binding.warningsEmptyText.text = result.error ?: getString(R.string.error_load_warnings)
                return@launch
            }

            latestSettings = result.settings
            val alerts = result.alerts
            noteNewAlerts(alerts)
            adapter.submitList(alerts)

            val radius = result.settings?.radiusMiles ?: latestSettings?.radiusMiles ?: 700
            binding.warningsMetaText.text = getString(
                R.string.warnings_meta,
                alerts.size,
                radius,
            )
            binding.warningsEmptyText.isVisible = alerts.isEmpty()
            binding.warningsEmptyText.text = result.message ?: getString(R.string.warnings_empty)
        }
    }

    private fun noteNewAlerts(alerts: List<WarningAlert>) {
        if (!alertsInitialized) {
            seenAlertIds.addAll(alerts.map { it.id })
            alertsInitialized = true
            return
        }

        val newAlerts = alerts.filter { it.id !in seenAlertIds }
        newAlerts.forEach { seenAlertIds.add(it.id) }

        val alertToPlay = newAlerts.firstOrNull { preferences.isWarningSoundEnabled(it.event) }
        if (alertToPlay != null) {
            soundHelper.play(alertToPlay.event)
        }
    }

    private fun openSettingsDialog() {
        val dialog = WarningsSettingsDialogFragment.newInstance(latestSettings)
        dialog.onSettingsSaved = { refreshWarnings(force = true) }
        dialog.show(parentFragmentManager, WarningsSettingsDialogFragment.TAG)
    }

    private fun showWarningDetail(alert: WarningAlert) {
        val detailBinding = DialogWarningDetailBinding.inflate(layoutInflater)
        detailBinding.detailEventText.text = alert.event
        detailBinding.detailEventText.setTextColor(parseColor(alert.color))
        detailBinding.detailMetaText.text = getString(
            R.string.warning_detail_meta,
            alert.severity,
            alert.urgency,
            alert.distanceMiles,
        )
        detailBinding.detailHeadlineText.text = alert.headline
        detailBinding.detailDescriptionText.text = alert.description
        detailBinding.detailOfficeText.text = getString(
            R.string.warning_detail_office,
            alert.senderName,
            alert.sent.ifBlank { alert.effective },
            alert.expires.ifBlank { alert.ends.orEmpty() },
        )

        if (!alert.instruction.isNullOrBlank()) {
            detailBinding.detailInstructionLabel.isVisible = true
            detailBinding.detailInstructionText.isVisible = true
            detailBinding.detailInstructionText.text = alert.instruction
        }

        MaterialAlertDialogBuilder(requireContext())
            .setTitle(alert.event)
            .setView(detailBinding.root)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun parseColor(value: String): Int {
        return runCatching { Color.parseColor(value) }.getOrDefault(Color.parseColor("#ff8c00"))
    }
}
