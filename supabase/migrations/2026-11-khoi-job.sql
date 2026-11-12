-- Chạy MỘT LẦN trong Supabase → SQL Editor. Thêm "khối" cho job: project (Khối dự án) hoặc backoffice (Back office). Chạy lại không sao.
alter table lh_jobs add column if not exists division text not null default 'project' check (division in ('project', 'backoffice'));

-- Gán sẵn Back office cho các job cũ có tên thuộc nhóm HR / C&B / Compliance / Admin / Kế toán... (bạn sửa lại được trong form job).
update lh_jobs set division = 'backoffice'
where division = 'project'
  and title ~* '(^|[^a-z0-9])(hr|hrbp|hrop|hrm|c&b|compliance|office|accountant|accounting|kế toán|finance|tài chính|legal|pháp chế|marketing|recruiter|talent|tuyển dụng|nhân sự|procurement|purchasing|internal control|l&d|payroll|general affairs|secretary|thư ký)([^a-z0-9]|$)';
