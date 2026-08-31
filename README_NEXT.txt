INT6066 Human Bingo — Vercel + Supabase

This version hosts on Vercel and stores live classroom data in Supabase Postgres + Realtime.
It no longer uses Firebase Realtime Database.

Required Vercel environment variables (public only):
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY

Do not expose POSTGRES_PASSWORD, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_JWT_SECRET
to the browser. Those stay as Vercel/server secrets.

First-time database setup (once):
  1. Put POSTGRES_URL_NON_POOLING in the local environment.
  2. Run: npm run setup-db
  Or paste supabase/schema.sql into the Supabase SQL Editor and run it.

Classroom URLs:
  Student: YOUR_SITE/?room=INT6066
  Teacher: YOUR_SITE/?room=INT6066&teacher=1

Architecture:
  Browsers talk directly to Supabase (same pattern as the old Firebase client).
  Vercel only serves the Next.js app. 100 concurrent students do not go through
  Vercel serverless functions for each bingo write.
