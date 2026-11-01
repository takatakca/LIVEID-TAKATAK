-- TAKATAK LIVE ID: initial schema.
-- Privacy by design: no raw images or audio are ever stored. Phone and email are AES-256-GCM sealed;
-- lookups use keyed hashes. The face template from the live check is sealed and wiped after the ID step
-- or when the session expires (see src/flow/purge.ts).

create table if not exists liveid_clients (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  name text not null,
  secret_hash text not null,
  redirect_uris text[] not null,
  allowed_scopes text[] not null default array['openid','phone','email','liveness','id_document'],
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table if not exists liveid_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references liveid_clients(id),
  browser_token_hash text not null unique,
  csrf_token text not null,
  redirect_uri text not null,
  state text not null,
  nonce text,
  scopes text[] not null,
  code_challenge text not null,
  display text not null default 'page' check (display in ('page','popup')),
  locale text not null default 'fr' check (locale in ('fr','en')),
  status text not null default 'pending'
    check (status in ('pending','completed','denied','failed','expired')),
  consented_at timestamptz,
  phone_sealed text,
  phone_hash text,
  phone_verified_at timestamptz,
  email_sealed text,
  email_hash text,
  email_verified_at timestamptz,
  liveness_attempts int not null default 0,
  liveness_passed_at timestamptz,
  liveness_report jsonb,
  face_template_sealed text,
  id_attempts int not null default 0,
  id_matched_at timestamptz,
  id_report jsonb,
  risk jsonb not null default '{}'::jsonb,
  auth_code_hash text unique,
  auth_code_expires_at timestamptz,
  auth_code_used_at timestamptz,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz
);
create index if not exists liveid_sessions_expires_idx on liveid_sessions (expires_at);
create index if not exists liveid_sessions_phone_idx on liveid_sessions (phone_hash) where phone_hash is not null;

create table if not exists liveid_otps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references liveid_sessions(id) on delete cascade,
  channel text not null check (channel in ('sms','email')),
  target_hash text not null,
  code_hash text not null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create index if not exists liveid_otps_session_idx on liveid_otps (session_id, channel, created_at desc);

create table if not exists liveid_challenges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references liveid_sessions(id) on delete cascade,
  digits text not null,
  moves text[] not null,
  plan jsonb not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists liveid_challenges_session_idx on liveid_challenges (session_id);

create table if not exists liveid_rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null
);

create table if not exists liveid_audit (
  id bigserial primary key,
  session_id uuid,
  client_id text,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists liveid_audit_session_idx on liveid_audit (session_id);
