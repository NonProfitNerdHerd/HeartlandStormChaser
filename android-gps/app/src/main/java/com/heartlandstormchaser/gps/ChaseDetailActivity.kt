package com.heartlandstormchaser.gps

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.heartlandstormchaser.gps.databinding.ActivityChaseDetailBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class ChaseDetailActivity : AppCompatActivity() {
    private lateinit var binding: ActivityChaseDetailBinding
    private lateinit var preferences: GpsPreferences
    private lateinit var expenseAdapter: ChaseExpenseAdapter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityChaseDetailBinding.inflate(layoutInflater)
        setContentView(binding.root)

        preferences = GpsPreferences(this)
        val chaseId = intent.getStringExtra(EXTRA_CHASE_ID)
        if (chaseId.isNullOrBlank()) {
            finish()
            return
        }

        setSupportActionBar(binding.chaseDetailToolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        binding.chaseDetailToolbar.setNavigationOnClickListener { finish() }

        expenseAdapter = ChaseExpenseAdapter { }
        binding.chaseDetailExpensesList.layoutManager = LinearLayoutManager(this)
        binding.chaseDetailExpensesList.adapter = expenseAdapter

        setupMapWebView()
        loadChaseDetail(chaseId)
    }

    private fun setupMapWebView() {
        binding.chaseDetailMapWebView.settings.javaScriptEnabled = true
        binding.chaseDetailMapWebView.settings.domStorageEnabled = true
        binding.chaseDetailMapWebView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                pendingMapPayload?.let { payload ->
                    view?.evaluateJavascript("renderRoute($payload)", null)
                    pendingMapPayload = null
                }
            }
        }
        binding.chaseDetailMapWebView.loadUrl("file:///android_asset/chase_map.html")
    }

    private var pendingMapPayload: String? = null

    private fun loadChaseDetail(chaseId: String) {
        binding.chaseDetailProgress.isVisible = true
        binding.chaseDetailScroll.isVisible = false

        lifecycleScope.launch {
            val client = GpsApiClient(preferences.serverUrl, preferences.deviceToken)
            val result = withContext(Dispatchers.IO) { client.fetchChaseDetail(chaseId) }

            binding.chaseDetailProgress.isVisible = false

            if (!result.success || result.detail == null) {
                Toast.makeText(
                    this@ChaseDetailActivity,
                    result.error ?: getString(R.string.error_load_chases),
                    Toast.LENGTH_SHORT,
                ).show()
                finish()
                return@launch
            }

            renderDetail(result.detail)
            binding.chaseDetailScroll.isVisible = true
        }
    }

    private fun renderDetail(detail: ChaseDetail) {
        val chase = detail.chase
        binding.chaseDetailNameText.text = chase.chaseName
        binding.chaseDetailStatusText.text = statusLabel(chase.status)
        binding.chaseDetailDistanceText.text = getString(
            R.string.chase_distance_miles,
            chase.totalDistanceMiles,
        )
        binding.chaseDetailDurationText.text = getString(
            R.string.chase_duration_elapsed,
            formatChaseDuration(chase.startTime, chase.endTime),
        )
        binding.chaseDetailExpensesTotalText.text = getString(
            R.string.chase_expenses_total,
            chase.totalExpenses,
        )

        val notes = chase.notes.trim()
        binding.chaseDetailNotesText.text = if (notes.isBlank()) {
            getString(R.string.chase_detail_no_notes)
        } else {
            notes
        }

        expenseAdapter.submitList(detail.expenses)
        binding.chaseDetailExpensesEmptyText.isVisible = detail.expenses.isEmpty()

        renderMap(detail)
    }

    private fun renderMap(detail: ChaseDetail) {
        val chase = detail.chase
        val pointsJson = JSONArray()
        detail.points.forEach { point ->
            pointsJson.put(
                JSONObject()
                    .put("lat", point.lat)
                    .put("lng", point.lng),
            )
        }

        val payload = JSONObject()
            .put(
                "chase",
                JSONObject()
                    .put("start_lat", chase.startLat)
                    .put("start_lng", chase.startLng),
            )
            .put("points", pointsJson)
            .toString()

        pendingMapPayload = JSONObject.quote(payload)
        binding.chaseDetailMapWebView.evaluateJavascript("renderRoute($pendingMapPayload)", null)
    }

    private fun statusLabel(status: String): String {
        return when (status) {
            "active" -> getString(R.string.chase_status_active)
            "paused" -> getString(R.string.chase_status_paused)
            else -> getString(R.string.chase_status_completed)
        }
    }

    companion object {
        private const val EXTRA_CHASE_ID = "chase_id"

        fun createIntent(context: Context, chaseId: String): Intent {
            return Intent(context, ChaseDetailActivity::class.java).putExtra(EXTRA_CHASE_ID, chaseId)
        }
    }
}

fun formatChaseDuration(startTime: String, endTime: String?): String {
    val start = parseChaseInstant(startTime) ?: return "—"
    val end = endTime?.let { parseChaseInstant(it) } ?: Instant.now()
    val seconds = Duration.between(start, end).seconds.coerceAtLeast(0)
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    val secs = seconds % 60
    return if (hours > 0) {
        String.format("%d:%02d:%02d", hours, minutes, secs)
    } else {
        String.format("%d:%02d", minutes, secs)
    }
}

fun parseChaseInstant(value: String): Instant? {
    val trimmed = value.trim()
    if (trimmed.isBlank()) {
        return null
    }

    return runCatching {
        Instant.parse(trimmed)
    }.getOrNull() ?: runCatching {
        val normalized = if (trimmed.contains("T")) trimmed else trimmed.replace(" ", "T")
        val withZone = if (normalized.endsWith("Z") || normalized.contains("+")) {
            normalized
        } else {
            "${normalized}Z"
        }
        Instant.parse(withZone)
    }.getOrNull() ?: runCatching {
        val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
        LocalDateTime.parse(trimmed, formatter).atZone(ZoneId.of("UTC")).toInstant()
    }.getOrNull()
}
