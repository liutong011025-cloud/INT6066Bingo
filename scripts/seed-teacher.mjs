import postgres from "postgres";

const connection =
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;

if (!connection) {
  console.error("Missing POSTGRES_URL_NON_POOLING.");
  process.exit(1);
}

const sql = postgres(connection, { max: 1, ssl: "require" });

const nicoleCourses = [
  { code: "INT6066", title: "INT 6066", blurb: "Education and design bingo" },
  { code: "INT6136P", title: "INT 6136P", blurb: "AI in the workplace bingo" },
  { code: "LAW6003", title: "LAW 6003", blurb: "法律、AI 与创业 Bingo" }
];

try {
  const teachers = await sql`select id from public.teachers where lower(username) = 'nicole' limit 1`;
  if (!teachers.length) {
    console.error("Nicole is not in teachers. Seed the teacher first.");
    process.exit(1);
  }
  const owner = teachers[0].id;
  for (const course of nicoleCourses) {
    await sql`
      insert into public.courses (code, title, blurb, created_by)
      values (${course.code}, ${course.title}, ${course.blurb}, ${owner})
      on conflict (code) do update
        set title = excluded.title,
            blurb = excluded.blurb,
            created_by = excluded.created_by
    `;
  }
  const rows = await sql`
    select code, title, created_by
    from public.courses
    where created_by = ${owner}
    order by code
  `;
  console.log("Nicole courses:", rows.map((r) => r.code).join(", "));
} finally {
  await sql.end();
}
