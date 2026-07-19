package com.heartlandstormchaser.gps

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.datepicker.MaterialDatePicker
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.timepicker.MaterialTimePicker
import com.google.android.material.timepicker.TimeFormat
import com.heartlandstormchaser.gps.databinding.FragmentBroadcastBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

class BroadcastFragment : Fragment() {
    private var _binding: FragmentBroadcastBinding? = null
    private val binding get() = _binding!!
    private lateinit var preferences: GpsPreferences
    private lateinit var broadcastAdapter: BroadcastAdapter

    private var selectedDateTime: ZonedDateTime = ZonedDateTime.now(CentralTime.zone)

    private val timeZones = listOf(
        "America/Chicago",
        "America/New_York",
        "America/Denver",
        "America/Los_Angeles",
        "America/Phoenix",
        "UTC",
    )

    private val platformOptions = listOf(
        PlatformOption("youtube", R.string.broadcast_platform_youtube),
        PlatformOption("obs", R.string.broadcast_platform_obs),
    )

    private val visibilityOptions = listOf(
        VisibilityOption("public", R.string.broadcast_visibility_public),
        VisibilityOption("unlisted", R.string.broadcast_visibility_unlisted),
        VisibilityOption("private", R.string.broadcast_visibility_private),
    )

    private val displayFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("MM/dd/yyyy h:mm a", Locale.US)

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentBroadcastBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        preferences = GpsPreferences(requireContext())

        broadcastAdapter = BroadcastAdapter { broadcast -> showBroadcastDetail(broadcast) }
        binding.broadcastList.layoutManager = LinearLayoutManager(requireContext())
        binding.broadcastList.adapter = broadcastAdapter

        setupDropdowns()
        updateDateTimeField()

