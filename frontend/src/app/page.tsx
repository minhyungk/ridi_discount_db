import { getPrisma } from "@/lib/prisma";
import { format, formatDistanceToNow, isAfter, differenceInDays } from "date-fns";
import { ko } from "date-fns/locale/ko";
import Link from "next/link";
import CategoryChips from "@/components/CategoryChips";
import type { Prisma } from "@prisma/client";

export const revalidate = 3600;

const BLUE = "#1e9eff";
const PAGE_SIZE = 50;

type Filters = {
  type: "comic" | "novel" | null;
  cats: string[];
};

type Tag = "ending" | "new" | "popular" | null;
type SortKey = "price" | "discount" | "period" | "low";
type SortDir = "asc" | "desc";

const SORT_KEYS: readonly SortKey[] = ["price", "discount", "period", "low"] as const;
const COLUMN_DEFAULT_DIR: Record<SortKey, SortDir> = {
  price: "asc",      // 싼 가격 우선
  discount: "desc",  // 높은 할인율 우선
  period: "asc",     // 종료 임박 우선
  low: "asc",        // 역대 최저 낮은 순
};

type SearchState = {
  q: string;
  filters: Filters;
  tag: Tag;
  sort: SortKey | null;
  dir: SortDir;
};

function buildHref(state: SearchState, overrides: Partial<SearchState> = {}) {
  const next = { ...state, ...overrides };
  if (overrides.filters) next.filters = overrides.filters;
  const sp = new URLSearchParams();
  if (next.q) sp.set("q", next.q);
  if (next.filters.type) sp.set("type", next.filters.type);
  next.filters.cats.forEach((c) => sp.append("cat", c));
  if (next.tag) sp.set("tag", next.tag);
  if (next.sort) {
    sp.set("sort", next.sort);
    sp.set("dir", next.dir);
  }
  const qs = sp.toString();
  return qs ? `/?${qs}` : "/";
}

function buildWhere(filters: Filters): Prisma.BookWhereInput {
  const where: Prisma.BookWhereInput = {};
  if (filters.type === "comic") where.comic = true;
  else if (filters.type === "novel") where.comic = false;
  if (filters.cats.length > 0) {
    where.categories = {
      some: { category: { name: { in: filters.cats } } },
    };
  }
  return where;
}

async function getBooks(query: string, filters: Filters) {
  const prisma = getPrisma();
  const filterWhere = buildWhere(filters);

  if (!query) {
    return prisma.book.findMany({
      where: filterWhere,
      include: {
        histories: { orderBy: { scraped_at: "desc" }, take: 1 },
      },
      orderBy: [
        { list_order: { sort: "asc", nulls: "last" } },
        { discount_pct: "desc" },
      ],
    });
  }

  // 퍼지 검색: pg_trgm으로 제목/카테고리명 모두 매칭, similarity 내림차순
  // (DISTINCT로 중복 제거, ILIKE는 짧은 쿼리(<3자) trgm 약화 대비 fallback)
  const ranked = await prisma.$queryRaw<{ book_id: string; sim: number }[]>`
    SELECT b.book_id,
           GREATEST(
             similarity(b.title, ${query}),
             COALESCE(MAX(similarity(c.name, ${query})), 0)
           )::float AS sim
    FROM books b
    LEFT JOIN book_categories bc ON bc.book_id = b.book_id
    LEFT JOIN categories c ON c.category_id = bc.category_id
    WHERE b.title % ${query}
       OR c.name % ${query}
       OR b.title ILIKE ${"%" + query + "%"}
    GROUP BY b.book_id
    ORDER BY sim DESC, MIN(b.list_order) ASC NULLS LAST
    LIMIT 200
  `;

  if (ranked.length === 0) return [];

  const ids = ranked.map((r) => r.book_id);
  const books = await prisma.book.findMany({
    where: { ...filterWhere, book_id: { in: ids } },
    include: {
      histories: { orderBy: { scraped_at: "desc" }, take: 1 },
    },
  });

  // similarity 순서 보존
  const order = new Map(ids.map((id, i) => [id, i]));
  books.sort((a, b) => (order.get(a.book_id) ?? 1e9) - (order.get(b.book_id) ?? 1e9));
  return books;
}

