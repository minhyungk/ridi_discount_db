import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { books } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const db = getDb();
  const rows = await db
    .select({ book_id: books.book_id, updated_at: books.updated_at })
    .from(books)
    .orderBy(desc(books.updated_at));

  const now = new Date();

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/calendar`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    ...rows.map((b) => ({
      url: `${base}/books/${b.book_id}`,
      lastModified: b.updated_at,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}
