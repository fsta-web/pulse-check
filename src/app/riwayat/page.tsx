"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import StaffShell from "@/components/StaffShell";
import { CHECKIN_COLS, supabase, type Checkin, type Kondisi, type Operator, type Site } from "@/lib/supabase";
import { KONDISI_LABEL, KONDISI_WARNA, WARNA_HEX } from "@/lib/status";
import { addDays, dayStartMs, fmtTime, witaDate } from "@/lib/time";
import { CHECKIN_HEADER, checkinRow, downloadXlsx, flagsText } from "@/lib/excel";

const PAGE = 100;

function Riwayat() {
  const today = witaDate();
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [siteId, setSiteId] = useState("");
  const [opId, setOpId] = useState("");
  const [kondisi, setKondisi] = useState<"" | Kondisi>("");
  const [rows, setRows] = useState<Checkin[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [ops, setOps] = useState<Operator[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const sb = supabase();
    sb.from("sites").select("id,nama,lat,lng,radius_m,aktif").order("nama").then(({ data }) => setSites((data as Site[]) || []));
    sb.from("operators").select("id,nama,no_hp,area_utama_id,device_id,device_claimed_at,aktif").order("nama").then(({ data }) => setOps((data as Operator[]) || []));
  }, []);

  const opMap = useMemo(() => new Map(ops.map((o) => [o.id, o])), [ops]);
  const siteMap = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);

  const buildQuery = useCallback(
    (count: boolean) => {
      let q = supabase()
        .from("checkins")
        .select(CHECKIN_COLS, count ? { count: "exact" } : undefined)
        .gte("ditekan_at", new Date(dayStartMs(from)).toISOString())
        .lt("ditekan_at", new Date(dayStartMs(to) + 86400000).toISOString())
        .order("ditekan_at", { ascending: false });
      if (siteId) q = q.eq("site_id", siteId);
      if (opId) q = q.eq("operator_id", opId);
      if (kondisi) q = q.eq("kondisi", kondisi);
      return q;
    },
    [from, to, siteId, opId, kondisi],
  );

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setErr(null);
      const { data, error, count } = await buildQuery(true).range(p * PAGE, p * PAGE + PAGE - 1);
      setLoading(false);
      if (error) return setErr(error.message);
      setRows((data as Checkin[]) || []);
      setTotal(count || 0);
      setPage(p);
    },
    [buildQuery],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const exportAll = async () => {
    setExporting(true);
    setErr(null);
    const all: Checkin[] = [];
    for (let p = 0; p < 50; p++) {
      const { data, error } = await buildQuery(false).range(p * 1000, p * 1000 + 999);
      if (error) {
        setErr(error.message);
        setExporting(false);
        return;
      }
      all.push(...((data as Checkin[]) || []));
      if (!data || data.length < 1000) break;
    }
    await downloadXlsx(
      `riwayat-checkin-${from}_sd_${to}.xlsx`,
      CHECKIN_HEADER,
      all.map((c) => checkinRow(c, opMap, siteMap)),
      [12, 10, 24, 18, 10, 40, 11, 11, 14, 18, 30],
    );
    setExporting(false);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h1 className="st-h1">Riwayat check-in</h1>
      <div className="st-card row">
        <label className="field">
          Dari
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label className="field">
          Sampai
          <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </label>
        <label className="field">
          Area
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">Semua area</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nama}
                {s.aktif ? "" : " (nonaktif)"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Operator
          <select value={opId} onChange={(e) => setOpId(e.target.value)}>
            <option value="">Semua operator</option>
            {ops.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nama}
                {o.aktif ? "" : " (nonaktif)"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Kondisi
          <select value={kondisi} onChange={(e) => setKondisi(e.target.value as "" | Kondisi)}>
            <option value="">Semua</option>
            <option value="aman">Aman</option>
            <option value="kendala">Kendala</option>
            <option value="darurat">Darurat</option>
          </select>
        </label>
        <button className="btn btn-primary" onClick={exportAll} disabled={exporting || !total}>
          {exporting ? "Menyiapkan…" : "Ekspor Excel"}
        </button>
      </div>
      {err && <p className="alert alert-bad">{err}</p>}
      <div className="st-muted">
        {loading ? "Memuat…" : `${total} check-in`} · halaman {page + 1} dari {pages}
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Jam</th>
              <th>Operator</th>
              <th>Area</th>
              <th>Kondisi</th>
              <th>Keterangan</th>
              <th>GPS</th>
              <th>Tanda</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{witaDate(c.ditekan_at)}</td>
                <td>{fmtTime(c.ditekan_at)}</td>
                <td>{opMap.get(c.operator_id)?.nama || "-"}</td>
                <td>{(c.site_id && siteMap.get(c.site_id)?.nama) || "-"}</td>
                <td>
                  <span style={{ color: WARNA_HEX[KONDISI_WARNA[c.kondisi]], fontWeight: 700 }}>{KONDISI_LABEL[c.kondisi]}</span>
                </td>
                <td>{c.keterangan || ""}</td>
                <td>
                  {c.lat != null && c.lng != null ? (
                    <a href={`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=17/${c.lat}/${c.lng}`} target="_blank" rel="noreferrer">
                      ±{c.akurasi_m != null ? Math.round(c.akurasi_m) : "?"} m
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="st-muted">{flagsText(c)}</td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={8} className="st-muted">
                  Tidak ada check-in untuk filter ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button className="btn btn-sm" disabled={page === 0 || loading} onClick={() => load(page - 1)}>
          ‹ Sebelumnya
        </button>
        <button className="btn btn-sm" disabled={page + 1 >= pages || loading} onClick={() => load(page + 1)}>
          Berikutnya ›
        </button>
      </div>
    </div>
  );
}

export default function RiwayatPage() {
  return (
    <StaffShell>
      <Riwayat />
    </StaffShell>
  );
}
