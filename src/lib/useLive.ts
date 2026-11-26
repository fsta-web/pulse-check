"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CHECKIN_COLS, DEFAULT_SETTINGS, supabase, type Checkin, type Operator, type Settings, type Site } from "./supabase";
import { dayStartMs, witaDate } from "./time";

export type LiveData = {
  loading: boolean;
  error: string | null;
  sites: Site[];
  operators: Operator[];
  settings: Settings;
  today: string;
  checkins: Checkin[]; // check-in hari ini (WITA)
  now: number;
  connected: boolean;
  reload: () => void;
};

/** Data live dashboard: area, operator, pengaturan, dan check-in hari ini + realtime. */
export function useLive(onNewCheckin?: (c: Checkin) => void): LiveData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [today, setToday] = useState(witaDate());
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [now, setNow] = useState(Date.now());
  const [connected, setConnected] = useState(false);
  const cb = useRef(onNewCheckin);
  cb.current = onNewCheckin;
  const todayRef = useRef(today);

  const load = useCallback(async () => {
    const sb = supabase();
    const date = witaDate();
    const from = new Date(dayStartMs(date)).toISOString();
    const [s, o, st, c] = await Promise.all([
      sb.from("sites").select("id,nama,lat,lng,radius_m,aktif").order("nama"),
      sb.from("operators").select("id,nama,no_hp,area_utama_id,device_id,device_claimed_at,aktif").order("nama"),
      sb.from("settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("checkins").select(CHECKIN_COLS).gte("ditekan_at", from).order("ditekan_at", { ascending: false }).limit(5000),
    ]);
    const err = s.error || o.error || st.error || c.error;
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setSites((s.data as Site[]) || []);
    setOperators((o.data as Operator[]) || []);
    if (st.data) setSettings(st.data as Settings);
    const rows = (c.data as Checkin[]) || [];
    setCheckins(rows);
    lastReceived.current = rows.reduce<string>((m, r) => (r.diterima_at > m ? r.diterima_at : m), new Date(dayStartMs(date)).toISOString());
    todayRef.current = date;
    setToday(date);
    setError(null);
    setLoading(false);
  }, []);

  // Ambil hanya check-in baru (berdasarkan waktu diterima server), jauh lebih hemat dari memuat ulang semua.
  const lastReceived = useRef<string | null>(null);
  const fetchNew = useCallback(async () => {
    const since = lastReceived.current;
    if (!since) return load();
    const from = new Date(Date.parse(since) - 120000).toISOString();
    const { data, error } = await supabase()
      .from("checkins")
      .select(CHECKIN_COLS)
      .gte("diterima_at", from)
      .gte("ditekan_at", new Date(dayStartMs(todayRef.current)).toISOString())
      .order("diterima_at", { ascending: false })
      .limit(1000);
    if (error || !data) return;
    const rows = data as Checkin[];
    if (rows.length) {
      setCheckins((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        const add = rows.filter((r) => !ids.has(r.id));
        return add.length ? [...add, ...prev] : prev;
      });
      const max = rows.reduce((m, r) => (r.diterima_at > m ? r.diterima_at : m), since);
      lastReceived.current = max;
    }
  }, [load]);

  useEffect(() => {
    load();
    const sb = supabase();
    let wasConnected = false;
    const ch = sb
      .channel("checkins-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "checkins" }, (payload) => {
        const c = payload.new as Checkin;
        if (witaDate(c.ditekan_at) !== todayRef.current) return;
        setCheckins((prev) => (prev.some((p) => p.id === c.id) ? prev : [c, ...prev]));
        if (!lastReceived.current || c.diterima_at > lastReceived.current) lastReceived.current = c.diterima_at;
        cb.current?.(c);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          if (wasConnected) fetchNew(); // tersambung lagi: ambil check-in yang terlewat saja
          wasConnected = true;
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnected(false);
        }
      });
    const tick = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (witaDate(t) !== todayRef.current) load();
    }, 30000);
    // Cadangan kalau realtime terputus diam-diam: cek check-in baru tiap 10 menit, data master tiap 30 menit.
    const inc = setInterval(fetchNew, 10 * 60000);
    const full = setInterval(load, 30 * 60000);
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      if (away > 30 * 60000) load();
      else if (away > 2 * 60000) fetchNew();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(tick);
      clearInterval(inc);
      clearInterval(full);
      document.removeEventListener("visibilitychange", onVis);
      sb.removeChannel(ch);
    };
  }, [load, fetchNew]);

  return { loading, error, sites, operators, settings, today, checkins, now, connected, reload: load };
}
