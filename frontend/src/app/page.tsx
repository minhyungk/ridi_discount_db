import { prisma } from "@/lib/prisma";
import { format, formatDistanceToNow, isAfter, differenceInDays } from "date-fns";
import { ko } from "date-fns/locale/ko";
import Link from "next/link";
import { unstable_cache } from "next/cache";

export const revalidate = 3600;

const BLUE = "#1e9eff";
const PAGE_SIZE = 50;

const getBooks = unstable_cache(
  async (query: string) =>
    prisma.book.findMany({
      where: query
        ? { title: { contains: query, mode: "insensitive" } }
        : undefined,
      include: {
        histories: { orderBy: { scraped_at: "desc" }, take: 1 },
      },
      orderBy: [
        { list_order: { sort: "asc", nulls: "last" } },
        { discount_pct: "desc" },
      ],
    }),
  ["books-by-query"],
  { revalidate: 3600, tags: ["books"] }
);

type BookWithStatus = {
  book_id: string;
  title: string;
  full_price: number | null;
  set_price: number | null;
  discount_pct: number | null;
  all_time_low: number | null;
  isOnSale: boolean;
  isEndingSoon: boolean;
  lastHistory?: { start_date: Date | null; end_date: Date | null };
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const { q, p } = await searchParams;
  const query = q?.trim() ?? "";
  const pageParam = Math.max(1, parseInt(p ?? "1", 10) || 1);

  const books = await getBooks(query);
  const now = new Date();

  const withStatus = books.map((book) => {
    const h = book.histories[0];
    const endDate = h?.end_date ? new Date(h.end_date) : null;
    const isOnSale = !!(endDate && isAfter(endDate, now));
    const isEndingSoon = isOnSale && endDate ? differenceInDays(endDate, now) <= 7 : false;
    return { ...book, lastHistory: h, isOnSale, isEndingSoon };
  });

  const filtered = query ? withStatus : withStatus.filter((b) => b.isOnSale);

  filtered.sort((a, b) => {
    if (a.isOnSale !== b.isOnSale) return a.isOnSale ? -1 : 1;
    return 0;
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const heading = query ? `"${query}" 검색 결과` : "세일 중인 도서";

  return (
    <main className="home-main" style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header className="home-header" style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.5px", color: "#1d1d1f" }}>
          {heading}
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: "#6e6e73" }}>
          총 {total.toLocaleString()}권
          {totalPages > 1 && (
            <span style={{ marginLeft: 8, color: "#a1a1a6" }}>
              · {page} / {totalPages} 페이지
            </span>
          )}
        </p>
      </header>

      {total === 0 ? (
        <div
          style={{
            padding: "64px 24px",
            textAlign: "center",
            color: "#6e6e73",
            fontSize: 14,
            background: "#f5f5f7",
            borderRadius: 12,
          }}
        >
          {query ? "검색 결과가 없습니다." : "현재 세일 중인 도서가 없습니다."}
        </div>
      ) : (
        <>
          {/* ── PC: 테이블 뷰 ── */}
          <div className="book-table">
            <div
              style={{
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 12,
                overflow: "hidden",
                overflowX: "auto",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead style={{ background: "#f5f5f7" }}>
                  <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                    {[
                      { label: "제목", align: "left" as const },
                      { label: "가격", align: "right" as const },
                      { label: "할인", align: "center" as const },
                      { label: "상태", align: "center" as const },
                      { label: "기간", align: "center" as const },
                      { label: "역대 최저", align: "right" as const },
                    ].map((c) => (
                      <th
                        key={c.label}
                        style={{
                          padding: "12px 16px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#6e6e73",
                          textAlign: c.align,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((book) => (
                    <BookRow key={book.book_id} book={book} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── 모바일: 카드 뷰 ── */}
          <div className="book-cards">
            {paged.map((book) => (
              <BookCard key={book.book_id} book={book} />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} query={query} />
          )}
        </>
      )}
    </main>
  );
}

/* ── 모바일 카드 컴포넌트 ── */
function BookCard({ book }: { book: BookWithStatus }) {
  const h = book.lastHistory;
  const hasDiscount = !!(book.discount_pct && book.discount_pct > 0);
  const isAtLow = book.set_price === book.all_time_low && book.isOnSale;

  const periodStr =
    h?.start_date && h?.end_date
      ? `${format(new Date(h.start_date), "M.d")} — ${format(new Date(h.end_date), "M.d")}`
      : null;

  return (
    <Link
      href={`/books/${book.book_id}`}
      style={{
        display: "flex",
        gap: 14,
        padding: 14,
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 12,
        background: "#fff",
        textDecoration: "none",
        color: "#1d1d1f",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://img.ridicdn.net/cover/${book.book_id}/large?dpi=xxhdpi`}
        alt=""
        width={80}
        height={114}
        loading="lazy"
        style={{
          width: 80,
          height: 114,
          flexShrink: 0,
          borderRadius: 4,
          background: "#f5f5f7",
          boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
          objectFit: "cover",
        }}
      />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: BLUE, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {book.title}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          {hasDiscount ? (
            <>
              <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {book.set_price?.toLocaleString()}원
              </span>
              <span style={{ fontSize: 11, color: "#a1a1a6", textDecoration: "line-through" }}>
                {book.full_price?.toLocaleString()}원
              </span>
            </>
          ) : (
            <span style={{ fontSize: 16, fontWeight: 700 }}>
              {book.set_price?.toLocaleString()}원
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {hasDiscount && (
            <span style={{ padding: "1px 8px", fontSize: 11, fontWeight: 700, color: "#fff", background: BLUE, borderRadius: 999 }}>
              -{book.discount_pct}%
            </span>
          )}
          {book.isOnSale && (
            <span style={{ padding: "1px 8px", fontSize: 11, fontWeight: 600, color: BLUE, background: "rgba(30,158,255,0.1)", borderRadius: 999 }}>
              할인 중
            </span>
          )}
          {book.isEndingSoon && (
            <span style={{ padding: "1px 8px", fontSize: 11, fontWeight: 600, color: "#e0483e", background: "rgba(224,72,62,0.1)", borderRadius: 999 }}>
              종료 임박
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#6e6e73", marginTop: "auto" }}>
          {periodStr && <span>{periodStr}</span>}
          <span style={{ color: isAtLow ? BLUE : "#6e6e73", fontWeight: isAtLow ? 700 : 400 }}>
            최저 {book.all_time_low?.toLocaleString()}원
            {isAtLow && <span style={{ marginLeft: 2, color: BLUE, fontSize: 9, fontWeight: 700 }}>최저가</span>}
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ── PC 테이블 행 ── */
function BookRow({ book }: { book: BookWithStatus }) {
  const h = book.lastHistory;
  const hasDiscount = !!(book.discount_pct && book.discount_pct > 0);
  const isAtLow = book.set_price === book.all_time_low && book.isOnSale;

  const periodStr =
    h?.start_date && h?.end_date
      ? `${format(new Date(h.start_date), "M.d")} — ${format(new Date(h.end_date), "M.d")}`
      : "—";

  const cell: React.CSSProperties = {
    padding: "14px 16px",
    fontSize: 13,
    borderBottom: "1px solid rgba(0,0,0,0.05)",
    color: "#1d1d1f",
  };

  return (
    <tr>
      <td style={{ ...cell, maxWidth: 360, verticalAlign: "top" }}>
        <Link
          href={`/books/${book.book_id}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            color: BLUE,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://img.ridicdn.net/cover/${book.book_id}/large?dpi=xxhdpi`}
            alt=""
            width={110}
            height={157}
            loading="lazy"
            style={{
              width: 110,
              height: 157,
              borderRadius: 4,
              background: "#f5f5f7",
              boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
              objectFit: "cover",
            }}
          />
          <span style={{ lineHeight: 1.4 }}>{book.title}</span>
        </Link>
      </td>

      <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {hasDiscount ? (
          <>
            <span style={{ fontSize: 11, color: "#a1a1a6", textDecoration: "line-through" }}>
              {book.full_price?.toLocaleString()}원
            </span>
            <br />
            <span style={{ fontWeight: 600 }}>{book.set_price?.toLocaleString()}원</span>
          </>
        ) : (
          <span>{book.set_price?.toLocaleString()}원</span>
        )}
      </td>

      <td style={{ ...cell, textAlign: "center" }}>
        {hasDiscount ? (
          <span style={{ display: "inline-block", padding: "2px 10px", fontSize: 12, fontWeight: 700, color: "#fff", background: BLUE, borderRadius: 999 }}>
            -{book.discount_pct}%
          </span>
        ) : (
          <span style={{ color: "#d2d2d7" }}>—</span>
        )}
      </td>

      <td style={{ ...cell, textAlign: "center" }}>
        {book.isOnSale ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 10px", fontSize: 12, fontWeight: 600, color: BLUE, background: "rgba(30,158,255,0.1)", borderRadius: 999 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: BLUE, animation: "pulse 2s infinite" }} />
              할인 중
            </span>
            {book.isEndingSoon && (
              <span style={{ display: "inline-block", padding: "2px 8px", fontSize: 11, fontWeight: 600, color: "#e0483e", background: "rgba(224,72,62,0.1)", borderRadius: 999 }}>
                종료 임박
              </span>
            )}
          </div>
        ) : h?.end_date ? (
          <span style={{ fontSize: 12, color: "#6e6e73" }}>
            {formatDistanceToNow(new Date(h.end_date), { addSuffix: true, locale: ko })}
          </span>
        ) : (
          <span style={{ color: "#d2d2d7" }}>—</span>
        )}
      </td>

      <td style={{ ...cell, textAlign: "center", whiteSpace: "nowrap", color: "#6e6e73", fontSize: 12 }}>
        {periodStr}
      </td>

      <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: isAtLow ? BLUE : "#6e6e73", fontWeight: isAtLow ? 700 : 400 }}>
        {book.all_time_low?.toLocaleString()}원
        {isAtLow && (
          <span style={{ marginLeft: 4, fontSize: 10, color: BLUE, fontWeight: 700 }}>최저가</span>
        )}
      </td>
    </tr>
  );
}

function Pagination({ page, totalPages, query }: { page: number; totalPages: number; query: string }) {
  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (p > 1) params.set("p", String(p));
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  const windowSize = 7;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages: number[] = [];
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <nav style={{ display: "flex", gap: 4, justifyContent: "center", alignItems: "center", marginTop: 24, flexWrap: "wrap" }}>
      <PageLink href={hrefFor(Math.max(1, page - 1))} disabled={page === 1}>←</PageLink>
      {start > 1 && (
        <>
          <PageLink href={hrefFor(1)}>1</PageLink>
          {start > 2 && <Ellipsis />}
        </>
      )}
      {pages.map((p) => (
        <PageLink key={p} href={hrefFor(p)} active={p === page}>{p}</PageLink>
      ))}
      {end < totalPages && (
        <>
          {end < totalPages - 1 && <Ellipsis />}
          <PageLink href={hrefFor(totalPages)}>{totalPages}</PageLink>
        </>
      )}
      <PageLink href={hrefFor(Math.min(totalPages, page + 1))} disabled={page === totalPages}>→</PageLink>
    </nav>
  );
}

function PageLink({ href, children, active, disabled }: { href: string; children: React.ReactNode; active?: boolean; disabled?: boolean }) {
  const style: React.CSSProperties = {
    minWidth: 36, height: 36, padding: "0 10px",
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    borderRadius: 8, fontSize: 13,
    fontWeight: active ? 700 : 500,
    color: active ? "#fff" : disabled ? "#d2d2d7" : BLUE,
    background: active ? BLUE : "transparent",
    border: active ? "none" : "1px solid rgba(0,0,0,0.08)",
    pointerEvents: disabled ? "none" : undefined,
    fontVariantNumeric: "tabular-nums",
  };
  if (disabled || active) return <span style={style}>{children}</span>;
  return <Link href={href} style={style}>{children}</Link>;
}

function Ellipsis() {
  return <span style={{ minWidth: 24, textAlign: "center", color: "#a1a1a6", fontSize: 13 }}>…</span>;
}
