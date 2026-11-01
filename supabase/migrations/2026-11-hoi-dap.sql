-- Chạy MỘT LẦN trong Supabase → SQL Editor để bật tính năng hỏi đáp dưới job.
-- Chỉ thêm bảng mới, không đụng dữ liệu cũ; chạy lại nhiều lần cũng không sao.

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

alter table lh_threads  enable row level security;
alter table lh_messages enable row level security;
