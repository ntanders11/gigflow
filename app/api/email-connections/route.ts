import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeGmailToken } from "@/lib/email/gmail";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("email_connections")
    .select("provider, connected_email, status")
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connections: data ?? [] });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = req.nextUrl.searchParams.get("provider");
  if (provider !== "gmail" && provider !== "outlook") {
    return NextResponse.json({ error: "provider must be 'gmail' or 'outlook'" }, { status: 400 });
  }

  if (provider === "gmail") {
    const { data: connection } = await supabase
      .from("email_connections")
      .select("refresh_token")
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .maybeSingle();

    if (connection?.refresh_token) {
      // Best-effort — the row gets deleted below regardless of whether this
      // succeeds, and that's what actually stops StageReach from sending.
      await revokeGmailToken(connection.refresh_token).catch((err) =>
        console.error("email-connections DELETE: gmail revoke failed", err)
      );
    }
  }

  // No equivalent revoke call for Outlook — Microsoft's v2.0 token endpoint
  // has no one-call revoke API the way Google does. The row delete below is
  // what actually stops StageReach from sending either way.

  const { error } = await supabase
    .from("email_connections")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
