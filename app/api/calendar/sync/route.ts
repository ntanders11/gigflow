import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshToken } from "@/lib/email/outlook";

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: connection } = await supabase
    .from("email_connections")
    .select("id, access_token, refresh_token, expires_at")
    .eq("user_id", user.id)
    .eq("provider", "outlook")
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({ error: "Not connected to Outlook" }, { status: 401 });
  }

  let accessToken = connection.access_token;
  const expiresAt = new Date(connection.expires_at).getTime();
  if (expiresAt - Date.now() < REFRESH_BUFFER_MS) {
    try {
      accessToken = await refreshToken(connection.id, connection.refresh_token);
    } catch (err) {
      console.error("calendar/sync: token refresh failed", err);
      return NextResponse.json({ error: "Not connected to Outlook" }, { status: 401 });
    }
  }

  const { venueName, city, gigDate, notes } = await req.json();

  if (!gigDate) {
    return NextResponse.json({ error: "No gig date set for this venue" }, { status: 400 });
  }

  const startDateTime = `${gigDate}T19:00:00`;
  const endDateTime = `${gigDate}T22:00:00`;

  const event = {
    subject: `Gig at ${venueName}`,
    body: {
      contentType: "Text",
      content: notes
        ? `${notes}\n\nVenue: ${venueName}${city ? `, ${city}` : ""}`
        : `Booked gig at ${venueName}${city ? `, ${city}` : ""}`,
    },
    start: { dateTime: startDateTime, timeZone: "America/Los_Angeles" },
    end: { dateTime: endDateTime, timeZone: "America/Los_Angeles" },
    location: { displayName: city ?? venueName },
  };

  const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    const err = await res.json();
    return NextResponse.json({ error: err }, { status: res.status });
  }

  const created = await res.json();
  return NextResponse.json({ id: created.id, webLink: created.webLink });
}
