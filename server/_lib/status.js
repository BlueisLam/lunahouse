'use strict';
/**
 * Nguồn sự thật duy nhất cho các trạng thái application.
 * label  = tên nội bộ (admin thấy)
 * pub    = tên hiển thị cho ứng viên khi tra cứu
 * hint   = câu giải thích cho ứng viên
 */
const STAGES = [
  { key: 'new',        label: 'Mới',            pub: 'Đã nhận hồ sơ',
    hint: 'Mình đã nhận được hồ sơ của bạn và sẽ xem trong vòng 1–3 ngày làm việc.' },
  { key: 'screening',  label: 'Đã screening',   pub: 'Đang xem xét',
    hint: 'Hồ sơ đang được đối chiếu với yêu cầu của vị trí. Mình sẽ liên hệ nếu cần trao đổi thêm.' },
  { key: 'submitted',  label: 'Đã gửi khách',   pub: 'Hồ sơ đã được giới thiệu',
    hint: 'Hồ sơ của bạn đã được gửi tới bên tuyển dụng. Mình sẽ báo ngay khi có phản hồi.' },
  { key: 'interview1', label: 'Phỏng vấn 1',    pub: 'Vòng phỏng vấn 1',
    hint: 'Bạn đã vào vòng phỏng vấn 1. Mình sẽ liên hệ để chốt lịch (online hoặc offline) và hướng dẫn chuẩn bị.' },
  { key: 'interview2', label: 'Phỏng vấn 2',    pub: 'Vòng phỏng vấn 2',
    hint: 'Chúc mừng, bạn đã vào vòng phỏng vấn 2. Mình sẽ liên hệ để chốt lịch (online hoặc offline).' },
  { key: 'offer',      label: 'Offer',          pub: 'Đã có offer',
    hint: 'Bên tuyển dụng đã gửi offer cho bạn. Mình sẽ trao đổi chi tiết qua điện thoại.' },
  { key: 'hired',      label: 'Nhận việc',      pub: 'Đã nhận việc',
    hint: 'Chúc mừng bạn đã nhận việc. Cảm ơn bạn đã tin tưởng mình.' },
  { key: 'rejected',   label: 'Từ chối',        pub: 'Chưa phù hợp lần này',
    hint: 'Rất tiếc hồ sơ chưa phù hợp với vị trí này. Mình sẽ giữ hồ sơ trong kho để liên hệ khi có vị trí khác hợp hơn.' },
  { key: 'withdrawn',  label: 'Ứng viên rút',   pub: 'Đã rút hồ sơ',
    hint: 'Hồ sơ đã được rút khỏi vị trí này theo yêu cầu của bạn.' },
];

const FLOW = ['new', 'screening', 'submitted', 'interview1', 'interview2', 'offer', 'hired'];
const TERMINAL = ['hired', 'rejected', 'withdrawn'];
const BY_KEY = Object.fromEntries(STAGES.map(s => [s.key, s]));
const isStatus = k => Object.prototype.hasOwnProperty.call(BY_KEY, k);

module.exports = { STAGES, FLOW, TERMINAL, BY_KEY, isStatus };
