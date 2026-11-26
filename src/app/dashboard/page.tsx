"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";
import StaffShell from "@/components/StaffShell";
import RecapPanel from "@/components/RecapPanel";
import type { Focus } from "@/components/MapView";
import { checkinPopup } from "@/components/MapView";
import { useLive } from "@/lib/useLive";
import type { Checkin, Operator, Site } from "@/lib/supabase";
import { computeAreaStatus, KONDISI_LABEL, KONDISI_WARNA, latestPerOperator, sortAreaStatus, WARNA_HEX } from "@/lib/status";
import { fmtAgo, fmtTime, minutesSince, pad2 } from "@/lib/time";
import { flagsText } from "@/lib/excel";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false, loading: () => <div className="db-map-inner" /> });

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const play = (t: number, f: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = "square";
      g.gain.setValueAtTime(0.15, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.36);
    };
    play(0, 880);
    play(0.45, 660);
    play(0.9, 880);
    setTimeout(() => ctx.close(), 1600);
  } catch {
    /* audio diblokir browser */
  }
}

function Dashboard() {
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [tab, setTab] = useState<"peta" | "panel">("panel");
  const focusKey = useRef(0);

  const onNew = useCallback((c: Checkin) => {
    if (c.kondisi === "darurat") {
      beep();
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("DARURAT — Pulse Check", { body: c.keterangan || "Operator melapor darurat", icon: "/icons/icon-192.png" });
        } catch {
          /* abaikan */
        }
      }
    }
  }, []);

  const live = useLive(onNew);
  const { sites, operators, settings, checkins, now, today } = live;

  const activeSites = useMemo(() => sites.filter((s) => s.aktif), [sites]);
  const opMap = useMemo(() => new Map<string, Operator>(operators.map((o) => [o.id, o])), [operators]);
  const siteMap = useMemo(() => new Map<string, Site>(sites.map((s) => [s.id, s])), [sites]);
  const statuses = useMemo(() => sortAreaStatus(computeAreaStatus(activeSites, checkins, settings, now)), [activeSites, checkins, settings, now]);
  const latest = useMemo(() => [...latestPerOperator(checkins).values()], [checkins]);
  const perhatian = useMemo(
    () => latest.filter((c) => c.kondisi !== "aman").sort((a, b) => (a.kondisi === b.kondisi ? b.ditekan_at.localeCompare(a.ditekan_at) : a.kondisi === "darurat" ? -1 : 1)),
    [latest],
  );
  const feed = useMemo(() => [...checkins].sort((a, b) => b.ditekan_at.localeCompare(a.ditekan_at)).slice(0, 60), [checkins]);

  const counts = useMemo(() => {
    const c = { hijau: 0, kuning: 0, merah: 0, abu: 0 };
    for (const s of statuses) c[s.warna]++;
    return c;
  }, [statuses]);

  const focusCheckin = (c: Checkin) => {
    if (c.lat == null || c.lng == null) return;
    focusKey.current++;
    setFocus({ lat: c.lat, lng: c.lng, html: checkinPopup(c, opMap.get(c.operator_id)?.nama || "Operator", now), key: focusKey.current });
    setTab("peta");
  };

  const selectSite = (id: string) => {
    setSelected(id);
    setTab("panel");
  };

  const selSite = selected ? siteMap.get(selected) : undefined;
  const [soundOn, setSoundOn] = useState(false);

  if (live.loading) return <div className="st-muted">Memuat data…</div>;

  return (
    <>
      {live.error && <p className="alert alert-bad">Gagal memuat data: {live.error}</p>}
      <div className="row db-tabs-mobile" style={{ marginBottom: 8 }}>
        <button className={`btn btn-sm ${tab === "peta" ? "btn-primary" : ""}`} onClick={() => setTab("peta")}>
          Peta
        </button>
        <button className={`btn btn-sm ${tab === "panel" ? "btn-primary" : ""}`} onClick={() => setTab("panel")}>
          {selSite ? `Rekap ${selSite.nama}` : "Daftar"}
        </button>
      </div>
      <div className="db-grid" data-tab={tab}>
        <div className="db-map">
          <MapView
            statuses={statuses}
            latest={latest}
            operators={opMap}
            staleMinutes={settings.merah_menit}
            selectedId={selected}
            onSelect={selectSite}
            focus={focus}
            now={now}
          />
        </div>
        <div className="db-panel">
          {selSite ? (
            <RecapPanel
              site={selSite}
              status={statuses.find((s) => s.site.id === selSite.id)}
              today={today}
              todayCheckins={checkins}
              operators={opMap}
              settings={settings}
              now={now}
              onBack={() => setSelected(null)}
              onFocus={focusCheckin}
            />
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="st-muted">
                  {live.connected ? "● Live" : "○ Menyambung ulang…"} · {fmtTime(now)} WITA · jam pantau {pad2(settings.jam_mulai)}:00–
                  {pad2(settings.jam_selesai)}:00
                </div>
                <button
                  className="btn btn-sm"
                  onClick={() => {
                    beep();
                    setSoundOn(true);
                    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
                  }}
                >
                  {soundOn ? "Suara aktif ✓" : "Tes suara darurat"}
                </button>
              </div>
              <div className="db-counters">
                <div className="db-counter" style={{ borderLeft: `4px solid ${WARNA_HEX.hijau}` }}>
                  <b>{counts.hijau}</b>
                  <span>area aman</span>
                </div>
                <div className="db-counter" style={{ borderLeft: `4px solid ${WARNA_HEX.kuning}` }}>
                  <b>{counts.kuning}</b>
                  <span>kendala / jatuh tempo</span>
                </div>
                <div className="db-counter" style={{ borderLeft: `4px solid ${WARNA_HEX.merah}` }}>
                  <b>{counts.merah}</b>
                  <span>darurat / terlewat</span>
                </div>
              </div>

              {perhatian.length > 0 && (
                <div className="st-card" style={{ padding: 0, borderColor: "#f3b4b4" }}>
                  <div className="st-h2" style={{ padding: "10px 12px 0", color: "#991b1b" }}>
                    Perlu perhatian
                  </div>
                  {perhatian.map((c) => (
                    <div key={c.id} className="db-feed-item" style={{ cursor: "pointer" }} onClick={() => focusCheckin(c)}>
                      <span className={`db-dot ${c.kondisi === "darurat" ? "blink" : ""}`} style={{ background: WARNA_HEX[KONDISI_WARNA[c.kondisi]], marginTop: 4 }} />
                      <div>
                        <b>{opMap.get(c.operator_id)?.nama}</b> · {KONDISI_LABEL[c.kondisi]} · {fmtTime(c.ditekan_at)} ·{" "}
                        {(c.site_id && siteMap.get(c.site_id)?.nama) || "-"}
                        {c.keterangan && <div className="st-muted">&quot;{c.keterangan}&quot;</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="st-card" style={{ padding: 0 }}>
                <div className="st-h2" style={{ padding: "10px 12px 4px" }}>
                  Area kerja <span className="st-muted">· klik untuk rekap 24 jam</span>
                </div>
                {!statuses.length && <p className="st-muted" style={{ padding: "0 12px 12px" }}>Belum ada area. Admin bisa menambahkannya di menu Admin.</p>}
                {statuses.map((st) => (
                  <button key={st.site.id} className="db-area" onClick={() => selectSite(st.site.id)}>
                    <span className={`db-dot ${st.darurat ? "blink" : ""}`} style={{ background: WARNA_HEX[st.warna] }} />
                    <span>
                      <b>{st.site.nama}</b>
                      <div className="st-muted">
                        {st.alasan}
                        {st.lastAt ? ` · terakhir ${fmtTime(st.lastAt)}` : ""}
                      </div>
                    </span>
                    <span className="st-muted" style={{ textAlign: "right" }}>
                      {st.operatorAktif} operator
                      <br />
                      {st.jumlahHariIni} check-in
                    </span>
                  </button>
                ))}
              </div>

              <div className="st-card" style={{ padding: 0 }}>
                <div className="st-h2" style={{ padding: "10px 12px 4px" }}>
                  Check-in terbaru
                </div>
                {!feed.length && <p className="st-muted" style={{ padding: "0 12px 12px" }}>Belum ada check-in hari ini.</p>}
                {feed.map((c) => {
                  const f = flagsText(c);
                  return (
                    <div key={c.id} className="db-feed-item" style={{ cursor: c.lat != null ? "pointer" : "default" }} onClick={() => focusCheckin(c)}>
                      <span className="db-dot" style={{ background: WARNA_HEX[KONDISI_WARNA[c.kondisi]], marginTop: 4 }} />
                      <div style={{ flex: 1 }}>
                        <b>{opMap.get(c.operator_id)?.nama || "?"}</b> · {(c.site_id && siteMap.get(c.site_id)?.nama) || "-"}
                        {c.kondisi !== "aman" && <b style={{ color: WARNA_HEX[KONDISI_WARNA[c.kondisi]] }}> · {KONDISI_LABEL[c.kondisi]}</b>}
                        {c.keterangan && <div className="st-muted">&quot;{c.keterangan}&quot;</div>}
                        {f && (
                          <div className="db-flags">
                            {f.split(", ").map((x) => (
                              <span key={x} className="flag">
                                {x}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="st-muted" style={{ whiteSpace: "nowrap" }}>
                        {fmtTime(c.ditekan_at)}
                        <br />
                        {fmtAgo(minutesSince(c.ditekan_at, now))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <StaffShell>
      <Dashboard />
    </StaffShell>
  );
}
