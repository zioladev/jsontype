import { Database } from "bun:sqlite";

export interface Share {
  id: string;
  json: string; // exactly as pasted, formatting preserved
  types: string; // the TypeScript that was on screen when it was saved
  created_at: number;
}

export type ShareStore = ReturnType<typeof openStore>;

export function openStore(path: string) {
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS shares (
    id         TEXT PRIMARY KEY,
    json       TEXT NOT NULL,
    types      TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  const insert = db.query(
    "INSERT OR IGNORE INTO shares (id, json, types, created_at) VALUES ($id, $json, $types, $created_at)",
  );
  const select = db.query<Share, { id: string }>("SELECT * FROM shares WHERE id = $id");

  return {
    save(share: Omit<Share, "created_at">) {
      insert.run({ ...share, created_at: Date.now() });
    },
    get(id: string): Share | null {
      return select.get({ id });
    },
    close() {
      db.close();
    },
  };
}
