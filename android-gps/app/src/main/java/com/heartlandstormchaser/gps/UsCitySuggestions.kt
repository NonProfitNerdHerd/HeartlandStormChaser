package com.heartlandstormchaser.gps

data class CitySuggestion(
    val city: String,
    val state: String,
) {
    val label: String
        get() = "$city, $state"
}

object UsCitySuggestions {
    private val cities = listOf(
        CitySuggestion("Abilene", "TX"),
        CitySuggestion("Amarillo", "TX"),
        CitySuggestion("Ames", "IA"),
        CitySuggestion("Ann Arbor", "MI"),
        CitySuggestion("Atlanta", "GA"),
        CitySuggestion("Austin", "TX"),
        CitySuggestion("Bartlesville", "OK"),
        CitySuggestion("Baton Rouge", "LA"),
        CitySuggestion("Birmingham", "AL"),
        CitySuggestion("Bismarck", "ND"),
        CitySuggestion("Boise", "ID"),
        CitySuggestion("Boulder", "CO"),
        CitySuggestion("Buffalo", "NY"),
        CitySuggestion("Cedar Rapids", "IA"),
        CitySuggestion("Charlotte", "NC"),
        CitySuggestion("Chicago", "IL"),
        CitySuggestion("Cincinnati", "OH"),
        CitySuggestion("Cleveland", "OH"),
        CitySuggestion("Colorado Springs", "CO"),
        CitySuggestion("Columbus", "OH"),
        CitySuggestion("Dallas", "TX"),
        CitySuggestion("Denver", "CO"),
        CitySuggestion("Des Moines", "IA"),
        CitySuggestion("Detroit", "MI"),
        CitySuggestion("Dodge City", "KS"),
        CitySuggestion("Durant", "OK"),
        CitySuggestion("El Reno", "OK"),
        CitySuggestion("Elk City", "OK"),
        CitySuggestion("Emporia", "KS"),
        CitySuggestion("Enid", "OK"),
        CitySuggestion("Fargo", "ND"),
        CitySuggestion("Fort Smith", "AR"),
        CitySuggestion("Fort Worth", "TX"),
        CitySuggestion("Goodland", "KS"),
        CitySuggestion("Grand Island", "NE"),
        CitySuggestion("Grand Rapids", "MI"),
        CitySuggestion("Great Bend", "KS"),
        CitySuggestion("Green Bay", "WI"),
        CitySuggestion("Guymon", "OK"),
        CitySuggestion("Hays", "KS"),
        CitySuggestion("Hobart", "OK"),
        CitySuggestion("Houston", "TX"),
        CitySuggestion("Hutchinson", "KS"),
        CitySuggestion("Indianapolis", "IN"),
        CitySuggestion("Jackson", "MS"),
        CitySuggestion("Joplin", "MO"),
        CitySuggestion("Kansas City", "KS"),
        CitySuggestion("Kansas City", "MO"),
        CitySuggestion("Kearney", "NE"),
        CitySuggestion("Lafayette", "LA"),
        CitySuggestion("Laredo", "TX"),
        CitySuggestion("Lawton", "OK"),
        CitySuggestion("Liberal", "KS"),
        CitySuggestion("Lincoln", "NE"),
        CitySuggestion("Little Rock", "AR"),
        CitySuggestion("Lubbock", "TX"),
        CitySuggestion("Madison", "WI"),
        CitySuggestion("McAlester", "OK"),
        CitySuggestion("Memphis", "TN"),
        CitySuggestion("Miami", "OK"),
        CitySuggestion("Midland", "TX"),
        CitySuggestion("Milwaukee", "WI"),
        CitySuggestion("Minneapolis", "MN"),
        CitySuggestion("Mobile", "AL"),
        CitySuggestion("Moore", "OK"),
        CitySuggestion("Muskogee", "OK"),
        CitySuggestion("Nashville", "TN"),
        CitySuggestion("New Orleans", "LA"),
        CitySuggestion("Norman", "OK"),
        CitySuggestion("North Platte", "NE"),
        CitySuggestion("Oklahoma City", "OK"),
        CitySuggestion("Omaha", "NE"),
        CitySuggestion("Pampa", "TX"),
        CitySuggestion("Ponca City", "OK"),
        CitySuggestion("Pueblo", "CO"),
        CitySuggestion("Rapid City", "SD"),
        CitySuggestion("Rogers", "AR"),
        CitySuggestion("Salina", "KS"),
        CitySuggestion("San Antonio", "TX"),
        CitySuggestion("Scottsbluff", "NE"),
        CitySuggestion("Shawnee", "OK"),
        CitySuggestion("Sioux Falls", "SD"),
        CitySuggestion("Springfield", "MO"),
        CitySuggestion("St. Louis", "MO"),
        CitySuggestion("Stillwater", "OK"),
        CitySuggestion("Topeka", "KS"),
        CitySuggestion("Tulsa", "OK"),
        CitySuggestion("Tyler", "TX"),
        CitySuggestion("Wichita", "KS"),
        CitySuggestion("Wichita Falls", "TX"),
        CitySuggestion("Woodward", "OK"),
        CitySuggestion("Yukon", "OK"),
    )

    fun filter(query: String, stateFilter: String? = null, limit: Int = 8): List<CitySuggestion> {
        val normalizedQuery = query.trim()
        if (normalizedQuery.isBlank()) {
            return emptyList()
        }

        val normalizedState = stateFilter?.trim()?.uppercase()?.takeIf { it.isNotBlank() }
        val queryLower = normalizedQuery.lowercase()

        return cities.asSequence()
            .filter { suggestion ->
                if (normalizedState != null && suggestion.state != normalizedState) {
                    return@filter false
                }
                suggestion.city.lowercase().contains(queryLower) ||
                    suggestion.label.lowercase().contains(queryLower)
            }
            .distinctBy { it.label.lowercase() }
            .take(limit)
            .toList()
    }

    fun parseSelection(raw: String): CitySuggestion? {
        val trimmed = raw.trim()
        if (trimmed.isBlank()) {
            return null
        }

        cities.firstOrNull { it.label.equals(trimmed, ignoreCase = true) }?.let { return it }

        val commaParts = trimmed.split(",", limit = 2).map { it.trim() }
        if (commaParts.size == 2) {
            val city = commaParts[0]
            val state = commaParts[1].uppercase()
            if (city.isNotBlank() && state.length == 2) {
                return CitySuggestion(city, state)
            }
        }

        return null
    }
}
