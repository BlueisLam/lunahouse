-- Chạy MỘT LẦN trong Supabase → SQL Editor. Thêm mức ưu tiên cho job (thường / cao / gấp). Chạy lại không sao.
alter table lh_jobs add column if not exists priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent'));
create index if not exists lh_jobs_prio on lh_jobs (recruiter_id, priority);
