import { prisma } from "@/lib/prisma";
import { format, isAfter } from "date-fns";
import { notFound } from "next/navigation";
import Link from "next/link";
import PriceChart, { PricePoint } from "@/components/PriceChart";

export const dynamic = "force-dynamic";
export const runtime = "edge";

const BLUE = "#1e9eff";

export default async function BookDetail({
  params,
}: {
  params: Promise<{ book_id: string }>;
}) {
  const { book_id } = await params;

  const book = await prisma.book.findUnique({
    where: { book_id },
    include: {
      histories: { orderBy: { scraped_at: "asc" } },
    },
  });

  if (!book) notFound();

  const now = new Date();
  const latest = book.histories[book.histories.length - 1];
  const isOnSale = !!(latest?.end_date && isAfter(new Date(latest.end_date), now));

  const chartData: PricePoint[] = book.histories
    .filter((h) => h.set_price != null)
    .map((h) => ({
      date: format(new Date(h.scraped_at), "M.d"),
      price: h.set_price as number,
    }));

  const hasDiscount = !!(book.discount_pct && book.discount_pct > 0);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px 80px" }}>
      <Link
        href="/"
        style={{
          fontSize: 13,
          color: "#6e6e73",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          marginBottom: 20,
        }}
      >
        ← 목록으로
      </Link>

      <header
        style={{
          marginBottom: 32,
          display: "flex",
          gap: 20,
          alignItems: "flex-start",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://img.ridicdn.net/cover/${book.book_id}/large?dpi=xhdpi`}
          alt={book.title}
          width={140}
          height={200}
          style={{
            width: 140,
            height: "auto",
            flexShrink: 0,
            borderRadius: 6,
            boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
            background: "#f5f5f7",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.4px",
              color: "#1d1d1f",
              lineHeight: 1.3,
            }}
          >
            {book.title}
          </h1>
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <a
              href={`https://ridibooks.com/books/${book.book_id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13, color: BLUE, fontWeight: 500 }}
            >
              리디북스에서 보기 ↗
            </a>
            {isOnSale && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "2px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: BLUE,
                  background: "rgba(30,158,255,0.1)",
                  borderRadius: 999,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: BLUE,
                    animation: "pulse 2s infinite",
                  }}
                />
                할인 중
              </span>
            )}
          </div>
        </div>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 32,
        }}
      >
        <StatCard
          label="현재 가격"
          value={`${book.set_price?.toLocaleString() ?? "—"}원`}
          accent
        />
        <StatCard
          label="정가"
          value={`${book.full_price?.toLocaleString() ?? "—"}원`}
          strike
        />
        <StatCard
          label="할인율"
          value={hasDiscount ? `-${book.discount_pct}%` : "—"}
          accent={hasDiscount}
        />
        <StatCard
          label="역대 최저가"
          value={`${book.all_time_low?.toLocaleString() ?? "—"}원`}
        />
        {latest?.start_date && latest?.end_date && (
          <StatCard
            label="할인 기간"
            value={`${format(new Date(latest.start_date), "M.d")} — ${format(new Date(latest.end_date), "M.d")}`}
          />
        )}
      </section>

      <section
        style={{
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 12,
          padding: "20px 16px 16px",
          background: "#fff",
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "#1d1d1f",
            marginBottom: 12,
            padding: "0 8px",
          }}
        >
          가격 히스토리
        </h2>
        <PriceChart
          data={chartData}
          fullPrice={book.full_price}
          allTimeLow={book.all_time_low}
        />
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
  strike,
}: {
  label: string;
  value: string;
  accent?: boolean;
  strike?: boolean;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: "#f5f5f7",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 11, color: "#6e6e73", fontWeight: 500 }}>{label}</div>
      <div
        style={{
          marginTop: 4,
          fontSize: 18,
          fontWeight: 700,
          color: accent ? BLUE : "#1d1d1f",
          textDecoration: strike ? "line-through" : "none",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
    </div>
  );
}
