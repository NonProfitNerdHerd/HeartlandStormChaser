const NOMINATIM_USER_AGENT = "HeartlandStormChaser/1.0 (contact@heartlandstormchaser.local)";

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

function normalizeState(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 2) {
    return trimmed.toUpperCase();
  }

  return STATE_NAME_TO_CODE[trimmed.toLowerCase()] ?? null;
}

function extractCity(address: Record<string, string | undefined>): string | null {
  return (
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    address.county?.replace(/ County$/i, "") ||
    null
  );
}

export async function handleGeocode(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname !== "/api/geocode/suggest" || request.method !== "GET") {
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return Response.json({ ok: true, suggestions: [] });
  }

  const encoded = encodeURIComponent(`${query}, USA`);
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&addressdetails=1&limit=10&countrycodes=us`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": NOMINATIM_USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    return Response.json({ ok: false, error: "Geocode lookup failed" }, { status: 502 });
  }

  const results = (await response.json()) as Array<{
    display_name?: string;
    address?: Record<string, string | undefined>;
  }>;

  const suggestions: Array<{ city: string; state: string; label: string }> = [];
  const seen = new Set<string>();

  for (const result of results) {
    const address = result.address ?? {};
    const city = extractCity(address);
    const state = normalizeState(address.state);
    if (!city || !state) {
      continue;
    }

    const label = `${city}, ${state}`;
    const key = label.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    suggestions.push({ city, state, label });
  }

  return Response.json({ ok: true, suggestions });
}
