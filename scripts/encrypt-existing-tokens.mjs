// One-time: scrambles the Gmail/Outlook tokens already saved in email_connections.
//   node scripts/encrypt-existing-tokens.mjs          -> dry run, changes nothing
//   node scripts/encrypt-existing-tokens.mjs --apply  -> does it
// Needs TOKEN_ENCRYPTION_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local.
import fs from "fs";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
if (!/^[0-9a-fA-F]{64}$/.test(env.TOKEN_ENCRYPTION_KEY ?? "")) throw new Error("TOKEN_ENCRYPTION_KEY missing or not 64 hex characters in .env.local");
const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "hex");
const PREFIX = "enc:v1:";
const enc = (p) => { const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", key, iv); const d = Buffer.concat([c.update(p, "utf8"), c.final()]); return `${PREFIX}${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${d.toString("base64")}`; };
const dec = (s) => { const [iv, tag, d] = s.slice(PREFIX.length).split(":"); const x = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64")); x.setAuthTag(Buffer.from(tag, "base64")); return Buffer.concat([x.update(Buffer.from(d, "base64")), x.final()]).toString("utf8"); };

const apply = process.argv.includes("--apply");
const s = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await s.from("email_connections").select("id, provider, access_token, refresh_token");
if (error) throw error;
let todo = 0, done = 0;
for (const r of data) {
  const patch = {};
  for (const f of ["access_token", "refresh_token"]) {
    if (r[f] && !r[f].startsWith(PREFIX)) {
      const scrambled = enc(r[f]);
      if (dec(scrambled) !== r[f]) throw new Error("round-trip check failed, stopping");
      patch[f] = scrambled;
    }
  }
  if (!Object.keys(patch).length) continue;
  todo++;
  if (apply) { const u = await s.from("email_connections").update(patch).eq("id", r.id); if (u.error) throw u.error; done++; }
}
console.log(`${data.length} connections; ${todo} need scrambling; ${apply ? done + " updated" : "dry run, nothing changed"}`);
