-- =====================================================================
-- ScanQC Web · Supabase 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 Run 한 번.
-- (다시 실행해도 안전하도록 작성됨)
--
--  · 로그인 없이 쓰는 사람: 이미지는 서버로 가지 않음. 사용 통계(폴더·파일 이름, 처리 건수)만 기록
--  · 로그인한 사람: 클라우드 작업 묶음(업로드·배정·잠금), 작업 기록
--  · 첫 번째로 가입한 계정이 자동으로 관리자
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- 사람
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  login       text unique not null,
  name        text not null default '',
  role        text not null default 'worker' check (role in ('admin','worker')),
  approved    boolean not null default false,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, login, name, role, approved)
  values (new.id,
          lower(coalesce(nullif(new.raw_user_meta_data->>'login',''), split_part(new.email,'@',1))),
          coalesce(new.raw_user_meta_data->>'name',''),
          case when is_first then 'admin' else 'worker' end,
          is_first)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and approved)
$$;
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and approved)
$$;
create or replace function public.who(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(name,''), login) from public.profiles where id = p
$$;

-- ---------------------------------------------------------------- 작업 묶음 · 파일
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  note        text not null default '',
  cfg         jsonb not null default '{}'::jsonb,   -- auto_mode, margin_mm, skew_warn, backup
  archived    boolean not null default false,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.files (
  id           bigint generated always as identity primary key,
  project_id   uuid not null references public.projects(id) on delete cascade,
  stem         text not null,                 -- 확장자 뺀 소문자 이름 (원본·보정본 짝 맞춤)
  name         text not null,                 -- 화면에 보이는 이름
  orig_name    text, hp_name text,            -- 저장소의 실제 파일 이름
  orig_bytes   bigint, hp_bytes bigint,
  orig_ver     int not null default 0,
  hp_ver       int not null default 0,
  has_backup   boolean not null default false,
  seq          int not null default 0,        -- 자연 정렬 순번 (1부터)
  status       text not null default '',      -- '', auto, ok, edited, copied, skipped
  qc           text,                          -- error | warn | null (자동 검사 결과)
  assignee     uuid references public.profiles(id) on delete set null,
  locked_by    uuid references public.profiles(id) on delete set null,
  locked_at    timestamptz,
  draft        jsonb, draft_status text, draft_by uuid,
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  updated_at   timestamptz not null default now(),
  unique (project_id, stem)
);
create index if not exists files_project_seq on public.files(project_id, seq);
create index if not exists files_assignee on public.files(assignee);

create table if not exists public.logs (
  id          bigint generated always as identity primary key,
  project_id  uuid references public.projects(id) on delete cascade,
  file_id     bigint references public.files(id) on delete set null,
  user_id     uuid default auth.uid() references public.profiles(id) on delete set null,
  action      text not null,
  file_name   text,
  detail      jsonb,
  at          timestamptz not null default now()
);
create index if not exists logs_project_at on public.logs(project_id, at desc);
create index if not exists logs_user_at on public.logs(user_id, at desc);

-- ---------------------------------------------------------------- 사용 통계 (로그인 안 한 사람 포함)
create table if not exists public.usage_sessions (
  id           uuid primary key,              -- 폴더(또는 묶음)를 연 한 번
  anon_id      text not null,                 -- 브라우저마다 하나 (익명)
  user_id      uuid references public.profiles(id) on delete set null,
  mode         text not null default 'local', -- local | cloud
  orig_folder  text, hp_folder text,
  project_id   uuid,
  file_count   int not null default 0,
  viewed       int not null default 0,
  saved        int not null default 0,
  auto         int not null default 0,
  edited       int not null default 0,
  copied       int not null default 0,
  ok           int not null default 0,
  restored     int not null default 0,
  ua           text,
  started_at   timestamptz not null default now(),
  last_at      timestamptz not null default now()
);
create index if not exists usage_sessions_last on public.usage_sessions(last_at desc);
create index if not exists usage_sessions_anon on public.usage_sessions(anon_id);

