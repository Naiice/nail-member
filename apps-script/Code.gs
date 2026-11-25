/**
 * ระบบสะสมแต้ม ร้าน "เล็บเศรษฐี"
 * Google Apps Script — วางโค้ดนี้ใน Extensions > Apps Script ของ Google Sheet
 * แล้ว Deploy เป็น Web app (Execute as: Me, Who has access: Anyone)
 */

const SPREADSHEET_ID = '1nUECMivsVWKWQ7JEe9C-Zg07rttNonc0wT2KGDFVZ40';
const STAMPS_FOR_FREE = 10;
const MEMBERS_SHEET = 'Members';
const LOG_SHEET = 'Log';
const MEMBER_HEADERS = ['เบอร์โทร', 'ชื่อ', 'แต้มปัจจุบัน', 'มาใช้บริการทั้งหมด', 'ใช้สิทธิ์ฟรีไปแล้ว', 'วันที่สมัคร', 'มาล่าสุด'];
const LOG_HEADERS = ['เวลา', 'เบอร์โทร', 'ชื่อ', 'รายการ', 'แต้มหลังทำรายการ'];
const MAX_PIN_FAILS = 5;

/** รันฟังก์ชันนี้ครั้งแรกครั้งเดียว: สร้างชีต + ตั้ง PIN เริ่มต้น */
function setup() {
  getSheet_(MEMBERS_SHEET, MEMBER_HEADERS);
  getSheet_(LOG_SHEET, LOG_HEADERS);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PIN')) props.setProperty('ADMIN_PIN', '1234');
  Logger.log('ตั้งค่าเสร็จแล้ว PIN ปัจจุบัน: ' + props.getProperty('ADMIN_PIN'));
}

/** เปลี่ยน PIN: แก้ตัวเลขด้านล่าง แล้วกด Run ฟังก์ชันนี้ */
function changePin() {
  const NEW_PIN = '1234';
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', NEW_PIN);
  Logger.log('เปลี่ยน PIN เป็น ' + NEW_PIN + ' แล้ว');
}

function doGet() {
  return json_({ ok: true, message: 'Lep Setthi member API is running' });
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'รูปแบบข้อมูลไม่ถูกต้อง' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return json_(route_(body));
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) });
  } finally {
    lock.releaseLock();
  }
}

function route_(b) {
  switch (b.action) {
    case 'lookup':     return lookup_(b);
    case 'register':   return register_(b);
    case 'verifyPin':  checkPin_(b.pin); return { ok: true };
    case 'addStamp':   checkPin_(b.pin); return changePoints_(b.phone, +1);
    case 'removeStamp':checkPin_(b.pin); return changePoints_(b.phone, -1);
    case 'redeem':     checkPin_(b.pin); return redeem_(b.phone);
    default:           return { ok: false, error: 'ไม่รู้จักคำสั่ง' };
  }
}

/* ---------- actions ---------- */

function lookup_(b) {
  const phone = normPhone_(b.phone);
  const row = findRow_(phone);
  if (!row) return { ok: true, found: false };
  return { ok: true, found: true, member: toMember_(row.values) };
}

function register_(b) {
  const phone = normPhone_(b.phone);
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw new Error('กรุณากรอกชื่อ');
  const existing = findRow_(phone);
  if (existing) return { ok: true, created: false, member: toMember_(existing.values) };

  const sheet = getSheet_(MEMBERS_SHEET, MEMBER_HEADERS);
  const now = new Date();
  const values = [phone, name, 0, 0, 0, now, ''];
  sheet.appendRow(values);
  sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('@').setValue(phone);
  log_(phone, name, 'สมัครสมาชิก', 0);
  return { ok: true, created: true, member: toMember_(values) };
}

