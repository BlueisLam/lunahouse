-- Chạy MỘT LẦN trong Supabase → SQL Editor. Tạo bảng báo lỗi / góp ý của recruiter gửi cho admin. Chạy lại không sao.
create table if not exists lh_reports (
  id           uuid primary key default gen_random_uuid(),
  recruiter_id uuid references lh_recruiters(id) on delete cascade,
  kind         text not null default 'bug' check (kind in ('bug', 'idea', 'abuse', 'other')),
  message      text not null,
  page         text not null default '',
  status       text not null default 'new' check (status in ('new', 'done')),
  created_at   timestamptz default now()
);
create index if not exists lh_rep_rec on lh_reports (recruiter_id, created_at desc);
create index if not exists lh_rep_st  on lh_reports (status, created_at desc);
alter table lh_reports enable row level security;
