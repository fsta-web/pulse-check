"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import type { Site } from "@/lib/supabase";
import { AREA_BOUNDS } from "./MapView";

type Props = {
  sites: Site[];
  editing: { id: string | null; lat: number | null; lng: number | null; radius: number } | null;
  onPick: (lat: number, lng: number) => void;
};

/** Peta kecil untuk admin: klik peta untuk menentukan titik area. */
export default function SitePicker({ sites, editing, onPick }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const draw = useRef<() => void>(() => {});
  const lastFly = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lf = await import("leaflet");
      if (cancelled || !el.current || map.current) return;
      L.current = lf;
      const m = lf.map(el.current, { maxZoom: 19 });
      lf.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      m.fitBounds(AREA_BOUNDS);
      m.on("click", (e: Leaflet.LeafletMouseEvent) => pickRef.current(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)));
      layer.current = lf.layerGroup().addTo(m);
      map.current = m;
      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(() => m.invalidateSize({ pan: false }));
        ro.observe(el.current);
        roRef.current = ro;
      }
      setTimeout(() => m.invalidateSize({ pan: false }), 300);
      draw.current();
    })();
    return () => {
      cancelled = true;
      roRef.current?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    draw.current = () => {
      const lf = L.current;
      const m = map.current;
      if (!lf || !m || !layer.current) return;
      layer.current.clearLayers();
      for (const s of sites) {
        if (editing?.id === s.id) continue;
        lf.circle([s.lat, s.lng], { radius: s.radius_m, color: s.aktif ? "#15803d" : "#9ca3af", weight: 1.5, fillOpacity: 0.12 })
          .bindTooltip(s.nama, { permanent: true, direction: "top", className: "area-label" })
          .addTo(layer.current);
      }
      if (editing && editing.lat != null && editing.lng != null) {
        lf.circle([editing.lat, editing.lng], { radius: editing.radius, color: "#2563eb", weight: 3, fillOpacity: 0.2 }).addTo(layer.current);
        lf.circleMarker([editing.lat, editing.lng], { radius: 6, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }).addTo(layer.current);
        const key = `${editing.id}`;
        if (lastFly.current !== key) {
          lastFly.current = key;
          m.setView([editing.lat, editing.lng], Math.max(m.getZoom(), 14));
        }
      } else if (!editing) {
        lastFly.current = "";
      }
    };
    draw.current();
  }, [sites, editing]);

  return <div ref={el} style={{ height: 420, borderRadius: 10, border: "1px solid var(--line)" }} />;
}
