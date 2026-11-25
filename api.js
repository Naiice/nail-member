// ตัวเชื่อมต่อ Google Apps Script (+ โหมดทดลองเมื่อยังไม่ได้ใส่ API_URL)
(function () {
  const cfg = window.APP_CONFIG;
  const TARGET = cfg.STAMPS_FOR_FREE;

  async function call(action, data) {
    if (!cfg.API_URL) return mock(action, data || {});
    const res = await fetch(cfg.API_URL, {
      method: 'POST',
      // text/plain เพื่อไม่ให้เกิด CORS preflight กับ Apps Script
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action }, data)),
    });
    if (!res.ok) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (' + res.status + ')');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'เกิดข้อผิดพลาด');
    return json;
  }

  function normPhone(raw) {
    let p = String(raw || '').replace(/\D/g, '');
    if (p.length === 11 && p.startsWith('66')) p = '0' + p.slice(2);
    return /^0\d{8,9}$/.test(p) ? p : null;
  }

  /* ---------- โหมดทดลอง (เก็บใน localStorage) ---------- */
  function db() {
    try { return JSON.parse(localStorage.getItem('lep_mock_db') || '{}'); } catch (e) { return {}; }
  }
  function save(d) { try { localStorage.setItem('lep_mock_db', JSON.stringify(d)); } catch (e) {} }
  function view(m) { return Object.assign({}, m, { target: TARGET, freeReady: m.points >= TARGET }); }

  async function mock(action, b) {
    await new Promise((r) => setTimeout(r, 250));
    const d = db();
    const pinOk = () => { if (String(b.pin) !== '1234') throw new Error('PIN ไม่ถูกต้อง (โหมดทดลองใช้ 1234)'); };
    const phone = b.phone ? normPhone(b.phone) : null;
    if (b.phone && !phone) throw new Error('เบอร์โทรไม่ถูกต้อง');
    const m = phone && d[phone];
    switch (action) {
      case 'lookup': return m ? { ok: true, found: true, member: view(m) } : { ok: true, found: false };
      case 'register':
        pinOk();
        if (!String(b.name || '').trim()) throw new Error('กรุณากรอกชื่อ');
        if (m) return { ok: true, created: false, member: view(m) };
        d[phone] = { phone, name: b.name.trim(), points: 0, visits: 0, freeUsed: 0 };
        save(d); return { ok: true, created: true, member: view(d[phone]) };
      case 'verifyPin': pinOk(); return { ok: true };
      case 'addStamp':
        pinOk(); if (!m) throw new Error('ไม่พบสมาชิกเบอร์นี้');
        if (m.points >= TARGET) throw new Error('ครบ ' + TARGET + ' แต้มแล้ว กรุณากด "ใช้สิทธิ์ฟรี" ก่อน');
        m.points++; m.visits++; save(d); return { ok: true, member: view(m) };
      case 'removeStamp':
        pinOk(); if (!m) throw new Error('ไม่พบสมาชิกเบอร์นี้');
        if (m.points <= 0) throw new Error('แต้มเป็น 0 อยู่แล้ว');
        m.points--; m.visits = Math.max(0, m.visits - 1); save(d); return { ok: true, member: view(m) };
      case 'redeem':
        pinOk(); if (!m) throw new Error('ไม่พบสมาชิกเบอร์นี้');
        if (m.points < TARGET) throw new Error('แต้มยังไม่ครบ ' + TARGET + ' แต้ม');
        m.points = 0; m.visits++; m.freeUsed++; save(d); return { ok: true, member: view(m) };
    }
    throw new Error('ไม่รู้จักคำสั่ง');
  }

  function renderStamps(el, member) {
    el.innerHTML = '';
    for (let i = 1; i <= member.target; i++) {
      const s = document.createElement('div');
      s.className = 'stamp' + (i <= member.points ? ' on' : '');
      s.innerHTML = i <= member.points ? '💅' : '<span>' + i + '</span>';
      el.appendChild(s);
    }
    const free = document.createElement('div');
    free.className = 'stamp free' + (member.freeReady ? ' on' : '');
    free.innerHTML = member.freeReady ? '🎁' : '<span>ฟรี</span>';
    el.appendChild(free);
  }

  function formatPhone(p) {
    return p.length === 10 ? p.slice(0, 3) + '-' + p.slice(3, 6) + '-' + p.slice(6) : p;
  }

  window.LepAPI = { call, normPhone, renderStamps, formatPhone, isMock: !cfg.API_URL };
})();
