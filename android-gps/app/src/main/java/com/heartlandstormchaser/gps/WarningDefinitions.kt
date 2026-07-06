package com.heartlandstormchaser.gps

object WarningDefinitions {
    val COMMON_EVENT_TYPES = listOf(
        "Tornado Warning",
        "Severe Thunderstorm Warning",
        "Flash Flood Warning",
        "Flood Warning",
        "Flood Watch",
        "Flash Flood Watch",
        "Tornado Watch",
        "Severe Thunderstorm Watch",
        "Special Weather Statement",
        "Winter Storm Warning",
        "Blizzard Warning",
        "High Wind Warning",
    )

    val RADIUS_OPTIONS_MILES = listOf(25, 50, 100, 200, 350, 500, 700, 1000)

    val SOUND_EVENT_TYPES = listOf(
        "Tornado Warning",
        "Tornado Watch",
        "Severe Thunderstorm Warning",
        "Severe Thunderstorm Watch",
    )

    fun soundResourceId(event: String): Int? = when (event) {
        "Tornado Warning" -> R.raw.tornado_warning
        "Tornado Watch" -> R.raw.tornado_watch
        "Severe Thunderstorm Warning" -> R.raw.severe_thunderstorm_warning
        "Severe Thunderstorm Watch" -> R.raw.severe_thunderstorm_watch
        else -> null
    }

    fun hasSound(event: String): Boolean = soundResourceId(event) != null
}
