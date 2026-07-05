package com.heartlandstormchaser.gps

import java.net.URI

object ApiUrlHelper {
    fun normalizeServerUrl(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isBlank()) {
            return ""
        }

        return try {
            val uri = URI(trimmed)
            val scheme = uri.scheme ?: return trimmed
            val host = uri.host ?: return trimmed
            val port = uri.port
            val portSuffix = when {
                port <= 0 -> ""
                (scheme == "https" && port == 443) || (scheme == "http" && port == 80) -> ""
                else -> ":$port"
            }
            "$scheme://$host$portSuffix"
        } catch (_: Exception) {
            trimmed
        }
    }

    fun apiUrl(serverUrl: String, path: String): String {
        val base = normalizeServerUrl(serverUrl)
        val normalizedPath = if (path.startsWith("/")) path else "/$path"
        return "$base$normalizedPath"
    }
}
