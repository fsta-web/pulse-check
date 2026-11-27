"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Kondisi } from "@/lib/supabase";
import { rpc } from "@/lib/rpc";
import { fmtJarak, nearestSites, siteInRadius, type SiteLite } from "@/lib/status";
import { fmtAgo, fmtTime, minutesSince } from "@/lib/time";
import { getDeviceId, store, uuid, type OperatorPick, type QueueItem } from "@/lib/operator-store";
import { getDeviceInfo } from "@/lib/device";

type CheckinResp = {
  ok: boolean;
  error?: string;
  duplicate?: boolean;
  ditekan_at?: string;
  site_nama?: string;
  di_luar_area?: boolean;
  jarak_m?: number | null;
  tanpa_lokasi?: boolean;
};

type StatusResp = {
  state: "ok" | "taken" | "inactive";
  nama?: string;
  last?: { ditekan_at: string; kondisi: Kondisi; site_nama: string | null } | null;
};

type Pos = { lat: number; lng: number; acc: number };

type Done = {
  waktu: string;
  kondisi: Kondisi;
  site: string | null;
  akurasi: number | null;
  luar: boolean;
  tanpaLokasi: boolean;
  antre: boolean;
  viaQr?: boolean;
  sudahAda?: boolean;
};

const ERR_TEXT: Record<string, string> = {
  device_mismatch: "Nama ini sudah terdaftar di HP lain. Minta admin mereset HP terdaftar.",
  inactive: "Nama ini sudah tidak aktif. Pilih nama lain atau hubungi admin.",
  keterangan_wajib: "Keterangan wajib diisi untuk laporan kendala.",
  invalid_site: "Area tidak ditemukan. Pilih area lagi.",
  invalid_qr: "Kode QR tidak dikenal atau sudah diganti. Minta admin mencetak ulang QR area ini.",
};

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function b64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function getPosition(timeoutMs = 15000): Promise<{ pos: Pos | null; err: string | null }> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve({ pos: null, err: "GPS tidak didukung HP ini" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ pos: { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }, err: null }),
      (e) =>
        resolve({
          pos: null,
          err: e.code === 1 ? "Izin lokasi ditolak" : e.code === 3 ? "GPS terlalu lama merespons" : "Lokasi tidak tersedia",
        }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

export default function OperatorApp() {
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [deviceId, setDeviceId] = useState("");
  const [operator, setOperator] = useState<OperatorPick | null>(null);
  const [ops, setOps] = useState<OperatorPick[]>([]);
  const [sites, setSites] = useState<SiteLite[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [last, setLast] = useState(store.getLast());
  const [listsLoaded, setListsLoaded] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [staffSession, setStaffSession] = useState(false);
  const [keterangan, setKeterangan] = useState("");
  const nameRef = useRef<HTMLSelectElement>(null);
  const [phase, setPhase] = useState<"idle" | "locating" | "sending" | "qr">("idle");
  const [qr, setQr] = useState<{ token: string; site: string | null; invalid: boolean } | null>(null);
  const qrBusy = useRef(false);
  const [pickSite, setPickSite] = useState<{ pos: Pos | null; gpsErr: string | null } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pushState, setPushState] = useState<"unsupported" | "default" | "granted" | "denied" | "ios-install">("default");
  const [installEvt, setInstallEvt] = useState<Event | null>(null);
  const [now, setNow] = useState(Date.now());
  const pickResolver = useRef<((siteId: string | null) => void) | null>(null);
  const ketRef = useRef<HTMLTextAreaElement>(null);
  const flushing = useRef(false);

  // ---------- Inisialisasi ----------
  useEffect(() => {
    setDeviceId(getDeviceId());
    setOperator(store.getOperator());
    setOps(store.getOps());
    setSites(store.getSites());
    setQueue(store.getQueue());
    setOnline(navigator.onLine);
    const qrToken = new URLSearchParams(window.location.search).get("qr");
    if (qrToken && /^[a-z0-9]{6,20}$/i.test(qrToken)) {
      setQr({ token: qrToken.toLowerCase(), site: null, invalid: false });
      window.history.replaceState(null, "", "/");
    }
    try {
      setStaffSession(!!localStorage.getItem("pulse-auth"));
    } catch {
      /* abaikan */
    }
    setReady(true);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
      setPushState(ios && !standalone ? "ios-install" : "unsupported");
    } else {
      setPushState(Notification.permission as "default" | "granted" | "denied");
    }

    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const bip = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", bip);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", bip);
      clearInterval(tick);
    };
  }, []);

  const applyStatus = useCallback((st: StatusResp | null) => {
    if (!st) return;
    if (st.state === "taken") {
      setError(ERR_TEXT.device_mismatch);
      store.setOperator(null);
      setOperator(null);
    } else if (st.state === "inactive") {
      setError(ERR_TEXT.inactive);
      store.setOperator(null);
      setOperator(null);
    } else if (st.last) {
      const l = st.last;
      const local = store.getLast();
      if (!local || l.ditekan_at > local.ditekan_at) {
        store.setLast(l);
        setLast(l);
      }
    }
  }, []);

  // Satu panggilan saat halaman dibuka: daftar nama, daftar area, dan status operator.
  const statusFor = useRef<string | null>(null);
  const refreshLists = useCallback(async () => {
    const opId = store.getOperator()?.id ?? null;
    const r = await rpc<{ ops: OperatorPick[]; sites: SiteLite[]; status: StatusResp | null }>("op_bootstrap", {
      p_operator: opId,
      p_device: getDeviceId(),
    });
    if (r.ok) {
      setOps(r.data.ops);
      store.setOps(r.data.ops);
      setSites(r.data.sites);
      store.setSites(r.data.sites);
      statusFor.current = opId;
      applyStatus(r.data.status);
    }
    if (r.ok || !navigator.onLine) setListsLoaded(true);
  }, [applyStatus]);

  useEffect(() => {
    if (ready) refreshLists();
  }, [ready, refreshLists]);

  // Status operator saat nama diganti (saat halaman dibuka sudah ikut di op_bootstrap).
  useEffect(() => {
    if (!ready || !operator || !deviceId || statusFor.current === operator.id) return;
    statusFor.current = operator.id;
    let cancelled = false;
    rpc<StatusResp>("op_status", { p_operator: operator.id, p_device: deviceId }).then((r) => {
      if (!cancelled && r.ok) applyStatus(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, operator, deviceId, applyStatus]);

  // Catat model HP + sistem operasi untuk HP terdaftar (sekali per buka aplikasi per nama).
  const infoSentFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !operator || !deviceId || !online || infoSentFor.current === operator.id) return;
    infoSentFor.current = operator.id;
    getDeviceInfo().then((d) =>
      rpc<string>("op_device_info", { p_operator: operator.id, p_device: deviceId, p_model: d.model, p_os: d.os, p_browser: d.browser }).then((r) => {
        if (!r.ok) infoSentFor.current = null;
      }),
    );
  }, [ready, operator, deviceId, online]);

  // ---------- GPS disiapkan sejak halaman dibuka ----------
  const fixRef = useRef<{ pos: Pos; at: number } | null>(null);
  const [gps, setGps] = useState<{ state: "off" | "searching" | "ready" | "denied" | "error"; acc: number | null }>({ state: "off", acc: null });
  useEffect(() => {
    if (!ready || !operator || !("geolocation" in navigator)) return;
    let watchId: number | null = null;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = null;
    };
    const start = () => {
      if (watchId != null) return;
      setGps((g) => (g.state === "ready" ? g : { state: "searching", acc: null }));
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          fixRef.current = { pos: { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }, at: Date.now() };
          setGps({ state: "ready", acc: Math.round(p.coords.accuracy) });
        },
        (e) => setGps({ state: e.code === 1 ? "denied" : "error", acc: null }),
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 60000 },
      );
      // Hemat baterai: berhenti setelah 5 menit, dinyalakan lagi saat halaman dibuka ulang.
      stopTimer = setTimeout(stop, 5 * 60000);
    };
    const onVis = () => (document.visibilityState === "visible" ? start() : stop());
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ready, operator]);

  // ---------- Antrean offline ----------
  const saveQueue = (q: QueueItem[]) => {
    store.setQueue(q);
    setQueue(q);
  };

  const flushQueue = useCallback(async () => {
    if (flushing.current) return;
    const q = store.getQueue();
    if (!q.length || !navigator.onLine) return;
    flushing.current = true;
    const dev = getDeviceId();
    const remaining: QueueItem[] = [];
    let sent = 0;
    const dropped: string[] = [];
    for (const item of q) {
      if (item.needs_site && !item.site_id) {
        remaining.push(item);
        continue;
      }
      const r = item.qr_token
        ? await rpc<CheckinResp>("op_checkin_qr", {
            p_client_id: item.client_id,
            p_operator: item.operator_id,
            p_device: dev,
            p_token: item.qr_token,
            p_lat: item.lat,
            p_lng: item.lng,
            p_akurasi: item.akurasi,
            p_ditekan_at: item.ditekan_at,
            p_offline: true,
          })
        : await rpc<CheckinResp>("op_checkin", {
            p_client_id: item.client_id,
            p_operator: item.operator_id,
            p_device: dev,
            p_kondisi: item.kondisi,
            p_keterangan: item.keterangan,
            p_lat: item.lat,
            p_lng: item.lng,
            p_akurasi: item.akurasi,
            p_ditekan_at: item.ditekan_at,
            p_offline: true,
            p_site: item.site_id,
          });
      if (r.ok && r.data.ok) {
        sent++;
      } else if (!r.ok && r.network) {
        remaining.push({ ...item, attempts: item.attempts + 1 });
      } else if (r.ok && (r.data.error === "need_site" || r.data.error === "invalid_site")) {
        remaining.push({ ...item, site_id: null, site_nama: null, needs_site: true, attempts: item.attempts + 1 });
      } else {
        const code = r.ok ? r.data.error || "gagal" : r.error;
        dropped.push(ERR_TEXT[code] || code);
      }
    }
    store.setQueue(remaining);
    setQueue(remaining);
    flushing.current = false;
    if (sent) setNotice(`${sent} laporan tertunda sudah terkirim.`);
    if (remaining.some((x) => x.needs_site)) refreshLists();
    if (dropped.length) setError(`Laporan tertunda ditolak: ${dropped[0]}`);
  }, [refreshLists]);

  useEffect(() => {
    if (!ready) return;
    flushQueue();
    const onOnline = () => flushQueue();
    const onVis = () => document.visibilityState === "visible" && flushQueue();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(() => store.getQueue().length && flushQueue(), 20000);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(iv);
    };
  }, [ready, flushQueue]);

  // ---------- Notifikasi ----------
  const subscribePush = useCallback(
    async (silent: boolean) => {
      if (!operator || !VAPID || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
      try {
        if (!silent) {
          const perm = await Notification.requestPermission();
          setPushState(perm as "default" | "granted" | "denied");
          if (perm !== "granted") return;
        } else if (Notification.permission !== "granted") return;
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) });
        const j = sub.toJSON();
        const r = await rpc<string>("op_push_subscribe", {
          p_operator: operator.id,
          p_device: getDeviceId(),
          p_endpoint: j.endpoint,
          p_p256dh: j.keys?.p256dh,
          p_auth: j.keys?.auth,
        });
        if (!silent) {
          if (r.ok && r.data === "ok") setNotice("Pengingat check-in aktif.");
          else setError("Gagal mengaktifkan pengingat. Coba lagi saat ada sinyal.");
        }
      } catch {
        if (!silent) setError("Gagal mengaktifkan pengingat di HP ini.");
      }
    },
    [operator],
  );

  useEffect(() => {
    if (ready && operator && pushState === "granted") subscribePush(true);
  }, [ready, operator, pushState, subscribePush]);

  // ---------- Pilih nama ----------
  const chooseOperator = async (id: string) => {
    setError(null);
    setNotice(null);
    if (!id) return;
    if (operator && id === operator.id) return;
    if (queue.length) {
      setError("Masih ada laporan yang belum terkirim. Tunggu sampai terkirim sebelum ganti nama.");
      return;
    }
    const o = ops.find((x) => x.id === id);
    if (!o) return;
    setClaiming(true);
    const r = await rpc<string>("op_claim", { p_operator: o.id, p_device: deviceId });
    setClaiming(false);
    if (!r.ok) {
      setError(r.network ? "Butuh sinyal untuk memilih nama pertama kali." : r.error);
      return;
    }
    if (r.data === "taken") return setError(ERR_TEXT.device_mismatch);
    if (r.data !== "ok") return setError(ERR_TEXT.inactive);
    store.setOperator(o);
    store.setLast(null);
    setLast(null);
    setOperator(o);
  };

  // ---------- Check-in ----------
  const askSite = (pos: Pos | null, gpsErr: string | null) =>
    new Promise<string | null>((resolve) => {
      pickResolver.current = resolve;
      setPickSite({ pos, gpsErr });
    });

  const resolvePick = (siteId: string | null) => {
    const r = pickResolver.current;
    pickResolver.current = null;
    setPickSite(null);
    r?.(siteId);
  };

  const fixQueueSite = async () => {
    const item = store.getQueue().find((x) => x.needs_site);
    if (!item) return;
    if (!store.getSites().length) await refreshLists();
    if (!store.getSites().length) {
      setError("Daftar area belum termuat. Coba lagi saat ada sinyal.");
      return;
    }
    const siteId = await askSite(
      item.lat != null && item.lng != null ? { lat: item.lat, lng: item.lng, acc: item.akurasi ?? 0 } : null,
      item.lat == null ? "Laporan ini tanpa lokasi GPS" : null,
    );
    if (!siteId) return;
    const nama = store.getSites().find((x) => x.id === siteId)?.nama ?? null;
    saveQueue(store.getQueue().map((x) => (x.client_id === item.client_id ? { ...x, site_id: siteId, site_nama: nama, needs_site: false } : x)));
    flushQueue();
  };

  const finish = (d: Done, kondisi: Kondisi) => {
    const l = { ditekan_at: d.waktu, kondisi, site_nama: d.site };
    store.setLast(l);
    setLast(l);
    setKeterangan("");
    setDone(d);
  };

  // ---------- Check-in lewat scan QR area (otomatis Aman) ----------
  useEffect(() => {
    if (!qr || qr.site || qr.invalid || !online) return;
    let cancelled = false;
    rpc<{ ok: boolean; site_nama?: string }>("op_qr_info", { p_token: qr.token }).then((r) => {
      if (cancelled || !r.ok) return;
      setQr((q) => (q && q.token === qr.token ? { ...q, site: r.data.site_nama ?? null, invalid: !r.data.ok } : q));
    });
    return () => {
      cancelled = true;
    };
  }, [qr, online]);

  const doQrCheckin = useCallback(
    async (token: string, op: OperatorPick) => {
      if (qrBusy.current) return;
      qrBusy.current = true;
      setError(null);
      setNotice(null);
      const pressedAt = new Date().toISOString();
      setPhase("qr");
      const cached = fixRef.current && Date.now() - fixRef.current.at < 120000 ? fixRef.current.pos : null;
      let pos: Pos | null = cached && cached.acc <= 150 ? cached : null;
      if (!pos) pos = (await getPosition(6000)).pos ?? cached;
      const item: QueueItem = {
        client_id: uuid(),
        operator_id: op.id,
        kondisi: "aman",
        keterangan: null,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        akurasi: pos ? Math.round(pos.acc) : null,
        ditekan_at: pressedAt,
        site_id: null,
        site_nama: qr?.site ?? null,
        attempts: 0,
        qr_token: token,
      };
      const r = await rpc<CheckinResp>("op_checkin_qr", {
        p_client_id: item.client_id,
        p_operator: op.id,
        p_device: getDeviceId(),
        p_token: token,
        p_lat: item.lat,
        p_lng: item.lng,
        p_akurasi: item.akurasi,
        p_ditekan_at: pressedAt,
        p_offline: false,
      });
      setPhase("idle");
      setQr(null);
      qrBusy.current = false;
      if (!r.ok && r.network) {
        saveQueue([...store.getQueue(), item]);
        finish({ waktu: pressedAt, kondisi: "aman", site: item.site_nama, akurasi: item.akurasi, luar: false, tanpaLokasi: !pos, antre: true, viaQr: true }, "aman");
        return;
      }
      if (!r.ok) return setError(r.error);
      const d = r.data;
      if (!d.ok) {
        if (d.error === "device_mismatch" || d.error === "inactive") {
          store.setOperator(null);
          setOperator(null);
        }
        return setError(ERR_TEXT[d.error || ""] || `Gagal: ${d.error}`);
      }
      finish(
        {
          waktu: d.ditekan_at || pressedAt,
          kondisi: "aman",
          site: d.site_nama || item.site_nama,
          akurasi: item.akurasi,
          luar: !!d.di_luar_area,
          tanpaLokasi: !!d.tanpa_lokasi,
          antre: false,
          viaQr: true,
          sudahAda: !!d.duplicate,
        },
        "aman",
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qr],
  );

  useEffect(() => {
    if (!ready || !operator || !qr || qr.invalid || phase !== "idle") return;
    doQrCheckin(qr.token, operator);
  }, [ready, operator, qr, phase, doQrCheckin]);

  useEffect(() => {
    if (qr?.invalid) {
      setError(ERR_TEXT.invalid_qr);
      setQr(null);
    }
  }, [qr]);

  const doCheckin = async (kondisi: Kondisi) => {
    if (phase !== "idle") return;
    setError(null);
    setNotice(null);
    if (!operator) {
      setError("Pilih nama Anda dulu.");
      nameRef.current?.focus();
      return;
    }
    const ket = keterangan.trim();
    if (kondisi === "kendala" && !ket) {
      setError(ERR_TEXT.keterangan_wajib);
      ketRef.current?.focus();
      return;
    }
    const pressedAt = new Date().toISOString();
    setPhase("locating");
    const cached = fixRef.current && Date.now() - fixRef.current.at < 120000 ? fixRef.current.pos : null;
    let pos: Pos | null = cached && cached.acc <= 150 ? cached : null;
    let gpsErr: string | null = null;
    if (!pos) {
      const r = await getPosition(kondisi === "darurat" ? 6000 : 10000);
      pos = r.pos ?? cached;
      gpsErr = pos ? null : r.err;
    }

    let siteList = sites;
    if (!siteList.length) {
      const s = await rpc<SiteLite[]>("op_sites");
      if (s.ok) {
        siteList = s.data;
        setSites(s.data);
        store.setSites(s.data);
      }
    }
    let siteId: string | null = null;
    let siteNama: string | null = null;
    const hit = pos ? siteInRadius(siteList, pos.lat, pos.lng) : null;
    if (hit) {
      siteId = hit.site.id;
      siteNama = hit.site.nama;
    } else if (siteList.length) {
      setPhase("idle");
      siteId = await askSite(pos, gpsErr);
      if (!siteId) return;
      siteNama = siteList.find((s) => s.id === siteId)?.nama ?? null;
    }

    const item: QueueItem = {
      client_id: uuid(),
      operator_id: operator.id,
      kondisi,
      keterangan: ket || null,
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      akurasi: pos ? Math.round(pos.acc) : null,
      ditekan_at: pressedAt,
      site_id: siteId,
      site_nama: siteNama,
      attempts: 0,
    };

    setPhase("sending");
    const r = await rpc<CheckinResp>(
      "op_checkin",
      {
        p_client_id: item.client_id,
        p_operator: item.operator_id,
        p_device: deviceId,
        p_kondisi: item.kondisi,
        p_keterangan: item.keterangan,
        p_lat: item.lat,
        p_lng: item.lng,
        p_akurasi: item.akurasi,
        p_ditekan_at: item.ditekan_at,
        p_offline: false,
        p_site: item.site_id,
      },
      kondisi === "darurat" ? 15000 : 12000,
    );
    setPhase("idle");

    if (!r.ok && r.network) {
      saveQueue([...store.getQueue(), item]);
      finish(
        { waktu: pressedAt, kondisi, site: siteNama, akurasi: item.akurasi, luar: !hit && !!pos, tanpaLokasi: !pos, antre: true },
        kondisi,
      );
      return;
    }
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const d = r.data;
    if (!d.ok) {
      if (d.error === "need_site") {
        setError("Area tidak terdeteksi. Pilih area lalu tekan tombol lagi.");
        setSites([]);
        store.setSites([]);
        refreshLists();
        return;
      }
      if (d.error === "device_mismatch" || d.error === "inactive") {
        store.setOperator(null);
        setOperator(null);
      }
      setError(ERR_TEXT[d.error || ""] || `Gagal: ${d.error}`);
      return;
    }
    finish(
      {
        waktu: d.ditekan_at || pressedAt,
        kondisi,
        site: d.site_nama || siteNama,
        akurasi: item.akurasi,
        luar: !!d.di_luar_area,
        tanpaLokasi: !!d.tanpa_lokasi,
        antre: false,
      },
      kondisi,
    );
  };

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 12000);
    return () => clearTimeout(t);
  }, [done]);

  const install = async () => {
    const e = installEvt as unknown as { prompt: () => Promise<void> } | null;
    if (e) {
      await e.prompt();
      setInstallEvt(null);
    }
  };

  if (!ready) return <main className="op-shell" />;

  // ---------- Layar: terkirim ----------
  if (done) {
    return (
      <main className="op-shell">
        <section className={`op-done op-done-${done.kondisi}`}>
          <div className="op-done-icon" aria-hidden="true">
            {done.antre ? "⏳" : "✓"}
          </div>
          <h1 className="op-title">{done.antre ? "Tersimpan di HP" : "Tercatat"} {fmtTime(done.waktu)}</h1>
          <p className="op-done-line">
            {done.kondisi === "aman" ? "Aman" : done.kondisi === "kendala" ? "Kendala" : "DARURAT"}
            {done.site ? ` · ${done.site}` : ""}
            {done.viaQr ? " · via QR" : ""}
          </p>
          <ul className="op-done-flags">
            {done.akurasi != null && <li>Akurasi GPS ±{done.akurasi} m</li>}
            {done.tanpaLokasi && <li>Tanpa lokasi GPS. Nyalakan GPS untuk laporan berikutnya.</li>}
            {done.luar && !done.viaQr && <li>Posisi di luar radius area</li>}
            {done.antre && <li>Belum ada sinyal. Laporan dikirim otomatis begitu ada sinyal.</li>}
            {done.sudahAda && <li>QR ini sudah Anda scan barusan, jadi tidak dicatat dua kali.</li>}
            {done.viaQr && done.luar && <li>Posisi GPS jauh dari area QR</li>}
          </ul>
          <button className="op-btn-secondary" onClick={() => setDone(null)}>
            Selesai
          </button>
        </section>
      </main>
    );
  }

  const lastMin = last ? minutesSince(last.ditekan_at, now) : null;

  // ---------- Layar: check-in ----------
  return (
    <main className="op-shell">
      <header className="op-head">
        <div className="op-brand">
          <span className="op-logo" aria-hidden="true" />
          Pulse Check
          {!online ? <span className="pill pill-warn">Tanpa sinyal</span> : <span className="pill pill-ok">Online</span>}
        </div>
        <a className="op-staff-link" href={staffSession ? "/dashboard" : "/login"}>
          {staffSession ? "Dashboard" : "Login SPV / Admin"}
        </a>
      </header>

      {qr && !operator && (
        <section className="op-notice">
          QR area{qr.site ? ` ${qr.site}` : ""} terdeteksi. Pilih nama Anda di bawah, check-in Aman akan tercatat otomatis.
        </section>
      )}

      <section className="op-card op-who">
        <label className="op-label" htmlFor="nama">
          Nama operator
        </label>
        <select
          id="nama"
          ref={nameRef}
          className="op-input op-select"
          value={operator?.id || ""}
          disabled={claiming}
          onChange={(e) => chooseOperator(e.target.value)}
        >
          <option value="">{ops.length ? "— Pilih nama Anda —" : listsLoaded ? "Belum ada nama operator" : "Memuat daftar nama…"}</option>
          {operator && !ops.some((o) => o.id === operator.id) && <option value={operator.id}>{operator.nama}</option>}
          {ops.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nama}
            </option>
          ))}
        </select>
        {listsLoaded && !ops.length && <p className="op-muted">Admin perlu menambahkan nama operator lebih dulu.</p>}
        {operator && (
          <p className="op-muted">
            {last ? (
              <>
                Terakhir lapor <b>{fmtTime(last.ditekan_at)}</b> ({fmtAgo(lastMin ?? 0)})
                {last.site_nama ? ` · ${last.site_nama}` : ""}
              </>
            ) : (
              "Belum ada check-in dari HP ini."
            )}
          </p>
        )}
        {operator && (
          <p className={`op-gps op-gps-${gps.state}`}>
            {gps.state === "ready"
              ? `GPS siap · ±${gps.acc} m`
              : gps.state === "searching"
                ? "Mencari sinyal GPS…"
                : gps.state === "denied"
                  ? "Izin lokasi ditolak. Izinkan lokasi di pengaturan browser."
                  : gps.state === "error"
                    ? "GPS belum mendapat posisi. Pastikan GPS HP menyala."
                    : ""}
          </p>
        )}
      </section>

      {queue.some((x) => x.needs_site) && (
        <section className="op-queue">
          {queue.filter((x) => x.needs_site).length} laporan tertunda belum punya area.
          <button className="op-link" onClick={fixQueueSite}>
            Pilih area
          </button>
        </section>
      )}
      {queue.some((x) => !x.needs_site) && (
        <section className="op-queue">
          {queue.filter((x) => !x.needs_site).length} laporan menunggu sinyal. Akan dikirim otomatis.
          {online && (
            <button className="op-link" onClick={() => flushQueue()}>
              Kirim sekarang
            </button>
          )}
        </section>
      )}
      {error && <p className="op-error">{error}</p>}
      {notice && <p className="op-notice">{notice}</p>}

      <section className="op-actions">
        <button className="op-btn op-btn-aman" disabled={phase !== "idle"} onClick={() => doCheckin("aman")}>
          <span className="op-btn-label">Aman</span>
          <span className="op-btn-sub">Kondisi baik, tidak ada masalah</span>
        </button>
        <div className="op-row">
          <button className="op-btn op-btn-kendala" disabled={phase !== "idle"} onClick={() => doCheckin("kendala")}>
            <span className="op-btn-label">Kendala</span>
            <span className="op-btn-sub">Isi keterangan</span>
          </button>
          <button className="op-btn op-btn-darurat" disabled={phase !== "idle"} onClick={() => doCheckin("darurat")}>
            <span className="op-btn-label">Darurat</span>
            <span className="op-btn-sub">Butuh bantuan</span>
          </button>
        </div>
        <label className="op-label" htmlFor="ket">
          Keterangan <span className="op-muted">(wajib untuk Kendala)</span>
        </label>
        <textarea
          id="ket"
          ref={ketRef}
          className="op-input op-textarea"
          maxLength={500}
          placeholder="Contoh: cedera ringan di tangan, HT mati"
          value={keterangan}
          onChange={(e) => setKeterangan(e.target.value)}
        />
      </section>

      {phase !== "idle" && (
        <div className="op-overlay" role="status">
          <div className="op-spinner" aria-hidden="true" />
          {phase === "locating" ? "Mengambil lokasi GPS…" : phase === "qr" ? "Mencatat check-in via QR…" : "Mengirim laporan…"}
        </div>
      )}

      {pickSite && (
        <div className="op-overlay op-overlay-sheet">
          <div className="op-sheet">
            <h2 className="op-title-sm">Pilih area kerja</h2>
            <p className="op-sub">
              {pickSite.pos
                ? "Posisi Anda di luar radius semua area. Laporan akan ditandai \"di luar area\"."
                : `${pickSite.gpsErr || "Lokasi tidak tersedia"}. Laporan akan ditandai "tanpa lokasi".`}
            </p>
            <div className="op-names">
              {nearestSites(sites, pickSite.pos?.lat ?? null, pickSite.pos?.lng ?? null).map((s) => (
                <button key={s.id} className="op-name" onClick={() => resolvePick(s.id)}>
                  {s.nama}
                  {s.jarak != null && <span className="op-muted"> · {fmtJarak(s.jarak)}</span>}
                </button>
              ))}
            </div>
            <button className="op-btn-secondary" onClick={() => resolvePick(null)}>
              Batal
            </button>
          </div>
        </div>
      )}

      <footer className="op-foot">
        {pushState === "default" && (
          <button className="op-btn-secondary" onClick={() => subscribePush(false)}>
            Aktifkan pengingat check-in
          </button>
        )}
        {pushState === "denied" && <p className="op-muted">Notifikasi diblokir. Izinkan di pengaturan browser untuk menerima pengingat.</p>}
        {pushState === "ios-install" && (
          <p className="op-muted">Untuk pengingat di iPhone: tekan tombol Bagikan lalu &quot;Tambahkan ke Layar Utama&quot;, lalu buka dari ikon itu.</p>
        )}
        {installEvt && (
          <button className="op-btn-secondary" onClick={install}>
            Pasang di layar HP
          </button>
        )}
      </footer>
    </main>
  );
}
