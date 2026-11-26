import * as webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = { endpoint: string; p256dh: string; auth: string; title: string; body: string; tag?: string };

let configured = false;
function setup(): boolean {
  if (configured) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@pulse.local", pub, priv);
  configured = true;
  return true;
}

/** Dipanggil oleh jadwal otomatis Supabase (pg_cron + pg_net) untuk mengirim pengingat. */
export async function POST(req: Request) {
  const secret = process.env.PUSH_SECRET;
  if (!secret || req.headers.get("x-push-secret") !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!setup()) return Response.json({ error: "vapid_not_configured" }, { status: 500 });

  let messages: Msg[] = [];
  try {
    const body = await req.json();
    messages = Array.isArray(body?.messages) ? body.messages.slice(0, 500) : [];
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }

  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    messages.map(async (m) => {
      try {
        await webpush.sendNotification(
          { endpoint: m.endpoint, keys: { p256dh: m.p256dh, auth: m.auth } },
          JSON.stringify({ title: m.title, body: m.body, tag: m.tag || "pulse-reminder" }),
          { TTL: 1800, urgency: "high" },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push(m.endpoint);
      }
    }),
  );

  if (gone.length) {
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/push_cleanup`, {
      method: "POST",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ p_secret: secret, p_endpoints: gone }),
    }).catch(() => {});
  }

  return Response.json({ sent, gone: gone.length, total: messages.length });
}
