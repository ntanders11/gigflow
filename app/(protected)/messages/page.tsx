import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MessagesView from "@/components/messages/MessagesView";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { c } = await searchParams;

  return (
    <div className="min-h-screen p-4 md:p-8" style={{ backgroundColor: "#0E0E10", color: "#F4E8D2" }}>
      <h1 className="text-2xl font-bold tracking-tight mb-6 pr-14 md:pr-0">Messages</h1>
      <MessagesView role="artist" initialConversationId={c} />
    </div>
  );
}
