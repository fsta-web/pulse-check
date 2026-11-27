"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import StaffShell from "@/components/StaffShell";
import { supabase, type Site } from "@/lib/supabase";

type Poster = { site: Site; url: string; svg: string };

function CetakQr() {
  const [posters, setPosters] = useState<Poster[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const id = new URLSearchParams(window.location.search).get("site");
      let q = supabase().from("sites").select("id,nama,lat,lng,radius_m,aktif,qr_token").eq("aktif", true).order("nama");
      if (id && id !== "all") q = q.eq("id", id);
      const { data, error } = await q;
      if (error) {
        setErr(error.message);
        setLoading(false);
        return;
      }
      const origin = window.location.origin;
      const out: Poster[] = [];
      for (const s of (data as Site[]) || []) {
        if (!s.qr_token) continue;
        const url = `${origin}/?qr=${s.qr_token}`;
        const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "Q", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
        out.push({ site: s, url, svg });
      }
      setPosters(out);
      setLoading(false);
    })();
  }, []);

  const tanggal = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Makassar", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  return (
    <div>
      <div className="qr-toolbar no-print">
        <div>
          <h1 className="st-h1" style={{ marginBottom: 4 }}>
            Cetak QR area
          </h1>
          <div className="st-muted">
            Satu poster per halaman A4. Cetak, laminasi, lalu tempel di lokasi yang terlindung dari hujan dan sinar matahari langsung.
          </div>
        </div>
        <div className="row">
          <a className="btn" href="/admin">
            ← Kembali ke Admin
          </a>
          <button className="btn btn-primary" onClick={() => window.print()} disabled={!posters.length}>
            Cetak
          </button>
        </div>
      </div>
      {err && <p className="alert alert-bad no-print">{err}</p>}
      {loading && <p className="st-muted no-print">Membuat QR…</p>}
      {!loading && !posters.length && !err && <p className="st-muted no-print">Tidak ada area aktif.</p>}
      <div className="qr-sheets">
        {posters.map((p) => (
          <section key={p.site.id} className="qr-poster">
            <div className="qr-brand">
              <span className="op-logo" aria-hidden="true" /> PULSE CHECK
            </div>
            <div className="qr-area">{p.site.nama}</div>
            <div className="qr-code" dangerouslySetInnerHTML={{ __html: p.svg }} />
            <ol className="qr-steps">
              <li>Buka kamera HP, arahkan ke QR ini.</li>
              <li>Ketuk link yang muncul.</li>
              <li>
                Check-in <b>Aman</b> tercatat otomatis.
              </li>
            </ol>
            <p className="qr-note">Ada kendala atau keadaan darurat? Tekan tombol Kendala / Darurat di aplikasi Pulse Check.</p>
            <div className="qr-foot">
              Kode {p.site.qr_token} · dicetak {tanggal}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function CetakQrPage() {
  return (
    <StaffShell adminOnly>
      <CetakQr />
    </StaffShell>
  );
}
