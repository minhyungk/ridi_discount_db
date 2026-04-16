import requests
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
    'port': os.getenv('DB_PORT')
}

class RidiScraper:
    def __init__(self, db_config):
        self.list_api_url = "https://api.ridibooks.com/v2/selections/?section_id=748&limit=50"
        self.detail_base_url = "https://ridibooks.com/books/"
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        self.db_config = db_config

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

    def extract_detail(self, book_id):
        try:
            url = f"{self.detail_base_url}{book_id}"
            response = requests.get(url, headers=self.headers, timeout=10)
            html = response.text

            p_info = {}
            m_detail = re.search(r'var bookDetail = (\{.*?\});', html, re.DOTALL)
            if m_detail:
                p_info = json.loads(m_detail.group(1)).get('price_info', {}) or {}

            def parse_date(d):
                return d.get('date') if isinstance(d, dict) else d

            set_price = int(p_info.get('current_price') or 0)

            # 세트북의 실제 할인율은 price_info가 아닌 HTML 내 purchase 배열의 '세트 정가' discountRate
            m_rate = re.search(
                r'"priceType":"전자책 세트 정가"[^}]*?"discountRate":(\d+)', html
            )
            discount_pct = int(m_rate.group(1)) if m_rate else int(
                p_info.get('ebook_discount_percentage') or 0
            )

            full_price = (
                round(set_price / (1 - discount_pct / 100))
                if discount_pct > 0 and set_price
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
            print(f"  [ERR] Detail extraction failed for {book_id}: {e}")
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

    def run(self):
        conn = self.get_db_connection()
        cur = conn.cursor()
        try:
            self.init_db(cur)
            conn.commit()

            response = requests.get(self.list_api_url, headers=self.headers)
            items = response.json().get('data', {}).get('items', [])
            print(f"[RidiDB] {len(items)} books found\n")

            for item in items:
                b_id = item['book']['book_id']
                title = item['book']['title']

                details = self.extract_detail(b_id)
                if details:
                    self._upsert(cur, b_id, title, details)

                time.sleep(0.5)

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
