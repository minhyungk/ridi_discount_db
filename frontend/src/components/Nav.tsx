"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const BLUE = "#1e9eff";

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    setQ(params.get("q") ?? "");
  }, [params]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    router.push(query ? `/?q=${encodeURIComponent(query)}` : "/");
  };

  const linkStyle = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px",
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 600,
    color: active ? "#fff" : BLUE,
    background: active ? BLUE : "rgba(30,158,255,0.08)",
    transition: "background 0.15s",
    whiteSpace: "nowrap",
  });

  const isHome = pathname === "/";
  const isCalendar = pathname === "/calendar";

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <div className="nav-inner">
        <Link
          href="/"
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: BLUE,
            letterSpacing: "-0.3px",
            whiteSpace: "nowrap",
          }}
        >
          RidiDB
        </Link>

        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/" style={linkStyle(isHome)}>
            할인 도서
          </Link>
          <Link href="/calendar" style={linkStyle(isCalendar)}>
            캘린더
          </Link>
        </div>

        <form onSubmit={onSubmit} className="nav-search">
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#6e6e73"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: "absolute", left: 14, pointerEvents: "none" }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="도서 검색"
              style={{
                width: "100%",
                padding: "10px 16px 10px 40px",
                fontSize: 14,
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 999,
                background: "#f5f5f7",
                outline: "none",
                color: "#1d1d1f",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = BLUE)}
              onBlur={(e) =>
                (e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)")
              }
            />
          </div>
        </form>
      </div>
    </nav>
  );
}
