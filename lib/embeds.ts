// Turns a raw YouTube/Spotify link into an embeddable iframe URL, so a
// video/music sample can play right on the profile page instead of just
// linking out. Returns null when the URL doesn't match a recognized
// pattern (or the platform has no embed format at all) -- callers fall
// back to a plain "Open" link in that case, same as before this existed.

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractSpotifyEmbed(url: string): string | null {
  const match = url.match(/open\.spotify\.com\/(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]+)/);
  if (!match) return null;
  const [, type, id] = match;
  return `https://open.spotify.com/embed/${type}/${id}`;
}

export function getEmbedUrl(platform: string, url: string): string | null {
  if (platform === "youtube") {
    const videoId = extractYouTubeId(url);
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
  }
  if (platform === "spotify") {
    return extractSpotifyEmbed(url);
  }
  return null;
}
