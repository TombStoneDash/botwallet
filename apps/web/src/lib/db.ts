import { createDb } from "@botwallet/db";

// Lazy singleton — only connects when first called at runtime
let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) {
    const url = process.env.BOTWALLET_DATABASE_URL;
    if (!url) throw new Error("BOTWALLET_DATABASE_URL is required");
    _db = createDb(url);
  }
  return _db;
}
