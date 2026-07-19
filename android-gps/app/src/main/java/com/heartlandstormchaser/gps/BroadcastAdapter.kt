package com.heartlandstormchaser.gps

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.heartlandstormchaser.gps.databinding.ItemBroadcastBinding

class BroadcastAdapter(
    private val onBroadcastClick: (ScheduledBroadcastSummary) -> Unit,
) : ListAdapter<ScheduledBroadcastSummary, BroadcastAdapter.BroadcastViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): BroadcastViewHolder {
        val binding = ItemBroadcastBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return BroadcastViewHolder(binding)
    }

    override fun onBindViewHolder(holder: BroadcastViewHolder, position: Int) {
        holder.bind(getItem(position), onBroadcastClick)
    }

    class BroadcastViewHolder(
        private val binding: ItemBroadcastBinding,
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(
            broadcast: ScheduledBroadcastSummary,
            onBroadcastClick: (ScheduledBroadcastSummary) -> Unit,
        ) {
            val context = binding.root.context
            binding.root.setOnClickListener { onBroadcastClick(broadcast) }
            binding.broadcastItemTitle.text = broadcast.title
            binding.broadcastItemWhen.text = CentralTime.formatIso(broadcast.scheduledAt)
            binding.broadcastItemMeta.text = context.getString(
                R.string.broadcast_item_meta,
                platformLabel(context, broadcast.platform),
                visibilityLabel(context, broadcast.visibility),
                broadcast.status,
            )
        }

        private fun platformLabel(context: android.content.Context, platform: String): String {
            return when (platform) {
                "obs" -> context.getString(R.string.broadcast_platform_obs)
                else -> context.getString(R.string.broadcast_platform_youtube)
            }
        }

        private fun visibilityLabel(context: android.content.Context, visibility: String): String {
            return when (visibility) {
                "unlisted" -> context.getString(R.string.broadcast_visibility_unlisted)
                "private" -> context.getString(R.string.broadcast_visibility_private)
                else -> context.getString(R.string.broadcast_visibility_public)
            }
        }
    }

    private companion object DiffCallback : DiffUtil.ItemCallback<ScheduledBroadcastSummary>() {
        override fun areItemsTheSame(
            oldItem: ScheduledBroadcastSummary,
            newItem: ScheduledBroadcastSummary,
        ): Boolean = oldItem.id == newItem.id

        override fun areContentsTheSame(
            oldItem: ScheduledBroadcastSummary,
            newItem: ScheduledBroadcastSummary,
        ): Boolean = oldItem == newItem
    }
}
