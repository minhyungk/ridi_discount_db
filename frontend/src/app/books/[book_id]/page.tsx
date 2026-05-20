import { getPrisma } from "@/lib/prisma";
import { format, isAfter, differenceInDays } from "date-fns";
import { notFound } from "next/navigation";
import Link from "next/link";
import PriceChart, { PricePoint } from "@/components/PriceChart";

export const dynamic = "force-dynamic";

const BLUE = "#1e9eff";

async function getBookDetail(book_id: string) {
  const prisma = getPrisma();
  return prisma.book.findUnique({
    where: { book_id },
    include: {
      histories: { orderBy: { scraped_at: "asc" } },
      authors: { include: { author: true } },
    },
  });
}

export default async function BookDetail({
  params,
}: {
  params: Promise<{ book_id: string }>;
}) {
  const { book_id } = await params;

  const book = await getBookDetail(book_id);

  if (!book) notFound();

  const now = new Date();
  const latest = book.histories[book.histories.length - 1];
  const endDate = latest?.end_date ? new Date(latest.end_date) : null;
  const startDate = latest?.start_date ? new Date(latest.start_date) : null;
  const isOnSale = !!(endDate && isAfter(endDate, now));
  const daysLeft = isOnSale && endDate ? Math.max(0, differenceInDays(endDate, now)) : null;
  const isEndingSoon = isOnSale && endDate ? differenceInDays(endDate, now) <= 7 : false;
  const isNew = isOnSale && startDate ? differenceInDays(now, startDate) < 3 : false;

  const authorNames = Array.from(
    new Set((book.authors ?? []).map((ba) => ba.author.name).filter(Boolean))
  );
  const synopsis = book.introduction?.trim() || null;

  const chartData: PricePoint[] = book.histories
    .filter((h) => h.set_price != null)
    .map((h) => ({
      ts: new Date(h.scraped_at).getTime(),
      price: h.set_price as number,
    }));

  // 세일 중: 마지막 가격이 오늘까지 유지됐음을 수평선으로 시각화
  // 세일 종료: end_date 지점에서 정가로 수직 상승 후 오늘까지 수평 연장
  if (chartData.length > 0) {
    const last = chartData[chartData.length - 1];
    const nowTs = now.getTime();
    if (isOnSale) {
      if (last.ts < nowTs) {
        chartData.push({ ts: nowTs, price: last.price });
      }
    } else if (endDate && book.full_price && isAfter(now, endDate)) {
      const endTs = endDate.getTime();
      if (last.ts < endTs) {
        chartData.push({ ts: endTs, price: last.price });
      }
      chartData.push({ ts: endTs, price: book.full_price });
      if (endTs < nowTs) {
        chartData.push({ ts: nowTs, price: book.full_price });
      }
    }
  }

  // "현재 할인 중" (세일 종료 후에는 false)
  const hasDiscount = !!(book.discount_pct && book.discount_pct > 0 && isOnSale);

  return (
    <main className="detail-main" style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px 80px" }}>
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
        className="detail-header"
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
          className="detail-cover"
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
            className="detail-title"
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
              <>
                <span
                  className="detail-status-pill"
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
                {isNew && (
                  <span
                    className="detail-status-pill"
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#ca8a04",
                      background: "rgba(202,138,4,0.12)",
                      borderRadius: 999,
                    }}
                  >
                    NEW!
                  </span>
                )}
                {isEndingSoon && (
                  <span
                    className="detail-status-pill"
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#e0483e",
                      background: "rgba(224,72,62,0.1)",
                      borderRadius: 999,
                    }}
                  >
                    종료 임박
                  </span>
                )}
                {daysLeft != null && (
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: isEndingSoon ? "#e0483e" : "#6e6e73",
                      background: isEndingSoon
                        ? "rgba(224,72,62,0.1)"
                        : "rgba(0,0,0,0.06)",
                      borderRadius: 999,
                    }}
                  >
                    {daysLeft === 0 ? "오늘 종료" : `종료 D-${daysLeft}`}
                  </span>
                )}
              </>
            )}
          </div>
          {authorNames.length > 0 && (
            <div
              style={{
                marginTop: 14,
                fontSize: 14,
                color: "#3a3a3c",
                lineHeight: 1.4,
              }}
            >
              <span style={{ color: "#86868b", marginRight: 6 }}>작가</span>
              {authorNames.join(", ")}
            </div>
          )}
          {synopsis && (
            <div
              style={{
                marginTop: 12,
                fontSize: 13,
                lineHeight: 1.7,
                color: "#1d1d1f",
                whiteSpace: "pre-wrap",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#86868b",
                  letterSpacing: "0.3px",
                  marginBottom: 6,
                }}
              >
                시놉시스
              </div>
              {synopsis}
            </div>
          )}
        </div>
      </header>

      <section
        className="stat-grid"
        style={{ marginBottom: 32 }}
      >
        <StatCard
          label="현재 가격"
          value={`${(isOnSale ? book.set_price : book.full_price)?.toLocaleString() ?? "—"}원`}
          accent={isOnSale}
        />
        <StatCard
          label="정가"
          value={`${book.full_price?.toLocaleString() ?? "—"}원`}
          strike={isOnSale}
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
            label={isOnSale ? "할인 기간" : "최근 세일"}
            value={`${format(new Date(latest.start_date), "M.d")} — ${format(new Date(latest.end_date), "M.d")}`}
            span={2}
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
  span,
}: {
  label: string;
  value: string;
  accent?: boolean;
  strike?: boolean;
  span?: number;
}) {
  return (
    <div
      className={span ? "stat-span-2" : undefined}
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