create table if not exists public.usage_events (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.usage_sessions(id) on delete cascade,
  at          timestamptz not null default now(),
  action      text not null,                  -- open, view, save, copy, ok, restore, close
  file_name   text,
  status      text,
  detail      jsonb
);
create index if not exists usage_events_session on public.usage_events(session_id, at);
alter table public.usage_events add column if not exists eid text;   -- 같은 기록이 두 번 와도 한 번만
create unique index if not exists usage_events_eid on public.usage_events(eid);

-- ---------------------------------------------------------------- 행 단위 권한 (RLS)
alter table public.profiles       enable row level security;
alter table public.projects       enable row level security;
alter table public.files          enable row level security;
alter table public.logs           enable row level security;
alter table public.usage_sessions enable row level security;
alter table public.usage_events   enable row level security;

drop policy if exists p_profiles_sel on public.profiles;
create policy p_profiles_sel on public.profiles for select using (id = auth.uid() or public.is_member());
drop policy if exists p_profiles_upd on public.profiles;
create policy p_profiles_upd on public.profiles for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists p_profiles_del on public.profiles;
create policy p_profiles_del on public.profiles for delete using (public.is_admin());

drop policy if exists p_projects_sel on public.projects;
create policy p_projects_sel on public.projects for select using (public.is_member());
drop policy if exists p_projects_all on public.projects;
create policy p_projects_all on public.projects for all using (public.is_admin()) with check (public.is_admin());

-- 작업자는 '배정 안 된 파일 + 나에게 배정된 파일'만 봄. 고치는 건 아래 함수로만.
drop policy if exists p_files_sel on public.files;
create policy p_files_sel on public.files for select
  using (public.is_admin() or (public.is_member() and (assignee is null or assignee = auth.uid())));
drop policy if exists p_files_all on public.files;
create policy p_files_all on public.files for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists p_logs_sel on public.logs;
create policy p_logs_sel on public.logs for select using (public.is_admin() or user_id = auth.uid());

drop policy if exists p_usage_s_sel on public.usage_sessions;
create policy p_usage_s_sel on public.usage_sessions for select using (public.is_admin());
drop policy if exists p_usage_e_sel on public.usage_events;
create policy p_usage_e_sel on public.usage_events for select using (public.is_admin());

-- ---------------------------------------------------------------- 작업자용 함수
create or replace function public._file_for_me(p_id bigint) returns public.files
language plpgsql security definer set search_path = public as $$
declare f public.files;
begin
  if not public.is_member() then raise exception '승인된 계정만 사용할 수 있습니다'; end if;
  select * into f from public.files where id = p_id for update;
  if not found then raise exception '파일이 없습니다'; end if;
  if not public.is_admin() and f.assignee is not null and f.assignee <> auth.uid() then
    raise exception '나에게 배정되지 않은 파일입니다';
  end if;
  return f;
end $$;

-- 파일 잠금 (90초 동안 소식이 없으면 풀린 것으로 봄 · 화면이 30초마다 연장)
create or replace function public.claim_file(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f public.files; uid uuid := auth.uid();
begin
  f := public._file_for_me(p_id);
  update public.profiles set last_seen = now() where id = uid;
  if f.locked_by is null or f.locked_by = uid or f.locked_at < now() - interval '90 seconds' then
    update public.files set locked_by = uid, locked_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'hp_ver', f.hp_ver, 'orig_ver', f.orig_ver, 'status', f.status,
                              'draft', f.draft, 'draft_status', f.draft_status, 'has_backup', f.has_backup);
  end if;
  return jsonb_build_object('ok', false, 'by', public.who(f.locked_by), 'since', f.locked_at);
end $$;

