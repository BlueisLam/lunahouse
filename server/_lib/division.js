'use strict';
/** Khối của job: "project" (khối dự án) hoặc "backoffice" (Back office). */
const DIVISIONS = ['project', 'backoffice'];

const BACK = /\b(hr|hrbp|hrop|hrm|c&b|compliance|office|accountant|accounting|ke toan|finance|tai chinh|legal|phap che|marketing|recruiter|talent|tuyen dung|nhan su|procurement|purchasing|internal control|l&d|payroll|general affairs|secretary|thu ky|executive assistant|admin|administrator)\b/;
const TECH_ADMIN = /\b(system|network|database|server|cloud|devops|linux|windows)\s+(admin|administrator)\b/;

const plain = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

/** Khi job chưa gán khối: đoán theo tên vị trí (HR, C&B, Compliance, Admin, Kế toán… là Back office). */
function inferDivision(title) {
  const t = plain(title);
  if (TECH_ADMIN.test(t)) return 'project';
  return BACK.test(t) ? 'backoffice' : 'project';
}

module.exports = { DIVISIONS, inferDivision };
