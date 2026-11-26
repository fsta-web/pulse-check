"use client";

import { useEffect, useMemo, useState } from "react";
import { CHECKIN_COLS, supabase, type Checkin, type Operator, type Settings, type Site } from "@/lib/supabase";
import { buildRecap, KONDISI_LABEL, KONDISI_WARNA, WARNA_HEX, type AreaStatus } from "@/lib/status";
import { addDays, dayStartMs, fmtDateLong, fmtTime, pad2, witaDate, witaHour } from "@/lib/time";
import { downloadXlsx, flagsText } from "@/lib/excel";

type Props = {
  site: Site;
  status: AreaStatus | undefined;
  today: string;
  todayCheckins: Checkin[];
  operators: Map<string, Operator>;
  settings: Settings;
  now: number;
  onBack: () => void;
  onFocus: (c: Checkin) => void;
};

export default function RecapPanel({ site, status, today, todayCheckins, operators, settings, now, onBack, onFocus }: Props) {
  const [date, setDate] = useState(today);
  const [other, setOther] = useState<Checkin[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setDate(today), [site.id, today]);

  useEffect(() => {
    if (date === today) {
      setOther(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(null);
    supabase()
      .from("checkins")
      .select(CHECKIN_COLS)
      .eq("site_id", site.id)
      .gte("ditekan_at", new Date(dayStartMs(date)).toISOString())
      .lt("ditekan_at", new Date(dayStartMs(date) + 86400000).toISOString())
      .order("ditekan_at")
      .then(({ data, error }) => {
        if (!alive) return;
        setLoading(false);
        if (error) setErr(error.message);
        else setOther((data as Checkin[]) || []);
      });
    return () => {
      alive = false;
    };
  }, [date, today, site.id]);

  const list = useMemo(
    () => (date === today ? todayCheckins.filter((c) => c.site_id === site.id) : other || []),
    [date, today, todayCheckins, other, site.id],
  );
  const rows = useMemo(() => buildRecap(date, list, settings, now), [date, list, settings, now]);
  const nowHour = date === today ? witaHour(now) : -1;
  const kosong = rows.filter((r) => r.status === "pantau-kosong").length;
  const operatorBeda = new Set(list.map((c) => c.operator_id)).size;

  const exportXlsx = async () => {
    const out: (string | number | null)[][] = [];
    for (const r of rows) {
      const jam = `${pad2(r.jam)}:00`;
      if (!r.checkins.length) {
        out.push([jam, r.status === "pantau-kosong" ? "Tidak ada check-in" : "", "", "", "", ""]);
        continue;
      }
      for (const c of r.checkins) {
        out.push([jam, operators.get(c.operator_id)?.nama || "-", fmtTime(c.ditekan_at), KONDISI_LABEL[c.kondisi], c.keterangan || "", flagsText(c)]);
      }
    }
    await downloadXlsx(
      `rekap-${site.nama.replace(/[^\w-]+/g, "_")}-${date}.xlsx`,
      ["Jam", "Operator", "Waktu check-in (WITA)", "Kondisi", "Keterangan", "Tanda"],
      out,
      [8, 24, 18, 10, 40, 30],
    );
  };

  return (
    <div className="st-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <button className="btn btn-sm" onClick={onBack}>
          ← Semua area
        </button>
        <button className="btn btn-sm" onClick={exportXlsx} disabled={loading}>
          Ekspor Excel
        </button>
      </div>
      <div>
        <h2 className="st-h1" style={{ marginBottom: 2 }}>
          {site.nama}
        </h2>
        <div className="st-muted">{fmtDateLong(date)}</div>
      </div>
      <div className="row" style={{ alignItems: "center" }}>
        <button className="btn btn-sm" onClick={() => setDate(addDays(date, -1))}>
          ‹
        </button>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="btn btn-sm"
          style={{ fontWeight: 400 }}
        />
        <button className="btn btn-sm" onClick={() => setDate(addDays(date, 1))} disabled={date >= today}>
          ›
        </button>
        {date !== today && (
          <button className="btn btn-sm" onClick={() => setDate(today)}>
            Hari ini
          </button>
        )}
      </div>
      <div className="db-counters">
        <div className="db-counter">
          <b>{list.length}</b>
          <span>check-in</span>
        </div>
        <div className="db-counter">
          <b>{operatorBeda}</b>
          <span>operator</span>
        </div>
        <div className="db-counter" style={kosong ? { background: "var(--merah-bg)" } : undefined}>
          <b>{kosong}</b>
          <span>
            jam kosong ({pad2(settings.jam_mulai)}–{pad2(settings.jam_selesai)})
          </span>
        </div>
      </div>
      {date === today && status && (
        <div className="st-muted">
          Status sekarang:{" "}
          <b style={{ color: WARNA_HEX[status.warna] }}>{status.warna === "abu" ? "di luar jam pantau" : status.warna}</b> · {status.alasan}
        </div>
      )}
      {err && <p className="alert alert-bad">{err}</p>}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 64 }}>Jam</th>
              <th>Operator yang check-in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.jam}
                className={`${r.status === "luar" ? "rc-row-luar" : ""} ${r.status === "pantau-kosong" ? "rc-row-kosong" : ""} ${
                  r.jam === nowHour ? "rc-row-now" : ""
                }`}
              >
                <td>{pad2(r.jam)}:00</td>
                <td>
                  {loading ? (
                    "…"
                  ) : r.checkins.length ? (
                    r.checkins.map((c) => {
                      const flags = flagsText(c);
                      return (
                        <span
                          key={c.id}
                          className="chip"
                          title={`${KONDISI_LABEL[c.kondisi]}${c.keterangan ? ` — ${c.keterangan}` : ""}${
                            c.akurasi_m != null ? ` · GPS ±${Math.round(c.akurasi_m)} m` : ""
                          }${flags ? ` · ${flags}` : ""}`}
                          onClick={() => onFocus(c)}
                        >
                          <i style={{ background: WARNA_HEX[KONDISI_WARNA[c.kondisi]] }} />
                          {operators.get(c.operator_id)?.nama || "?"} {fmtTime(c.ditekan_at)}
                          {c.kondisi !== "aman" && <b style={{ fontSize: 11 }}>{KONDISI_LABEL[c.kondisi]}</b>}
                          {flags && <span className="st-muted">•</span>}
                        </span>
                      );
                    })
                  ) : r.status === "pantau-kosong" ? (
                    <span style={{ color: "#991b1b", fontWeight: 600 }}>Tidak ada check-in</span>
                  ) : r.status === "berjalan" ? (
                    <span className="st-muted">Jam berjalan, belum ada check-in</span>
                  ) : (
                    <span className="st-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="st-muted">
        Jam di luar {pad2(settings.jam_mulai)}:00–{pad2(settings.jam_selesai)}:00 berwarna abu-abu. Arahkan kursor ke nama untuk detail, klik untuk
        melihat titiknya di peta. Data per {witaDate(now) === date ? fmtTime(now) : "hari itu"}.
      </div>
    </div>
  );
}
