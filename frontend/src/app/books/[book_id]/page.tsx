import { getDb } from "@/lib/db";
import { books } from "@/db/schema";
import { eq } from "drizzle-orm";
import { format, isAfter, differenceInDays } from "date-fns";
import { notFound } from "next/navigation";
import Link from "next/link";
import PriceChart, { PricePoint } from "@/components/PriceChart";

export const dynamic = "force-dynamic";

const BLUE = "#1e9eff";

async function getBookDetail(book_id: string) {
  const db = getDb();
  const book = await db.query.books.findFirst({
    where: eq(books.book_id, book_id),
    with: {
      histories: {
        orderBy: (h, { asc }) => [asc(h.scraped_at)],
      },
      authors: {
        with: { author: true },
      },
    },
  });
  if (!book) return null;

  // 권수 갱신으로 book_id가 바뀐 같은 시리즈의 예전/다른 세트 히스토리까지 병합
  let seriesBooks: SeriesBookLike[] = [book];
  if (book.series_id != null) {
    const siblings = await db.query.books.findMany({
      where: eq(books.series_id, book.series_id),
      with: {
        histories: {
          orderBy: (h, { asc }) => [asc(h.scraped_at)],
        },
      },
    });
    if (siblings.length > 0) seriesBooks = siblings;
  }

  return { book, seriesBooks };
}

type SeriesBookLike = {
  book_id: string;
  full_price: number | null;
  set_type: string | null;
  set_total: number | null;
  histories: {
    set_price: number | null;
    start_date: Date | string | null;
    end_date: Date | string | null;
    scraped_at: Date | string;
    full_price: number | null;
  }[];
};

type SaleEntry = {
  start: number;
  scraped: number;
  end: number | null;
  price: number;
  fullPrice: number | null;
  note: string | null;
};

const DAY_MS = 86_400_000;

/**
 * 세일 이벤트들(start~end 구간 할인가)로부터 정가↔할인가 계단 타임라인 합성.
 * stepAfter 렌더링 전제: 각 점의 가격이 다음 점까지 유지된다.
 */
function buildChartData(raw: SaleEntry[], nowTs: number): PricePoint[] {
  const entries = [...raw].sort(
    (a, b) => a.start - b.start || a.scraped - b.scraped
  );
  const pts: PricePoint[] = [];

  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    const next = entries[i + 1];
    // 같은 세일 내 가격 변동(동일 start의 후속 row)은 발견 시점에 반영
    const startTs =
      prev && prev.start === e.start ? Math.max(e.scraped, e.start) : e.start;

    // 첫 세일 전: 정가 구간을 짧게 보여줘서 "하락" 계단이 보이게
    if (!prev && e.fullPrice != null) {
      pts.push({ ts: startTs - 7 * DAY_MS, price: e.fullPrice, note: null });
    }

    pts.push({ ts: startTs, price: e.price, note: e.note });

    let endTs = e.end;
    if (endTs != null && endTs < startTs) endTs = null;
    if (next && endTs != null && endTs > next.start) endTs = next.start;

    // 세일 종료 후 정가 복귀 (다음 세일 시작 전까지의 구간)
    const boundary = next ? next.start : nowTs;
    if (
      endTs != null &&
      endTs <= nowTs &&
      endTs < boundary &&
      e.fullPrice != null
    ) {
      pts.push({ ts: endTs, price: e.fullPrice, note: null });
    }

    // 마지막 이벤트: 오늘까지 수평 연장
    if (!next) {
      const onSaleNow = endTs == null || endTs > nowTs;
      if (onSaleNow) {
        if (startTs < nowTs) pts.push({ ts: nowTs, price: e.price, note: e.note });
      } else if (e.fullPrice != null && endTs < nowTs) {
        pts.push({ ts: nowTs, price: e.fullPrice, note: null });
      }
    }
  });

  return pts;
}

export default async function BookDetail({
  params,
}: {
  params: Promise<{ book_id: string }>;
}) {
  const { book_id } = await params;

  const detail = await getBookDetail(book_id);

  if (!detail) notFound();
  const { book, seriesBooks } = detail;

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

  // 시리즈 내 모든 세트의 세일 이벤트를 하나의 타임라인으로
  const saleEntries: SaleEntry[] = seriesBooks.flatMap((b) => {
    const note =
      [b.set_type, b.set_total ? `총 ${b.set_total}권` : null]
        .filter(Boolean)
        .join(" · ") || null;
    return b.histories
      .filter((h) => h.set_price != null)
      .map((h) => {
        const scraped = new Date(h.scraped_at).getTime();
        return {
          start: h.start_date ? new Date(h.start_date).getTime() : scraped,
          scraped,
          end: h.end_date ? new Date(h.end_date).getTime() : null,
          price: h.set_price as number,
          // 세일 당시 정가가 기록돼 있으면 그걸, 없으면(과거 데이터) 해당 세트의 현재 정가
          fullPrice: h.full_price ?? b.full_price ?? null,
          note,
        };
      });
  });

  const chartData: PricePoint[] = buildChartData(saleEntries, now.getTime());

  // 역대 최저가: 시리즈 전체 히스토리 기준 (이전 세트 시절 포함)
  const salePrices = saleEntries.map((e) => e.price);
  if (book.all_time_low != null) salePrices.push(book.all_time_low);
  const allTimeLow = salePrices.length > 0 ? Math.min(...salePrices) : null;

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
            {book.set_type && (
              <span
                className="detail-status-pill"
                style={{
                  display: "inline-block",
                  padding: "2px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#6e6e73",
                  background: "rgba(0,0,0,0.06)",
                  borderRadius: 999,
                }}
              >
                {book.set_type}
              </span>
            )}
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
          value={`${allTimeLow?.toLocaleString() ?? "—"}원`}
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
            marginBottom: seriesBooks.length > 1 ? 4 : 12,
            padding: "0 8px",
          }}
        >
          가격 히스토리
        </h2>
        {seriesBooks.length > 1 && (
          <p
            style={{
              fontSize: 12,
              color: "#6e6e73",
              margin: "0 0 12px",
              padding: "0 8px",
            }}
          >
            같은 시리즈의 이전 세트 기록 포함 ({seriesBooks.length}개 세트)
          </p>
        )}
        <PriceChart
          data={chartData}
          fullPrice={book.full_price}
          allTimeLow={allTimeLow}
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
