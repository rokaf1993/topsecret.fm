// topsecret.fm newsletter backend (Supabase Edge Function "newsletter")
//
// Public actions:   subscribe, unsubscribe
// Admin actions:    stats, send   (require header x-admin-key = NEWSLETTER_ADMIN_KEY)
//
// Secrets (set in Supabase dashboard → Edge Functions → Secrets):
//   NEWSLETTER_ADMIN_KEY  password for the newsletter.html admin page
//   RESEND_API_KEY        API key from resend.com (topsecret.fm domain verified there)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const FROM = "topsecret.fm <hello@topsecret.fm>";
const REPLY_TO = "hello@topsecret.fm";
const SITE = "https://topsecret.fm";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function isAdmin(req: Request) {
  const key = Deno.env.get("NEWSLETTER_ADMIN_KEY") ?? "";
  return safeEqual(req.headers.get("x-admin-key") ?? "", key);
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Plain text → simple HTML. Blank line = new paragraph; URLs become links.
function textToHtml(text: string) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => {
      const linked = esc(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#c8102e;">$1</a>');
      return `<p style="margin:0 0 16px;line-height:1.6;">${linked.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
}

function renderEmail(subject: string, body: string, unsubUrl: string) {
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F7E9DD;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7E9DD;"><tr><td align="center" style="padding:32px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffaf4;border:1px solid #1b1330;">
<tr><td style="padding:24px 28px;border-bottom:2px solid #1b1330;font-family:Georgia,serif;font-size:26px;font-weight:bold;color:#1b1330;">topsecret.fm</td></tr>
<tr><td style="padding:28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;color:#1b1330;">
<h1 style="font-family:Georgia,serif;font-size:24px;line-height:1.25;margin:0 0 20px;">${esc(subject)}</h1>
${textToHtml(body)}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #1b1330;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#4a4160;">
You're getting this because you signed up at <a href="${SITE}" style="color:#4a4160;">topsecret.fm</a>.
<a href="${unsubUrl}" style="color:#4a4160;">Unsubscribe</a>.
</td></tr></table></td></tr></table></body></html>`;
  const text = `${subject}\n\n${body.trim()}\n\n—\ntopsecret.fm · ${SITE}\nUnsubscribe: ${unsubUrl}`;
  return { html, text };
}

async function sendBatch(emails: unknown[]) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY is not set yet");
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(emails),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
}

function buildMessage(to: string, token: string, subject: string, body: string) {
  const unsubUrl = `${SITE}/unsubscribe.html?token=${token}`;
  const { html, text } = renderEmail(subject, body, unsubUrl);
  return {
    from: FROM,
    reply_to: REPLY_TO,
    to: [to],
    subject,
    html,
    text,
    headers: { "List-Unsubscribe": `<${unsubUrl}>` },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(payload.action ?? "");

  try {
    // ---------- public ----------
    if (action === "subscribe") {
      const email = String(payload.email ?? "").trim().toLowerCase();
      if (email.length > 254 || !EMAIL_RE.test(email)) return json({ error: "Please enter a valid email address." }, 400);
      if (payload.website) return json({ ok: true }); // honeypot: bots fill hidden field

      const { data: existing } = await db.from("subscribers").select("id, unsubscribed_at").eq("email", email).maybeSingle();
      if (existing && !existing.unsubscribed_at) return json({ ok: true, status: "already" });
      if (existing) {
        await db.from("subscribers").update({ unsubscribed_at: null, subscribed_at: new Date().toISOString() }).eq("id", existing.id);
        return json({ ok: true, status: "resubscribed" });
      }
      const { error } = await db.from("subscribers").insert({ email, source: String(payload.source ?? "website").slice(0, 40) });
      if (error) throw error;
      return json({ ok: true, status: "subscribed" });
    }

    if (action === "unsubscribe") {
      const token = String(payload.token ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ error: "That unsubscribe link isn't valid." }, 400);
      const { data, error } = await db
        .from("subscribers")
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq("unsub_token", token)
        .is("unsubscribed_at", null)
        .select("email");
      if (error) throw error;
      return json({ ok: true, changed: (data ?? []).length });
    }

    // ---------- admin ----------
    if (!isAdmin(req)) return json({ error: "Wrong admin password." }, 401);

    if (action === "stats") {
      const { count: active } = await db.from("subscribers").select("id", { count: "exact", head: true }).is("unsubscribed_at", null);
      const { count: unsubscribed } = await db.from("subscribers").select("id", { count: "exact", head: true }).not("unsubscribed_at", "is", null);
      const { data: recentSubs } = await db.from("subscribers").select("email, subscribed_at").is("unsubscribed_at", null).order("subscribed_at", { ascending: false }).limit(10);
      const { data: sends } = await db.from("newsletter_sends").select("subject, sent_at, recipients").order("sent_at", { ascending: false }).limit(10);
      return json({
        ok: true,
        active: active ?? 0,
        unsubscribed: unsubscribed ?? 0,
        recentSubs: recentSubs ?? [],
        sends: sends ?? [],
        resendConfigured: !!Deno.env.get("RESEND_API_KEY"),
      });
    }

    if (action === "send") {
      const subject = String(payload.subject ?? "").trim();
      const body = String(payload.body ?? "").trim();
      if (!subject || !body) return json({ error: "Subject and message are both needed." }, 400);
      if (subject.length > 200 || body.length > 50000) return json({ error: "Message is too long." }, 400);

      // Test send to one address
      const testTo = String(payload.testTo ?? "").trim().toLowerCase();
      if (testTo) {
        if (!EMAIL_RE.test(testTo)) return json({ error: "Test address isn't valid." }, 400);
        await sendBatch([buildMessage(testTo, "00000000-0000-0000-0000-000000000000", `[TEST] ${subject}`, body)]);
        return json({ ok: true, test: true, recipients: 1 });
      }

      const { data: subs, error } = await db.from("subscribers").select("email, unsub_token").is("unsubscribed_at", null);
      if (error) throw error;
      const list = subs ?? [];
      if (list.length === 0) return json({ error: "No subscribers yet." }, 400);

      for (let i = 0; i < list.length; i += 100) {
        await sendBatch(list.slice(i, i + 100).map((s) => buildMessage(s.email, s.unsub_token, subject, body)));
      }
      await db.from("newsletter_sends").insert({ subject, body, recipients: list.length });
      return json({ ok: true, recipients: list.length });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong" }, 500);
  }
});
