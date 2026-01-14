# ridi_discount_db
Third party Ridibooks db to keep track of discount history

To run this repository on another computer, you need to ensure both the **data pipeline (Scraper)** and the **web interface (Next.js)** can connect to the **PostgreSQL database**.

Follow these steps to set up the environment from scratch.


# 📚 Ridi Discount Tracker

A full-stack application to track set book prices and discount periods from Ridibooks, featuring a SteamDB-style dashboard.

## 🚀 Getting Started

Follow these steps to set up the project on a new machine.

### 1. Prerequisites
Ensure you have the following installed:
* **Docker & Docker Compose** (For the PostgreSQL database)
* **Python 3.9+** (For the Scraper)
* **Node.js 18+ & npm** (For the Frontend)

---

### 2. Environment Setup
Clone the repository and create a `.env` file in the root directory:

```env
# Database Credentials
DB_USER=myuser
DB_PASSWORD=mypassword
DB_NAME=ridi_db
DB_HOST=localhost
DB_PORT=5432

# Prisma Database URL
DATABASE_URL="postgresql://myuser:mypassword@localhost:5432/ridi_db?schema=public"

```

---

### 3. Database & Docker

Start the PostgreSQL container and pgAdmin:

```bash
docker-compose up -d
```

*Wait a few seconds for the database to initialize.*

---

### 4. Scraper Setup (Python)

Navigate to the `scraper` folder, set up a virtual environment, and install dependencies:

```bash
cd scraper
python -m venv .venv
source .venv/bin/activate  # On Windows use: .venv\Scripts\activate
pip install -r requirements.txt
```

Run the scraper to populate the database:

```bash
python main.py
```

---

### 5. Frontend Setup (Next.js)

Navigate to the `frontend` folder, install packages, and sync the database schema:

```bash
cd ../frontend
npm install

# Generate Prisma client and sync schema
npx prisma generate
npx prisma db push
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](https://www.google.com/search?q=http://localhost:3000) to see the dashboard.

---

### Tech Stack

* **Frontend:** Next.js (App Router), Tailwind CSS, Prisma 7
* **Backend:** Python (Requests, BeautifulSoup/Regex)
* **Database:** PostgreSQL (Docker)
* **Visualizer:** pgAdmin 4