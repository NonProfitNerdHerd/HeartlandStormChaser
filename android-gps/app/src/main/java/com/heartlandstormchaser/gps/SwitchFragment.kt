package com.heartlandstormchaser.gps

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.heartlandstormchaser.gps.databinding.FragmentSwitchBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SwitchFragment : Fragment() {
    private var _binding: FragmentSwitchBinding? = null
    private val binding get() = _binding!!
    private lateinit var preferences: GpsPreferences
    private lateinit var sceneAdapter: SwitchSceneAdapter

    private var pollJob: Job? = null
    private var activateBusy = false
    private var stopBusy = false
    private var currentProgramScene: String? = null
    private var streamingActive = false

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentSwitchBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        preferences = GpsPreferences(requireContext())

        sceneAdapter = SwitchSceneAdapter { sceneName -> activateScene(sceneName) }
        binding.switchSceneList.layoutManager = LinearLayoutManager(requireContext())
        binding.switchSceneList.adapter = sceneAdapter

        binding.switchRefresh.setOnRefreshListener { refreshScenes(showProgress = false) }
        binding.switchStopStreamButton.setOnClickListener { confirmStopStream() }
        updateStopButton()
    }

    override fun onResume() {
        super.onResume()
        refreshScenes(showProgress = true)
        startPolling()
    }

    override fun onPause() {
        pollJob?.cancel()
        pollJob = null
        super.onPause()
    }

    override fun onDestroyView() {
        pollJob?.cancel()
        pollJob = null
        _binding = null
        super.onDestroyView()
    }

    private fun startPolling() {
        pollJob?.cancel()
        pollJob = viewLifecycleOwner.lifecycleScope.launch {
            while (isActive) {
                delay(3_000)
                if (!activateBusy && !stopBusy) {
                    refreshScenes(showProgress = false)
                }
            }
        }
    }

    private fun refreshScenes(showProgress: Boolean) {
        if (_binding == null) {
            return
        }
        if (showProgress) {
            binding.switchProgress.isVisible = true
        }

        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) { client.fetchBroadcastScenes() }

            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.switchProgress.isVisible = false
            binding.switchRefresh.isRefreshing = false

            if (!result.success) {
                binding.switchStatusText.text = result.error ?: getString(R.string.error_load_scenes)
                sceneAdapter.submitList(emptyList())
                streamingActive = false
                updateStopButton()
                return@launch
            }

            streamingActive = result.streamingActive && result.obsConnected && result.listenerConnected
            updateStopButton()

            if (!result.obsConnected || !result.listenerConnected) {
                binding.switchStatusText.text = result.error?.takeIf { it.isNotBlank() }
                    ?: getString(R.string.switch_obs_disconnected)
                sceneAdapter.submitList(emptyList())
                return@launch
            }

            currentProgramScene = result.currentProgramScene
            if (result.scenes.isEmpty()) {
                binding.switchStatusText.text = getString(R.string.switch_no_scenes)
                sceneAdapter.submitList(emptyList())
                return@launch
            }

            val active = currentProgramScene
            binding.switchStatusText.text = if (active.isNullOrBlank()) {
                getString(R.string.switch_status_active_none)
            } else {
                getString(R.string.switch_status_connected, active)
            }

            sceneAdapter.submitList(
                result.scenes.map { scene ->
                    SwitchSceneRow(
                        name = scene.name,
                        isActive = scene.name == active,
                        enabled = !activateBusy,
                    )
                },
            )
        }
    }

    private fun updateStopButton() {
        val button = _binding?.switchStopStreamButton ?: return
        if (streamingActive && !stopBusy) {
            button.isEnabled = true
            button.text = getString(R.string.action_stop_streaming)
            button.alpha = 1f
        } else {
            button.isEnabled = false
            button.text = getString(R.string.switch_no_stream_active)
            button.alpha = if (stopBusy) 0.7f else 0.55f
        }
    }

    private fun confirmStopStream() {
        if (!streamingActive || stopBusy) {
            return
        }
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.switch_stop_confirm_title)
            .setMessage(R.string.switch_stop_confirm_message)
            .setNegativeButton(R.string.action_close, null)
            .setPositiveButton(R.string.action_stop_streaming) { _, _ -> stopStream() }
            .show()
    }

    private fun stopStream() {
        if (stopBusy) {
            return
        }
        stopBusy = true
        updateStopButton()

        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) { client.stopBroadcastStream() }

            if (_binding == null || !isAdded) {
                return@launch
            }

            stopBusy = false
            if (!result.success) {
                updateStopButton()
                Toast.makeText(
                    requireContext(),
                    result.error ?: getString(R.string.error_stop_stream),
                    Toast.LENGTH_LONG,
                ).show()
                refreshScenes(showProgress = false)
                return@launch
            }

            streamingActive = false
            updateStopButton()
            Toast.makeText(requireContext(), R.string.switch_stream_stopped, Toast.LENGTH_SHORT).show()
            refreshScenes(showProgress = false)
        }
    }

    private fun activateScene(sceneName: String) {
        if (activateBusy) {
            return
        }
        activateBusy = true
        updateBusyState()

        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.activateBroadcastScene(sceneName)
            }

            if (_binding == null || !isAdded) {
                return@launch
            }

            activateBusy = false
            if (!result.success) {
                updateBusyState()
                Toast.makeText(
                    requireContext(),
                    result.error ?: getString(R.string.error_activate_scene),
                    Toast.LENGTH_LONG,
                ).show()
                refreshScenes(showProgress = false)
                return@launch
            }

            currentProgramScene = result.currentProgramScene ?: sceneName
            Toast.makeText(
                requireContext(),
                getString(R.string.switch_scene_activated, currentProgramScene),
                Toast.LENGTH_SHORT,
            ).show()
            refreshScenes(showProgress = false)
        }
    }

    private fun updateBusyState() {
        val active = currentProgramScene
        val current = sceneAdapter.currentList
        if (current.isEmpty()) {
            return
        }
        sceneAdapter.submitList(
            current.map { row ->
                row.copy(
                    isActive = row.name == active,
                    enabled = !activateBusy,
                )
            },
        )
    }
}
