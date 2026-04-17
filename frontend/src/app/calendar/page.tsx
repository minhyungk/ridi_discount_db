import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { unstable_cache } from "next/cache";

export const runtime = "edge";
export const revalidate = 3600;

const BLUE = "#1e9eff";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 선두의 [특별 세트], [완결 세트], [기간한정 특별 세트] 등 모든 대괄호 태그 제거
const stripTags = (t: string) => t.replace(/^(\[[^\]]*\]\s*)+/, "").trim();

type BookEnd = {
  book_id: string;
  title: string;
  discount_pct: number | null;
};

// 과거 달은 사실상 영구 캐시, 이번 달은 1시간 TTL로 scraper 반영
const getMonthHistories = unstable_cache(
  async (year: number, month: number) => {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 1);
    return prisma.priceHistory.findMany({
      where: { end_date: { gte: monthStart, lt: monthEnd } },
      include: { book: true },
      orderBy: { end_date: "asc" },
    });
  },
  ["month-histories"],
  { revalidate: 3600, tags: ["books"] }
);

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const { y, m } = await searchParams;
  const now = new Date();
  const year = y ? parseInt(y, 10) : now.getFullYear();
  const month = m ? parseInt(m, 10) : now.getMonth() + 1;

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);

  const histories = await getMonthHistories(year, month);

  const seen = new Set<string>();
  const byDay = new Map<number, BookEnd[]>();
  for (const h of histories) {
    if (!h.end_date) continue;
    const key = `${h.book_id}-${h.end_date.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const day = new Date(h.end_date).getDate();
    const list = byDay.get(day) ?? [];
    list.push({
      book_id: h.book_id,
      title: h.book.title,
      discount_pct: h.book.discount_pct,
    });
    byDay.set(day, list);
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = monthStart.getDay();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const today = now.getFullYear() === year && now.getMonth() + 1 === month ? now.getDate() : null;

  return (
    <main style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header
        style={{
          marginBottom: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: "-0.5px",
              color: "#1d1d1f",
            }}
          >
            세일 종료 캘린더
          </h1>
          <p style={{ marginTop: 6, fontSize: 14, color: "#6e6e73" }}>
            {year}년 {month}월 · 총 {histories.length}건의 세일 종료
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <NavBtn href={`/calendar?y=${prevMonth.y}&m=${prevMonth.m}`}>←</NavBtn>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              minWidth: 120,
              textAlign: "center",
              color: "#1d1d1f",
            }}
          >
            {year}.{String(month).padStart(2, "0")}
          </div>
          <NavBtn href={`/calendar?y=${nextMonth.y}&m=${nextMonth.m}`}>→</NavBtn>
        </div>
      </header>

      <div
        style={{
          border: "1px solid rgba(0,0,0,0.08)",
          borderRadius: 12,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            background: "#f5f5f7",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          {WEEKDAYS.map((d, i) => (
            <div
              key={d}
              style={{
                padding: "10px 12px",
                fontSize: 12,
                fontWeight: 600,
                color: i === 0 ? "#e0483e" : i === 6 ? BLUE : "#6e6e73",
                textAlign: "center",
              }}
            >
              {d}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          }}
        >
          {cells.map((day, idx) => {
            const dow = idx % 7;
            const books = day ? byDay.get(day) ?? [] : [];
            const isToday = day === today;
            return (
              <div
                key={idx}
                style={{
                  minWidth: 0,
                  minHeight: 120,
                  padding: 8,
                  borderRight:
                    dow === 6 ? "none" : "1px solid rgba(0,0,0,0.05)",
                  borderBottom:
                    idx >= cells.length - 7 ? "none" : "1px solid rgba(0,0,0,0.05)",
                  background: day ? "#fff" : "#fafafa",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {day && (
                  <>
                    <div
                      style={{
                        display: "inline-flex",
                        alignSelf: "flex-start",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: 22,
                        height: 22,
                        padding: "0 6px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        color: isToday
                          ? "#fff"
                          : dow === 0
                          ? "#e0483e"
                          : dow === 6
                          ? BLUE
                          : "#1d1d1f",
                        background: isToday ? BLUE : "transparent",
                        marginBottom: 6,
                      }}
                    >
                      {day}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 3,
                        minWidth: 0,
                      }}
                    >
                      {books.slice(0, 4).map((b) => (
                        <BookPill key={b.book_id} book={b} />
                      ))}
                      {books.length > 4 && (
                        <details style={{ minWidth: 0 }}>
                          <summary
                            style={{
                              padding: "3px 6px",
                              fontSize: 11,
                              color: "#6e6e73",
                              cursor: "pointer",
                              listStyle: "none",
                              fontWeight: 500,
                            }}
                          >
                            +{books.length - 4}건 더 보기
                          </summary>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                              marginTop: 3,
                              minWidth: 0,
                            }}
                          >
                            {books.slice(4).map((b) => (
                              <BookPill key={b.book_id} book={b} />
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function BookPill({
  book,
}: {
  book: { book_id: string; title: string; discount_pct: number | null };
}) {
  return (
    <Link
      href={`/books/${book.book_id}`}
      title={`${book.title} 세일 종료`}
      style={{
        display: "block",
        maxWidth: "100%",
        padding: "3px 6px",
        fontSize: 11,
        background: "rgba(30,158,255,0.1)",
        color: BLUE,
        borderRadius: 4,
        fontWeight: 500,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
      }}
    >
      {book.discount_pct ? `-${book.discount_pct}% ` : ""}
      {stripTags(book.title)}
    </Link>
  );
}

function NavBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        width: 36,
        height: 36,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        background: "rgba(30,158,255,0.08)",
        color: BLUE,
        fontWeight: 700,
        fontSize: 16,
      }}
    >
      {children}
    </Link>
  );
}
