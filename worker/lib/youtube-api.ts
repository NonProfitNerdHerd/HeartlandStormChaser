export interface ChannelLiveStatus {
  isLive: boolean;
  videoId: string | null;
  title: string | null;
}

interface YouTubeSearchResponse {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: { title?: string; liveBroadcastContent?: string };
  }>;
  error?: { message?: string };
}

export async function fetchChannelLiveStatus(
  channelId: string,
  apiKey: string,
): Promise<ChannelLiveStatus> {
  const params = new URLSearchParams({
    part: "snippet",
    channelId,
    eventType: "live",
    type: "video",
    maxResults: "1",
    key: apiKey,
  });

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
  );

  const data = (await response.json()) as YouTubeSearchResponse;

  if (!response.ok) {
    throw new Error(data.error?.message ?? `YouTube API error (${response.status})`);
  }

  const item = data.items?.[0];
  if (!item?.id?.videoId) {
    return { isLive: false, videoId: null, title: null };
  }

  return {
    isLive: true,
    videoId: item.id.videoId,
    title: item.snippet?.title ?? null,
  };
}
