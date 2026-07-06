package com.heartlandstormchaser.gps

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.view.isVisible
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.heartlandstormchaser.gps.databinding.ItemChaseExpenseBinding

class ChaseExpenseAdapter(
    private val onExpenseClick: (ChaseExpense) -> Unit,
) : ListAdapter<ChaseExpense, ChaseExpenseAdapter.ExpenseViewHolder>(DiffCallback) {

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ExpenseViewHolder {
        val binding = ItemChaseExpenseBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ExpenseViewHolder(binding, onExpenseClick)
    }

    override fun onBindViewHolder(holder: ExpenseViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    class ExpenseViewHolder(
        private val binding: ItemChaseExpenseBinding,
        private val onExpenseClick: (ChaseExpense) -> Unit,
    ) : RecyclerView.ViewHolder(binding.root) {
        fun bind(expense: ChaseExpense) {
            binding.expenseCategoryText.text = expense.category
            binding.expenseAmountText.text = String.format("$%.2f", expense.amount)

            val description = expense.description.trim()
            binding.expenseDescriptionText.isVisible = description.isNotBlank()
            binding.expenseDescriptionText.text = description
            binding.root.setOnClickListener { onExpenseClick(expense) }
        }
    }

    private companion object DiffCallback : DiffUtil.ItemCallback<ChaseExpense>() {
        override fun areItemsTheSame(oldItem: ChaseExpense, newItem: ChaseExpense): Boolean {
            return oldItem.id == newItem.id
        }

        override fun areContentsTheSame(oldItem: ChaseExpense, newItem: ChaseExpense): Boolean {
            return oldItem == newItem
        }
    }
}
