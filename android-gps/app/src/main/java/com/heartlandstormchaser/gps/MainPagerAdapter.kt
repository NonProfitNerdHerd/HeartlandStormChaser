package com.heartlandstormchaser.gps

import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.viewpager2.adapter.FragmentStateAdapter

class MainPagerAdapter(activity: FragmentActivity) : FragmentStateAdapter(activity) {
    override fun getItemCount(): Int = 4

    override fun createFragment(position: Int): Fragment {
        return when (position) {
            0 -> WarningsFragment()
            1 -> OverlaysFragment()
            2 -> GpsFragment()
            else -> ChasesFragment()
        }
    }
}
