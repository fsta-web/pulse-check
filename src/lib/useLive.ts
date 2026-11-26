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
    setCheckins((c.data as Checkin[]) || []);
    todayRef.current = date;
    setToday(date);
    setError(null);
    setLoading(false);
  }, []);

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
        cb.current?.(c);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          if (wasConnected) load(); // tersambung lagi: ambil data yang terlewat
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
    const full = setInterval(load, 5 * 60000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(tick);
      clearInterval(full);
      document.removeEventListener("visibilitychange", onVis);
      sb.removeChannel(ch);
    };
  }, [load]);

  return { loading, error, sites, operators, settings, today, checkins, now, connected, reload: load };
}
