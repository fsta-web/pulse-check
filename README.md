# Pulse Check

Aplikasi web pulse check untuk operator di area remote Samarinda–Kutai Kartanegara.

- `/` — halaman operator (HP): pilih nama sekali, lalu check-in Aman / Kendala / Darurat. Lokasi GPS dan area kerja ditentukan otomatis. Tetap bisa dipakai tanpa sinyal (laporan disimpan lalu dikirim otomatis).
- `/dashboard` — SPV dan admin: peta OpenStreetMap, status per area, check-in terbaru, rekap 24 jam per area.
- `/riwayat` — pencarian dan ekspor Excel.
- `/admin` — operator, area kerja, akun, pengaturan (khusus admin).

## Teknologi

- Next.js 16 di Vercel (region `sin1`).
- Supabase (project `pulse-check`, region `ap-southeast-1`): Postgres + RLS, Auth, Realtime, pg_cron + pg_net.
- Operator tidak login. Semua laporan operator lewat fungsi RPC `op_*` yang memvalidasi nama, HP terdaftar, kondisi, dan area.
- Pengingat: `pg_cron` menjalankan `private.run_reminders()` setiap 5 menit, lalu memanggil `POST /api/push/send` (dilindungi `PUSH_SECRET`) untuk mengirim web push.

## Environment variable

| Nama | Keterangan |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL project Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key Supabase |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Kunci publik VAPID untuk web push |
| `VAPID_PRIVATE_KEY` | Kunci privat VAPID (rahasia) |
| `VAPID_SUBJECT` | `mailto:` kontak pengirim push |
| `PUSH_SECRET` | Sama dengan `private.secrets` bernama `push` di database |

## Pengembangan

```bash
npm install
npm run dev
```
