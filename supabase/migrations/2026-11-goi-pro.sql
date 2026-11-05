-- Chạy MỘT LẦN (sau 2026-11-nhieu-recruiter.sql) để bật gói Free / Pro. Chỉ thêm cột, chạy lại không sao.
-- Môi trường dev: thay lh_ bằng lhdev_.
alter table lh_recruiters add column if not exists plan_until timestamptz;            -- còn hạn Pro tới lúc này (trống = Free)
alter table lh_recruiters add column if not exists ai_month   text    not null default '';   -- tháng đang đếm lượt AI, dạng 2026-11
alter table lh_recruiters add column if not exists ai_count   integer not null default 0;
alter table lh_recruiters add column if not exists logo_url   text    not null default '';   -- Pro: logo trang riêng
alter table lh_recruiters add column if not exists cover_url  text    not null default '';   -- Pro: ảnh bìa trang riêng
