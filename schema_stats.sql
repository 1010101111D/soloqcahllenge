-- Correr en Supabase > SQL Editor (una sola vez)
create table matches (match_id text primary key, ts bigint not null, dur int, data jsonb not null);
create table elo_history (id bigserial primary key, riot_id text not null, ts timestamptz default now(), tier text, rank text, lp int);
create index on elo_history (riot_id, ts);
alter table matches enable row level security;
alter table elo_history enable row level security;