        binding.broadcastDateTimeInput.setOnClickListener { pickDateTime() }
        binding.broadcastDateTimeLayout.setEndIconOnClickListener { pickDateTime() }
        binding.broadcastSaveDraftButton.setOnClickListener { submitBroadcast(saveAsDraft = true) }
        binding.broadcastScheduleButton.setOnClickListener { submitBroadcast(saveAsDraft = false) }
    }

    override fun onResume() {
        super.onResume()
        refreshUpcoming()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private fun setupDropdowns() {
        binding.broadcastTimezoneInput.setAdapter(
            ArrayAdapter(requireContext(), android.R.layout.simple_list_item_1, timeZones),
        )
        binding.broadcastTimezoneInput.setText("America/Chicago", false)

        val platformLabels = platformOptions.map { getString(it.labelRes) }
        binding.broadcastPlatformInput.setAdapter(
            ArrayAdapter(requireContext(), android.R.layout.simple_list_item_1, platformLabels),
        )
        binding.broadcastPlatformInput.setText(getString(R.string.broadcast_platform_youtube), false)

        val visibilityLabels = visibilityOptions.map { getString(it.labelRes) }
        binding.broadcastVisibilityInput.setAdapter(
            ArrayAdapter(requireContext(), android.R.layout.simple_list_item_1, visibilityLabels),
        )
        binding.broadcastVisibilityInput.setText(getString(R.string.broadcast_visibility_public), false)
    }

    private fun updateDateTimeField() {
        binding.broadcastDateTimeInput.setText(selectedDateTime.format(displayFormatter))
    }

    private fun pickDateTime() {
        val zone = selectedZoneId()
        val localDate = selectedDateTime.withZoneSameInstant(zone).toLocalDate()
        val utcMillis = localDate.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

        val datePicker = MaterialDatePicker.Builder.datePicker()
            .setTitleText(R.string.label_broadcast_datetime)
            .setSelection(utcMillis)
            .build()

        datePicker.addOnPositiveButtonClickListener { selection ->
            val pickedDate = Instant.ofEpochMilli(selection)
                .atZone(ZoneOffset.UTC)
                .toLocalDate()
            val current = selectedDateTime.withZoneSameInstant(zone)
            selectedDateTime = ZonedDateTime.of(
                pickedDate,
                current.toLocalTime(),
                zone,
            )
            pickTime()
        }
        datePicker.show(parentFragmentManager, "broadcast_date_picker")
    }

    private fun pickTime() {
        val zone = selectedZoneId()
        val current = selectedDateTime.withZoneSameInstant(zone)
        val timePicker = MaterialTimePicker.Builder()
            .setTimeFormat(TimeFormat.CLOCK_12H)
            .setHour(current.hour)
            .setMinute(current.minute)
            .setTitleText(R.string.label_broadcast_datetime)
            .build()

        timePicker.addOnPositiveButtonClickListener {
            selectedDateTime = ZonedDateTime.of(
                current.toLocalDate(),
                LocalTime.of(timePicker.hour, timePicker.minute),
                zone,
            )
            updateDateTimeField()
        }
        timePicker.show(parentFragmentManager, "broadcast_time_picker")
    }

    private fun selectedZoneId(): ZoneId {
        val raw = binding.broadcastTimezoneInput.text?.toString()?.trim().orEmpty()
        return runCatching { ZoneId.of(raw.ifBlank { "America/Chicago" }) }
            .getOrDefault(CentralTime.zone)
    }

    private fun selectedPlatform(): String {
        val label = binding.broadcastPlatformInput.text?.toString().orEmpty()
        return platformOptions.firstOrNull { getString(it.labelRes) == label }?.value ?: "youtube"
    }

    private fun selectedVisibility(): String {
        val label = binding.broadcastVisibilityInput.text?.toString().orEmpty()
        return visibilityOptions.firstOrNull { getString(it.labelRes) == label }?.value ?: "public"
    }

    private fun submitBroadcast(saveAsDraft: Boolean) {
        val title = binding.broadcastTitleInput.text?.toString()?.trim().orEmpty()
        if (title.isBlank()) {
            Toast.makeText(requireContext(), R.string.error_broadcast_title_required, Toast.LENGTH_SHORT).show()
            return
        }

        val description = binding.broadcastDescriptionInput.text?.toString()?.trim().orEmpty()
        val timeZone = binding.broadcastTimezoneInput.text?.toString()?.trim().orEmpty()
            .ifBlank { "America/Chicago" }
        val durationText = binding.broadcastDurationInput.text?.toString()?.trim().orEmpty()
        val duration = durationText.toIntOrNull()

        // Re-apply selected timezone to the wall-clock date/time before submitting.
        val local = selectedDateTime.withZoneSameLocal(selectedZoneId())
        selectedDateTime = local
        val scheduledAtIso = local.toInstant().toString()

        setFormLoading(true)
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.createScheduledBroadcast(
                    title = title,
                    description = description.ifBlank { null },
                    scheduledAtIso = scheduledAtIso,
                    timeZone = timeZone,
                    platform = selectedPlatform(),
                    visibility = selectedVisibility(),
                    expectedDurationMinutes = duration,
                    saveAsDraft = saveAsDraft,
                )
            }

            if (_binding == null || !isAdded) {
                return@launch
            }
            setFormLoading(false)

            if (!result.success) {
                Toast.makeText(
                    requireContext(),
                    result.error ?: getString(R.string.error_create_broadcast),
                    Toast.LENGTH_LONG,
                ).show()
                return@launch
            }

            Toast.makeText(
                requireContext(),
                if (saveAsDraft) R.string.broadcast_draft_saved else R.string.broadcast_scheduled,
                Toast.LENGTH_SHORT,
            ).show()
            binding.broadcastTitleInput.setText("")
            binding.broadcastDescriptionInput.setText("")
            refreshUpcoming()
        }
    }

    private fun setFormLoading(loading: Boolean) {
        binding.broadcastFormProgress.isVisible = loading
        binding.broadcastSaveDraftButton.isEnabled = !loading
        binding.broadcastScheduleButton.isEnabled = !loading
    }

    private fun refreshUpcoming() {
        binding.broadcastListProgress.isVisible = true
        binding.broadcastListMetaText.text = getString(R.string.broadcast_loading)

        val zone = CentralTime.zone
        val today = LocalDate.now(zone)
        val fromIso = today.atStartOfDay(zone).toInstant().toString()
        val toIso = today.plusDays(3).atTime(LocalTime.MAX).atZone(zone).toInstant().toString()

        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.listScheduledBroadcasts(fromIso, toIso)
            }

            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.broadcastListProgress.isVisible = false

            if (!result.success) {
                binding.broadcastListMetaText.text = result.error
                    ?: getString(R.string.error_load_broadcasts)
                broadcastAdapter.submitList(emptyList())
                return@launch
            }

            broadcastAdapter.submitList(result.broadcasts)
            binding.broadcastListMetaText.text = if (result.broadcasts.isEmpty()) {
                getString(R.string.broadcast_empty)
            } else {
                getString(R.string.broadcast_list_meta, result.broadcasts.size)
            }
        }
    }

    private fun showBroadcastDetail(broadcast: ScheduledBroadcastSummary) {
        val watchUrl = broadcast.watchUrl?.trim().orEmpty()
        val platformLabel = when (broadcast.platform) {
            "obs" -> getString(R.string.broadcast_platform_obs)
            else -> getString(R.string.broadcast_platform_youtube)
        }
        val visibilityLabel = when (broadcast.visibility) {
            "unlisted" -> getString(R.string.broadcast_visibility_unlisted)
            "private" -> getString(R.string.broadcast_visibility_private)
            else -> getString(R.string.broadcast_visibility_public)
        }

        val watchLine = when {
            watchUrl.isNotBlank() -> watchUrl
            broadcast.platform == "youtube" -> getString(R.string.broadcast_watch_not_ready)
            else -> "—"
        }

        val message = buildString {
            append(getString(R.string.broadcast_detail_when, CentralTime.formatIso(broadcast.scheduledAt)))
            append("\n")
            append(getString(R.string.broadcast_detail_status, broadcast.status))
            append("\n")
            append(getString(R.string.broadcast_detail_platform, platformLabel))
            append("\n")
            append(getString(R.string.broadcast_detail_visibility, visibilityLabel))
            append("\n\n")
            append(getString(R.string.broadcast_detail_youtube_link))
            append("\n")
            append(watchLine)
            if (broadcast.description.isNotBlank()) {
                append("\n\n")
                append(broadcast.description)
            }
        }

        val padding = (24 * resources.displayMetrics.density).toInt()
        val messageView = android.widget.TextView(requireContext()).apply {
            text = message
            setTextIsSelectable(true)
            setPadding(padding, padding / 2, padding, padding / 2)
            textSize = 16f
            if (watchUrl.isNotBlank()) {
                android.text.util.Linkify.addLinks(this, android.text.util.Linkify.WEB_URLS)
                movementMethod = android.text.method.LinkMovementMethod.getInstance()
            }
        }

        val builder = MaterialAlertDialogBuilder(requireContext())
            .setTitle(broadcast.title)
            .setView(messageView)
            .setNegativeButton(R.string.action_close, null)

        if (watchUrl.isNotBlank()) {
            builder.setPositiveButton(R.string.action_open_youtube) { _, _ ->
                openYouTube(watchUrl)
            }
        }

        builder.show()
    }

    private fun openYouTube(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(requireContext(), R.string.error_youtube_unavailable, Toast.LENGTH_SHORT).show()
        }
    }

    private data class PlatformOption(val value: String, val labelRes: Int)
    private data class VisibilityOption(val value: String, val labelRes: Int)
}
