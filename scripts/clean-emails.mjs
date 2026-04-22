import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync("/Users/tayloranderson/gigflow/.env.local", "utf8")
    .split("\n").filter(l => l && !l.startsWith("#"))
    .map(l => [l.split("=")[0].trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const db = createClient(env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"]);

// Clearly fake or wrong emails from website templates / Wix / web designers
const badEmails = [
  "user@domain.com",
  "hi@mystore.com",
  "jerry@icewingcc.com",
  "allison@lunabeanmedia.com",
  "605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com",
];

for (const email of badEmails) {
  const { data } = await db.from("venues").update({ contact_email: null }).eq("contact_email", email).select("name");
  if (data?.length) console.log(`Cleared "${email}" from: ${data.map(v => v.name).join(", ")}`);
}

console.log("Done cleaning.");
