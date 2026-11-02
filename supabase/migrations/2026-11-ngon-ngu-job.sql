-- Chạy MỘT LẦN trong Supabase → SQL Editor: thêm ngôn ngữ hiển thị cho từng job (vi | en).
-- Job cũ mặc định là tiếng Việt. Chạy lại nhiều lần cũng không sao.
alter table lh_jobs add column if not exists lang text not null default 'vi';