create or replace function public.release_file(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update public.files set locked_by = null, locked_at = null where id = p_id and locked_by = auth.uid()
$$;

-- 보정본 저장이 끝난 뒤 기록 (저장소 업로드는 잠금을 가진 사람만 가능)
create or replace function public.file_saved(p_id bigint, p_status text, p_hp_name text, p_hp_bytes bigint,
                                             p_backup boolean, p_action text default 'save', p_detail jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.files; uid uuid := auth.uid();
begin
  f := public._file_for_me(p_id);
  if f.locked_by is distinct from uid and not public.is_admin() then raise exception '다른 사람이 작업 중인 파일입니다'; end if;
  update public.files set
    status = coalesce(nullif(p_status,''), status), hp_name = coalesce(p_hp_name, hp_name), hp_bytes = coalesce(p_hp_bytes, hp_bytes),
    hp_ver = hp_ver + 1, has_backup = has_backup or coalesce(p_backup,false),
    draft = null, draft_status = null, draft_by = null,
    reviewed_by = uid, reviewed_at = now(), updated_at = now(), locked_at = now()
  where id = p_id returning * into f;
  insert into public.logs(project_id, file_id, user_id, action, file_name, detail)
  values (f.project_id, f.id, uid, coalesce(p_action,'save'), f.name, jsonb_build_object('status', p_status) || coalesce(p_detail,'{}'::jsonb));
  return jsonb_build_object('hp_ver', f.hp_ver, 'status', f.status, 'has_backup', f.has_backup);
end $$;

-- 저장 없이 상태만 (확인 · 건너뜀 · 복원 후 미검수)
create or replace function public.set_file_status(p_id bigint, p_status text, p_action text default 'status')
returns void language plpgsql security definer set search_path = public as $$
declare f public.files; uid uuid := auth.uid();
begin
  f := public._file_for_me(p_id);
  update public.files set status = coalesce(p_status,''), reviewed_by = uid, reviewed_at = now(), updated_at = now(),
         draft = case when p_action = 'restore' then null else draft end
  where id = p_id;
  if p_action = 'restore' then update public.files set hp_ver = hp_ver + 1 where id = p_id; end if;
  insert into public.logs(project_id, file_id, user_id, action, file_name, detail)
  values (f.project_id, f.id, uid, coalesce(p_action,'status'), f.name, jsonb_build_object('status', p_status));
end $$;

-- 창을 닫을 때 저장 못 한 수정 내용 보관 (다음에 열면 이어서 저장)
create or replace function public.save_draft(p_id bigint, p_edits jsonb, p_status text default 'edited')
returns void language plpgsql security definer set search_path = public as $$
declare f public.files;
begin
  f := public._file_for_me(p_id);
  if f.locked_by is not null and f.locked_by <> auth.uid() and f.locked_at > now() - interval '90 seconds' then return; end if;
  update public.files set draft = p_edits, draft_status = case when p_edits is null then null else p_status end,
         draft_by = case when p_edits is null then null else auth.uid() end
  where id = p_id;
end $$;

create or replace function public.set_qc(p_id bigint, p_qc text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._file_for_me(p_id);
  update public.files set qc = nullif(p_qc,'') where id = p_id;
end $$;

-- ---------------------------------------------------------------- 관리자용 함수
-- 업로드한 파일 등록 (원본/보정본 각각 따로 불러도 짝이 맞춰짐)
create or replace function public.add_files(p_project uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.files(project_id, stem, name, orig_name, orig_bytes, orig_ver, hp_name, hp_bytes, hp_ver, seq)
    values (p_project, r->>'stem', coalesce(r->>'hp_name', r->>'orig_name'),
            r->>'orig_name', (r->>'orig_bytes')::bigint, case when r ? 'orig_name' then 1 else 0 end,
            r->>'hp_name', (r->>'hp_bytes')::bigint, case when r ? 'hp_name' then 1 else 0 end,
            coalesce((r->>'seq')::int, 0))
    on conflict (project_id, stem) do update set
      orig_name  = coalesce(excluded.orig_name, files.orig_name),
      orig_bytes = coalesce(excluded.orig_bytes, files.orig_bytes),
      orig_ver   = files.orig_ver + case when excluded.orig_name is not null then 1 else 0 end,
      hp_name    = coalesce(excluded.hp_name, files.hp_name),
      hp_bytes   = coalesce(excluded.hp_bytes, files.hp_bytes),
      hp_ver     = files.hp_ver + case when excluded.hp_name is not null then 1 else 0 end,
      name       = coalesce(excluded.hp_name, files.hp_name, files.name),
      updated_at = now();
    n := n + 1;
  end loop;
  -- 자연 정렬 순번 다시 매기기 (00002 < 00010)
  with o as (
    select id, row_number() over (order by
      regexp_replace(stem, '\d+', '', 'g'),
      coalesce(nullif(regexp_replace(stem, '\D+', '', 'g'), '')::numeric, 0), stem) as rn
    from public.files where project_id = p_project)
  update public.files f set seq = o.rn from o where f.id = o.id and f.seq is distinct from o.rn;
  return n;
end $$;

-- 고르게 나누기: 대상 파일을 순서대로 끊어서 작업자들에게 차례로
create or replace function public.assign_even(p_project uuid, p_users uuid[], p_only_unassigned boolean default true,
                                              p_only_todo boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare n int; k int := coalesce(array_length(p_users,1),0);
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있습니다'; end if;
  if k = 0 then return 0; end if;
  with t as (
    select id, row_number() over (order by seq) - 1 as i, count(*) over () as cnt from public.files
    where project_id = p_project and (not p_only_unassigned or assignee is null) and (not p_only_todo or status = ''))
  update public.files f set assignee = p_users[1 + floor(t.i * k / greatest(t.cnt,1))::int] from t where f.id = t.id;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.project_dashboard(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있습니다'; end if;
  select jsonb_build_object(
    'total',   (select count(*) from files where project_id = p_project),
    'status',  (select coalesce(jsonb_object_agg(s, c), '{}') from (select status s, count(*) c from files where project_id = p_project group by status) x),
    'qc',      (select coalesce(jsonb_object_agg(q, c), '{}') from (select coalesce(qc,'none') q, count(*) c from files where project_id = p_project group by qc) x),
    'drafts',  (select count(*) from files where project_id = p_project and draft is not null),
    'locked',  (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'by', public.who(locked_by), 'since', locked_at) order by locked_at desc), '[]')
                from files where project_id = p_project and locked_by is not null and locked_at > now() - interval '90 seconds'),
    'people',  (select coalesce(jsonb_agg(x order by x->>'name'), '[]') from (
                  select jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.name,''), p.login), 'login', p.login, 'last_seen', p.last_seen,
                    'assigned', (select count(*) from files f where f.project_id = p_project and f.assignee = p.id),
                    'assigned_done', (select count(*) from files f where f.project_id = p_project and f.assignee = p.id and f.status <> ''),
                    'done', (select count(*) from files f where f.project_id = p_project and f.reviewed_by = p.id and f.status <> ''),
                    'auto', (select count(*) from files f where f.project_id = p_project and f.reviewed_by = p.id and f.status = 'auto'),
                    'edited', (select count(*) from files f where f.project_id = p_project and f.reviewed_by = p.id and f.status = 'edited'),
                    'copied', (select count(*) from files f where f.project_id = p_project and f.reviewed_by = p.id and f.status = 'copied'),
                    'ok', (select count(*) from files f where f.project_id = p_project and f.reviewed_by = p.id and f.status = 'ok'),
                    'today', (select count(distinct l.file_id) from logs l where l.project_id = p_project and l.user_id = p.id and l.at >= date_trunc('day', now())),
                    'last_at', (select max(l.at) from logs l where l.project_id = p_project and l.user_id = p.id)) x
                  from profiles p where p.approved) y),
    'unassigned', (select count(*) from files where project_id = p_project and assignee is null),
    'recent',  (select coalesce(jsonb_agg(x), '[]') from (
                  select jsonb_build_object('at', l.at, 'who', public.who(l.user_id), 'action', l.action, 'file', l.file_name, 'detail', l.detail) x
                  from logs l where l.project_id = p_project order by l.at desc limit 60) z)
  ) into res;
  return res;
