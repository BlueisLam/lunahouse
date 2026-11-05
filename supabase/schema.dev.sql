-- Tự sinh từ schema.sql bằng `npm run schema:dev`. KHÔNG sửa tay.
-- ============================================================
-- Lunahouse — schema Supabase
-- Chạy toàn bộ file này trong Supabase › SQL Editor › New query › Run
-- Tất cả bảng có tiền tố lhdev_ nên dùng chung project với LunaTicket / Luna Cosmetics không bị đụng tên.
-- ============================================================

create extension if not exists pgcrypto;

create or replace function lhdev_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------- RECRUITERS (mỗi người một tài khoản, dữ liệu tách riêng) ----------
create table if not exists lhdev_recruiters (
  id            uuid primary key default gen_random_uuid(),
  auth_id       uuid unique,                                   -- id người dùng bên Supabase Auth (trống với tài khoản chủ đăng nhập bằng ADMIN_PASSWORD)
  email         text not null,
  email_norm    text generated always as (lower(trim(email))) stored,
  handle        text not null,                                 -- đường dẫn công khai: lunahouse.click/<handle>
  display_name  text not null default '',                      -- tên gọi: "Lam"
  title         text not null default '',                      -- "Talent Acquisition"
  bio           text not null default '',
  contact_email text not null default '',
  zalo          text not null default '',
  facebook      text not null default '',
  linkedin      text not null default '',
  telegram      text not null default '',
  communities   jsonb not null default '[]'::jsonb,
  role          text not null default 'recruiter' check (role in ('admin', 'recruiter')),
  status        text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  telegram_chat_id text not null default '',                   -- nhận thông báo hồ sơ mới qua bot Luna
  notify_email  text not null default '',                      -- trống = dùng email đăng nhập
  ip_hash       text not null default '',
  plan_until    timestamptz,                                   -- còn hạn Pro tới lúc này (trống = Free)
  ai_month      text not null default '',
  ai_count      integer not null default 0,
  logo_url      text not null default '',
  cover_url     text not null default '',
  last_login_at timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create unique index if not exists lhdev_rec_email  on lhdev_recruiters (email_norm);
create unique index if not exists lhdev_rec_handle on lhdev_recruiters (lower(handle));
alter table lhdev_recruiters enable row level security;
drop trigger if exists lhdev_rec_updated on lhdev_recruiters;
create trigger lhdev_rec_updated before update on lhdev_recruiters
  for each row execute function lhdev_set_updated_at();

-- ---------- JOBS ----------
create table if not exists lhdev_jobs (
  id                 uuid primary key default gen_random_uuid(),
  slug               text unique not null,
  title              text not null,
  level              text default '',                 -- Junior / Mid / Senior / Lead
  job_type           text default 'Full-time',
  salary_text        text default '',                 -- "Thoả thuận", "25–40 triệu"...
  location           text default '',                 -- "Hồ Chí Minh", "Hà Nội", "Remote"...
  lang               text not null default 'vi',      -- ngôn ngữ hiển thị JD: vi | en
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
create trigger lhdev_jobs_updated before update on lhdev_jobs
  for each row execute function lhdev_set_updated_at();

-- ---------- CANDIDATES (kho CV) ----------
create table if not exists lhdev_candidates (
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
create index if not exists lhdev_cand_email on lhdev_candidates (email_norm);
create index if not exists lhdev_cand_phone on lhdev_candidates (phone_norm);
create index if not exists lhdev_cand_tech  on lhdev_candidates using gin (technologies);
create trigger lhdev_cand_updated before update on lhdev_candidates
  for each row execute function lhdev_set_updated_at();

-- ---------- APPLICATIONS (một ứng viên ↔ một job) ----------
create table if not exists lhdev_applications (
  id                uuid primary key default gen_random_uuid(),
  code              text unique not null,               -- mã tra cứu, ví dụ LH-7K3Q9X
  job_id            uuid references lhdev_jobs(id) on delete set null,   -- null = gửi CV vào kho
  candidate_id      uuid not null references lhdev_candidates(id) on delete cascade,
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
create unique index if not exists lhdev_app_job_cand on lhdev_applications (job_id, candidate_id) where job_id is not null;
create index if not exists lhdev_app_cand   on lhdev_applications (candidate_id);
create index if not exists lhdev_app_status on lhdev_applications (status);
create index if not exists lhdev_app_ip     on lhdev_applications (ip_hash, created_at);
create trigger lhdev_app_updated before update on lhdev_applications
  for each row execute function lhdev_set_updated_at();

-- ---------- ACTIVITIES (nhật ký) ----------
create table if not exists lhdev_activities (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references lhdev_applications(id) on delete cascade,
  type            text not null default 'note',         -- status | note | system
  note            text default '',
  meta            jsonb default '{}'::jsonb,            -- {from,to} khi type = status
  created_at      timestamptz default now()
);
create index if not exists lhdev_act_app on lhdev_activities (application_id, created_at);

-- ---------- HỎI ĐÁP DƯỚI JOB (thread riêng tư, admin chọn đăng công khai) ----------
create table if not exists lhdev_threads (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references lhdev_jobs(id) on delete cascade,
  token         text not null unique,                  -- link riêng để ứng viên xem hội thoại của mình
  author_name   text not null,
  author_email  text not null,
  is_public     boolean not null default false,        -- chỉ admin bật mới hiện dưới job
  unread_admin  boolean not null default true,         -- có tin ứng viên mà admin chưa đọc
  last_from     text not null default 'candidate',     -- candidate | recruiter
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists lhdev_thr_job    on lhdev_threads (job_id, is_public);
create index if not exists lhdev_thr_update on lhdev_threads (updated_at desc);
drop trigger if exists lhdev_thr_updated on lhdev_threads;
create trigger lhdev_thr_updated before update on lhdev_threads
  for each row execute function lhdev_set_updated_at();

create table if not exists lhdev_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references lhdev_threads(id) on delete cascade,
  sender      text not null,                           -- candidate | recruiter
  body        text not null,
  ip_hash     text default '',
  created_at  timestamptz default now()
);
create index if not exists lhdev_msg_thread on lhdev_messages (thread_id, created_at);
create index if not exists lhdev_msg_ip     on lhdev_messages (ip_hash, created_at);

-- ---------- BẢO MẬT ----------
-- Bật RLS và KHÔNG tạo policy nào: trình duyệt (anon key) không đọc/ghi được gì.
-- Chỉ Netlify Functions dùng service_role key mới truy cập được.
alter table lhdev_jobs         enable row level security;
alter table lhdev_candidates   enable row level security;
alter table lhdev_applications enable row level security;
alter table lhdev_activities   enable row level security;
alter table lhdev_threads      enable row level security;
alter table lhdev_messages     enable row level security;

-- Bucket lưu CV: private. File chỉ mở được qua link tạm do admin tạo.
insert into storage.buckets (id, name, public)
values ('lhdev-cv', 'lhdev-cv', false)
on conflict (id) do nothing;

-- Nếu bạn đã chạy schema trước đây (chưa có cột location), chạy thêm dòng này:
alter table lhdev_jobs add column if not exists location text default '';
alter table lhdev_jobs add column if not exists lang text not null default 'vi';
update storage.buckets set id = id where id = 'lhdev-cv';

-- ---------- NHIỀU RECRUITER: cột chủ sở hữu ----------
alter table lhdev_jobs         add column if not exists recruiter_id uuid references lhdev_recruiters(id) on delete cascade;
alter table lhdev_candidates   add column if not exists recruiter_id uuid references lhdev_recruiters(id) on delete cascade;
alter table lhdev_applications add column if not exists recruiter_id uuid references lhdev_recruiters(id) on delete cascade;
alter table lhdev_activities   add column if not exists recruiter_id uuid references lhdev_recruiters(id) on delete cascade;
alter table lhdev_threads      add column if not exists recruiter_id uuid references lhdev_recruiters(id) on delete cascade;

create index if not exists lhdev_jobs_rec  on lhdev_jobs (recruiter_id, status);
create index if not exists lhdev_cand_rec  on lhdev_candidates (recruiter_id, created_at desc);
create index if not exists lhdev_app_rec   on lhdev_applications (recruiter_id, updated_at desc);
create index if not exists lhdev_act_rec   on lhdev_activities (recruiter_id, created_at);
create index if not exists lhdev_thr_rec   on lhdev_threads (recruiter_id, updated_at desc);

-- Cài đặt chung (công tắc tính phí gói Free/Pro...). Chỉ service key đọc ghi.
create table if not exists lhdev_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table lhdev_settings enable row level security;
