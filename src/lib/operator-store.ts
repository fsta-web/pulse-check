// Penyimpanan lokal di HP operator (localStorage). Semua fungsi aman dipanggil di browser saja.
import type { Kondisi } from "./supabase";
import type { SiteLite } from "./status";

export type OperatorPick = { id: string; nama: string };

export type LastCheckin = { ditekan_at: string; kondisi: Kondisi; site_nama: string | null };

export type QueueItem = {
  client_id: string;
  operator_id: string;
  kondisi: Kondisi;
  keterangan: string | null;
  lat: number | null;
  lng: number | null;
  akurasi: number | null;
  ditekan_at: string;
  site_id: string | null;
  site_nama: string | null;
  attempts: number;
  needs_site?: boolean;
  qr_token?: string;
};

const K = {
  device: "pc_device",
  operator: "pc_operator",
  sites: "pc_sites",
  ops: "pc_ops",
  queue: "pc_queue",
  last: "pc_last",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* penyimpanan penuh atau diblokir */
  }
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getDeviceId(): string {
  let id = read<string | null>(K.device, null);
  if (!id) {
    id = uuid();
    write(K.device, id);
  }
  return id;
}

export const store = {
  getOperator: () => read<OperatorPick | null>(K.operator, null),
  setOperator: (o: OperatorPick | null) => write(K.operator, o),
  getSites: () => read<SiteLite[]>(K.sites, []),
  setSites: (s: SiteLite[]) => write(K.sites, s),
  getOps: () => read<OperatorPick[]>(K.ops, []),
  setOps: (o: OperatorPick[]) => write(K.ops, o),
  getQueue: () => read<QueueItem[]>(K.queue, []),
  setQueue: (q: QueueItem[]) => write(K.queue, q),
  getLast: () => read<LastCheckin | null>(K.last, null),
  setLast: (l: LastCheckin | null) => write(K.last, l),
};
