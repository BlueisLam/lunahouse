-- ============================================================
-- Lunahouse — schema Supabase
-- Chạy toàn bộ file này trong Supabase › SQL Editor › New query › Run
-- Tất cả bảng có tiền tố lh_ nên dùng chung project với LunaTicket / Luna Cosmetics không bị đụng tên.
-- ============================================================

create extension if not exists pgcrypto;

create or replace function lh_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------- JOBS ----------
create table if not exists lh_jobs (
  id                 uuid primary key default gen_random_uuid(),
  slug               text unique not null,
  title              text not null,
  level              text default '',                 -- Junior / Mid / Senior / Lead
  job_type           text default 'Full-time',
  salary_text        text default '',                 -- "Thoả thuận", "25–40 triệu"...
  location           text default '',                 -- "Hồ Chí Minh", "Hà Nội", "Remote"...
  summary            text default '',
  responsibilities   text default '',                 -- mỗi dòng một ý
  requirements       text default '',
  benefits           text default '',
  must_have_tech     text[] default '{}',
  nice_to_have_tech  text[] default '{}',
  domains            text[] default '{}',
  min_years          numeric default 0,
  status             text not null default 'draft' check (status in ('draft','open','paused','closed')),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create trigger lh_jobs_updated before update on lh_jobs
  for each row execute function lh_set_updated_at();

-- ---------- CANDIDATES (kho CV) ----------
create table if not exists lh_candidates (
  id                        uuid primary key default gen_random_uuid(),
  full_name                 text not null default '',
  date_of_birth             text default '',
  address                   text default '',
  phone_number              text default '',
  email                     text default '',
  gender                    text default 'Male',
  positions                 text[] default '{}',
  english_level             text default '',
  total_years_experience    numeric default 0,
  years_experience_by_role  jsonb default '{}'::jsonb,
  project_domains           text[] default '{}',
  technologies              text[] default '{}',
  cv_upload_date            timestamptz default now(),
  is_open_to_work           boolean default true,
  job_type_preference       text default '',
  expected_salary           text default '',
  notice_period             text default '',
  headline                  text default '',
  notes                     text default '',
  links                     text default '',
  cv_path                   text default '',
  cv_filename               text default '',
  cv_text                   text default '',
  source                    text default 'apply',      -- apply | admin
  parse_status              text default 'none',       -- none | pending | done | failed
  parse_error               text default '',
  dup_of                    uuid,
  email_norm                text generated always as (lower(trim(email))) stored,
  phone_norm                text generated always as (right(regexp_replace(coalesce(phone_number,''), '\D', '', 'g'), 9)) stored,
  created_at                timestamptz default now(),
  updated_at                timestamptz default now()
);
create index if not exists lh_cand_email on lh_candidates (email_norm);
create index if not exists lh_cand_phone on lh_candidates (phone_norm);
create index if not exists lh_cand_tech  on lh_candidates using gin (technologies);
create trigger lh_cand_updated before update on lh_candidates
  for each row execute function lh_set_updated_at();

-- ---------- APPLICATIONS (một ứng viên ↔ một job) ----------
create table if not exists lh_applications (
  id                uuid primary key default gen_random_uuid(),
  code              text unique not null,               -- mã tra cứu, ví dụ LH-7K3Q9X
  job_id            uuid references lh_jobs(id) on delete set null,   -- null = gửi CV vào kho
  candidate_id      uuid not null references lh_candidates(id) on delete cascade,
  status            text not null default 'new',
  public_note       text default '',                    -- ứng viên nhìn thấy khi tra cứu
  internal_note     text default '',                    -- chỉ admin
  cover_note        text default '',                    -- lời nhắn của ứng viên
  match_score       int,
  match_reason      text default '',
  next_action       text default '',
  next_action_date  date,
  ip_hash           text default '',
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create unique index if not exists lh_app_job_cand on lh_applications (job_id, candidate_id) where job_id is not null;
create index if not exists lh_app_cand   on lh_applications (candidate_id);
create index if not exists lh_app_status on lh_applications (status);
create index if not exists lh_app_ip     on lh_applications (ip_hash, created_at);
create trigger lh_app_updated before update on lh_applications
  for each row execute function lh_set_updated_at();

-- ---------- ACTIVITIES (nhật ký) ----------
create table if not exists lh_activities (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references lh_applications(id) on delete cascade,
  type            text not null default 'note',         -- status | note | system
  note            text default '',
  meta            jsonb default '{}'::jsonb,            -- {from,to} khi type = status
  created_at      timestamptz default now()
);
create index if not exists lh_act_app on lh_activities (application_id, created_at);

-- ---------- HỎI ĐÁP DƯỚI JOB (thread riêng tư, admin chọn đăng công khai) ----------
create table if not exists lh_threads (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references lh_jobs(id) on delete cascade,
  token         text not null unique,                  -- link riêng để ứng viên xem hội thoại của mình
  author_name   text not null,
  author_email  text not null,
  is_public     boolean not null default false,        -- chỉ admin bật mới hiện dưới job
  unread_admin  boolean not null default true,         -- có tin ứng viên mà admin chưa đọc
  last_from     text not null default 'candidate',     -- candidate | recruiter
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists lh_thr_job    on lh_threads (job_id, is_public);
create index if not exists lh_thr_update on lh_threads (updated_at desc);
drop trigger if exists lh_thr_updated on lh_threads;
create trigger lh_thr_updated before update on lh_threads
  for each row execute function lh_set_updated_at();

create table if not exists lh_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references lh_threads(id) on delete cascade,
  sender      text not null,                           -- candidate | recruiter
  body        text not null,
  ip_hash     text default '',
  created_at  timestamptz default now()
);
create index if not exists lh_msg_thread on lh_messages (thread_id, created_at);
create index if not exists lh_msg_ip     on lh_messages (ip_hash, created_at);

-- ---------- BẢO MẬT ----------
-- Bật RLS và KHÔNG tạo policy nào: trình duyệt (anon key) không đọc/ghi được gì.
-- Chỉ Netlify Functions dùng service_role key mới truy cập được.
alter table lh_jobs         enable row level security;
alter table lh_candidates   enable row level security;
alter table lh_applications enable row level security;
alter table lh_activities   enable row level security;
alter table lh_threads      enable row level security;
alter table lh_messages     enable row level security;

-- Bucket lưu CV: private. File chỉ mở được qua link tạm do admin tạo.
insert into storage.buckets (id, name, public)
values ('lh-cv', 'lh-cv', false)
on conflict (id) do nothing;

-- Nếu bạn đã chạy schema trước đây (chưa có cột location), chạy thêm dòng này:
alter table lh_jobs add column if not exists location text default '';
update storage.buckets set id = id where id = 'lh-cv';
