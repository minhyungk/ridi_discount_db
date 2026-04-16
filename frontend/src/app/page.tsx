import { prisma } from "@/lib/prisma";
import { format, formatDistanceToNow, isAfter } from "date-fns";
import { ko } from "date-fns/locale/ko";
import Link from "next/link";

export const dynamic = "force-dynamic";

const BLUE = "#1e9eff";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const books = await prisma.book.findMany({
    where: query
      ? { title: { contains: query, mode: "insensitive" } }
      : undefined,
    include: {
      histories: { orderBy: { scraped_at: "desc" }, take: 1 },
    },
    orderBy: { updated_at: "desc" },
  });

  const now = new Date();

  const withStatus = books.map((book) => {
    const h = book.histories[0];
    const isOnSale = !!(h?.end_date && isAfter(new Date(h.end_date), now));
    return { ...book, lastHistory: h, isOnSale };
  });

  const filtered = query ? withStatus : withStatus.filter((b) => b.isOnSale);

  filtered.sort((a, b) => {
    if (a.isOnSale !== b.isOnSale) return a.isOnSale ? -1 : 1;
    return (b.discount_pct || 0) - (a.discount_pct || 0);
  });

  const heading = query ? `"${query}" 검색 결과` : "세일 중인 도서";

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: "-0.5px",
            color: "#1d1d1f",
          }}
        >
          {heading}
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: "#6e6e73" }}>
          총 {filtered.length.toLocaleString()}권
        </p>
      </header>

      {filtered.length === 0 ? (
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
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 12,
            overflow: "hidden",
            overflowX: "auto",
          }}
        >
          <table
            style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}
          >
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
              {filtered.map((book) => (
                <BookRow key={book.book_id} book={book} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function BookRow({
  book,
}: {
  book: {
    book_id: string;
    title: string;
    full_price: number | null;
    set_price: number | null;
    discount_pct: number | null;
    all_time_low: number | null;
    isOnSale: boolean;
    lastHistory?: { start_date: Date | null; end_date: Date | null };
  };
}) {
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
      <td style={{ ...cell, maxWidth: 360 }}>
        <Link
          href={`/books/${book.book_id}`}
          style={{ color: BLUE, fontWeight: 500 }}
        >
          {book.title}
        </Link>
      </td>

      <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
        {hasDiscount ? (
          <>
            <span style={{ fontSize: 11, color: "#a1a1a6", textDecoration: "line-through" }}>
              {book.full_price?.toLocaleString()}원
            </span>
            <br />
            <span style={{ fontWeight: 600 }}>
              {book.set_price?.toLocaleString()}원
            </span>
          </>
        ) : (
          <span>{book.set_price?.toLocaleString()}원</span>
        )}
      </td>

      <td style={{ ...cell, textAlign: "center" }}>
        {hasDiscount ? (
          <span
            style={{
              display: "inline-block",
              padding: "2px 10px",
              fontSize: 12,
              fontWeight: 700,
              color: "#fff",
              background: BLUE,
              borderRadius: 999,
            }}
          >
            -{book.discount_pct}%
          </span>
        ) : (
          <span style={{ color: "#d2d2d7" }}>—</span>
        )}
      </td>

      <td style={{ ...cell, textAlign: "center" }}>
        {book.isOnSale ? (
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
        ) : h?.end_date ? (
          <span style={{ fontSize: 12, color: "#6e6e73" }}>
            {formatDistanceToNow(new Date(h.end_date), { addSuffix: true, locale: ko })}
          </span>
        ) : (
          <span style={{ color: "#d2d2d7" }}>—</span>
        )}
      </td>

      <td
        style={{
          ...cell,
          textAlign: "center",
          whiteSpace: "nowrap",
          color: "#6e6e73",
          fontSize: 12,
        }}
      >
        {periodStr}
      </td>

      <td
        style={{
          ...cell,
          textAlign: "right",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
          color: isAtLow ? BLUE : "#6e6e73",
          fontWeight: isAtLow ? 700 : 400,
        }}
      >
        {book.all_time_low?.toLocaleString()}원
        {isAtLow && (
          <span style={{ marginLeft: 4, fontSize: 10, color: BLUE, fontWeight: 700 }}>
            최저가
          </span>
        )}
      </td>
    </tr>
  );
}
