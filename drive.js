// 구글 드라이브 저장: 말씀 정리/연도/월/ 폴더 + 목록 시트
(function () {
  const CLIENT_ID = '819400438897-6m75ptrd1o82cei5ivqra43ieirc9ej1.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const ROOT_NAME = '말씀 정리';
  const SHEET_NAME = '말씀 정리 목록';
  const FOLDER = 'application/vnd.google-apps.folder';
  const SHEET = 'application/vnd.google-apps.spreadsheet';
  const HEADER = ['날짜', '예배', '제목', '설교자', '본문', '분류', '주제 태그', '핵심 한 줄', 'PDF', '받아쓰기'];

  let token = null;
  let expiresAt = 0;
  let client = null;
  let pending = null;

  try {
    const saved = JSON.parse(sessionStorage.getItem('mn_gtoken') || 'null');
    if (saved && saved.expiresAt > Date.now() + 60000) ({ token, expiresAt } = saved);
  } catch (e) {}

  const hasToken = () => token && Date.now() < expiresAt - 60000;

  function initClient() {
    if (client) return client;
    if (!window.google?.accounts?.oauth2) throw new Error('구글 로그인 모듈을 아직 불러오지 못했어요. 잠시 뒤 다시 눌러주세요.');
    client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        const p = pending; pending = null;
        if (resp.error) return p?.reject(new Error(resp.error_description || resp.error));
        token = resp.access_token;
        expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        try { sessionStorage.setItem('mn_gtoken', JSON.stringify({ token, expiresAt })); } catch (e) {}
        try { localStorage.setItem('mn_gconnected', '1'); } catch (e) {}
        p?.resolve(token);
      },
      error_callback: (err) => { const p = pending; pending = null; p?.reject(new Error(err?.message || '로그인 창이 닫혔어요.')); },
    });
    return client;
  }

  // 반드시 버튼 탭 안에서 바로 불러야 아이폰에서 팝업이 열린다
  function connect() {
    if (hasToken()) return Promise.resolve(token);
    const c = initClient();
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      c.requestAccessToken({ prompt: localStorage.getItem('mn_gconnected') ? '' : 'consent' });
    });
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
    if (res.status === 401) { token = null; throw new Error('구글 로그인이 만료됐어요. 다시 저장을 눌러주세요.'); }
    if (!res.ok) throw new Error(`드라이브 오류 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function findOrCreate(name, parent, mimeType) {
    const query = `name='${q(name)}' and mimeType='${mimeType}' and '${parent}' in parents and trashed=false`;
    const r = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`);
    if (r.files?.length) return { id: r.files[0].id, created: false };
    const c = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType, parents: [parent] }),
    });
    return { id: c.id, created: true };
  }

  async function upload(blob, name, mimeType, parent) {
    const boundary = 'mn' + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, mimeType, parents: [parent] });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, blob, `\r\n--${boundary}--`,
    ]);
    return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
  }

  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 60);

  async function save({ pdfBlob, transcript, doc }) {
    if (!hasToken()) throw new Error('구글 드라이브에 먼저 연결해 주세요.');
    const date = doc.date || new Date().toISOString().slice(0, 10);
    const [y, m] = date.split('-');
    const root = (await findOrCreate(ROOT_NAME, 'root', FOLDER)).id;
    const svc = safe(doc.service_type) || '기타';
    const sf = (await findOrCreate(svc, root, FOLDER)).id;
    const yf = (await findOrCreate(`${y}년`, sf, FOLDER)).id;
    const mf = (await findOrCreate(`${m}월`, yf, FOLDER)).id;
    const base = `${date}_${safe(doc.service_type)}_${safe(doc.title) || '말씀'}`;
    const pdf = await upload(pdfBlob, `${base}.pdf`, 'application/pdf', mf);
    const txt = await upload(new Blob([transcript], { type: 'text/plain' }), `${base}_받아쓰기.txt`, 'text/plain', mf);

    const sheet = await findOrCreate(SHEET_NAME, root, SHEET);
    const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}/values`;
    if (sheet.created) {
      await api(`${sheetsBase}/A1:J1?valueInputOption=RAW`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [HEADER] }),
      });
    }
    const row = [date, doc.service_type || '', doc.title || '', doc.preacher || '', doc.scripture_main || '',
      doc.category || '', (doc.tags || []).join(', '), window.Markup.strip(doc.one_line || ''), pdf.webViewLink || '', txt.webViewLink || ''];
    await api(`${sheetsBase}/A1:J1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [row] }),
    });
    return { pdfLink: pdf.webViewLink, folder: `${ROOT_NAME}/${svc}/${y}년/${m}월`, sheetLink: `https://docs.google.com/spreadsheets/d/${sheet.id}` };
  }

  window.Drive = { connect, save, hasToken };
})();