function changePoints_(phoneRaw, delta) {
  const phone = normPhone_(phoneRaw);
  const row = findRow_(phone);
  if (!row) throw new Error('ไม่พบสมาชิกเบอร์นี้');
  const v = row.values;
  let points = Number(v[2]) || 0;
  let visits = Number(v[3]) || 0;

  if (delta > 0) {
    if (points >= STAMPS_FOR_FREE) throw new Error('ครบ ' + STAMPS_FOR_FREE + ' แต้มแล้ว กรุณากด "ใช้สิทธิ์ฟรี" ก่อน');
    points += 1; visits += 1;
    v[6] = new Date();
  } else {
    if (points <= 0) throw new Error('แต้มเป็น 0 อยู่แล้ว');
    points -= 1; visits = Math.max(0, visits - 1);
  }
  v[2] = points; v[3] = visits;
  row.range.setValues([v]);
  log_(phone, v[1], delta > 0 ? 'เพิ่มแต้ม +1' : 'ลบแต้ม -1 (แก้ไข)', points);
  return { ok: true, member: toMember_(v) };
}

function redeem_(phoneRaw) {
  const phone = normPhone_(phoneRaw);
  const row = findRow_(phone);
  if (!row) throw new Error('ไม่พบสมาชิกเบอร์นี้');
  const v = row.values;
  if ((Number(v[2]) || 0) < STAMPS_FOR_FREE) throw new Error('แต้มยังไม่ครบ ' + STAMPS_FOR_FREE + ' แต้ม');
  v[2] = 0;
  v[3] = (Number(v[3]) || 0) + 1; // ครั้งที่ใช้สิทธิ์ฟรีนับเป็นการมาใช้บริการด้วย
  v[4] = (Number(v[4]) || 0) + 1;
  v[6] = new Date();
  row.range.setValues([v]);
  log_(phone, v[1], 'ใช้สิทธิ์ฟรี 1 ครั้ง', 0);
  return { ok: true, member: toMember_(v) };
}

/* ---------- helpers ---------- */

function checkPin_(pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pinFails') || 0);
  if (fails >= MAX_PIN_FAILS) throw new Error('ใส่ PIN ผิดหลายครั้ง กรุณารอ 10 นาที');
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || '1234';
  if (String(pin || '') !== real) {
    cache.put('pinFails', String(fails + 1), 600);
    throw new Error('PIN ไม่ถูกต้อง');
  }
  cache.remove('pinFails');
}

function normPhone_(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (p.length === 11 && p.indexOf('66') === 0) p = '0' + p.slice(2);
  if (!/^0\d{8,9}$/.test(p)) throw new Error('เบอร์โทรไม่ถูกต้อง');
  return p;
}

function findRow_(phone) {
  const sheet = getSheet_(MEMBERS_SHEET, MEMBER_HEADERS);
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const data = sheet.getRange(2, 1, last - 1, MEMBER_HEADERS.length).getValues();
  for (let i = 0; i < data.length; i++) {
    let cell = String(data[i][0]).replace(/\D/g, '');
    if (cell.length === 8 || cell.length === 9) cell = '0' + cell; // กรณีชีตตัดเลข 0 หน้า
    if (cell === phone) {
      data[i][0] = phone;
      return { range: sheet.getRange(i + 2, 1, 1, MEMBER_HEADERS.length), values: data[i] };
    }
  }
  return null;
}

function toMember_(v) {
  const points = Number(v[2]) || 0;
  return {
    phone: String(v[0]),
    name: String(v[1]),
    points: points,
    visits: Number(v[3]) || 0,
    freeUsed: Number(v[4]) || 0,
    target: STAMPS_FOR_FREE,
    freeReady: points >= STAMPS_FOR_FREE,
  };
}

function log_(phone, name, action, pointsAfter) {
  const sheet = getSheet_(LOG_SHEET, LOG_HEADERS);
  sheet.appendRow([new Date(), phone, name, action, pointsAfter]);
  sheet.getRange(sheet.getLastRow(), 2).setNumberFormat('@').setValue(phone);
}

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#F9B655');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('@');
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