end $$;

-- ---------------------------------------------------------------- 사용 통계 기록 (로그인 없이도 호출 가능)
create or replace function public.usage_track(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb := p->'session'; sid uuid := (s->>'id')::uuid; e jsonb; a text; st text; uid uuid := auth.uid();
begin
  if sid is null or coalesce(s->>'anon_id','') = '' then return; end if;
  insert into public.usage_sessions(id, anon_id, user_id, mode, orig_folder, hp_folder, project_id, file_count, ua)
  values (sid, left(s->>'anon_id', 64), uid, left(coalesce(s->>'mode','local'), 10), left(s->>'orig_folder', 300), left(s->>'hp_folder', 300),
          nullif(s->>'project_id','')::uuid, coalesce((s->>'file_count')::int, 0), left(s->>'ua', 200))
  on conflict (id) do update set last_at = now(), user_id = coalesce(usage_sessions.user_id, excluded.user_id),
    file_count = greatest(usage_sessions.file_count, excluded.file_count);
  for e in select * from jsonb_array_elements(coalesce(p->'events','[]'::jsonb)) limit 300 loop
    a := left(e->>'action', 20); st := left(e->>'status', 20);
    insert into public.usage_events(session_id, at, action, file_name, status, detail, eid)
    values (sid, coalesce((e->>'at')::timestamptz, now()), a, left(e->>'file', 300), st,
            case when e ? 'detail' and length((e->'detail')::text) < 2000 then e->'detail' end, left(e->>'id', 64))
    on conflict (eid) do nothing;
    if not found then continue; end if;
    update public.usage_sessions set last_at = now(),
      viewed   = viewed   + (a = 'view')::int,
      saved    = saved    + (a in ('save','copy'))::int,
      auto     = auto     + (a = 'save' and st = 'auto')::int,
      edited   = edited   + (a = 'save' and st = 'edited')::int,
      copied   = copied   + (a = 'copy' or (a = 'save' and st = 'copied'))::int,
      ok       = ok       + (a = 'ok')::int,
      restored = restored + (a = 'restore')::int
    where id = sid;
  end loop;
end $$;

create or replace function public.usage_summary(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; since timestamptz := date_trunc('day', now()) - make_interval(days => greatest(p_days,1) - 1);
begin
  if not public.is_admin() then raise exception '관리자만 볼 수 있습니다'; end if;
  select jsonb_build_object(
    'totals', (select jsonb_build_object(
        'sessions', count(*), 'browsers', count(distinct anon_id),
        'anon_sessions', count(*) filter (where user_id is null), 'member_sessions', count(*) filter (where user_id is not null),
        'anon_browsers', count(distinct anon_id) filter (where user_id is null),
        'viewed', coalesce(sum(viewed),0), 'saved', coalesce(sum(saved),0), 'auto', coalesce(sum(auto),0),
        'edited', coalesce(sum(edited),0), 'copied', coalesce(sum(copied),0), 'ok', coalesce(sum(ok),0))
      from usage_sessions where last_at >= since),
    'daily', (select coalesce(jsonb_agg(x order by x->>'day'), '[]') from (
        select jsonb_build_object('day', to_char(d, 'YYYY-MM-DD'),
          'anon', (select count(*) from usage_sessions s where s.user_id is null and s.started_at >= d and s.started_at < d + interval '1 day'),
          'member', (select count(*) from usage_sessions s where s.user_id is not null and s.started_at >= d and s.started_at < d + interval '1 day'),
          'saved', (select count(*) from usage_events e where e.action in ('save','copy') and e.at >= d and e.at < d + interval '1 day'),
          'edited', (select count(*) from usage_events e where e.action = 'save' and e.status = 'edited' and e.at >= d and e.at < d + interval '1 day')) x
        from generate_series(since, date_trunc('day', now()), interval '1 day') d) y),
    'folders', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('folder', coalesce(hp_folder, orig_folder, '(이름 없음)'), 'sessions', count(*), 'browsers', count(distinct anon_id),
          'files', max(file_count), 'viewed', sum(viewed), 'saved', sum(saved), 'edited', sum(edited), 'last_at', max(last_at)) x
        from usage_sessions where last_at >= since group by coalesce(hp_folder, orig_folder, '(이름 없음)') order by max(last_at) desc limit 50) z),
    'sessions', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('id', s.id, 'anon_id', s.anon_id, 'who', public.who(s.user_id), 'mode', s.mode,
          'orig_folder', s.orig_folder, 'hp_folder', s.hp_folder, 'project', (select name from projects where id = s.project_id),
          'file_count', s.file_count, 'viewed', s.viewed, 'saved', s.saved, 'auto', s.auto, 'edited', s.edited,
          'copied', s.copied, 'ok', s.ok, 'restored', s.restored, 'ua', s.ua, 'started_at', s.started_at, 'last_at', s.last_at) x
        from usage_sessions s where s.last_at >= since order by s.last_at desc limit 300) z)
  ) into res;
  return res;
