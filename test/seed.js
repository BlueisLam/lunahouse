'use strict';
/** Dữ liệu mẫu để xem giao diện (chỉ dùng trong dev-server, không đụng Supabase thật). */
module.exports = async function seed(fake) {
  const ins = async (t, row) => (await fake.from(t).insert(row).select().single()).data;
  const ago = (d, h = 0) => new Date(Date.now() - d * 86400e3 - h * 3600e3).toISOString();
  const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

  const jobs = {};
  jobs.java = await ins('lh_jobs', { slug: 'senior-java-developer', title: 'Senior Java Developer', level: 'Senior', job_type: 'Full-time', salary_text: '45 – 70 triệu', location: 'Hồ Chí Minh', status: 'open', min_years: 5,
    summary: 'Tham gia đội phát triển hệ thống core cho một ngân hàng số, nơi mỗi quyết định kỹ thuật ảnh hưởng trực tiếp đến hàng triệu giao dịch mỗi ngày.',
    responsibilities: 'Thiết kế và phát triển các microservice xử lý giao dịch\nReview code, kèm cặp các bạn Mid và Junior\nCùng BA và QA làm rõ yêu cầu trước khi bắt đầu sprint\nTối ưu hiệu năng và độ ổn định của các luồng thanh toán',
    requirements: 'Từ 5 năm kinh nghiệm Java, thành thạo Spring Boot\nHiểu sâu về transaction, concurrency và thiết kế API\nĐã làm việc với PostgreSQL hoặc Oracle trong hệ thống lớn\nĐọc hiểu tài liệu tiếng Anh tốt',
    benefits: 'Bảo hiểm sức khoẻ cao cấp cho bản thân và người thân\nThưởng dự án và thưởng tháng 13\nNgân sách đào tạo và chứng chỉ hằng năm',
    must_have_tech: ['Java', 'Spring Boot', 'PostgreSQL'], nice_to_have_tech: ['Kafka', 'Kubernetes', 'AWS'], domains: ['Banking', 'Fintech'] });
  jobs.qa = await ins('lh_jobs', { slug: 'automation-qa-engineer', title: 'Automation QA Engineer', level: 'Mid', job_type: 'Full-time', salary_text: '25 – 40 triệu', location: 'Hà Nội', status: 'open', min_years: 3,
    summary: 'Xây dựng và duy trì bộ kiểm thử tự động cho sản phẩm tài chính, từ API đến giao diện web.',
    responsibilities: 'Viết và bảo trì test tự động bằng Playwright\nPhối hợp với dev để bắt lỗi sớm trong pipeline CI\nLập kế hoạch test cho từng release',
    requirements: 'Từ 3 năm kinh nghiệm QA, tối thiểu 1 năm làm automation\nBiết Playwright hoặc Cypress, Postman\nTư duy kiểm thử tốt, cẩn thận',
    must_have_tech: ['Playwright', 'Postman', 'JavaScript'], nice_to_have_tech: ['Jenkins', 'k6'], domains: ['Fintech'] });
  jobs.ba = await ins('lh_jobs', { slug: 'business-analyst', title: 'Business Analyst (Banking)', level: 'Mid', job_type: 'Full-time', salary_text: 'Thoả thuận', location: 'Remote', status: 'open', min_years: 2,
    summary: 'Làm cầu nối giữa nghiệp vụ ngân hàng và đội kỹ thuật.', responsibilities: 'Phân tích và viết tài liệu yêu cầu\nChạy workshop với khách hàng', requirements: 'Từ 2 năm kinh nghiệm BA\nHiểu nghiệp vụ ngân hàng là lợi thế',
    must_have_tech: ['Jira', 'Confluence'], nice_to_have_tech: ['SQL'], domains: ['Banking'] });
  jobs.draft = await ins('lh_jobs', { slug: 'devops-engineer', title: 'DevOps Engineer', level: 'Senior', status: 'draft', min_years: 4, must_have_tech: ['Kubernetes', 'AWS', 'Terraform'], nice_to_have_tech: ['ArgoCD'], domains: [] });

  const people = [
    ['Nguyễn Văn An', 'an.nguyen@example.com', '0912345678', 'Hà Nội', 6, ['Java', 'Spring Boot', 'PostgreSQL', 'Kafka', 'Docker', 'AWS'], ['Banking', 'E-commerce'], ['Backend Developer', 'Tech Lead'], 'Backend Java 6 năm, mạnh mảng Banking và microservice', true],
    ['Lê Văn Cường', 'cuong.le@example.com', '0977000111', 'Hồ Chí Minh', 8, ['Java', 'Spring Boot', 'Oracle', 'Kafka', 'Kubernetes'], ['Banking', 'Fintech'], ['Senior Backend Developer'], 'Senior Java 8 năm, đã dẫn đội 5 người ở dự án thanh toán', true],
    ['Trần Thị Bích', 'bich.tran@example.com', '0933444555', 'Hồ Chí Minh', 3, ['Java', 'Spring Boot', 'MySQL', 'Redis'], ['E-commerce'], ['Java Developer'], 'Java Mid 3 năm, làm nhiều về e-commerce', true],
    ['Phạm Quốc Dũng', 'dung.pham@example.com', '0988111222', 'Đà Nẵng', 5, ['Playwright', 'Postman', 'JavaScript', 'Jenkins', 'SQL'], ['Fintech', 'Banking'], ['Automation QA'], 'Automation QA 5 năm với Playwright, quen CI/CD', true],
    ['Hoàng Minh Thư', 'thu.hoang@example.com', '0905666777', 'Hồ Chí Minh', 4, ['Cypress', 'Postman', 'JavaScript', 'TypeScript'], ['E-commerce'], ['QA Engineer'], 'QA 4 năm, chuyển dần sang automation', true],
    ['Vũ Đức Huy', 'huy.vu@example.com', '0944888999', 'Hà Nội', 7, ['React', 'TypeScript', 'Node.js', 'GraphQL', 'AWS'], ['SaaS'], ['Frontend Lead'], 'Frontend Lead 7 năm, React và TypeScript', false],
    ['Đặng Thu Hà', 'ha.dang@example.com', '0966123123', 'Hồ Chí Minh', 5, ['Jira', 'Confluence', 'SQL', 'Figma'], ['Banking', 'Insurance'], ['Business Analyst'], 'BA 5 năm mảng ngân hàng, viết SRS và chạy UAT', true],
    ['Bùi Anh Tuấn', 'tuan.bui@example.com', '0911222333', 'Cần Thơ', 2, ['PHP', 'Laravel', 'MySQL'], ['E-commerce'], ['PHP Developer'], 'PHP Junior 2 năm', true],
    ['Ngô Thanh Sơn', 'son.ngo@example.com', '0922333444', 'Hà Nội', 9, ['Java', 'Spring Boot', 'PostgreSQL', 'Kafka', 'AWS', 'Terraform', 'Kubernetes'], ['Banking', 'Telecom'], ['Solution Architect', 'Tech Lead'], 'Architect 9 năm, backend Java và hạ tầng cloud', true],
    ['Lý Hải Yến', 'yen.ly@example.com', '0955777888', 'Hồ Chí Minh', 6, ['Python', 'Django', 'PostgreSQL', 'Docker'], ['Healthcare'], ['Backend Developer'], 'Python backend 6 năm, healthcare', true],
    ['Mai Văn Long', 'long.mai@example.com', '0933999000', 'Hồ Chí Minh', 4, ['Kubernetes', 'AWS', 'Terraform', 'Jenkins', 'Linux'], ['Fintech'], ['DevOps Engineer'], 'DevOps 4 năm trên AWS', true],
    ['Đỗ Phương Linh', 'linh.do@example.com', '0900100200', 'Hải Phòng', 1, ['HTML', 'CSS', 'JavaScript'], [], ['Fresher Frontend'], 'Fresher frontend', true],
  ];
  const cands = [];
  for (let i = 0; i < people.length; i++) {
    const [full_name, email, phone_number, address, yrs, technologies, project_domains, positions, headline, open] = people[i];
    cands.push(await ins('lh_candidates', { full_name, email, phone_number, address, total_years_experience: yrs, technologies, project_domains, positions, headline, is_open_to_work: open, parse_status: 'done',
      cv_path: `seed/${i}.pdf`, cv_filename: `CV_${full_name.replace(/\s+/g, '_')}.pdf`, english_level: i % 3 === 0 ? 'IELTS 6.5' : i % 3 === 1 ? 'TOEIC 800' : '', expected_salary: `${25 + i * 3} triệu`,
      cv_text: `${full_name}\n${headline}\nKỹ năng: ${technologies.join(', ')}`, created_at: ago(i * 2, i), cv_upload_date: ago(i * 2, i) }));
  }
  // Một hồ sơ đang được AI đọc + một hồ sơ nghi trùng
  await ins('lh_candidates', { full_name: '(đang phân tích) CV_NguyenVanE.pdf', source: 'admin', parse_status: 'pending', cv_path: 'seed/p.pdf', cv_filename: 'CV_NguyenVanE.pdf' });
  await ins('lh_candidates', { full_name: 'Nguyen Van An', email: 'an.nguyen@example.com', phone_number: '0912345678', source: 'admin', parse_status: 'done', dup_of: cands[0].id, technologies: ['Java', 'Redis'], positions: ['Tech Lead'], cv_filename: 'CV_An_v2.pdf', cv_path: 'seed/dup.pdf' });

  const mkApp = async (job, cand, status, extra = {}, created = 1) => {
    const code = 'LH-' + Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[01OIL]/g, 'X');
    const a = await ins('lh_applications', { code, job_id: job ? job.id : null, candidate_id: cand.id, status, created_at: ago(created), updated_at: ago(Math.max(0, created - 1)), ...extra });
    await ins('lh_activities', { application_id: a.id, type: 'status', note: 'Ứng viên nộp hồ sơ', meta: { from: '', to: 'new' }, created_at: ago(created) });
    return a;
  };
  const a1 = await mkApp(jobs.java, cands[0], 'interview1', { public_note: 'Lịch phỏng vấn: 14h thứ Năm tại văn phòng khách hàng.', match_score: 86, next_action: 'Nhắc lịch phỏng vấn', next_action_date: day(1) }, 5);
  await ins('lh_activities', { application_id: a1.id, type: 'status', note: '', meta: { from: 'new', to: 'screening' }, created_at: ago(4) });
  await ins('lh_activities', { application_id: a1.id, type: 'status', note: '', meta: { from: 'screening', to: 'submitted' }, created_at: ago(3) });
  await ins('lh_activities', { application_id: a1.id, type: 'status', note: '', meta: { from: 'submitted', to: 'interview1' }, created_at: ago(1) });
  await ins('lh_activities', { application_id: a1.id, type: 'note', note: 'Ứng viên muốn offer tối thiểu 55 triệu.', created_at: ago(1, 3) });
  await mkApp(jobs.java, cands[1], 'submitted', { match_score: 91, match_reason: 'Mạnh Java và Banking', next_action: 'Hỏi khách về feedback CV', next_action_date: day(-1) }, 4);
  await mkApp(jobs.java, cands[8], 'screening', { match_score: 88, next_action: 'Gọi xác nhận mức lương', next_action_date: day(2) }, 3);
  await mkApp(jobs.java, cands[2], 'new', {}, 0);
  await mkApp(jobs.qa, cands[3], 'interview2', { match_score: 84, next_action: 'Chốt lịch vòng 2', next_action_date: day(3) }, 9);
  const rj = await mkApp(jobs.qa, cands[4], 'rejected', { match_score: 60, public_note: 'Cảm ơn bạn đã dành thời gian phỏng vấn. Phần kiểm thử API của bạn rất tốt, nhưng team đang cần người có kinh nghiệm automation sâu hơn với Playwright. Mình sẽ giữ hồ sơ để liên hệ khi có vị trí hợp hơn.' }, 12);
  for (const [f, t, d] of [['new', 'screening', 11], ['screening', 'submitted', 10], ['submitted', 'interview1', 8], ['interview1', 'rejected', 6]]) await ins('lh_activities', { application_id: rj.id, type: 'status', note: '', meta: { from: f, to: t }, created_at: ago(d) });
  await mkApp(jobs.ba, cands[6], 'offer', { match_score: 79, next_action: 'Theo dõi phản hồi offer', next_action_date: day(5) }, 14);
  await mkApp(null, cands[9], 'new', {}, 0);
  await mkApp(jobs.java, cands[5], 'withdrawn', {}, 8);
  // Hỏi đáp mẫu: 1 thread công khai (đã trả lời), 1 thread riêng tư chưa đọc
  const tk = () => require('crypto').randomBytes(18).toString('hex');
  const t1 = await ins('lh_threads', { job_id: jobs.java.id, token: tk(), author_name: 'Đỗ Minh Quân', author_email: 'quan.do@example.com', is_public: true, unread_admin: false, last_from: 'recruiter', created_at: ago(3), updated_at: ago(2) });
  await ins('lh_messages', { thread_id: t1.id, sender: 'candidate', body: 'Vị trí này có được làm remote một vài ngày trong tuần không ạ?', created_at: ago(3) });
  await ins('lh_messages', { thread_id: t1.id, sender: 'recruiter', body: 'Chào bạn, team làm hybrid: 3 ngày tại văn phòng, 2 ngày remote. Bạn cần thêm thông tin gì cứ hỏi mình nhé.', created_at: ago(2) });
  const t2 = await ins('lh_threads', { job_id: jobs.qa.id, token: tk(), author_name: 'Vũ Thanh Hà', author_email: 'ha.vu@example.com', is_public: false, unread_admin: true, last_from: 'candidate', created_at: ago(0, 2), updated_at: ago(0, 2) });
  await ins('lh_messages', { thread_id: t2.id, sender: 'candidate', body: 'Em mới có 2 năm kinh nghiệm automation, em có nên ứng tuyển vị trí này không ạ?', created_at: ago(0, 2) });
  return { jobs, cands };
};
