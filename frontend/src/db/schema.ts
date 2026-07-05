import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const series = pgTable("series", {
  series_id: serial("series_id").primaryKey(),
  name: text("name").notNull(),
  norm_key: text("norm_key").notNull().unique(),
});

export const books = pgTable("books", {
  book_id: text("book_id").primaryKey(),
  title: text("title").notNull(),
  full_price: integer("full_price"),
  set_price: integer("set_price"),
  all_time_low: integer("all_time_low"),
  discount_pct: integer("discount_pct"),
  list_order: integer("list_order"),
  comic: boolean("comic"),
  publisher: text("publisher"),
  publication_date: date("publication_date"),
  set_total: integer("set_total"),
  introduction: text("introduction"),
  set_type: text("set_type"),
  series_id: integer("series_id"),
  updated_at: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  category_id: integer("category_id").primaryKey(),
  name: text("name").notNull(),
  genre: text("genre"),
  parent_id: integer("parent_id"),
});

export const bookCategories = pgTable(
  "book_categories",
  {
    book_id: text("book_id").notNull(),
    category_id: integer("category_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.book_id, t.category_id] })],
);

export const authors = pgTable("authors", {
  author_id: serial("author_id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const bookAuthors = pgTable(
  "book_authors",
  {
    book_id: text("book_id").notNull(),
    author_id: integer("author_id").notNull(),
    role: text("role").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.book_id, t.author_id, t.role] })],
);

export const priceHistory = pgTable("price_history", {
  id: serial("id").primaryKey(),
  book_id: text("book_id").notNull(),
  set_price: integer("set_price"),
  start_date: timestamp("start_date", { withTimezone: false }),
  end_date: timestamp("end_date", { withTimezone: false }),
  scraped_at: timestamp("scraped_at", { withTimezone: false }).notNull().defaultNow(),
  full_price: integer("full_price"),
  discount_pct: integer("discount_pct"),
});

export const booksRelations = relations(books, ({ one, many }) => ({
  histories: many(priceHistory),
  categories: many(bookCategories),
  authors: many(bookAuthors),
  series: one(series, {
    fields: [books.series_id],
    references: [series.series_id],
  }),
}));

export const seriesRelations = relations(series, ({ many }) => ({
  books: many(books),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  books: many(bookCategories),
}));

export const bookCategoriesRelations = relations(bookCategories, ({ one }) => ({
  book: one(books, {
    fields: [bookCategories.book_id],
    references: [books.book_id],
  }),
  category: one(categories, {
    fields: [bookCategories.category_id],
    references: [categories.category_id],
  }),
}));

export const authorsRelations = relations(authors, ({ many }) => ({
  books: many(bookAuthors),
}));

export const bookAuthorsRelations = relations(bookAuthors, ({ one }) => ({
  book: one(books, {
    fields: [bookAuthors.book_id],
    references: [books.book_id],
  }),
  author: one(authors, {
    fields: [bookAuthors.author_id],
    references: [authors.author_id],
  }),
}));

export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  book: one(books, {
    fields: [priceHistory.book_id],
    references: [books.book_id],
  }),
}));

export type Book = typeof books.$inferSelect;
export type PriceHistory = typeof priceHistory.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Author = typeof authors.$inferSelect;
