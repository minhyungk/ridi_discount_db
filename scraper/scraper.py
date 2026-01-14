import requests
import re
import json
import time
import psycopg2
from datetime import datetime
import os
import traceback
from dotenv import load_dotenv

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

    def init_db(self):
        """테이블 구조를 Next.js/Prisma와 동일하게 맞춤"""
        commands = (
            """
            CREATE TABLE IF NOT EXISTS books (
                book_id VARCHAR(20) PRIMARY KEY,
                title TEXT NOT NULL,
                full_price INTEGER,
                set_price INTEGER,
                discount_pct INTEGER,
                all_time_low INTEGER,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS price_history (
                id SERIAL PRIMARY KEY,
                book_id VARCHAR(20) REFERENCES books(book_id),
                set_price INTEGER,
                start_date TIMESTAMP,
                end_date TIMESTAMP,
                scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn = self.get_db_connection()
        cur = conn.cursor()
        for command in commands:
            cur.execute(command)
        conn.commit()
        cur.close()
        conn.close()
        print("🗄️ Database synchronized with all columns.")

    def extract_detail(self, book_id):
        try:
            url = f"{self.detail_base_url}{book_id}"
            response = requests.get(url, headers=self.headers, timeout=10)
            
            pattern = r'var bookDetail = (\{.*?\});'
            match = re.search(pattern, response.text, re.DOTALL)
            
            if match:
                data = json.loads(match.group(1))
                p_info = data.get('price_info', {})
                
                # [수정] 리디 API는 'set_price'가 아니라 'current_price'를 씁니다.
                set_price = p_info.get('current_price') or 0
                discount_pct = p_info.get('ebook_discount_percentage') or 0
                
                # 역산 로직
                if discount_pct > 0:
                    calculated_full_price = int(set_price / (1 - (discount_pct / 100)))
                else:
                    calculated_full_price = p_info.get('paper_price') or p_info.get('regular_price') or set_price

                def parse_date(date_obj):
                    if isinstance(date_obj, dict):
                        return date_obj.get('date')
                    return date_obj

                return {
                    "start_date": parse_date(p_info.get('discount_start_date')),
                    "end_date": parse_date(p_info.get('discount_end_date')),
                    "full_price": calculated_full_price,
                    "set_price": set_price,
                    "discount_pct": discount_pct
                }
        except Exception as e:
            print(f"❌ Extraction Detail Error for {book_id}: {e}")
            traceback.print_exc()
        return None

    def upsert_to_db(self, book_id, title, details):
        conn = self.get_db_connection()
        cur = conn.cursor()
        try:
            # 1. UPSERT into books table (all columns included)
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
                book_id, 
                title, 
                details.get('full_price', 0), 
                details.get('set_price', 0),  
                details.get('set_price', 0),     
                details.get('discount_pct', 0)
            ))

            # 2. INSERT into price_history table
            cur.execute("""
                INSERT INTO price_history (book_id, set_price, start_date, end_date)
                VALUES (%s, %s, %s, %s);
            """, (book_id, details.get('set_price', 0), details.get('start_date'), details.get('end_date')))

            conn.commit()
            display_title = (title[:25] + '..') if len(title) > 25 else title
            print(f"✅ {display_title:<30} | Price: {details.get('set_price', 0):>7,}원 | Disc: {details.get('discount_pct', 0):>3}%")
        except Exception as e:
            conn.rollback()
            print(f"\n❌ DB Error for {title}")
            traceback.print_exc()
        finally:
            cur.close()
            conn.close()

    def run(self):
        self.init_db() # 실행 시 테이블 구조 먼저 확인
        response = requests.get(self.list_api_url, headers=self.headers)
        items = response.json().get('data', {}).get('items', [])

        for item in items:
            b_id = item['book']['book_id']
            title = item['book']['title']
            
            details = self.extract_detail(b_id)
            if details:
                self.upsert_to_db(b_id, title, details)
            
            time.sleep(0.5)

if __name__ == "__main__":
    scraper = RidiScraper(db_config)
    scraper.run()