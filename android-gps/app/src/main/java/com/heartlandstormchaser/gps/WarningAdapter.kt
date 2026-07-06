package com.heartlandstormchaser.gps

import android.graphics.Color
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.heartlandstormchaser.gps.databinding.ItemWarningBinding

class WarningAdapter(
    private val onWarningClick: (WarningAlert) -> Unit,
) : ListAdapter<WarningAlert, WarningAdapter.WarningViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): WarningViewHolder {
        val binding = ItemWarningBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return WarningViewHolder(binding, onWarningClick)
    }

    override fun onBindViewHolder(holder: WarningViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    class WarningViewHolder(
        private val binding: ItemWarningBinding,
        private val onWarningClick: (WarningAlert) -> Unit,
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(alert: WarningAlert) {
            binding.warningEventBanner.text = alert.event
            binding.warningEventBanner.setBackgroundColor(parseColor(alert.color))
            binding.warningSeverityText.text = "${alert.severity} · ${alert.urgency}"
            binding.warningDistanceText.text = binding.root.context.getString(
                R.string.warning_distance_miles,
                alert.distanceMiles,
            )
            binding.warningAreaText.text = alert.areaLabel.ifBlank { alert.areaDesc }
            binding.warningExpiresText.text = binding.root.context.getString(
                R.string.warning_expires_at,
                alert.expires.ifBlank { alert.ends.orEmpty() },
            )
            binding.root.setOnClickListener { onWarningClick(alert) }
        }

        private fun parseColor(value: String): Int {
            return runCatching { Color.parseColor(value) }.getOrDefault(Color.parseColor("#ff8c00"))
        }
    }

    private companion object DiffCallback : DiffUtil.ItemCallback<WarningAlert>() {
        override fun areItemsTheSame(oldItem: WarningAlert, newItem: WarningAlert): Boolean {
            return oldItem.id == newItem.id
        }

        override fun areContentsTheSame(oldItem: WarningAlert, newItem: WarningAlert): Boolean {
            return oldItem == newItem
        }
    }
}
