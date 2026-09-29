create table players (
  riot_id text primary key,          -- 'Nombre#TAG'
  region text not null default 'la2',
  puuid text, icon int, level int,
  tier text, rank text, lp int, wins int, losses int,
  start_tier text, start_rank text, start_lp int,
  err text, updated_at timestamptz default 'epoch'
);
alter table players enable row level security;  -- sin policies: solo el backend (service key) accede

-- agregá amigos así (start_* opcional; si no, se fija en el primer chequeo):
insert into players (riot_id, region) values ('Nacho#LAS','la2'), ('Amigo2#LAS','la2');
