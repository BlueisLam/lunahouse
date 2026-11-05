-- Chạy MỘT LẦN trong Supabase → SQL Editor. Tạo bảng cài đặt chung cho công tắc bật/tắt tính phí. Chạy lại không sao.
create table if not exists lh_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table lh_settings enable row level security;
