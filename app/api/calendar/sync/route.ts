import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get("outlook_access_token")?.value;
  if (!accessToken) {
    return NextResponse.json({ error: "Not connected to Outlook" }, { status: 401 });
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
