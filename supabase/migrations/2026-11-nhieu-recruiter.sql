-- Chạy MỘT LẦN trong Supabase → SQL Editor để bật chế độ nhiều recruiter.
-- BACKUP trước (Table Editor → Export CSV, hoặc Database → Backups). Chỉ THÊM bảng/cột, không xoá dữ liệu cũ.
-- Chạy lại nhiều lần cũng không sao. Dữ liệu cũ (recruiter_id trống) sẽ tự được gán cho tài khoản chủ
-- (ADMIN_EMAIL) ngay lần đăng nhập hoặc lần mở trang chủ đầu tiên sau khi deploy.

create table if not exists lh_recruiters (
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
  last_login_at timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create unique index if not exists lh_rec_email  on lh_recruiters (email_norm);
create unique index if not exists lh_rec_handle on lh_recruiters (lower(handle));
alter table lh_recruiters enable row level security;
drop trigger if exists lh_rec_updated on lh_recruiters;
create trigger lh_rec_updated before update on lh_recruiters
  for each row execute function lh_set_updated_at();

alter table lh_jobs         add column if not exists recruiter_id uuid references lh_recruiters(id) on delete cascade;
alter table lh_candidates   add column if not exists recruiter_id uuid references lh_recruiters(id) on delete cascade;
alter table lh_applications add column if not exists recruiter_id uuid references lh_recruiters(id) on delete cascade;
alter table lh_activities   add column if not exists recruiter_id uuid references lh_recruiters(id) on delete cascade;
alter table lh_threads      add column if not exists recruiter_id uuid references lh_recruiters(id) on delete cascade;

create index if not exists lh_jobs_rec  on lh_jobs (recruiter_id, status);
create index if not exists lh_cand_rec  on lh_candidates (recruiter_id, created_at desc);
create index if not exists lh_app_rec   on lh_applications (recruiter_id, updated_at desc);
create index if not exists lh_act_rec   on lh_activities (recruiter_id, created_at);
create index if not exists lh_thr_rec   on lh_threads (recruiter_id, updated_at desc);
