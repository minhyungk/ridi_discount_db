import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const books = await prisma.book.findMany({
    select: { book_id: true, updated_at: true },
    orderBy: { updated_at: "desc" },
  });

  const now = new Date();

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/calendar`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    ...books.map((b) => ({
      url: `${base}/books/${b.book_id}`,
      lastModified: b.updated_at,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];
}
