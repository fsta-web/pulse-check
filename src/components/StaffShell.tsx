"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Staff = { userId: string; email: string; role: "admin" | "spv"; nama: string | null };

const StaffCtx = createContext<Staff | null>(null);

export function useStaff(): Staff {
  const s = useContext(StaffCtx);
  if (!s) throw new Error("useStaff di luar StaffShell");
  return s;
}

export default function StaffShell({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase();
    let alive = true;
    (async () => {
      const { data } = await sb.auth.getSession();
      const session = data.session;
      if (!session) {
        router.replace(`/login?next=${encodeURIComponent(path)}`);
        return;
      }
      const { data: prof, error } = await sb.from("profiles").select("role,nama").eq("user_id", session.user.id).maybeSingle();
      if (!alive) return;
      if (error || !prof) {
        setErr("Akun ini tidak punya akses ke dashboard.");
        await sb.auth.signOut();
        return;
      }
      if (adminOnly && prof.role !== "admin") {
        router.replace("/dashboard");
        return;
      }
      setStaff({ userId: session.user.id, email: session.user.email || "", role: prof.role, nama: prof.nama });
    })();
    const { data: sub } = sb.auth.onAuthStateChange((evt) => {
      if (evt === "SIGNED_OUT") router.replace("/");
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [router, path, adminOnly]);

  const logout = async () => {
    await supabase().auth.signOut();
    router.replace("/");
  };

  if (err)
    return (
      <div className="lg-wrap">
        <div className="lg-card">
          <p className="alert alert-bad">{err}</p>
          <Link href="/login">Kembali ke login</Link>
        </div>
      </div>
    );
  if (!staff) return <div className="lg-wrap st-muted">Memuat…</div>;

  const nav = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/riwayat", label: "Riwayat" },
    ...(staff.role === "admin" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <StaffCtx.Provider value={staff}>
      <div className="st-wrap">
        <nav className="st-nav">
          <div className="op-brand">
            <span className="op-logo" aria-hidden="true" />
            Pulse Check
          </div>
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={path.startsWith(n.href) ? "active" : ""}>
              {n.label}
            </Link>
          ))}
          <div className="st-right">
            <a href="/" style={{ padding: 0, fontWeight: 400 }}>
              Halaman check-in
            </a>
            <span>
              {staff.nama || staff.email} · {staff.role === "admin" ? "Admin" : "SPV"}
            </span>
            <button className="btn btn-sm" onClick={logout}>
              Keluar
            </button>
          </div>
        </nav>
        <main className="st-main">{children}</main>
      </div>
    </StaffCtx.Provider>
  );
}
