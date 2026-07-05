package com.heartlandstormchaser.gps

import android.content.Intent
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.tabs.TabLayoutMediator
import com.heartlandstormchaser.gps.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var preferences: GpsPreferences

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        preferences = GpsPreferences(this)

        if (!preferences.isPaired) {
            startActivity(Intent(this, PairingActivity::class.java))
            finish()
            return
        }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.mainToolbar)

        binding.mainPager.adapter = MainPagerAdapter(this)
        TabLayoutMediator(binding.mainTabs, binding.mainPager) { tab, position ->
            tab.text = when (position) {
                0 -> getString(R.string.tab_gps)
                else -> getString(R.string.tab_overlays)
            }
        }.attach()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.menu_main, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_repair -> {
                startActivity(Intent(this, PairingActivity::class.java))
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    override fun onResume() {
        super.onResume()
        if (!preferences.isPaired) {
            startActivity(Intent(this, PairingActivity::class.java))
            finish()
        }
    }
}
