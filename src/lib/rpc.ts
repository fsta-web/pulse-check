// Panggilan RPC ringan tanpa supabase-js, supaya halaman operator tetap kecil dan cepat.
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export type RpcResult<T> = { ok: true; data: T } | { ok: false; network: boolean; error: string };

export async function rpc<T>(name: string, args: Record<string, unknown> = {}, timeoutMs = 12000): Promise<RpcResult<T>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, network: true, error: "offline" };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const network = res.status >= 500 || res.status === 0;
      return { ok: false, network, error: (body && (body.message || body.error)) || `HTTP ${res.status}` };
    }
    return { ok: true, data: body as T };
  } catch (e) {
    return { ok: false, network: true, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
