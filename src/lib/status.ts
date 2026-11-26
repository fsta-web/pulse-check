import type { Checkin, Kondisi, Settings, Site } from "./supabase";
import { atHourMs, witaDate, witaHour, witaHourFrac } from "./time";

export type Warna = "hijau" | "kuning" | "merah" | "abu";

export const WARNA_RANK: Record<Warna, number> = { abu: 0, hijau: 1, kuning: 2, merah: 3 };

export const WARNA_HEX: Record<Warna, string> = {
  hijau: "#16a34a",
  kuning: "#d97706",
  merah: "#dc2626",
  abu: "#9ca3af",
};

export const KONDISI_LABEL: Record<Kondisi, string> = { aman: "Aman", kendala: "Kendala", darurat: "Darurat" };

export const KONDISI_WARNA: Record<Kondisi, Warna> = { aman: "hijau", kendala: "kuning", darurat: "merah" };

export function inJamPantau(s: Settings, now = Date.now()): boolean {
  const h = witaHourFrac(now);
  return h >= s.jam_mulai && h < s.jam_selesai;
}

export type AreaStatus = {
  site: Site;
  warna: Warna;
  darurat: boolean;
  kendala: boolean;
  alasan: string;
  lastAt: string | null;
  menitSejak: number | null;
  operatorAktif: number; // operator yang check-in dalam merah_menit terakhir
  jumlahHariIni: number;
};

/** Check-in terakhir per operator dari daftar (sudah difilter hari ini). */
export function latestPerOperator(checkins: Checkin[]): Map<string, Checkin> {
  const m = new Map<string, Checkin>();
  for (const c of checkins) {
    const cur = m.get(c.operator_id);
    if (!cur || c.ditekan_at > cur.ditekan_at) m.set(c.operator_id, c);
  }
  return m;
}

/**
 * Status area: aturan waktu (hanya jam pantau) digabung dengan kendala/darurat
 * dari check-in terakhir tiap operator hari ini. Dipakai warna paling parah.
 */
export function computeAreaStatus(sites: Site[], todayCheckins: Checkin[], s: Settings, now = Date.now()): AreaStatus[] {
  const today = witaDate(now);
  const latest = latestPerOperator(todayCheckins);
  const pantau = inJamPantau(s, now);
  const startMs = atHourMs(today, s.jam_mulai);

  return sites.map((site) => {
    const list = todayCheckins.filter((c) => c.site_id === site.id);
    let lastAt: string | null = null;
    for (const c of list) if (!lastAt || c.ditekan_at > lastAt) lastAt = c.ditekan_at;

    let warna: Warna = "abu";
    let alasan = "Di luar jam pantau";
    let menitSejak: number | null = lastAt ? Math.floor((now - Date.parse(lastAt)) / 60000) : null;

    if (pantau) {
      const ref = Math.max(lastAt ? Date.parse(lastAt) : 0, startMs);
      const menit = Math.floor((now - ref) / 60000);
      if (menit < s.kuning_menit) {
        warna = "hijau";
        alasan = lastAt && Date.parse(lastAt) >= startMs ? "Check-in rutin" : "Menunggu check-in pertama";
      } else if (menit < s.merah_menit) {
        warna = "kuning";
        alasan = `${menit} menit tanpa check-in`;
      } else {
        warna = "merah";
        alasan = `${menit} menit tanpa check-in`;
      }
    }

    let darurat = false;
    let kendala = false;
    for (const c of latest.values()) {
      if (c.site_id !== site.id) continue;
      if (c.kondisi === "darurat") darurat = true;
      if (c.kondisi === "kendala") kendala = true;
    }
    if (kendala && WARNA_RANK[warna] < WARNA_RANK.kuning) {
      warna = "kuning";
      alasan = "Ada laporan kendala";
    }
    if (darurat) {
      warna = "merah";
      alasan = "Ada laporan DARURAT";
    }

    const aktifSet = new Set<string>();
    for (const c of list) if (now - Date.parse(c.ditekan_at) <= s.merah_menit * 60000) aktifSet.add(c.operator_id);

    return {
      site,
      warna,
      darurat,
      kendala,
      alasan,
      lastAt,
      menitSejak,
      operatorAktif: aktifSet.size,
      jumlahHariIni: list.length,
    };
  });
}

export function sortAreaStatus(list: AreaStatus[]): AreaStatus[] {
  return [...list].sort((a, b) => {
    if (a.darurat !== b.darurat) return a.darurat ? -1 : 1;
    const r = WARNA_RANK[b.warna] - WARNA_RANK[a.warna];
    if (r) return r;
    return a.site.nama.localeCompare(b.site.nama);
  });
}

export type RecapRow = {
  jam: number;
  checkins: Checkin[];
  status: "pantau-ok" | "pantau-kosong" | "berjalan" | "akan-datang" | "luar";
  warna: Warna | null;
};

/** Rekap 24 jam untuk satu area dan satu tanggal. */
export function buildRecap(date: string, siteCheckins: Checkin[], s: Settings, now = Date.now()): RecapRow[] {
  const rows: RecapRow[] = [];
  for (let jam = 0; jam < 24; jam++) {
    const startMs = atHourMs(date, jam);
    const endMs = startMs + 3600000;
    const list = siteCheckins
      .filter((c) => witaDate(c.ditekan_at) === date && witaHour(c.ditekan_at) === jam)
      .sort((a, b) => a.ditekan_at.localeCompare(b.ditekan_at));
    const pantau = jam >= s.jam_mulai && jam < s.jam_selesai;
    let status: RecapRow["status"];
    if (!pantau) status = "luar";
    else if (startMs > now) status = "akan-datang";
    else if (endMs > now) status = list.length ? "pantau-ok" : "berjalan";
    else status = list.length ? "pantau-ok" : "pantau-kosong";

    let warna: Warna | null = null;
    for (const c of list) {
      const w = KONDISI_WARNA[c.kondisi];
      if (!warna || WARNA_RANK[w] > WARNA_RANK[warna]) warna = w;
    }
    if (status === "pantau-kosong") warna = "merah";
    rows.push({ jam, checkins: list, status, warna });
  }
  return rows;
}

/** Jarak (meter) dua titik. */
export function jarakM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type SiteLite = { id: string; nama: string; lat: number; lng: number; radius_m: number };

/** Area terdekat yang radiusnya mencakup titik; null jika di luar semua area. */
export function siteInRadius(sites: SiteLite[], lat: number, lng: number): { site: SiteLite; jarak: number } | null {
  let best: { site: SiteLite; jarak: number } | null = null;
  for (const s of sites) {
    const d = jarakM(lat, lng, s.lat, s.lng);
    if (d <= s.radius_m && (!best || d < best.jarak)) best = { site: s, jarak: d };
  }
  return best;
}

export function nearestSites(sites: SiteLite[], lat: number | null, lng: number | null): (SiteLite & { jarak: number | null })[] {
  return sites
    .map((s) => ({ ...s, jarak: lat == null || lng == null ? null : jarakM(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => (a.jarak ?? 1e12) - (b.jarak ?? 1e12) || a.nama.localeCompare(b.nama));
}

export function fmtJarak(m: number | null | undefined): string {
  if (m == null) return "";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace(".", ",")} km`;
}
