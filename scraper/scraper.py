from curl_cffi import requests as http
import requests as plain_requests  # list API only (JSON, no CF)
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
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
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

            p_info = json.loads(m_detail.group(1)).get('price_info', {}) or {}

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

    def _upsert(self, cur, book_id, title, details):
        set_price = int(details.get('set_price', 0))
        discount_pct = int(details.get('discount_pct', 0))

        # Upsert into books
        cur.execute("""
            INSERT INTO books (book_id, title, full_price, set_price, all_time_low, discount_pct)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (book_id) DO UPDATE SET
                title = EXCLUDED.title,
                full_price = EXCLUDED.full_price,
                set_price = EXCLUDED.set_price,
                discount_pct = EXCLUDED.discount_pct,
                all_time_low = CASE
                    WHEN books.all_time_low IS NULL OR books.all_time_low = 0 THEN EXCLUDED.set_price
                    ELSE LEAST(books.all_time_low, EXCLUDED.set_price)
                END,
                updated_at = CURRENT_TIMESTAMP;
        """, (
            book_id, title,
            details.get('full_price', 0),
            set_price, set_price,
            details.get('discount_pct', 0)
        ))

        # Only insert price_history if the price actually changed
        cur.execute("""
            SELECT set_price FROM price_history
            WHERE book_id = %s
            ORDER BY scraped_at DESC LIMIT 1
        """, (book_id,))
        last = cur.fetchone()

        if not last or last[0] != set_price:
            cur.execute("""
                INSERT INTO price_history (book_id, set_price, start_date, end_date)
                VALUES (%s, %s, %s, %s)
            """, (book_id, set_price, details.get('start_date'), details.get('end_date')))
            status = "NEW"
        else:
            status = "same"

        display_title = (title[:25] + '..') if len(title) > 25 else title
        print(f"  {display_title:<30} | {set_price:>7,d}원 | -{discount_pct:>2d}% | {status}")

    def fetch_all_items(self):
        """offset 페이지네이션으로 전체 세일 세트북 리스트 수집 (List API는 CF 밖)"""
        items = []
        offset = 0
        while True:
            url = f"{self.list_api_base}&limit={self.PAGE_SIZE}&offset={offset}"
            r = plain_requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15)
            batch = r.json().get('data', {}).get('items', [])
            if not batch:
                break
            items.extend(batch)
            print(f"  [list] offset={offset} fetched {len(batch)}")
            if len(batch) < self.PAGE_SIZE:
                break
            offset += self.PAGE_SIZE
            time.sleep(0.3)
        return items

    def run(self):
        conn = self.get_db_connection()
        cur = conn.cursor()
        try:
            self.init_db(cur)
            conn.commit()

            items = self.fetch_all_items()
            print(f"\n[RidiDB] {len(items)} books found\n")

            for i, item in enumerate(items, 1):
                b_id = item['book']['book_id']
                title = item['book']['title']

                details = self.extract_detail(b_id)
                if details:
                    print(f"  [{i}/{len(items)}]", end=" ")
                    self._upsert(cur, b_id, title, details)

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