async function getTopCategories(limit = 10) {
  const prisma = getPrisma();
  // 활성 할인중 책의 카테고리 빈도 상위 N개. 최상위(parent_id=0) 카테고리 제외 — 만화/라노벨 토글이 이미 커버.
  const rows = await prisma.$queryRaw<{ name: string; count: bigint }[]>`
    SELECT c.name, COUNT(*)::bigint AS count
    FROM book_categories bc
    JOIN categories c ON c.category_id = bc.category_id
    JOIN books b ON b.book_id = bc.book_id
    WHERE b.list_order IS NOT NULL
      AND c.parent_id IS NOT NULL
      AND c.parent_id <> 0
    GROUP BY c.name
    ORDER BY count DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
}

type BookWithStatus = {
  book_id: string;
  title: string;
  full_price: number | null;
  set_price: number | null;
  discount_pct: number | null;
  all_time_low: number | null;
  list_order: number | null;
  isOnSale: boolean;
  isEndingSoon: boolean;
  isNew: boolean;
  daysLeft: number | null;
  lastHistory?: { start_date: Date | null; end_date: Date | null };
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    p?: string;
    type?: string;
    cat?: string | string[];
    tag?: string;
    sort?: string;
    dir?: string;
  }>;
}) {
  const { q, p, type, cat, tag, sort, dir } = await searchParams;
  const query = q?.trim() ?? "";
  const pageParam = Math.max(1, parseInt(p ?? "1", 10) || 1);
  const filters: Filters = {
    type: type === "comic" || type === "novel" ? type : null,
    cats: Array.isArray(cat) ? cat : cat ? [cat] : [],
  };
  const activeTag: Tag =
    tag === "ending" || tag === "new" || tag === "popular" ? tag : null;
  const activeSort: SortKey | null =
    sort && (SORT_KEYS as readonly string[]).includes(sort) ? (sort as SortKey) : null;
  const activeDir: SortDir = dir === "asc" || dir === "desc" ? dir : "desc";
  const state: SearchState = { q: query, filters, tag: activeTag, sort: activeSort, dir: activeDir };

  const [books, topCategories] = await Promise.all([
    getBooks(query, filters),
    getTopCategories(10),
  ]);
  const now = new Date();

  const withStatus = books.map((book) => {
    const h = book.histories[0];
    const endDate = h?.end_date ? new Date(h.end_date) : null;
    const startDate = h?.start_date ? new Date(h.start_date) : null;
    const isOnSale = !!(endDate && isAfter(endDate, now));
    const daysLeft = isOnSale && endDate ? Math.max(0, differenceInDays(endDate, now)) : null;
    const isEndingSoon = isOnSale && endDate ? differenceInDays(endDate, now) <= 7 : false;
    const isNew = isOnSale && startDate ? differenceInDays(now, startDate) < 3 : false;
    return { ...book, lastHistory: h, isOnSale, isEndingSoon, isNew, daysLeft };
  });

  let filtered = query ? withStatus : withStatus.filter((b) => b.isOnSale);

  // 태그 필터 (badge 클릭으로 토글)
  if (activeTag === "ending") filtered = filtered.filter((b) => b.isEndingSoon);
  else if (activeTag === "new") filtered = filtered.filter((b) => b.isNew);

  if (activeSort) {
    // 컬럼 정렬이 활성화된 경우 — 버킷 무시하고 컬럼 값으로 정렬
    const valueOf = (x: BookWithStatus): number => {
      switch (activeSort) {
        case "price":
          return x.set_price ?? Number.POSITIVE_INFINITY;
        case "discount":
          return x.discount_pct ?? -1;
        case "period":
          return x.lastHistory?.end_date
            ? new Date(x.lastHistory.end_date).getTime()
            : Number.POSITIVE_INFINITY;
        case "low":
          return x.all_time_low ?? Number.POSITIVE_INFINITY;
      }
    };
    filtered.sort((a, b) => {
      const diff = valueOf(a) - valueOf(b);
      return activeDir === "asc" ? diff : -diff;
    });
  } else if (activeTag === "popular") {
    // 인기순: 리스트 API 순서(list_order) 그대로
    filtered.sort((a, b) => {
      const ao = a.list_order ?? Number.POSITIVE_INFINITY;
      const bo = b.list_order ?? Number.POSITIVE_INFINITY;
      return ao - bo;
    });
  } else {
    // 기본 우선순위 버킷: 종료임박 → NEW → 일반 할인중 → 할인 종료
    // 같은 버킷 내에서는 stable sort로 DB orderBy(list_order asc) 유지
    filtered.sort((a, b) => {
      const bucket = (x: BookWithStatus) =>
        !x.isOnSale ? 3 : x.isEndingSoon ? 0 : x.isNew ? 1 : 2;
      return bucket(a) - bucket(b);
    });
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const heading = query ? `"${query}" 검색 결과` : "세일 중인 도서";

  return (
    <main className="home-main" style={{ maxWidth: 1120, margin: "0 auto", padding: "40px 24px 80px" }}>
      <header className="home-header" style={{ marginBottom: 20 }}>
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

      <CategoryChips topCategories={topCategories} />

      <SortTagPills state={state} />

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
                    {([
                      { label: "제목", align: "left" },
                      { label: "가격", align: "right", sortKey: "price" },
                      { label: "할인", align: "center", sortKey: "discount" },
                      { label: "상태", align: "center" },
                      { label: "기간", align: "center", sortKey: "period" },
                      { label: "역대 최저", align: "right", sortKey: "low" },
                    ] as { label: string; align: "left" | "center" | "right"; sortKey?: SortKey }[]).map((c) => (
                      <SortableHeader
                        key={c.label}
                        label={c.label}
                        align={c.align}
                        sortKey={c.sortKey}
                        state={state}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paged.map((book) => (
                    <BookRow key={book.book_id} book={book} state={state} />
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
            <Pagination page={page} totalPages={totalPages} state={state} />
          )}
        </>
      )}
    </main>
  );
}

/* ── 정렬/필터 pill 행 (인기순 · 종료 임박 · NEW!) ── */
function SortTagPills({ state }: { state: SearchState }) {
  const pills: { tag: Exclude<Tag, null>; label: string; color: string }[] = [
    { tag: "popular", label: "인기순", color: BLUE },
    { tag: "ending", label: "종료 임박", color: "#e0483e" },
    { tag: "new", label: "NEW!", color: "#ca8a04" },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        marginBottom: 16,
      }}
    >
      {pills.map((p) => {
        const active = state.tag === p.tag;
        return (
          <Link
            key={p.tag}
            href={buildHref(state, { tag: active ? null : p.tag })}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "6px 12px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 500,
              textDecoration: "none",
              whiteSpace: "nowrap",
              color: active ? "#fff" : p.color,
              background: active ? p.color : "transparent",
              border: `1px solid ${p.color}`,
              transition: "background 0.12s, color 0.12s",
            }}
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}

/* ── 모바일 카드 컴포넌트 ── */
function BookCard({ book }: { book: BookWithStatus }) {
  const h = book.lastHistory;
  const hasDiscount = !!(book.discount_pct && book.discount_pct > 0 && book.isOnSale);

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

        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          {hasDiscount ? (
            <>
              <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {book.set_price?.toLocaleString()}원
              </span>
              <span style={{ fontSize: 11, color: "#a1a1a6", textDecoration: "line-through" }}>
                {book.full_price?.toLocaleString()}원
              </span>
              <span style={{ padding: "1px 8px", fontSize: 11, fontWeight: 700, color: "#fff", background: BLUE, borderRadius: 999 }}>
                -{book.discount_pct}%
              </span>
            </>
          ) : (
            <span style={{ fontSize: 16, fontWeight: 700 }}>
              {book.full_price?.toLocaleString()}원
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {book.isOnSale && (
            <span style={{ padding: "1px 8px", fontSize: 11, fontWeight: 600, color: BLUE, background: "rgba(30,158,255,0.1)", borderRadius: 999 }}>
              할인 중
            </span>
          )}
          {book.isNew && (
            <span style={{ padding: "1px 8px", fontSize: 11, fontWeight: 600, color: "#ca8a04", background: "rgba(202,138,4,0.12)", borderRadius: 999 }}>
              NEW!
            </span>
          )}
          {book.isEndingSoon && (
            <span style={{ padding: "1px 8px", fontSize: 11, fontWeight: 600, color: "#e0483e", background: "rgba(224,72,62,0.1)", borderRadius: 999 }}>
              종료 임박
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#6e6e73", marginTop: "auto", flexWrap: "wrap" }}>
          {periodStr && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {periodStr}
              {book.isOnSale && book.daysLeft != null && (
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 999,
                    color: book.isEndingSoon ? "#e0483e" : "#6e6e73",
                    background: book.isEndingSoon
                      ? "rgba(224,72,62,0.1)"
                      : "rgba(0,0,0,0.06)",
                  }}
                >
                  {book.daysLeft === 0 ? "오늘 종료" : `종료 D-${book.daysLeft}`}
                </span>
              )}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ── 정렬 가능한 컬럼 헤더 ── */
function SortableHeader({
  label,
  align,
  sortKey,
  state,
}: {
  label: string;
  align: "left" | "center" | "right";
  sortKey?: SortKey;
  state: SearchState;
}) {
  const thStyle: React.CSSProperties = {
    padding: "12px 16px",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: "#86868b",
    textAlign: align,
  };

  if (!sortKey) return <th style={thStyle}>{label}</th>;

  const isActive = state.sort === sortKey;
  // 3-state cycle: 비활성 → 컬럼 기본방향 → 반대방향 → 해제
  const defaultDir = COLUMN_DEFAULT_DIR[sortKey];
  let nextOverrides: Partial<SearchState>;
  if (!isActive) nextOverrides = { sort: sortKey, dir: defaultDir };
  else if (state.dir === defaultDir)
    nextOverrides = { sort: sortKey, dir: defaultDir === "asc" ? "desc" : "asc" };
  else nextOverrides = { sort: null, dir: "desc" };

  const arrow = !isActive ? "↕" : state.dir === "asc" ? "↑" : "↓";
  const justify =
    align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start";

  return (
    <th style={thStyle}>
      <Link
        href={buildHref(state, nextOverrides)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: justify,
          gap: 4,
          color: isActive ? BLUE : "#86868b",
          textDecoration: "none",
        }}
      >
        {label}
        <span style={{ fontSize: 10, color: isActive ? BLUE : "#d2d2d7" }}>
          {arrow}
        </span>
      </Link>
    </th>
  );
}

/* ── PC 테이블 행 ── */
function BookRow({ book, state }: { book: BookWithStatus; state: SearchState }) {
  const h = book.lastHistory;
  const hasDiscount = !!(book.discount_pct && book.discount_pct > 0 && book.isOnSale);
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
          <span>{book.full_price?.toLocaleString()}원</span>
        )}
      </td>

      <td style={{ ...cell, textAlign: "center" }}>
        {hasDiscount ? (
          <span style={{ display: "inline-block", padding: "2px 10px", fontSize: 12, fontWeight: 700, color: "#fff", background: BLUE, borderRadius: 999 }}>
            -{book.discount_pct}%
          </span>
        ) : (
          <span style={{ color: "#a1a1a6", fontSize: 12 }}>없음</span>
        )}
      </td>

      <td style={{ ...cell, textAlign: "center" }}>
        {book.isOnSale ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 10px", fontSize: 12, fontWeight: 600, color: BLUE, background: "rgba(30,158,255,0.1)", borderRadius: 999 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: BLUE, animation: "pulse 2s infinite" }} />
              할인 중
            </span>
            {book.isNew && (
              <Link
                href={buildHref(state, { tag: state.tag === "new" ? null : "new" })}
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#ca8a04",
                  background: "rgba(202,138,4,0.12)",
                  borderRadius: 999,
                  textDecoration: "none",
                  boxShadow: state.tag === "new" ? "inset 0 0 0 1.5px #ca8a04" : undefined,
                }}
              >
                NEW!
              </Link>
            )}
            {book.isEndingSoon && (
              <Link
                href={buildHref(state, { tag: state.tag === "ending" ? null : "ending" })}
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#e0483e",
                  background: "rgba(224,72,62,0.1)",
                  borderRadius: 999,
                  textDecoration: "none",
                  boxShadow: state.tag === "ending" ? "inset 0 0 0 1.5px #e0483e" : undefined,
                }}
              >
                종료 임박
              </Link>
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
        <div>{periodStr}</div>
        {book.isOnSale && book.daysLeft != null && (
          <div style={{ marginTop: 6 }}>
            <span
              style={{
                display: "inline-block",
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 999,
                color: book.isEndingSoon ? "#e0483e" : "#6e6e73",
                background: book.isEndingSoon
                  ? "rgba(224,72,62,0.1)"
                  : "rgba(0,0,0,0.06)",
              }}
            >
              {book.daysLeft === 0 ? "오늘 종료" : `종료 D-${book.daysLeft}`}
            </span>
          </div>
        )}
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

function Pagination({
  page,
  totalPages,
  state,
}: {
  page: number;
  totalPages: number;
  state: SearchState;
}) {
  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.filters.type) params.set("type", state.filters.type);
    state.filters.cats.forEach((c) => params.append("cat", c));
    if (state.tag) params.set("tag", state.tag);
    if (state.sort) {
      params.set("sort", state.sort);
      params.set("dir", state.dir);
    }
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
