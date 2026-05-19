from curl_cffi import requests as http
import re
import json
import time
import sys
import psycopg2
from datetime import datetime
import os
import traceback
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

load_dotenv()

def _date_key(d):
    """date/datetime/str/None → 'YYYY-MM-DD' or None. DB와 API 사이 타입 차이 흡수."""
    if d is None:
        return None
    if hasattr(d, 'strftime'):
        return d.strftime("%Y-%m-%d")
    return str(d)[:10]

db_config = {
    'dbname': os.getenv('DB_NAME'),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD'),
    'host': os.getenv('DB_HOST'),
    'port': os.getenv('DB_PORT'),
    'sslmode': os.getenv('DB_SSLMODE', 'disable'),  # Neon: require, local docker: disable
}

class RidiScraper:
    PAGE_SIZE = 200  # Ridibooks API 최대
    DETAIL_SLEEP = 2.5  # 상세 페이지 요청 간격 (CF 레이트리밋 회피)

    def __init__(self, db_config):
        self.list_api_base = "https://api.ridibooks.com/v2/selections/?section_id=748"
        self.detail_base_url = "https://ridibooks.com/books/"
        self.db_config = db_config
        # curl_cffi 세션 — Chrome TLS 지문 + 쿠키 유지 (__cf_bm 재사용)
        self.session = http.Session(impersonate="chrome")

    def get_db_connection(self):
        return psycopg2.connect(**self.db_config)

    def init_db(self, cur):
        """테이블 구조를 Next.js/Prisma와 동일하게 맞춤"""
        cur.execute("""
            CREATE TABLE IF NOT EXISTS books (
                book_id VARCHAR(20) PRIMARY KEY,
                title TEXT NOT NULL,
                full_price INTEGER,
                set_price INTEGER,
                discount_pct INTEGER,
                all_time_low INTEGER,
                list_order INTEGER,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # 기존 테이블용 마이그레이션 (신규 컬럼 추가)
        cur.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS list_order INTEGER")
        cur.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS comic BOOLEAN")
        cur.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS publisher TEXT")
        cur.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS publication_date DATE")
        cur.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS set_total INTEGER")
        cur.execute("ALTER TABLE books ADD COLUMN IF NOT EXISTS introduction TEXT")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS price_history (
                id SERIAL PRIMARY KEY,
                book_id VARCHAR(20) REFERENCES books(book_id),
                set_price INTEGER,
                start_date TIMESTAMP,
                end_date TIMESTAMP,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                category_id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                genre TEXT,
                parent_id INTEGER
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS book_categories (
                book_id VARCHAR(20) REFERENCES books(book_id) ON DELETE CASCADE,
                category_id INTEGER REFERENCES categories(category_id),
                PRIMARY KEY (book_id, category_id)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS authors (
                author_id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS book_authors (
                book_id VARCHAR(20) REFERENCES books(book_id) ON DELETE CASCADE,
                author_id INTEGER REFERENCES authors(author_id),
                role TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (book_id, author_id, role)
            )
        """)
        # pg_trgm: 제목/카테고리명 퍼지 검색용
        cur.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        cur.execute("CREATE INDEX IF NOT EXISTS books_title_trgm ON books USING GIN (title gin_trgm_ops)")
        cur.execute("CREATE INDEX IF NOT EXISTS categories_name_trgm ON categories USING GIN (name gin_trgm_ops)")

    def fetch_detail_html(self, book_id, max_retries=3):
        """상세 페이지 HTML을 curl_cffi(chrome 지문) + 지수 백오프 재시도로 가져옴."""
        url = f"{self.detail_base_url}{book_id}"
        for attempt in range(max_retries):
            try:
                r = self.session.get(url, timeout=20)
                if r.status_code == 200:
                    return r.text
                if r.status_code in (403, 429, 500, 502, 503, 504):
                    wait = 2 ** attempt * 10  # 10s, 20s, 40s
                    print(f"  [WARN] {book_id} HTTP {r.status_code}, retry in {wait}s")
                    time.sleep(wait)
                    continue
                print(f"  [SKIP] {book_id} HTTP {r.status_code}")
                return None
            except Exception as e:
                print(f"  [WARN] {book_id} request failed: {e}")
                time.sleep(2 ** attempt * 5)
        print(f"  [FAIL] {book_id} exhausted retries")
        return None

    def extract_detail(self, book_id):
        html = self.fetch_detail_html(book_id)
        if html is None:
            return None
        try:
            m_detail = re.search(r'var bookDetail = (\{.*?\});', html, re.DOTALL)
            if not m_detail:
                print(f"  [SKIP] {book_id} bookDetail JSON not found")
                return None

            b_detail = json.loads(m_detail.group(1))
            p_info = b_detail.get('price_info', {}) or {}

            def parse_date(d):
                return d.get('date') if isinstance(d, dict) else d

            set_price = int(p_info.get('current_price') or 0)
            if set_price <= 0:
                print(f"  [SKIP] {book_id} set_price=0 (not for sale / unavailable)")
                return None

            m_rate = re.search(
                r'"priceType":"전자책 세트 정가"[^}]*?"discountRate":(\d+)', html
            )
            discount_pct = int(m_rate.group(1)) if m_rate else int(
                p_info.get('ebook_discount_percentage') or 0
            )

            full_price = (
                round(set_price / (1 - discount_pct / 100))
                if discount_pct > 0
                else set_price
            )

            return {
                "start_date": parse_date(p_info.get('discount_start_date')),
                "end_date": parse_date(p_info.get('discount_end_date')),
                "full_price": full_price,
                "set_price": set_price,
                "discount_pct": discount_pct,
            }
        except Exception as e:
            print(f"  [ERR] Detail parse failed for {book_id}: {e}")
            traceback.print_exc()
            return None

    def extract_metadata(self, book_data):
        """리스트 API의 book dict에서 메타데이터 추출 (상세 페이지 불필요)."""
        authors = []
        for a in (book_data.get('authors') or []):
            if isinstance(a, dict) and a.get('name'):
                authors.append({'name': a['name'], 'role': a.get('role') or ''})
            elif isinstance(a, str) and a:
                authors.append({'name': a, 'role': ''})

        categories = []
        for c in (book_data.get('categories') or []):
            if isinstance(c, dict) and c.get('category_id') and c.get('name'):
                categories.append({
                    'category_id': int(c['category_id']),
                    'name': c['name'],
                    'genre': c.get('genre'),
                    'parent_id': c.get('parent_id'),
                })

        pub = book_data.get('publisher')
        publisher = pub.get('name') if isinstance(pub, dict) else (pub if isinstance(pub, str) else None)

        set_obj = book_data.get('set')
        set_total = set_obj.get('total') if isinstance(set_obj, dict) else None

        # comic은 file.comic 위치에 있음
        file_obj = book_data.get('file') or {}
        comic = file_obj.get('comic')
        if not isinstance(comic, bool):
            comic = None

        publication_date = book_data.get('publication_date')  # ISO 문자열 (e.g., "2022-10-28T00:00:00+09:00")

        intro_obj = book_data.get('introduction')
        introduction = intro_obj.get('description') if isinstance(intro_obj, dict) else None
        if isinstance(introduction, str):
            introduction = introduction.strip() or None
        else:
            introduction = None

        return {
            "authors": authors,
            "categories": categories,
            "publisher": publisher,
            "set_total": set_total,
            "comic": comic,
            "publication_date": publication_date,
            "introduction": introduction,
        }

    def _upsert(self, cur, book_id, title, details, list_order):
        set_price = int(details.get('set_price', 0))
        discount_pct = int(details.get('discount_pct', 0))

        # Upsert into books (메타데이터 컬럼 포함)
        cur.execute("""
            INSERT INTO books (
                book_id, title, full_price, set_price, all_time_low, discount_pct, list_order,
                comic, publisher, publication_date, set_total, introduction
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (book_id) DO UPDATE SET
                title = EXCLUDED.title,
                full_price = EXCLUDED.full_price,
                set_price = EXCLUDED.set_price,
                discount_pct = EXCLUDED.discount_pct,
                list_order = EXCLUDED.list_order,
                comic = EXCLUDED.comic,
                publisher = EXCLUDED.publisher,
                publication_date = EXCLUDED.publication_date,
                set_total = EXCLUDED.set_total,
                introduction = COALESCE(EXCLUDED.introduction, books.introduction),
                all_time_low = CASE
                    WHEN books.all_time_low IS NULL OR books.all_time_low = 0 THEN EXCLUDED.set_price
                    ELSE LEAST(books.all_time_low, EXCLUDED.set_price)
                END,
                updated_at = CURRENT_TIMESTAMP;
        """, (
            book_id, title,
            details.get('full_price', 0),
            set_price, set_price,
            details.get('discount_pct', 0),
            list_order,
            details.get('comic'),
            details.get('publisher'),
            details.get('publication_date'),
            details.get('set_total'),
            details.get('introduction'),
        ))

        # categories: 신규/변경 시 upsert
        for cat in (details.get('categories') or []):
            cur.execute("""
                INSERT INTO categories (category_id, name, genre, parent_id)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (category_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    genre = EXCLUDED.genre,
                    parent_id = EXCLUDED.parent_id
            """, (cat['category_id'], cat['name'], cat.get('genre'), cat.get('parent_id')))

        # book_categories: 책 단위로 전체 삭제 후 재삽입 (delete-then-insert)
        cur.execute("DELETE FROM book_categories WHERE book_id = %s", (book_id,))
        cat_rows = list({(book_id, c['category_id']) for c in (details.get('categories') or [])})
        if cat_rows:
            cur.executemany(
                "INSERT INTO book_categories (book_id, category_id) VALUES (%s, %s)",
                cat_rows
            )

        # authors: 이름 기준 upsert + book_authors 재삽입
        cur.execute("DELETE FROM book_authors WHERE book_id = %s", (book_id,))
        seen = set()
        for author in (details.get('authors') or []):
            name = author['name']
            role = author.get('role') or ''
            if (name, role) in seen:
                continue
            seen.add((name, role))
            cur.execute("""
                INSERT INTO authors (name) VALUES (%s)
                ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
                RETURNING author_id
            """, (name,))
            author_id = cur.fetchone()[0]
            cur.execute("""
                INSERT INTO book_authors (book_id, author_id, role)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (book_id, author_id, role))

        # 가격 or 세일 시작일이 바뀌었을 때만 새 row 삽입.
        # 같은 가격이라도 start_date가 다르면 재세일 이벤트이므로 별개 row로 보존.
        cur.execute("""
            SELECT set_price, start_date FROM price_history
            WHERE book_id = %s
            ORDER BY scraped_at DESC LIMIT 1
        """, (book_id,))
        last = cur.fetchone()

        new_start = details.get('start_date')
        new_end = details.get('end_date')
        changed = (
            not last
            or last[0] != set_price
            or _date_key(last[1]) != _date_key(new_start)
        )

        if changed:
            cur.execute("""
                INSERT INTO price_history (book_id, set_price, start_date, end_date)
                VALUES (%s, %s, %s, %s)
            """, (book_id, set_price, new_start, new_end))
            status = "NEW"
        else:
            status = "same"

        display_title = (title[:25] + '..') if len(title) > 25 else title
        print(f"  {display_title:<30} | {set_price:>7,d}원 | -{discount_pct:>2d}% | {status}")

    def fetch_all_items(self):
        """offset 페이지네이션으로 전체 세일 세트북 리스트 수집.
        List API도 Cloudflare 보호 안으로 들어와서 curl_cffi(Chrome 지문) 세션 사용."""
        items = []
        offset = 0
        while True:
            url = f"{self.list_api_base}&limit={self.PAGE_SIZE}&offset={offset}"
            r = self.session.get(url, timeout=20)
            if r.status_code != 200:
                print(f"  [list] offset={offset} HTTP {r.status_code}, aborting")
                break
            try:
                batch = r.json().get('data', {}).get('items', [])
            except Exception:
                snippet = (r.text or '')[:200].replace('\n', ' ')
                print(f"  [list] offset={offset} non-JSON response: {snippet}")
                break
            if not batch:
                break
            items.extend(batch)
            print(f"  [list] offset={offset} fetched {len(batch)}")
            if len(batch) < self.PAGE_SIZE:
                break
            offset += self.PAGE_SIZE
            time.sleep(0.5)
        return items

    def run(self):
        conn = self.get_db_connection()
        cur = conn.cursor()
        try:
            self.init_db(cur)
            conn.commit()

            # 매 런 시작 시 list_order 초기화 —
            # 이번 세일 리스트에 없는 책(세일 종료된 옛 책)은 NULL로 남아서
            # 검색 시 인기순 뒤쪽에 나오지만 히스토리 조회는 정상 작동
            cur.execute("UPDATE books SET list_order = NULL")
            conn.commit()

            items = self.fetch_all_items()
            print(f"\n[RidiDB] {len(items)} books found\n")

            for i, item in enumerate(items, 1):
                book_data = item['book']
                b_id = book_data['book_id']
                title = book_data['title']

                price_details = self.extract_detail(b_id)
                if price_details:
                    metadata = self.extract_metadata(book_data)
                    details = {**price_details, **metadata}
                    print(f"  [{i}/{len(items)}]", end=" ")
                    self._upsert(cur, b_id, title, details, i - 1)

                if i % 50 == 0:
                    conn.commit()

                time.sleep(self.DETAIL_SLEEP)

            conn.commit()
            print(f"\n[RidiDB] Done — {len(items)} books processed")
        except Exception as e:
            conn.rollback()
            print(f"\n[ERR] Scraper failed: {e}")
            traceback.print_exc()
        finally:
            cur.close()
            conn.close()

if __name__ == "__main__":
    scraper = RidiScraper(db_config)
    scraper.run()
