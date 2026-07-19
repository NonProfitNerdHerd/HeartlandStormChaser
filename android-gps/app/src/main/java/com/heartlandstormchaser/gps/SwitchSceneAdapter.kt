package com.heartlandstormchaser.gps

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.button.MaterialButton
import com.heartlandstormchaser.gps.databinding.ItemSwitchSceneBinding

data class SwitchSceneRow(
    val name: String,
    val isActive: Boolean,
    val enabled: Boolean,
)

class SwitchSceneAdapter(
    private val onSceneClick: (String) -> Unit,
) : ListAdapter<SwitchSceneRow, SwitchSceneAdapter.SceneViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): SceneViewHolder {
        val binding = ItemSwitchSceneBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return SceneViewHolder(binding)
    }

    override fun onBindViewHolder(holder: SceneViewHolder, position: Int) {
        holder.bind(getItem(position), onSceneClick)
    }

    class SceneViewHolder(
        private val binding: ItemSwitchSceneBinding,
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(row: SwitchSceneRow, onSceneClick: (String) -> Unit) {
            val button = binding.switchSceneButton
            button.text = row.name
            button.isEnabled = row.enabled && !row.isActive
            applyStyle(button, row.isActive)
            button.setOnClickListener {
                if (!row.isActive) {
                    onSceneClick(row.name)
                }
            }
        }

        private fun applyStyle(button: MaterialButton, active: Boolean) {
            if (active) {
                button.setBackgroundColor(button.context.getColor(R.color.md_theme_primary))
                button.setTextColor(button.context.getColor(R.color.md_theme_on_primary))
                button.strokeWidth = 0
            } else {
                button.setBackgroundColor(button.context.getColor(android.R.color.transparent))
                button.setTextColor(button.context.getColor(R.color.md_theme_primary))
                button.strokeWidth = (1 * button.resources.displayMetrics.density).toInt().coerceAtLeast(1)
                button.strokeColor = android.content.res.ColorStateList.valueOf(
                    button.context.getColor(R.color.md_theme_outline),
                )
            }
        }
    }

    private companion object DiffCallback : DiffUtil.ItemCallback<SwitchSceneRow>() {
        override fun areItemsTheSame(oldItem: SwitchSceneRow, newItem: SwitchSceneRow): Boolean {
            return oldItem.name == newItem.name
        }

        override fun areContentsTheSame(oldItem: SwitchSceneRow, newItem: SwitchSceneRow): Boolean {
            return oldItem == newItem
        }
    }
}
