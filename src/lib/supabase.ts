import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

let client: SupabaseClient | null = null;

/** Satu client untuk seluruh aplikasi (browser). */
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "pulse-auth" },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

export type Kondisi = "aman" | "kendala" | "darurat";

export type Site = {
  id: string;
  nama: string;
  lat: number;
  lng: number;
  radius_m: number;
  aktif: boolean;
};

export type Operator = {
  id: string;
  nama: string;
  no_hp: string | null;
  area_utama_id: string | null;
  device_id: string | null;
  device_claimed_at: string | null;
  aktif: boolean;
};

export type Checkin = {
  id: number;
  operator_id: string;
  site_id: string | null;
  kondisi: Kondisi;
  keterangan: string | null;
  lat: number | null;
  lng: number | null;
  akurasi_m: number | null;
  jarak_area_m: number | null;
  di_luar_area: boolean;
  area_manual: boolean;
  ditekan_at: string;
  diterima_at: string;
  offline: boolean;
  jam_selisih: boolean;
};

export type Settings = {
  id: number;
  jam_mulai: number;
  jam_selesai: number;
  kuning_menit: number;
  merah_menit: number;
  pengingat1_menit: number;
  pengingat2_menit: number;
  pengingat_pagi: boolean;
  app_url: string | null;
};

export const DEFAULT_SETTINGS: Settings = {
  id: 1,
  jam_mulai: 8,
  jam_selesai: 20,
  kuning_menit: 60,
  merah_menit: 90,
  pengingat1_menit: 50,
  pengingat2_menit: 80,
  pengingat_pagi: true,
  app_url: null,
};

export const CHECKIN_COLS =
  "id,operator_id,site_id,kondisi,keterangan,lat,lng,akurasi_m,jarak_area_m,di_luar_area,area_manual,ditekan_at,diterima_at,offline,jam_selisih";
