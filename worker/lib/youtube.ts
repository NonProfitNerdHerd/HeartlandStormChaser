export type YouTubeParseResult =
  | { ok: true; videoId: string; embedUrl: string }
  | { ok: false; error: string };

const EMBED_BASE = "https://www.youtube.com/embed/";

function buildEmbedUrl(videoId: string): string {
  return `${EMBED_BASE}${videoId}`;
}

function extractVideoId(hostname: string, pathname: string, searchParams: URLSearchParams): string | null {
  const host = hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    const id = pathname.split("/").filter(Boolean)[0];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const v = searchParams.get("v");
    if (v && /^[\w-]{11}$/.test(v)) {
      return v;
    }

    const parts = pathname.split("/").filter(Boolean);

    if (parts[0] === "embed" || parts[0] === "live" || parts[0] === "v") {
      const id = parts[1];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }

    if (parts[0] === "shorts" && parts[1] && /^[\w-]{11}$/.test(parts[1])) {
      return parts[1];
    }
  }

  return null;
}

export function parseYouTubeUrl(rawUrl: string): YouTubeParseResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: "YouTube URL is required." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL format." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must use http or https." };
  }

  const videoId = extractVideoId(parsed.hostname, parsed.pathname, parsed.searchParams);
  if (!videoId) {
    return {
      ok: false,
      error:
        "Could not extract a YouTube video ID. Use watch, youtu.be, live, or embed URLs.",
    };
  }

  return {
    ok: true,
    videoId,
    embedUrl: buildEmbedUrl(videoId),
  };
}
