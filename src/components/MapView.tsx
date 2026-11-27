"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import type { Checkin, Operator } from "@/lib/supabase";
import { KONDISI_LABEL, KONDISI_WARNA, WARNA_HEX, type AreaStatus } from "@/lib/status";
import { fmtAgo, fmtTime, minutesSince } from "@/lib/time";

// Kotak area Kutai Kartanegara + Samarinda (sedikit dilebihkan).
export const AREA_BOUNDS: [[number, number], [number, number]] = [
  [-1.45, 115.25],
  [1.65, 117.85],
];

export type Focus = { lat: number; lng: number; html?: string; key: number } | null;

type Props = {
  statuses: AreaStatus[];
  latest: Checkin[]; // check-in terakhir tiap operator hari ini
  operators: Map<string, Operator>;
  staleMinutes: number;
  selectedId: string | null;
  onSelect: (siteId: string) => void;
  focus: Focus;
  now: number;
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function checkinPopup(c: Checkin, nama: string, now = Date.now()): string {
  const flags: string[] = [];
  if (c.via_qr) flags.push("via QR");
  if (c.di_luar_area) flags.push(c.via_qr ? "jauh dari area QR" : "di luar area");
  if (c.offline) flags.push("terkirim terlambat");
  if (c.lat == null) flags.push("tanpa lokasi");
  if (c.jam_selisih) flags.push("jam HP berbeda");
  return `<div style="min-width:180px"><b>${esc(nama)}</b><br>${KONDISI_LABEL[c.kondisi]} · ${fmtTime(c.ditekan_at)} (${fmtAgo(
    minutesSince(c.ditekan_at, now),
  )})${c.keterangan ? `<br><i>"${esc(c.keterangan)}"</i>` : ""}${
    c.akurasi_m != null ? `<br>Akurasi GPS ±${Math.round(c.akurasi_m)} m` : ""
  }${flags.length ? `<br><span style="color:#92400e">${flags.join(", ")}</span>` : ""}</div>`;
}

export default function MapView({ statuses, latest, operators, staleMinutes, selectedId, onSelect, focus, now }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const areaLayer = useRef<Leaflet.LayerGroup | null>(null);
  const opLayer = useRef<Leaflet.LayerGroup | null>(null);
  const fitted = useRef(false);
  const shownOnce = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const readyRef = useRef(false);
  const redraw = useRef<() => void>(() => {});

  // Buat peta sekali.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lf = await import("leaflet");
      if (cancelled || !el.current || map.current) return;
      L.current = lf;
      const m = lf.map(el.current, { maxZoom: 19, zoomControl: true, attributionControl: true });
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      m.fitBounds(AREA_BOUNDS);
      areaLayer.current = lf.layerGroup().addTo(m);
      opLayer.current = lf.layerGroup().addTo(m);
      map.current = m;
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => {
          const visible = !!el.current && el.current.clientWidth > 0 && el.current.clientHeight > 0;
          m.invalidateSize({ pan: false });
          // Peta dibuat saat tab peta tersembunyi: atur ulang tampilan begitu terlihat.
          if (visible && !shownOnce.current) {
            shownOnce.current = true;
            fitted.current = false;
            m.fitBounds(AREA_BOUNDS);
            redraw.current();
          }
        });
        ro.observe(el.current);
        roRef.current = ro;
      }
      setTimeout(() => m.invalidateSize({ pan: false }), 300);
      readyRef.current = true;
      redraw.current();
    })();
    return () => {
      cancelled = true;
      roRef.current?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Gambar ulang area & operator setiap data berubah.
  useEffect(() => {
    redraw.current = () => {
      const lf = L.current;
      const m = map.current;
      if (!lf || !m || !areaLayer.current || !opLayer.current) return;
      areaLayer.current.clearLayers();
      opLayer.current.clearLayers();

      for (const st of statuses) {
        const s = st.site;
        const color = WARNA_HEX[st.warna];
        const sel = s.id === selectedId;
        const cls = st.darurat ? "pc-pulse" : "";
        const circle = lf.circle([s.lat, s.lng], {
          radius: s.radius_m,
          color,
          weight: sel ? 4 : 2,
          fillColor: color,
          fillOpacity: sel ? 0.25 : 0.15,
          className: cls,
        });
        const center = lf.circleMarker([s.lat, s.lng], {
          radius: sel ? 11 : 9,
          color: "#fff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
          className: cls,
        });
        center.bindTooltip(esc(s.nama), { permanent: true, direction: "top", offset: [0, -10], className: "area-label" });
        const pick = () => onSelectRef.current(s.id);
        circle.on("click", pick);
        center.on("click", pick);
        circle.addTo(areaLayer.current);
        center.addTo(areaLayer.current);
      }

      for (const c of latest) {
        if (c.lat == null || c.lng == null) continue;
        const stale = minutesSince(c.ditekan_at, now) > staleMinutes;
        const color = stale ? WARNA_HEX.abu : WARNA_HEX[KONDISI_WARNA[c.kondisi]];
        const nama = operators.get(c.operator_id)?.nama || "Operator";
        const mk = lf.circleMarker([c.lat, c.lng], {
          radius: 6,
          color: "#fff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
          className: c.kondisi === "darurat" ? "pc-pulse" : "",
        });
        mk.bindTooltip(`${esc(nama)} · ${fmtTime(c.ditekan_at)}`);
        mk.bindPopup(checkinPopup(c, nama, now));
        mk.addTo(opLayer.current);
      }

      if (!fitted.current && statuses.length) {
        const b = lf.latLngBounds(statuses.map((st) => [st.site.lat, st.site.lng] as [number, number]));
        m.fitBounds(b.pad(0.3), { maxZoom: 13 });
        fitted.current = true;
      }
    };
    if (readyRef.current) redraw.current();
  }, [statuses, latest, operators, staleMinutes, selectedId, now]);

  // Perbesar ke area terpilih.
  useEffect(() => {
    const lf = L.current;
    const m = map.current;
    if (!lf || !m || !selectedId) return;
    const st = statuses.find((x) => x.site.id === selectedId);
    if (!st) return;
    const b = lf.circle([st.site.lat, st.site.lng], { radius: st.site.radius_m }).addTo(m);
    m.flyToBounds(b.getBounds().pad(0.6), { maxZoom: 16, duration: 0.6 });
    b.remove();
    // sengaja hanya saat area terpilih berganti
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Fokus ke satu check-in.
  useEffect(() => {
    const lf = L.current;
    const m = map.current;
    if (!lf || !m || !focus) return;
    m.flyTo([focus.lat, focus.lng], 17, { duration: 0.6 });
    if (focus.html) lf.popup().setLatLng([focus.lat, focus.lng]).setContent(focus.html).openOn(m);
  }, [focus]);

  return <div ref={el} className="db-map-inner" />;
}
