"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import StaffShell, { useStaff } from "@/components/StaffShell";
import { DEFAULT_SETTINGS, supabase, type Operator, type Settings, type Site } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/time";

const SitePicker = dynamic(() => import("@/components/SitePicker"), {
  ssr: false,
  loading: () => <div style={{ height: 420, borderRadius: 10, background: "#e9efe9" }} />,
});

type Msg = { ok: boolean; text: string } | null;

function errText(e: { code?: string; message: string }): string {
  if (e.code === "23505") return "Nama sudah dipakai operator aktif lain.";
  if (e.code === "23514") return "Isian tidak valid. Periksa kembali.";
  return e.message;
}

function MsgBox({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p className={`alert ${msg.ok ? "alert-ok" : "alert-bad"}`}>{msg.text}</p>;
}

// ===================== Operator =====================
function OperatorsTab({ sites }: { sites: Site[] }) {
  const [ops, setOps] = useState<Operator[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [bulk, setBulk] = useState("");
  const [bulkArea, setBulkArea] = useState("");
  const [edit, setEdit] = useState<Operator | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const siteMap = useMemo(() => new Map(sites.map((s) => [s.id, s.nama])), [sites]);

  const load = useCallback(async () => {
    const { data, error } = await supabase()
      .from("operators")
      .select("id,nama,no_hp,area_utama_id,device_id,device_claimed_at,device_model,device_os,device_browser,device_seen_at,aktif")
      .order("nama");
    if (error) setMsg({ ok: false, text: error.message });
    else setOps((data as Operator[]) || []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const addBulk = async () => {
    const names = [...new Set(bulk.split("\n").map((s) => s.trim()).filter(Boolean))];
    if (!names.length) return;
    const { error } = await supabase()
      .from("operators")
      .insert(names.map((nama) => ({ nama, area_utama_id: bulkArea || null })));
    if (error) return setMsg({ ok: false, text: errText(error) });
    setMsg({ ok: true, text: `${names.length} operator ditambahkan.` });
    setBulk("");
    load();
  };

  const save = async () => {
    if (!edit) return;
    const { error } = await supabase()
      .from("operators")
      .update({ nama: edit.nama.trim(), no_hp: edit.no_hp?.trim() || null, area_utama_id: edit.area_utama_id || null })
      .eq("id", edit.id);
    if (error) return setMsg({ ok: false, text: errText(error) });
    setMsg({ ok: true, text: "Perubahan disimpan." });
    setEdit(null);
    load();
  };

  const resetDevice = async (o: Operator) => {
    const hp = [o.device_model, o.device_os].filter(Boolean).join(" · ");
    if (!confirm(`Reset HP terdaftar untuk ${o.nama}${hp ? ` (${hp})` : ""}? Operator harus memilih namanya lagi di HP baru.`)) return;
    const { error } = await supabase().from("operators").update({ device_id: null, device_claimed_at: null }).eq("id", o.id);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: `HP terdaftar ${o.nama} sudah direset.` });
    load();
  };

  const toggle = async (o: Operator) => {
    if (o.aktif && !confirm(`Nonaktifkan ${o.nama}? Riwayatnya tetap tersimpan.`)) return;
    const { error } = await supabase().from("operators").update({ aktif: !o.aktif }).eq("id", o.id);
    if (error) return setMsg({ ok: false, text: errText(error) });
    load();
  };

  const list = ops.filter((o) => showInactive || o.aktif);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <MsgBox msg={msg} />
      <div className="st-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2 className="st-h2">Tambah operator</h2>
        <label className="field">
          Nama (satu nama per baris, bisa tempel daftar dari Excel)
          <textarea rows={4} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"Budi Santoso\nAndi Pratama"} />
        </label>
        <div className="row">
          <label className="field">
            Area utama (opsional)
            <select value={bulkArea} onChange={(e) => setBulkArea(e.target.value)}>
              <option value="">-</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nama}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" onClick={addBulk} disabled={!bulk.trim()}>
            Tambah
          </button>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="st-muted">
          {ops.filter((o) => o.aktif).length} operator aktif · {ops.filter((o) => o.aktif && o.device_id).length} sudah memilih nama di HP
        </div>
        <label className="st-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Tampilkan nonaktif
        </label>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Nama</th>
              <th>No. HP</th>
              <th>Area utama</th>
              <th>HP terdaftar</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((o) =>
              edit?.id === o.id ? (
                <tr key={o.id}>
                  <td>
                    <input className="btn btn-sm" style={{ fontWeight: 400, width: "100%" }} value={edit.nama} onChange={(e) => setEdit({ ...edit, nama: e.target.value })} />
                  </td>
                  <td>
                    <input className="btn btn-sm" style={{ fontWeight: 400, width: "100%" }} value={edit.no_hp || ""} onChange={(e) => setEdit({ ...edit, no_hp: e.target.value })} />
                  </td>
                  <td>
                    <select className="btn btn-sm" value={edit.area_utama_id || ""} onChange={(e) => setEdit({ ...edit, area_utama_id: e.target.value || null })}>
                      <option value="">-</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nama}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td colSpan={2} />
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-sm btn-primary" onClick={save}>
                      Simpan
                    </button>{" "}
                    <button className="btn btn-sm" onClick={() => setEdit(null)}>
                      Batal
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={o.id} style={o.aktif ? undefined : { color: "#8a948d" }}>
                  <td>
                    <b>{o.nama}</b>
                  </td>
                  <td>{o.no_hp || "-"}</td>
                  <td>{(o.area_utama_id && siteMap.get(o.area_utama_id)) || "-"}</td>
                  <td>
                    {o.device_id ? (
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", justifyContent: "space-between" }}>
                        <div>
                          <b>{o.device_model || "Model belum tercatat"}</b>
                          {o.device_os && <span> · {o.device_os}</span>}
                          <div className="st-muted">
                            {o.device_browser ? `${o.device_browser} · ` : ""}
                            {o.device_seen_at
                              ? `terakhir dibuka ${fmtDateTime(o.device_seen_at)}`
                              : o.device_claimed_at
                                ? `terdaftar ${fmtDateTime(o.device_claimed_at)}`
                                : ""}
                          </div>
                        </div>
                        <button className="btn btn-sm" onClick={() => resetDevice(o)}>
                          Reset
                        </button>
                      </div>
                    ) : (
                      <span className="st-muted">Belum</span>
                    )}
                  </td>
                  <td>{o.aktif ? <span className="pill pill-ok">Aktif</span> : <span className="pill pill-off">Nonaktif</span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-sm" onClick={() => setEdit(o)}>
                      Ubah
                    </button>{" "}
                    <button className={`btn btn-sm ${o.aktif ? "btn-danger" : ""}`} onClick={() => toggle(o)}>
                      {o.aktif ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  </td>
                </tr>
              ),
            )}
            {!list.length && (
              <tr>
                <td colSpan={6} className="st-muted">
                  Belum ada operator.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ===================== Area =====================
type SiteForm = { id: string | null; nama: string; coord: string; radius: string; aktif: boolean };
const EMPTY_SITE: SiteForm = { id: null, nama: "", coord: "", radius: "500", aktif: true };

function parseCoord(s: string): { lat: number; lng: number } | null {
  const m = s.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(",", "."));
  const lng = parseFloat(m[2].replace(",", "."));
  if (Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function SitesTab({ sites, reload }: { sites: Site[]; reload: () => void }) {
  const [form, setForm] = useState<SiteForm>(EMPTY_SITE);
  const [msg, setMsg] = useState<Msg>(null);
  const coord = parseCoord(form.coord);
  const radius = Math.max(50, Math.min(20000, parseInt(form.radius || "0", 10) || 0));

  const save = async () => {
    if (!form.nama.trim()) return setMsg({ ok: false, text: "Nama area wajib diisi." });
    if (!coord) return setMsg({ ok: false, text: "Koordinat belum valid. Klik peta atau tempel \"lat, lng\" dari Google Maps." });
    const row = { nama: form.nama.trim(), lat: coord.lat, lng: coord.lng, radius_m: radius, aktif: form.aktif };
    const sb = supabase();
    const { error } = form.id ? await sb.from("sites").update(row).eq("id", form.id) : await sb.from("sites").insert(row);
    if (error) return setMsg({ ok: false, text: errText(error) });
    setMsg({ ok: true, text: form.id ? "Area diperbarui." : "Area ditambahkan." });
    setForm(EMPTY_SITE);
    reload();
  };

  const editSite = (s: Site) => setForm({ id: s.id, nama: s.nama, coord: `${s.lat}, ${s.lng}`, radius: String(s.radius_m), aktif: s.aktif });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(300px, 1fr)", gap: 12 }} className="adm-sites">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SitePicker
          sites={sites}
          editing={coord || form.id || form.nama ? { id: form.id, lat: coord?.lat ?? null, lng: coord?.lng ?? null, radius } : null}
          onPick={(lat, lng) => setForm((f) => ({ ...f, coord: `${lat}, ${lng}` }))}
        />
        <div className="st-muted">Klik peta untuk menentukan titik tengah area. Lingkaran biru = radius area yang sedang diisi.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <MsgBox msg={msg} />
        <div className="st-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 className="st-h2">{form.id ? "Ubah area" : "Tambah area"}</h2>
          <label className="field">
            Nama area
            <input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} placeholder="Area A / Well pad KM-12" />
          </label>
          <label className="field">
            Koordinat (lat, lng)
            <input value={form.coord} onChange={(e) => setForm({ ...form, coord: e.target.value })} placeholder="-0.4987, 117.1436" />
          </label>
          <label className="field">
            Radius (meter)
            <input type="number" min={50} max={20000} step={50} value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} />
          </label>
          <label className="st-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={form.aktif} onChange={(e) => setForm({ ...form, aktif: e.target.checked })} /> Aktif
          </label>
          <div className="row">
            <button className="btn btn-primary" onClick={save}>
              {form.id ? "Simpan" : "Tambah area"}
            </button>
            {(form.id || form.nama || form.coord) && (
              <button className="btn" onClick={() => setForm(EMPTY_SITE)}>
                Batal
              </button>
            )}
          </div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Area</th>
                <th>Radius</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.nama}</b>
                    <div className="st-muted">
                      {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                    </div>
                  </td>
                  <td>{s.radius_m} m</td>
                  <td>{s.aktif ? <span className="pill pill-ok">Aktif</span> : <span className="pill pill-off">Nonaktif</span>}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => editSite(s)}>
                      Ubah
                    </button>
                  </td>
                </tr>
              ))}
              {!sites.length && (
                <tr>
                  <td colSpan={4} className="st-muted">
                    Belum ada area.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ===================== Akun =====================
type Account = { user_id: string; email: string; role: "admin" | "spv"; nama: string | null };

function AccountsTab() {
  const me = useStaff();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [forms, setForms] = useState<Record<string, { email: string; password: string; nama: string }>>({});
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().rpc("admin_accounts");
    if (error) return setMsg({ ok: false, text: error.message });
    const list = (data as Account[]) || [];
    setAccounts(list);
    setForms(Object.fromEntries(list.map((a) => [a.user_id, { email: a.email, password: "", nama: a.nama || "" }])));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (a: Account) => {
    const f = forms[a.user_id];
    const { data, error } = await supabase().rpc("admin_update_account", {
      p_user: a.user_id,
      p_email: f.email,
      p_password: f.password || null,
      p_nama: f.nama,
    });
    if (error) return setMsg({ ok: false, text: error.message });
    const text: Record<string, string> = {
      ok: "Akun diperbarui.",
      invalid_email: "Format email tidak valid.",
      email_taken: "Email sudah dipakai akun lain.",
      password_short: "Password minimal 8 karakter.",
      forbidden: "Hanya admin yang bisa mengubah akun.",
    };
    setMsg({ ok: data === "ok", text: text[data as string] || String(data) });
    if (data === "ok") load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <MsgBox msg={msg} />
      {accounts.map((a) => {
        const f = forms[a.user_id];
        if (!f) return null;
        return (
          <div key={a.user_id} className="st-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2 className="st-h2">
              {a.role === "admin" ? "Admin" : "SPV"} {a.user_id === me.userId && <span className="st-muted">(akun Anda)</span>}
            </h2>
            <div className="row">
              <label className="field" style={{ flex: 1, minWidth: 160 }}>
                Nama tampilan
                <input value={f.nama} onChange={(e) => setForms({ ...forms, [a.user_id]: { ...f, nama: e.target.value } })} />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 200 }}>
                Email login
                <input type="email" value={f.email} onChange={(e) => setForms({ ...forms, [a.user_id]: { ...f, email: e.target.value } })} />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 160 }}>
                Password baru
                <input
                  type="password"
                  value={f.password}
                  placeholder="Kosongkan jika tidak diganti"
                  autoComplete="new-password"
                  onChange={(e) => setForms({ ...forms, [a.user_id]: { ...f, password: e.target.value } })}
                />
              </label>
              <button className="btn btn-primary" onClick={() => save(a)}>
                Simpan
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===================== Pengaturan =====================
function SettingsTab() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [msg, setMsg] = useState<Msg>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    supabase()
      .from("settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setS(data as Settings);
        setLoaded(true);
      });
  }, []);

  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: parseInt(e.target.value || "0", 10) });

  const save = async () => {
    if (s.jam_mulai >= s.jam_selesai) return setMsg({ ok: false, text: "Jam mulai harus lebih awal dari jam selesai." });
    if (s.kuning_menit >= s.merah_menit) return setMsg({ ok: false, text: "Batas kuning harus lebih kecil dari batas merah." });
    if (s.pengingat1_menit >= s.pengingat2_menit) return setMsg({ ok: false, text: "Pengingat pertama harus lebih awal dari pengingat kedua." });
    const { error } = await supabase()
      .from("settings")
      .update({
        jam_mulai: s.jam_mulai,
        jam_selesai: s.jam_selesai,
        kuning_menit: s.kuning_menit,
        merah_menit: s.merah_menit,
        pengingat1_menit: s.pengingat1_menit,
        pengingat2_menit: s.pengingat2_menit,
        pengingat_pagi: s.pengingat_pagi,
        app_url: s.app_url?.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setMsg(error ? { ok: false, text: errText(error) } : { ok: true, text: "Pengaturan disimpan." });
  };

  if (!loaded) return <div className="st-muted">Memuat…</div>;

  return (
    <div className="st-card" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <MsgBox msg={msg} />
      <h2 className="st-h2">Jam pantau (WITA)</h2>
      <div className="row">
        <label className="field">
          Mulai (jam)
          <input type="number" min={0} max={23} value={s.jam_mulai} onChange={num("jam_mulai")} />
        </label>
        <label className="field">
          Selesai (jam)
          <input type="number" min={1} max={24} value={s.jam_selesai} onChange={num("jam_selesai")} />
        </label>
      </div>
      <h2 className="st-h2">Warna area</h2>
      <div className="row">
        <label className="field">
          Kuning setelah (menit tanpa check-in)
          <input type="number" min={5} max={600} value={s.kuning_menit} onChange={num("kuning_menit")} />
        </label>
        <label className="field">
          Merah setelah (menit tanpa check-in)
          <input type="number" min={10} max={900} value={s.merah_menit} onChange={num("merah_menit")} />
        </label>
      </div>
      <h2 className="st-h2">Notifikasi pengingat ke operator</h2>
      <div className="row">
        <label className="field">
          Pengingat 1 (menit setelah check-in)
          <input type="number" min={5} max={600} value={s.pengingat1_menit} onChange={num("pengingat1_menit")} />
        </label>
        <label className="field">
          Pengingat 2 (menit setelah check-in)
          <input type="number" min={5} max={900} value={s.pengingat2_menit} onChange={num("pengingat2_menit")} />
        </label>
      </div>
      <label className="st-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={s.pengingat_pagi} onChange={(e) => setS({ ...s, pengingat_pagi: e.target.checked })} /> Kirim pengingat pagi
        saat jam pantau dimulai
      </label>
      <label className="field">
        Alamat web (untuk pengiriman notifikasi)
        <div className="row">
          <input style={{ flex: 1 }} value={s.app_url || ""} onChange={(e) => setS({ ...s, app_url: e.target.value })} placeholder="https://…" />
          <button className="btn btn-sm" type="button" onClick={() => setS({ ...s, app_url: window.location.origin })}>
            Pakai alamat ini
          </button>
        </div>
      </label>
      <div>
        <button className="btn btn-primary" onClick={save}>
          Simpan pengaturan
        </button>
      </div>
    </div>
  );
}

// ===================== Halaman =====================
function Admin() {
  const [tab, setTab] = useState<"operator" | "area" | "akun" | "pengaturan">("operator");
  const [sites, setSites] = useState<Site[]>([]);
  const loadSites = useCallback(async () => {
    const { data } = await supabase().from("sites").select("id,nama,lat,lng,radius_m,aktif").order("nama");
    setSites((data as Site[]) || []);
  }, []);
  useEffect(() => {
    loadSites();
  }, [loadSites]);

  return (
    <div>
      <h1 className="st-h1">Admin</h1>
      <div className="tabs">
        {(
          [
            ["operator", "Operator"],
            ["area", "Area kerja"],
            ["akun", "Akun"],
            ["pengaturan", "Pengaturan"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "operator" && <OperatorsTab sites={sites.filter((s) => s.aktif)} />}
      {tab === "area" && <SitesTab sites={sites} reload={loadSites} />}
      {tab === "akun" && <AccountsTab />}
      {tab === "pengaturan" && <SettingsTab />}
    </div>
  );
}

export default function AdminPage() {
  return (
    <StaffShell adminOnly>
      <Admin />
    </StaffShell>
  );
}