end $$;

-- ---------------------------------------------------------------- 실행 권한
revoke all on function public.usage_track(jsonb) from public;
grant execute on function public.usage_track(jsonb) to anon, authenticated;
grant execute on function public.claim_file(bigint), public.release_file(bigint),
  public.file_saved(bigint, text, text, bigint, boolean, text, jsonb), public.set_file_status(bigint, text, text),
  public.save_draft(bigint, jsonb, text), public.set_qc(bigint, text), public.add_files(uuid, jsonb),
  public.assign_even(uuid, uuid[], boolean, boolean), public.project_dashboard(uuid), public.usage_summary(int),
  public.is_admin(), public.is_member() to authenticated;
revoke execute on function public._file_for_me(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- 파일 저장소 (비공개)
insert into storage.buckets (id, name, public) values ('scans', 'scans', false) on conflict (id) do nothing;

-- 경로: {묶음ID}/orig/파일명 · {묶음ID}/hp/파일명 · {묶음ID}/backup/파일명
drop policy if exists scans_read on storage.objects;
create policy scans_read on storage.objects for select to authenticated using (
  bucket_id = 'scans' and (public.is_admin() or exists (
    select 1 from public.files f where f.project_id::text = (storage.foldername(objects.name))[1]
      and (f.assignee is null or f.assignee = auth.uid())) and public.is_member()));

drop policy if exists scans_insert on storage.objects;
create policy scans_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'scans' and (public.is_admin() or (
    (storage.foldername(objects.name))[2] in ('hp','backup') and exists (
      select 1 from public.files f where f.project_id::text = (storage.foldername(objects.name))[1]
        and f.locked_by = auth.uid() and storage.filename(objects.name) in (f.hp_name, f.orig_name)))));

drop policy if exists scans_update on storage.objects;
create policy scans_update on storage.objects for update to authenticated using (
  bucket_id = 'scans' and (public.is_admin() or (
    (storage.foldername(objects.name))[2] in ('hp','backup') and exists (
      select 1 from public.files f where f.project_id::text = (storage.foldername(objects.name))[1]
        and f.locked_by = auth.uid() and storage.filename(objects.name) in (f.hp_name, f.orig_name)))));

drop policy if exists scans_delete on storage.objects;
create policy scans_delete on storage.objects for delete to authenticated using (bucket_id = 'scans' and public.is_admin());
