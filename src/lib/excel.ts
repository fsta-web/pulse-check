"use client";

import type { Checkin, Operator, Site } from "./supabase";
import { KONDISI_LABEL } from "./status";
import { fmtTime, witaDate } from "./time";

type Cell = string | number | null;

export function flagsText(c: Checkin): string {
  const f: string[] = [];
  if (c.via_qr) f.push("via QR");
  if (c.di_luar_area) f.push(c.via_qr ? "jauh dari area QR" : "di luar area");
  if (c.area_manual) f.push("area dipilih manual");
  if (c.offline) f.push("terkirim terlambat");
  if (c.lat == null) f.push("tanpa lokasi");
  if (c.jam_selisih) f.push("jam HP berbeda");
  return f.join(", ");
}

export function checkinRow(c: Checkin, ops: Map<string, Operator>, sites: Map<string, Site>): Cell[] {
  return [
    witaDate(c.ditekan_at),
    fmtTime(c.ditekan_at),
    ops.get(c.operator_id)?.nama || "-",
    (c.site_id && sites.get(c.site_id)?.nama) || "-",
    KONDISI_LABEL[c.kondisi],
    c.keterangan || "",
    c.lat,
    c.lng,
    c.akurasi_m != null ? Math.round(c.akurasi_m) : null,
    c.jarak_area_m != null ? Math.round(c.jarak_area_m) : null,
    flagsText(c),
  ];
}

export const CHECKIN_HEADER: string[] = [
  "Tanggal",
  "Jam (WITA)",
  "Operator",
  "Area",
  "Kondisi",
  "Keterangan",
  "Lat",
  "Lng",
  "Akurasi GPS (m)",
  "Jarak ke titik area (m)",
  "Tanda",
];

export async function downloadXlsx(fileName: string, header: string[], rows: Cell[][], widths?: number[]) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const data = [header.map((h) => ({ value: h, fontWeight: "bold" as const })), ...rows.map((r) => r.map((v) => (v === null ? null : { value: v })))];
  await writeExcelFile(data as never, { columns: (widths || header.map(() => 16)).map((w) => ({ width: w })) } as never).toFile(fileName);
}
