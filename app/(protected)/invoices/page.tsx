import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Invoice, Venue } from "@/types";
import CreateInvoiceButton from "@/components/invoice/CreateInvoiceButton";
import ArtistInvoicesList from "@/components/invoice/ArtistInvoicesList";

export default async function InvoicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: invoices } = await supabase
    .from("invoices")
    .select("*, venues(name, city)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const allInvoices = (invoices ?? []) as (Invoice & { venues: { name: string; city: string | null } | null })[];

  const { data: venues } = await supabase
    .from("venues")
    .select("*")
    .eq("user_id", user.id)
    .order("name");

  return (
    <div className="min-h-screen p-4 md:p-8" style={{ backgroundColor: "#0E0E10", color: "#F4E8D2" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8 max-w-4xl">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#F4E8D2" }}>
          Invoices
        </h1>
        <CreateInvoiceButton venues={(venues ?? []) as Venue[]} />
      </div>

      <ArtistInvoicesList initialInvoices={allInvoices} />
    </div>
  );
}
