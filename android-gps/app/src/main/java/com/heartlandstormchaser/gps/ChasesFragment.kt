package com.heartlandstormchaser.gps

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.core.view.isVisible
import androidx.core.widget.doAfterTextChanged
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.heartlandstormchaser.gps.databinding.DialogChaseExpenseBinding
import com.heartlandstormchaser.gps.databinding.DialogCreateChaseBinding
import com.heartlandstormchaser.gps.databinding.FragmentChasesBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ChasesFragment : Fragment() {
    private var _binding: FragmentChasesBinding? = null
    private val binding get() = _binding!!
    private lateinit var preferences: GpsPreferences
    private lateinit var chaseAdapter: ChaseAdapter
    private lateinit var expenseAdapter: ChaseExpenseAdapter

    private var activeChase: ChaseSummary? = null
    private var activeExpenses: List<ChaseExpense> = emptyList()
    private var notesDirty = false
    private var refreshJob: Job? = null
    private var durationJob: Job? = null

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        _binding = FragmentChasesBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        preferences = GpsPreferences(requireContext())

        chaseAdapter = ChaseAdapter { chase ->
            startActivity(ChaseDetailActivity.createIntent(requireContext(), chase.id))
        }
        binding.chasesList.layoutManager = LinearLayoutManager(requireContext())
        binding.chasesList.adapter = chaseAdapter

        expenseAdapter = ChaseExpenseAdapter { expense -> showExpenseDialog(expense) }
        binding.activeChaseExpensesList.layoutManager = LinearLayoutManager(requireContext())
        binding.activeChaseExpensesList.adapter = expenseAdapter

        binding.startChaseButton.setOnClickListener { showCreateChaseDialog() }
        binding.pauseResumeChaseButton.setOnClickListener { togglePauseResume() }
        binding.endChaseButton.setOnClickListener { confirmEndChase() }
        binding.saveChaseNotesButton.setOnClickListener { saveNotes() }
        binding.addExpenseButton.setOnClickListener { showExpenseDialog(null) }

        binding.activeChaseNotesInput.doAfterTextChanged {
            notesDirty = true
        }
    }

    override fun onResume() {
        super.onResume()
        refreshChases()
        startActiveChaseMonitoring()
    }

    override fun onPause() {
        refreshJob?.cancel()
        durationJob?.cancel()
        super.onPause()
    }

    override fun onDestroyView() {
        _binding = null
        super.onDestroyView()
    }

    private fun refreshChases() {
        binding.chasesProgress.isVisible = true

        viewLifecycleOwner.viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val activeResult = withContext(Dispatchers.IO) { client.fetchActiveChase() }
            val listResult = withContext(Dispatchers.IO) { client.fetchAllChases() }

            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.chasesProgress.isVisible = false

            if (!activeResult.success && !listResult.success) {
                binding.chasesMetaText.text = activeResult.error ?: listResult.error
                    ?: getString(R.string.error_load_chases)
                return@launch
            }

            activeChase = activeResult.chase
            if (activeChase != null) {
                preferences.saveActiveChase(activeChase!!.id, activeChase!!.status)
                loadActiveChaseDetail(activeChase!!.id)
            } else {
                preferences.clearActiveChase()
                activeExpenses = emptyList()
                renderActiveChase()
            }

            val previousChases = listResult.chases.filter { chase ->
                chase.status == "completed"
            }
            chaseAdapter.submitList(previousChases)

            binding.chasesMetaText.text = getString(R.string.chases_meta, listResult.chases.size)
            binding.previousChasesHeading.isVisible = previousChases.isNotEmpty()
            binding.chasesEmptyText.isVisible = activeChase == null && previousChases.isEmpty()
            binding.startChaseButton.isVisible = activeChase == null

            updateGpsWarning()
        }
    }

    private suspend fun loadActiveChaseDetail(chaseId: String) {
        val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
        val detailResult = withContext(Dispatchers.IO) { client.fetchChaseDetail(chaseId) }
        if (_binding == null || !isAdded) {
            return
        }
        if (detailResult.success && detailResult.detail != null) {
            activeChase = detailResult.detail.chase
            activeExpenses = detailResult.detail.expenses
            preferences.saveActiveChase(activeChase!!.id, activeChase!!.status)
        }
        renderActiveChase()
    }

    private fun renderActiveChase() {
        val chase = activeChase
        binding.activeChaseCard.isVisible = chase != null
        if (chase == null) {
            return
        }

        binding.activeChaseNameText.text = chase.chaseName
        binding.activeChaseStatusText.text = statusLabel(chase.status)
        binding.activeChaseDistanceText.text = getString(
            R.string.chase_distance_miles,
            chase.totalDistanceMiles,
        )
        binding.activeChaseDurationText.text = getString(
            R.string.chase_duration_elapsed,
            formatChaseDuration(chase.startTime, chase.endTime),
        )
        binding.activeChaseExpensesText.text = getString(
            R.string.chase_expenses_total,
            chase.totalExpenses,
        )

        val isRecording = chase.status == "active"
        binding.activeChaseRecordingText.isVisible = isRecording
        binding.pauseResumeChaseButton.text = if (chase.status == "paused") {
            getString(R.string.action_resume_chase)
        } else {
            getString(R.string.action_pause_chase)
        }
        binding.pauseResumeChaseButton.isEnabled = chase.status != "completed"
        binding.endChaseButton.isEnabled = chase.status != "completed"
        binding.addExpenseButton.isEnabled = chase.status != "completed"

        if (!notesDirty) {
            binding.activeChaseNotesInput.setText(chase.notes)
        }

        expenseAdapter.submitList(activeExpenses)
        updateGpsWarning()
        startActiveChaseMonitoring()
    }

    private fun startActiveChaseMonitoring() {
        refreshJob?.cancel()
        durationJob?.cancel()

        val chase = activeChase ?: return
        if (chase.status != "active" && chase.status != "paused") {
            return
        }

        durationJob = viewLifecycleOwner.lifecycleScope.launch {
            while (isActive) {
                updateDurationDisplay()
                delay(1_000)
            }
        }

        refreshJob = viewLifecycleOwner.lifecycleScope.launch {
            while (isActive) {
                delay(10_000)
                val current = activeChase ?: break
                if (current.status != "active" && current.status != "paused") {
                    break
                }
                loadActiveChaseDetail(current.id)
            }
        }
    }

    private fun updateDurationDisplay() {
        val chase = activeChase ?: return
        val b = _binding ?: return
        b.activeChaseDurationText.text = getString(
            R.string.chase_duration_elapsed,
            formatChaseDuration(chase.startTime, chase.endTime),
        )
    }

    private fun updateGpsWarning() {
        val showWarning = activeChase != null &&
            activeChase!!.status == "active" &&
            !preferences.broadcasting
        binding.chaseGpsWarningCard.isVisible = showWarning
    }

    private fun statusLabel(status: String): String {
        return when (status) {
            "active" -> getString(R.string.chase_status_active)
            "paused" -> getString(R.string.chase_status_paused)
            else -> getString(R.string.chase_status_completed)
        }
    }

    private fun showCreateChaseDialog() {
        val dialogBinding = DialogCreateChaseBinding.inflate(layoutInflater)
        val dialog = MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.dialog_create_chase_title)
            .setView(dialogBinding.root)
            .setPositiveButton(R.string.action_start_chase, null)
            .setNegativeButton(android.R.string.cancel, null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val name = dialogBinding.createChaseNameInput.text?.toString().orEmpty().trim()
                if (name.isBlank()) {
                    Toast.makeText(requireContext(), R.string.error_chase_name_required, Toast.LENGTH_SHORT).show()
                    return@setOnClickListener
                }
                dialog.dismiss()
                startChase(name)
            }
        }
        dialog.show()
    }

    private fun startChase(name: String) {
        binding.chasesProgress.isVisible = true
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) { client.createChase(name) }
            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.chasesProgress.isVisible = false

            if (!result.success || result.chase == null) {
                Toast.makeText(
                    requireContext(),
                    result.error ?: getString(R.string.error_create_chase),
                    Toast.LENGTH_SHORT,
                ).show()
                return@launch
            }

            notesDirty = false
            preferences.saveActiveChase(result.chase.id, result.chase.status)
            Toast.makeText(requireContext(), R.string.chase_created, Toast.LENGTH_SHORT).show()
            refreshChases()
        }
    }

    private fun togglePauseResume() {
        val chase = activeChase ?: return
        val newStatus = if (chase.status == "paused") "active" else "paused"

        binding.chasesProgress.isVisible = true
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.updateChase(chase.id, status = newStatus)
            }
            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.chasesProgress.isVisible = false

            if (!result.success || result.chase == null) {
                Toast.makeText(
                    requireContext(),
                    result.error ?: getString(R.string.error_update_chase),
                    Toast.LENGTH_SHORT,
                ).show()
                return@launch
            }

            activeChase = result.chase
            preferences.saveActiveChase(result.chase.id, result.chase.status)
            val message = if (newStatus == "paused") R.string.chase_paused else R.string.chase_resumed
            Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show()
            renderActiveChase()
        }
    }

    private fun confirmEndChase() {
        MaterialAlertDialogBuilder(requireContext())
            .setTitle(R.string.chase_end_confirm_title)
            .setMessage(R.string.chase_end_confirm_message)
            .setPositiveButton(R.string.action_end_chase) { _, _ -> endChase() }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun endChase() {
        val chase = activeChase ?: return

        binding.chasesProgress.isVisible = true
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) { client.completeChase(chase.id) }
            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.chasesProgress.isVisible = false

            if (!result.success) {
                Toast.makeText(
                    requireContext(),
                    result.error ?: getString(R.string.error_update_chase),
                    Toast.LENGTH_SHORT,
                ).show()
                return@launch
            }

            notesDirty = false
            preferences.clearActiveChase()
            preferences.clearPendingChasePoints()
            Toast.makeText(requireContext(), R.string.chase_completed, Toast.LENGTH_SHORT).show()
            refreshChases()
        }
    }

    private fun saveNotes() {
        val chase = activeChase ?: return
        val notes = binding.activeChaseNotesInput.text?.toString().orEmpty()

        binding.chasesProgress.isVisible = true
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.updateChase(chase.id, notes = notes)
            }
            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.chasesProgress.isVisible = false

            if (!result.success || result.chase == null) {
                Toast.makeText(
                    requireContext(),
                    result.error ?: getString(R.string.error_update_chase),
                    Toast.LENGTH_SHORT,
                ).show()
                return@launch
            }

            notesDirty = false
            activeChase = result.chase
            Toast.makeText(requireContext(), R.string.chase_notes_saved, Toast.LENGTH_SHORT).show()
            renderActiveChase()
        }
    }

    private fun showExpenseDialog(existing: ChaseExpense?) {
        val chase = activeChase ?: return
        val dialogBinding = DialogChaseExpenseBinding.inflate(layoutInflater)
        val categories = listOf(
            getString(R.string.expense_category_gas),
            getString(R.string.expense_category_food),
            getString(R.string.expense_category_hotel),
            getString(R.string.expense_category_equipment),
            getString(R.string.expense_category_souveniers),
            getString(R.string.expense_category_software),
            getString(R.string.expense_category_other),
        )

        dialogBinding.expenseCategoryInput.setAdapter(
            ArrayAdapter(requireContext(), android.R.layout.simple_dropdown_item_1line, categories),
        )

        if (existing != null) {
            dialogBinding.expenseCategoryInput.setText(existing.category, false)
            dialogBinding.expenseAmountInput.setText(existing.amount.toString())
            dialogBinding.expenseDescriptionInput.setText(existing.description)
        } else {
            dialogBinding.expenseCategoryInput.setText(categories.first(), false)
        }

        val builder = MaterialAlertDialogBuilder(requireContext())
            .setTitle(if (existing == null) R.string.dialog_expense_title_add else R.string.dialog_expense_title_edit)
            .setView(dialogBinding.root)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val category = dialogBinding.expenseCategoryInput.text?.toString().orEmpty().trim()
                val amountText = dialogBinding.expenseAmountInput.text?.toString().orEmpty().trim()
                val amount = amountText.toDoubleOrNull()
                if (amount == null || amount < 0) {
                    Toast.makeText(requireContext(), R.string.error_expense_amount_invalid, Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }

                val description = dialogBinding.expenseDescriptionInput.text?.toString().orEmpty()
                if (existing == null) {
                    addExpense(chase.id, category, amount, description)
                } else {
                    updateExpense(chase.id, existing.id, category, amount, description)
                }
            }
            .setNegativeButton(android.R.string.cancel, null)

        if (existing != null) {
            builder.setNeutralButton(R.string.action_delete) { _, _ ->
                deleteExpense(chase.id, existing.id)
            }
        }

        builder.show()
    }

    private fun addExpense(chaseId: String, category: String, amount: Double, description: String) {
        binding.chasesProgress.isVisible = true
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.addExpense(chaseId, category, amount, description)
            }
            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.chasesProgress.isVisible = false

            if (!result.success) {
                Toast.makeText(requireContext(), result.error, Toast.LENGTH_SHORT).show()
                return@launch
            }

            Toast.makeText(requireContext(), R.string.expense_saved, Toast.LENGTH_SHORT).show()
            loadActiveChaseDetail(chaseId)
        }
    }

    private fun updateExpense(
        chaseId: String,
        expenseId: String,
        category: String,
        amount: Double,
        description: String,
    ) {
        binding.chasesProgress.isVisible = true
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) {
                client.updateExpense(chaseId, expenseId, category, amount, description)
            }
            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.chasesProgress.isVisible = false

            if (!result.success) {
                Toast.makeText(requireContext(), result.error, Toast.LENGTH_SHORT).show()
                return@launch
            }

            Toast.makeText(requireContext(), R.string.expense_saved, Toast.LENGTH_SHORT).show()
            loadActiveChaseDetail(chaseId)
        }
    }

    private fun deleteExpense(chaseId: String, expenseId: String) {
        binding.chasesProgress.isVisible = true
        viewLifecycleOwner.lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) { client.deleteExpense(chaseId, expenseId) }
            if (_binding == null || !isAdded) {
                return@launch
            }
            binding.chasesProgress.isVisible = false

            if (!result.success) {
                Toast.makeText(requireContext(), result.error, Toast.LENGTH_SHORT).show()
                return@launch
            }

            Toast.makeText(requireContext(), R.string.expense_deleted, Toast.LENGTH_SHORT).show()
            loadActiveChaseDetail(chaseId)
        }
    }
}
