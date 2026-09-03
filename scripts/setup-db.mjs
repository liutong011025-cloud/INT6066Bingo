import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const connection =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;

if (!connection) {
  console.error("Missing POSTGRES_URL_NON_POOLING / POSTGRES_URL / DATABASE_URL.");
  process.exit(1);
}

const sql = postgres(connection, { max: 1, ssl: "require" });
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "schema.sql");
const schema = await readFile(schemaPath, "utf8");

try {
  await sql.unsafe(schema);
  const tables = await sql`
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'students'
    order by ordinal_position
  `;
  console.log("students table is ready:");
  for (const col of tables) console.log(`  - ${col.column_name} (${col.data_type})`);
  const extra = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_name in ('teachers', 'courses')
    order by table_name
  `;
  console.log("auth/course tables:", extra.map((t) => t.table_name).join(", ") || "(missing)");
} finally {
  await sql.end();
}
