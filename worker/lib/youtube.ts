export type ChannelParseResult =
  | { ok: true; channelId: string }
  | { ok: false; error: string };

const CHANNEL_ID_PATTERN = /^UC[\w-]{22}$/;

export function isValidChannelId(value: string): boolean {
  return CHANNEL_ID_PATTERN.test(value);
}

export function buildChannelPageUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

export function buildLiveVideoEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
}

export function buildChannelLiveEmbedUrl(channelId: string): string {
  return `https://www.youtube.com/embed/live_stream?channel=${channelId}`;
}

function extractChannelIdFromPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);

  const channelIndex = parts.indexOf("channel");
  if (channelIndex >= 0 && parts[channelIndex + 1]) {
    const id = parts[channelIndex + 1];
    return isValidChannelId(id) ? id : null;
  }

  return null;
}

export function parseChannelId(rawInput: string): ChannelParseResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { ok: false, error: "Channel ID is required." };
  }

  if (isValidChannelId(trimmed)) {
    return { ok: true, channelId: trimmed };
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const parsed = new URL(trimmed);
      const fromPath = extractChannelIdFromPath(parsed.pathname);
      if (fromPath) {
        return { ok: true, channelId: fromPath };
      }

      return {
        ok: false,
        error:
          "Could not find a channel ID in that URL. Paste the UC… ID or a /channel/UC… link.",
      };
    } catch {
      return { ok: false, error: "Invalid URL format." };
    }
  }

  return {
    ok: false,
    error: "Channel ID must start with UC and be 24 characters (e.g. UCqSk-ojoH2rgAuYadPLJgJA).",
  };
}
