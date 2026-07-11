package com.heartlandstormchaser.gps

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Heartland operations timezone (Central Time; CST/CDT via IANA rules). */
object CentralTime {
    val zone: ZoneId = ZoneId.of("America/Chicago")

    private val dateTimeFormatter: DateTimeFormatter =
        DateTimeFormatter.ofPattern("MMM d, yyyy, h:mm:ss a", Locale.US)

    fun formatMillis(epochMillis: Long): String {
        if (epochMillis <= 0L) {
            return "—"
        }
        return ZonedDateTime.ofInstant(Instant.ofEpochMilli(epochMillis), zone)
            .format(dateTimeFormatter)
    }

    fun formatIso(value: String?): String {
        if (value.isNullOrBlank()) {
            return "—"
        }
        val instant = parseChaseInstant(value) ?: return value
        return ZonedDateTime.ofInstant(instant, zone).format(dateTimeFormatter)
    }
}
