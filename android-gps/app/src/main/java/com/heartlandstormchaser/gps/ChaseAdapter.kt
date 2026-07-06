package com.heartlandstormchaser.gps

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.heartlandstormchaser.gps.databinding.ItemChaseBinding

class ChaseAdapter(
    private val onChaseClick: (ChaseSummary) -> Unit,
) : ListAdapter<ChaseSummary, ChaseAdapter.ChaseViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ChaseViewHolder {
        val binding = ItemChaseBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ChaseViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ChaseViewHolder, position: Int) {
        holder.bind(getItem(position), onChaseClick)
    }

    class ChaseViewHolder(
        private val binding: ItemChaseBinding,
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(chase: ChaseSummary, onChaseClick: (ChaseSummary) -> Unit) {
            val context = binding.root.context
            binding.root.setOnClickListener { onChaseClick(chase) }
            binding.chaseNameText.text = chase.chaseName
            binding.chaseStatusText.text = statusLabel(context, chase.status)
            binding.chaseDistanceText.text = context.getString(
                R.string.chase_distance_miles,
                chase.totalDistanceMiles,
            )
            binding.chaseExpensesText.text = context.getString(
                R.string.chase_expenses_total,
                chase.totalExpenses,
            )
            binding.chaseTimeText.text = if (chase.status == "completed" && !chase.endTime.isNullOrBlank()) {
                context.getString(R.string.chase_ended_at, chase.endTime)
            } else {
                context.getString(R.string.chase_started_at, chase.startTime)
            }
        }

        private fun statusLabel(context: android.content.Context, status: String): String {
            return when (status) {
                "active" -> context.getString(R.string.chase_status_active)
                "paused" -> context.getString(R.string.chase_status_paused)
                else -> context.getString(R.string.chase_status_completed)
            }
        }
    }

    private companion object DiffCallback : DiffUtil.ItemCallback<ChaseSummary>() {
        override fun areItemsTheSame(oldItem: ChaseSummary, newItem: ChaseSummary): Boolean {
            return oldItem.id == newItem.id
        }

        override fun areContentsTheSame(oldItem: ChaseSummary, newItem: ChaseSummary): Boolean {
            return oldItem == newItem
        }
    }
}
