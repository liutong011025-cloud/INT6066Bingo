import postgres from "postgres";

const connection =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;

if (!connection) {
  console.error("Missing POSTGRES_URL_NON_POOLING.");
  process.exit(1);
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 120000, hash: "SHA-256" },
    key,
    256
  );
  return Buffer.from(bits).toString("base64");
}

const username = "Nicole";
const password = "yinyin2948";
const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
const hash = await hashPassword(password, salt);
const sql = postgres(connection, { max: 1, ssl: "require" });

try {
  await sql`delete from public.teachers where lower(username) = lower(${username})`;
  await sql`
    insert into public.teachers (username, password_salt, password_hash)
    values (${username}, ${salt}, ${hash})
  `;
  const rows = await sql`select username from public.teachers order by username`;
  console.log("teachers:", rows.map((r) => r.username).join(", "));
} finally {
  await sql.end();
}
