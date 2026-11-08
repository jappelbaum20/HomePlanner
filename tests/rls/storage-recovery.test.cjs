'use strict';
// Disposable in-memory PostgreSQL and stub Auth/Storage tables only. This does
// not test a real Storage service, concurrent database sessions or deployment.
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

test('storage recovery SQL and synthetic RLS fixture', { skip: !process.env.HP_PGLITE_PACKAGE }, async () => {
  const { PGlite } = require(process.env.HP_PGLITE_PACKAGE);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; grant usage on schema auth to authenticated, anon;
      create table auth.users(instance_id uuid,id uuid primary key,aud text,role text,email text,encrypted_password text,email_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb);
      create table auth.sessions(id uuid primary key,user_id uuid not null,created_at timestamptz,updated_at timestamptz,not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
      create schema storage; grant usage on schema storage to authenticated;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security; grant insert on storage.objects to authenticated;
    `);
    for (const file of fs.readdirSync(path.join(root, 'supabase/migrations')).filter(x => x.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
    }
    for (const file of ['isolation.sql', 'synthetic-storage.sql', 'storage-recovery.sql']) {
      await db.exec(fs.readFileSync(path.join(__dirname, file), 'utf8'));
    }
  } finally { await db.close(); }
});
