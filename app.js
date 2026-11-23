(function () {
  const { esc, mark } = window.Markup;
  const $ = (id) => document.getElementById(id);
  const SEG_SEC = 30;
  const TARGET_RATE = 16000;

  // ---------- 설정 ----------
  const DEFAULT_CFG = { key: '', sttModel: 'gemini-2.5-flash', anaModel: 'gemini-2.5-flash', liveMin: 3, rpm: 8 };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) {
      const s = JSON.stringify(v);
      // 휴대폰 저장 공간이 차면(긴 설교가 여러 편 쌓였을 때) 오래된 기록부터 덜어 내고 다시 저장한다
      for (let i = 0; i < 8; i++) {
        try { localStorage.setItem(k, s); return true; } catch (e) {
          let h; try { h = JSON.parse(localStorage.getItem('mn_history') || '[]'); } catch (x) { h = []; }
          if (k === 'mn_history' || !h.length) break;
          try { localStorage.setItem('mn_history', JSON.stringify(h.slice(0, Math.floor(h.length * 0.7)))); } catch (x) { localStorage.removeItem('mn_history'); }
        }
      }
      if (!store.warned) { store.warned = true; setTimeout(() => toast?.('휴대폰 저장 공간이 부족해요. 드라이브에 저장해 두면 안전해요.', 4000), 0); }
      return false;
    },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  let cfg = { ...DEFAULT_CFG, ...store.get('mn_cfg', {}) };

  // ---------- 세션 상태 ----------
  const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const emptySession = () => ({ id: newId(), meta: {}, segments: [], live: null, final: null, elapsed: 0, saved: null });
  let S = store.get('mn_session', null) || emptySession();
  if (!S.id) S.id = newId();
  S.segments.forEach((s) => { if (s.status === 'pending') s.status = 'failed'; });
  const wavs = new Map(); // 세그먼트 번호 → 오디오(재시도용, 메모리에만)
  let pdfCache = null;

  function persist() {
    const meta = readMeta();
    S.meta = meta;
    store.set('mn_session', { ...S, segments: S.segments.map(({ i, t, len, status, text }) => ({ i, t, len, status, text })) });
  }

  // ---------- 화면 공통 ----------
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  const setStatus = (s) => ($('status').textContent = s);
  const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  function showTab(name) {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`));
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function readMeta() {
    return {
      date: $('sermonDate').value || S.meta?.date || today(),
      service_type: $('serviceType').value,
      preacher: $('preacher').value.trim(),
      title: $('sermonTitle').value.trim(),
      scripture: $('sermonText').value.trim(),
    };
  }
  function fillMeta() {
    const last = store.get('mn_lastmeta', {});
    const opts = [...$('serviceType').options].map((o) => o.value);
    const st = S.meta.service_type || last.service_type;
    $('serviceType').value = opts.includes(st) ? st : opts[0];
    $('preacher').value = S.meta.preacher ?? last.preacher ?? '';
    $('sermonDate').value = S.meta.date || today();
    $('sermonTitle').value = S.meta.title || '';
    $('sermonText').value = S.meta.scripture || '';
  }
  ['sermonDate', 'serviceType', 'preacher', 'sermonTitle', 'sermonText'].forEach((id) => $(id).addEventListener('change', () => {
    persist(); store.set('mn_lastmeta', { service_type: $('serviceType').value, preacher: $('preacher').value.trim() });
  }));

  // ---------- 진행 단계 표시 ----------
  // 0 녹음 · 1 받아쓰기 · 2 정리 · 3 저장 / state: idle, active, done, error
  const STEP_NAMES = ['녹음', '받아쓰기', '정리', '저장'];
  let steps = ['idle', 'idle', 'idle', 'idle'];
  function flow(i, state, title, detail = '') {
    if (state === 'active' || state === 'error') for (let k = i + 1; k < 4; k++) steps[k] = 'idle';
    steps[i] = state;
    for (let k = 0; k < i; k++) if (steps[k] !== 'done' && state !== 'error') steps[k] = 'done';
    $('steps').innerHTML = steps.map((s, k) => `<li class="st ${s}"><span class="b">${s === 'done' ? '✓' : s === 'error' ? '!' : k + 1}</span>${STEP_NAMES[k]}</li>`).join('');
    if (title) {
      const kind = state === 'error' ? 'error' : state === 'active' ? 'active' : 'done';
      $('banner').className = `banner ${kind}`;
      $('banner').hidden = false;
      $('bannerTitle').textContent = (kind === 'done' ? '✓ ' : kind === 'error' ? '✕ ' : '') + title;
      $('bannerDetail').textContent = detail;
      setStatus(title);
      if (kind === 'done' && navigator.vibrate) navigator.vibrate(200);
      // 받아쓰기 외 단계도 위 고정 막대에 보여준다
      if (kind === 'active' && i !== 1) {
        const bar = $('progress'); bar.hidden = false; bar.classList.remove('has-fail');
        bar.querySelector('.fill').style.width = /(\d+)%/.test(title) ? `${title.match(/(\d+)%/)[1]}%` : '100%';
        bar.querySelector('.ptext').textContent = `${title}${detail ? ` · ${detail}` : ''}`;
      } else if (i !== 1 || kind !== 'active') updateProgress();
    }
  }
  // 받아쓰기 진행 막대 (화면 위에 고정)
  function updateProgress() {
    const segs = S.segments.filter((s) => s.status !== 'gap');
    const busy = segs.some((s) => s.status === 'pending');
    const bar = $('progress');
    if (!segs.length || (!busy && !segs.some((s) => s.status === 'failed'))) { bar.hidden = true; return; }
    const done = segs.filter((s) => s.status === 'done').length;
    const failed = segs.filter((s) => s.status === 'failed').length;
    const left = segs.length - done - failed;
    bar.hidden = false;
    bar.querySelector('.fill').style.width = `${Math.round((done / segs.length) * 100)}%`;
    bar.querySelector('.ptext').textContent = `받아쓰기 ${done}/${segs.length} 완료` + (left ? ` · 남은 ${left}개` : '') + (failed ? ` · 실패 ${failed}개` : '')
      + (busy && left ? ` · 약 ${Math.max(1, Math.ceil(left / Math.max(1, Number(cfg.rpm) || 8)))}분 남음` : '');
    bar.classList.toggle('has-fail', failed > 0 && !busy);
  }
  setInterval(() => { if (S.segments.some((s) => s.waitUntil)) { renderSegments(); } }, 1000);

  function resetFlow() { steps = ['idle', 'idle', 'idle', 'idle']; $('steps').innerHTML = ''; $('banner').hidden = true; flow(0, 'idle'); }

  $('sermonDate').addEventListener('change', () => {
    if (!$('sermonDate').value) $('sermonDate').value = today();
    S.meta.date = $('sermonDate').value;
    if (S.final) { S.final.date = S.meta.date; pdfCache = null; persist(); renderFinal(); }
  });

  // ---------- 받아쓰기 목록 ----------
  const transcriptText = () => S.segments.filter((s) => (s.status === 'done' || s.status === 'gap') && s.text).map((s) => s.text).join('\n');

  function renderSegments() {
    $('trEmpty').hidden = S.segments.length > 0;
    $('trList').innerHTML = S.segments.map((s) => {
      const waiting = s.waitUntil && s.waitUntil > Date.now() ? ` (한도 초과, ${Math.ceil((s.waitUntil - Date.now()) / 1000)}초 뒤 다시)` : '';
      const label = s.status === 'pending' ? (s.active ? `받아쓰는 중…${waiting}` : '대기 중') : s.status === 'failed' ? `인식 실패${s.err ? ` · ${esc(s.err)}` : ''}` : '';
      const retry = s.status === 'failed' && (wavs.has(s.i) || fileJob) ? ` <button class="btn" data-retry="${s.i}">다시</button>` : '';
      const cnt = s.status === 'done' && s.text ? ` · ${s.text.length}자` : '';
      return `<div class="seg ${s.status}"><div class="t">${fmt(s.t)}${cnt} ${label}${retry}</div>${esc(s.text || '')}</div>`;
    }).join('');
    updateProgress();
    const total = transcriptText().length;
    $('trStats').textContent = total ? `받아쓴 글자 ${total.toLocaleString()}자 · ${S.segments.filter((s) => s.status === 'done').length}구간` : '';
    $('btnCopyTr').hidden = !total;
    const nFail = S.segments.filter((s) => s.status === 'failed').length;
    $('btnRetryFailed').hidden = !nFail;
    $('btnRetryFailed').textContent = `실패한 구간 다시 (${nFail}개)`;
  }
  $('trList').addEventListener('click', async (e) => {
    const i = e.target.dataset?.retry;
    if (i == null) return;
    const seg = S.segments.find((s) => s.i === Number(i));
    if (!wavs.has(seg.i) && fileJob && S.fileSig === fileJob.sig) wavs.set(seg.i, () => fileJob.makeSource(seg));
    seg.status = 'pending'; renderSegments();
    if (fileJob && S.fileSig === fileJob.sig) { await transcribeSeg(seg, ''); renderSegments(); persist(); } else enqueue(seg);
  });

  // ---------- 오디오 → WAV ----------
  function downsample(chunks, inRate) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const ratio = inRate / TARGET_RATE;
    const outLen = Math.floor(total / ratio);
    const out = new Float32Array(outLen);
    const flat = new Float32Array(total);
    let o = 0; chunks.forEach((c) => { flat.set(c, o); o += c.length; });
    for (let i = 0; i < outLen; i++) {
      const s = Math.floor(i * ratio), e = Math.min(total, Math.floor((i + 1) * ratio));
      let sum = 0; for (let j = s; j < e; j++) sum += flat[j];
      out[i] = e > s ? sum / (e - s) : flat[s] || 0;
    }
    return out;
  }
  function rms(x) { let s = 0; for (let i = 0; i < x.length; i += 4) s += x[i] * x[i]; return Math.sqrt(s / (x.length / 4)); }
  function encodeWav(samples) {
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, TARGET_RATE, true); v.setUint32(28, TARGET_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ---------- 받아쓰기 ----------
  // 받아쓰기 요청 속도 조절: 무료 키는 분당 요청 수 한도가 낮아서(약 10회) 몰아 보내면 429로 실패한다
  let nextSlot = 0;
  async function rateGate() {
    const gap = 60000 / Math.max(1, Number(cfg.rpm) || 8);
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + gap;
    if (wait) await new Promise((r) => setTimeout(r, wait));
  }

  async function transcribeSeg(seg, prevTail) {
    let wav = wavs.get(seg.i);
    if (typeof wav === 'function') wav = wav();
    if (!wav) { seg.status = 'failed'; seg.err = '원본 소리가 없어요'; return; }
    let other = 0;
    seg.active = true;
    try {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        await rateGate();
        seg.text = wav.remote
          ? await Gemini.transcribeRange(cfg, wav.remote, wav.from, wav.to)
          : wav.blob
            ? await Gemini.transcribe(cfg, wav.blob, '', { mime: wav.mime, approxSec: wav.sec })
            : await Gemini.transcribe(cfg, wav, prevTail);
        seg.status = 'done'; seg.err = ''; wavs.delete(seg.i);
        return;
      } catch (e) {
        seg.err = e.message;
        const limited = e.status === 429 || e.status === 503;
        if (!limited) other++;
        if (other >= 3 || attempt === 7) { seg.status = 'failed'; return; }
        // 한도 초과면 알려준 시간만큼(없으면 점점 길게) 쉬고 다시
        const wait = limited ? (e.retryAfter || 15000 * (attempt + 1)) : 3000 * (attempt + 1);
        if (limited) nextSlot = Math.max(nextSlot, Date.now() + wait);
        seg.waitUntil = Date.now() + wait;
        renderSegments(); updateProgress();
        await new Promise((r) => setTimeout(r, wait));
        seg.waitUntil = 0;
      }
    }
    } finally { seg.active = false; }
  }

  // 실시간 녹음은 순서대로 (앞 구간 끝부분을 문맥으로 넘김)
  let queue = Promise.resolve();
  function enqueue(seg) {
    queue = queue.then(async () => {
      const prev = S.segments.filter((s) => s.i < seg.i && s.status === 'done' && s.text).pop();
      await transcribeSeg(seg, prev ? prev.text.slice(-120) : '');
      renderSegments(); persist();
    });
    return queue;
  }

  // ---------- 녹음 ----------
  // rec: 녹음 세션 / rec.cap: 지금 열려 있는 마이크(화면이 꺼지면 아이폰이 끊을 수 있어 다시 연다)
  let rec = null;
  let tick = null, liveTimer = null, wakeLock = null;
  let segCounter = S.segments.reduce((m, s) => Math.max(m, s.i + 1), 0);

  async function lockScreen() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') { wakeLock = await navigator.wakeLock.request('screen'); } } catch (e) {}
  }

  function flushSegment(force) {
    if (!rec || !rec.len || !rec.rate) return;
    const minLen = rec.rate * (force ? 2 : SEG_SEC);
    if (rec.len < minLen) { if (force) { rec.chunks = []; rec.len = 0; } return; }
    const samples = downsample(rec.chunks, rec.rate);
    const t = rec.segStart;
    rec.chunks = []; rec.len = 0; rec.segStart = elapsedNow();
    if (rms(samples) < 0.002) return; // 거의 무음이면 건너뜀
    const seg = { i: segCounter++, t, status: 'pending', text: '' };
    wavs.set(seg.i, encodeWav(samples));
    S.segments.push(seg);
    renderSegments();
    enqueue(seg);
  }

  const elapsedNow = () => S.elapsed + (rec ? (Date.now() - rec.startedAt) / 1000 : 0);

  async function openCapture() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const cap = { stream, ctx, src, proc, lastAudio: Date.now() };
    proc.onaudioprocess = (e) => {
      if (!rec || rec.cap !== cap) return;
      cap.lastAudio = Date.now();
      rec.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      rec.len += e.inputBuffer.length;
      if (rec.len >= ctx.sampleRate * SEG_SEC) flushSegment(false);
    };
    src.connect(proc); proc.connect(ctx.destination);
    stream.getAudioTracks().forEach((t) => {
      t.addEventListener('ended', () => { if (rec?.cap === cap) markDropped(); });
      t.addEventListener('mute', () => { if (rec?.cap === cap) markDropped(); });
    });
    if (rec) { rec.cap = cap; rec.rate = ctx.sampleRate; }
    return cap;
  }

  async function closeCapture(cap) {
    if (!cap) return;
    try { cap.proc.disconnect(); cap.src.disconnect(); } catch (e) {}
    cap.stream.getTracks().forEach((t) => t.stop());
    try { await cap.ctx.close(); } catch (e) {}
  }

  // 아이폰이 마이크를 끊은 시점 기록
  function markDropped() {
    if (!rec || rec.droppedAt) return;
    flushSegment(true);
    rec.droppedAt = elapsedNow();
  }

  // 화면이 다시 켜지면 마이크를 다시 연다
  let resuming = false;
  async function resumeCapture() {
    if (!rec || resuming) return;
    resuming = true;
    try {
      const cap = rec.cap;
      const track = cap?.stream.getAudioTracks()[0];
      const alive = cap && track && track.readyState === 'live' && !track.muted && cap.ctx.state === 'running' && Date.now() - cap.lastAudio < 3000;
      if (alive && !rec.droppedAt) { lockScreen(); return; }
      if (cap?.ctx.state === 'suspended' && track?.readyState === 'live') {
        try { await cap.ctx.resume(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 600));
      }
      const t2 = rec.cap?.stream.getAudioTracks()[0];
      const ok = rec.cap && t2 && t2.readyState === 'live' && !t2.muted && rec.cap.ctx.state === 'running' && Date.now() - rec.cap.lastAudio < 1500;
      if (!ok) {
        flushSegment(true);
        await closeCapture(rec.cap);
        rec.cap = null;
        await openCapture();
      }
      const from = rec.droppedAt ?? rec.hiddenAt;
      const to = elapsedNow();
      if (from != null && to - from > 5) {
        S.segments.push({ i: segCounter++, t: from, status: 'gap', text: `(${fmt(from)}~${fmt(to)} 화면이 꺼져 녹음되지 않음)` });
        renderSegments(); persist();
        toast('화면이 꺼진 동안 녹음이 멈췄어서 다시 이어서 녹음해요.', 4000);
      }
      rec.droppedAt = null; rec.hiddenAt = null;
      rec.segStart = elapsedNow(); rec.chunks = []; rec.len = 0;
      lockScreen();
    } catch (e) {
      toast('마이크를 다시 열지 못했어요. "녹음 끝내기" 후 "이어서 녹음"을 눌러주세요.', 5000);
    } finally { resuming = false; }
  }

  async function startRec() {
    if (!cfg.key) { openSettings(); toast('먼저 Gemini API 키를 넣어주세요.'); return; }
    if (!confirmNew()) return;
    if (!S.meta.date) S.meta.date = today();
    rec = { cap: null, rate: 0, chunks: [], len: 0, startedAt: Date.now(), segStart: S.elapsed, droppedAt: null, hiddenAt: null };
    try { await openCapture(); }
    catch (e) { rec = null; toast('마이크를 쓸 수 없어요. Safari 설정에서 마이크를 허용해 주세요.', 4000); return; }
    lockScreen();
    $('btnRec').classList.add('on'); $('recLabel').textContent = '녹음 끝내기';
    flow(0, 'active', '녹음 중', '화면을 켜 둔 채로 두세요');
    tick = setInterval(() => {
      $('timer').textContent = fmt(elapsedNow());
      // 화면은 켜져 있는데 소리가 안 들어오면 다시 연다
      if (rec?.cap && document.visibilityState === 'visible' && (Date.now() - rec.cap.lastAudio > 4000 || rec.cap.stream.getAudioTracks()[0]?.readyState !== 'live')) resumeCapture();
    }, 1000);
    liveTimer = setInterval(runLive, Math.max(1, Number(cfg.liveMin) || 3) * 60000);
    showTab('live');
    persist();
  }

  // 이전 내용이 있으면 새로 시작할지 묻는다. false면 중단
  // ---------- 지난 기록 (이 휴대폰에 보관) ----------
  const HIST_KEY = 'mn_history';
  const hasContent = (x) => x && (x.final || (x.segments || []).some((s) => s.status === 'done' && s.text));
  function loadHistory() { return store.get(HIST_KEY, []); }
  function saveHistory(list) {
    // 휴대폰 저장 공간이 차면 오래된 것부터 지운다
    for (let n = list.length; n >= 0; n--) {
      try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, n))); return; } catch (e) {}
    }
  }
  function archive() {
    if (!hasContent(S)) return;
    const meta = readMeta();
    const entry = {
      id: S.id, savedAt: Date.now(), meta, elapsed: S.elapsed, saved: S.saved, driveTx: S.driveTx, driveIds: S.driveIds, fileSig: S.fileSig,
      segments: S.segments.filter((s) => s.text).map(({ i, t, len, status, text }) => ({ i, t, len, status, text })),
      final: S.final ? { ...S.final, _notes: undefined } : null,
    };
    const list = loadHistory().filter((h) => h.id !== S.id);
    list.unshift(entry);
    saveHistory(list.slice(0, 60));
  }
  function startFresh() {
    archive();
    S = emptySession(); S.meta = { date: today() }; wavs.clear(); pdfCache = null; segCounter = 0; liveLen = 0; fileJob = null;
    $('sermonTitle').value = ''; $('sermonText').value = ''; $('sermonDate').value = today();
    persist(); resetFlow(); renderAll(); showTab('live');
    $('timer').textContent = '00:00'; $('recLabel').textContent = '녹음 시작';
  }

  // 이전 내용이 있으면: 정리까지 끝난 것은 기록에 보관하고 새로 시작, 아니면 이어서 할지 묻는다
  function confirmNew() {
    if (!(S.final || S.segments.length)) return true;
    if (S.final || confirm('이전 내용이 있어요. 기록에 보관하고 새로 시작할까요?\\n(취소하면 이어서 진행해요)')) startFresh();
    return true;
  }

  $('btnNew').addEventListener('click', () => {
    if (rec) { toast('녹음을 먼저 끝내주세요.'); return; }
    if (hasContent(S) && !S.final && !confirm('아직 정리 전이에요. 지금 내용은 지난 기록에 보관하고 새로 시작할까요?')) return;
    startFresh();
    toast('새 예배를 시작할 수 있어요. 이전 내용은 지난 기록에 보관했어요.');
  });

  function renderHistory() {
    const list = loadHistory();
    $('histEmpty').hidden = list.length > 0;
    $('histList').innerHTML = list.map((h) => {
      const st = h.saved ? '드라이브 저장됨' : h.final ? '정리됨' : '받아쓰기만';
      const title = h.final?.title || h.meta?.title || '(제목 없음)';
      const chars = (h.segments || []).reduce((n, s) => n + (s.text || '').length, 0);
      return `<li class="hist-item${h.id === S.id ? ' current' : ''}">
        <div class="hm"><b>${esc(h.meta?.date || '')}</b> · ${esc(h.meta?.service_type || '')}${h.id === S.id ? ' · 지금 열린 기록' : ''}</div>
        <div class="ht">${esc(title)}</div>
        <div class="hm">${esc(h.final?.scripture_main || h.meta?.scripture || '')} · ${st} · 받아쓰기 ${chars.toLocaleString()}자</div>
        <div class="row"><button class="btn primary" data-open="${h.id}">불러오기</button><button class="btn" data-del="${h.id}">삭제</button></div>
      </li>`;
    }).join('');
  }
  $('btnHistory').addEventListener('click', () => { if (rec) { toast('녹음을 먼저 끝내주세요.'); return; } archive(); renderHistory(); $('history').showModal(); });
  $('histList').addEventListener('click', async (e) => {
    const openId = e.target.dataset?.open, delId = e.target.dataset?.del;
    if (delId) {
      if (!confirm('이 기록을 휴대폰에서 지울까요? (드라이브에 저장한 PDF는 그대로예요)')) return;
      saveHistory(loadHistory().filter((h) => h.id !== delId));
      renderHistory();
      return;
    }
    if (!openId) return;
    const h = loadHistory().find((x) => x.id === openId);
    if (!h) return;
    archive();
    S = { ...emptySession(), ...JSON.parse(JSON.stringify(h)), live: null };
    wavs.clear(); pdfCache = null; fileJob = null; liveLen = 0;
    segCounter = S.segments.reduce((m, s) => Math.max(m, s.i + 1), 0);
    $('sermonTitle').value = S.meta.title || ''; $('sermonText').value = S.meta.scripture || '';
    persist();
    $('history').close();
    await renderAll();
    resetFlow();
    if (S.saved) flow(3, 'done', '지난 기록을 불러왔어요', "드라이브에 저장된 기록이에요. '정리만 다시 하기'로 새로 정리할 수 있어요");
    else if (S.final) flow(2, 'done', '지난 기록을 불러왔어요', "'정리만 다시 하기'로 새로 정리할 수 있어요");
    else flow(1, 'done', '지난 기록을 불러왔어요', "'정리만 다시 하기'로 정리를 만들 수 있어요");
    showTab('result');
    $('resActions').hidden = false;
  });

  $('btnLearn').addEventListener('click', async () => {
    $('learnView').hidden = false;
    $('learnView').innerHTML = '<p class="hint">불러오는 중…</p>';
    const p = await Learn.load(readMeta().preacher);
    $('learnView').innerHTML = Learn.toHtml(p, esc);
  });

  // 드라이브에서 받아쓰기 목록을 불러와 고르기
  $('btnDriveList').addEventListener('click', async () => {
    try {
      await Drive.connect(); // 탭 직후 바로 호출해야 로그인 창이 열림
      $('driveList').innerHTML = '<li class="hint">드라이브에서 찾는 중…</li>';
      const files = await Drive.listTranscripts();
      $('driveList').innerHTML = files.length ? files.map((f) => {
        const p = f.appProperties || {};
        const label = p.mn ? `${p.mn_date} · ${p.mn_service}` : f.name.replace(/_받아쓰기\.txt$/, '');
        return `<li class="hist-item"><div class="hm"><b>${esc(label)}</b></div><div class="ht">${esc(p.mn_title || '')}</div>
          <div class="hm">${esc(p.mn_scripture || '')}${p.mn_preacher ? ' · ' + esc(p.mn_preacher) : ''}</div>
          <div class="row"><button class="btn primary" data-drive="${esc(f.id)}" data-name="${esc(f.name)}">불러와서 정리</button></div></li>`;
      }).join('') : '<li class="hint">드라이브에 저장된 받아쓰기가 아직 없어요.</li>';
      $('driveList')._files = files;
    } catch (e) { $('driveList').innerHTML = `<li class="hint">${esc(e.message)}</li>`; }
  });
  $('driveList').addEventListener('click', async (e) => {
    const id = e.target.dataset?.drive;
    if (!id) return;
    const f = ($('driveList')._files || []).find((x) => x.id === id) || { name: e.target.dataset.name };
    try {
      e.target.disabled = true; e.target.textContent = '불러오는 중…';
      const text = (await Drive.readText(id)).trim();
      const p = f.appProperties || {};
      await loadTranscript(text, f.name, p.mn ? { date: p.mn_date, service_type: p.mn_service, preacher: p.mn_preacher, title: p.mn_title, scripture: p.mn_scripture } : null, { txtId: id });
    } catch (err) { toast(err.message, 4000); e.target.disabled = false; e.target.textContent = '불러와서 정리'; }
  });

  // 받아쓰기 글을 새 기록으로 열고 정리를 돌린다
  async function loadTranscript(text, fileName, meta, driveTx) {
    if (text.length < 50) { toast('받아쓰기 내용이 너무 적어요.'); return; }
    archive();
    S = emptySession();
    // 파일 이름 예: 2026-11-22_주일 1부예배_제목_받아쓰기.txt
    const m = (fileName || '').replace(/\.txt$/i, '').replace(/_받아쓰기$/, '').split('_');
    S.meta = meta || { date: /^\d{4}-\d{2}-\d{2}$/.test(m[0]) ? m[0] : today(), service_type: m[1] || '', title: m.slice(2).join('_') };
    if (!S.meta.date) S.meta.date = today();
    S.segments = [{ i: 0, t: 0, status: 'done', text }];
    if (driveTx) S.driveTx = driveTx;
    segCounter = 1; wavs.clear(); pdfCache = null; fileJob = null; liveLen = 0;
    fillMeta(); $('sermonTitle').value = S.meta.title || ''; $('sermonText').value = S.meta.scripture || '';
    if (S.meta.preacher) $('preacher').value = S.meta.preacher;
    persist();
    $('history').close();
    await renderAll();
    resetFlow();
    await makeFinal();
  }

  // 드라이브에 저장된 받아쓰기(.txt)를 불러와 새로 정리
  $('btnImportTxt').addEventListener('click', () => $('txtInput').click());
  $('txtInput').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (f) await loadTranscript((await f.text()).replace(/^# 말씀 정리 앱 버전[^\n]*\n+/, '').trim(), f.name, null, null);
  });


  async function stopRec() {
    if (!rec) return;
    flushSegment(true);
    S.elapsed = elapsedNow();
    const r = rec; rec = null;
    await closeCapture(r.cap);
    clearInterval(tick); clearInterval(liveTimer);
    try { await wakeLock?.release(); } catch (e) {} wakeLock = null;
    $('btnRec').classList.remove('on'); $('recLabel').textContent = '이어서 녹음';
    flow(0, 'done', '녹음 완료', '남은 받아쓰기를 마무리하고 있어요'); flow(1, 'active');
    persist();
    await queue;
    renderAll();
    await makeFinal();
  }

  $('btnRec').addEventListener('click', () => (rec ? stopRec() : startRec()));

  document.addEventListener('visibilitychange', () => {
    if (!rec) return;
    if (document.visibilityState === 'hidden') {
      // 꺼지기 직전까지 녹음된 소리를 먼저 받아쓰기로 넘겨 둔다
      flushSegment(true);
      rec.hiddenAt = elapsedNow();
      persist();
    } else {
      resumeCapture();
    }
  });
  window.addEventListener('pageshow', () => { if (rec) resumeCapture(); });
  window.addEventListener('pagehide', () => { if (rec) { flushSegment(true); persist(); } });

  // ---------- 녹음 파일로 정리 (음성 메모 등) ----------
  // 파일 종류와 크기에 따라 조각 내는 방법을 고른다:
  //  - mp3: 바이트를 5분 분량씩 잘라 그대로 보낸다 (mp3는 잘라도 재생됨, 디코딩이 필요 없어 빠르고 가벼움)
  //  - 작은 m4a/wav: 휴대폰에서 풀어 1분씩 WAV로
  //  - 큰 m4a 등: Gemini에 파일째 올리고 5분 구간별로
  const FILE_SEG_SEC = 300; // 요청 수를 줄이려고 5분씩 (16kHz WAV 약 9.6MB)
  const BIG_FILE = 15 * 1024 * 1024;
  const REMOTE_SEG_SEC = 300;
  const MP3_MAX_BYTES = 12 * 1024 * 1024;
  const sigOf = (f) => `${f.name}|${f.size}`;
  const isMp3 = (f) => /mpeg|mp3/i.test(f.type) || /\.mp3$/i.test(f.name);
  let fileJob = null; // { sig, makeSource(seg) } — 실패한 구간 다시 하기에 씀

  function audioDuration(file) {
    return new Promise((resolve) => {
      const el = document.createElement('audio');
      const url = URL.createObjectURL(file);
      let fired = false;
      const done = (v) => { if (fired) return; fired = true; URL.revokeObjectURL(url); resolve(v); };
      el.preload = 'metadata';
      el.onloadedmetadata = () => done(isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => done(0);
      setTimeout(() => done(0), 15000);
      el.src = url;
    });
  }

  // mp3 길이를 파일 머리에서 직접 계산한다 (아이폰 Safari는 큰 mp3의 길이를 못 읽을 때가 있음)
  async function mp3Duration(file) {
    try {
      const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
      let start = 0;
      if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) { // ID3 태그 건너뛰기
        start = 10 + ((head[6] & 0x7f) << 21 | (head[7] & 0x7f) << 14 | (head[8] & 0x7f) << 7 | (head[9] & 0x7f));
        if (head[5] & 0x10) start += 10;
      }
      const buf = new Uint8Array(await file.slice(start, start + 256 * 1024).arrayBuffer());
      const BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
      const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
      for (let i = 0; i < buf.length - 4; i++) {
        if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
        const ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3;
        const bri = buf[i + 2] >> 4, sri = (buf[i + 2] >> 2) & 3, mode = buf[i + 3] >> 6;
        if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) continue; // Layer III만
        const kbps = BR[ver === 3 ? 1 : 2][bri];
        const rate = SR[ver][sri];
        const spf = ver === 3 ? 1152 : 576;
        // Xing/Info(VBR) 머리가 있으면 프레임 수로 정확히
        const side = ver === 3 ? (mode === 3 ? 17 : 32) : (mode === 3 ? 9 : 17);
        const x = i + 4 + side;
        const tag = String.fromCharCode(buf[x], buf[x + 1], buf[x + 2], buf[x + 3]);
        if ((tag === 'Xing' || tag === 'Info') && (buf[x + 7] & 1)) {
          const frames = (buf[x + 8] << 24 | buf[x + 9] << 16 | buf[x + 10] << 8 | buf[x + 11]) >>> 0;
          if (frames) return (frames * spf) / rate;
        }
        return ((file.size - start - i) * 8) / (kbps * 1000);
      }
    } catch (e) {}
    return 0;
  }

  // m4a(음성 메모) 길이를 moov/mvhd 상자에서 직접 읽는다
  async function mp4Duration(file) {
    try {
      let pos = 0;
      for (let n = 0; n < 50 && pos < file.size; n++) {
        const h = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
        let size = h.getUint32(0);
        const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
        if (size === 1) size = Number(h.getBigUint64(8));
        else if (size === 0) size = file.size - pos;
        if (type === 'moov') {
          const m = new Uint8Array(await file.slice(pos, pos + Math.min(size, 8 * 1024 * 1024)).arrayBuffer());
          for (let i = 8; i < m.length - 32; i++) {
            if (m[i] === 0x6d && m[i + 1] === 0x76 && m[i + 2] === 0x68 && m[i + 3] === 0x64) { // 'mvhd'
              const v = new DataView(m.buffer, i + 4);
              if (v.getUint8(0) === 1) return Number(v.getBigUint64(24)) / v.getUint32(20);
              return v.getUint32(16) / v.getUint32(12);
            }
          }
          return 0;
        }
        if (size < 8) return 0;
        pos += size;
      }
    } catch (e) {}
    return 0;
  }
  const fileDuration = async (file) => (isMp3(file) ? await mp3Duration(file) : await mp4Duration(file)) || (await audioDuration(file));

  async function processFile(file) {
    if (!cfg.key) { openSettings(); toast('먼저 Gemini API 키를 넣어주세요.'); return; }
    if (rec) { toast('녹음 중에는 파일을 올릴 수 없어요.'); return; }
    const sig = sigOf(file);
    // 같은 파일을 다시 고르면: 끝난 구간은 두고 실패·미완료 구간만 이어서
    const resume = S.fileSig === sig && S.segments.some((s) => s.status !== 'done' && s.status !== 'gap');
    if (!resume) {
      confirmNew();
      S.fileSig = sig;
    }
    showTab('transcript');
    lockScreen();
    flow(0, 'active', resume ? '이어서 받아쓰기 준비 중' : '녹음 파일 여는 중', file.name);
    try {
      if (isMp3(file) && file.size > BIG_FILE) await prepareMp3(file, resume);
      else if (file.size > BIG_FILE) await prepareRemote(file, resume);
      else await prepareDecoded(file, resume);
    } catch (e) {
      flow(0, 'error', '녹음 파일을 준비하지 못했어요', e.message);
      return;
    }
    const todo = S.segments.filter((s) => s.status !== 'done' && s.status !== 'gap');
    todo.forEach((s) => { s.status = 'pending'; wavs.set(s.i, () => fileJob.makeSource(s)); });
    await runFileSegments(todo);
  }

  // 새로 시작할 때 구간 목록을 만든다
  function planSegments(total, step) {
    S.elapsed = Math.max(S.elapsed || 0, total);
    $('timer').textContent = fmt(total);
    for (let s = 0; s < total - 2; s += step) S.segments.push({ i: segCounter++, t: s, len: Math.min(step, total - s), status: 'pending', text: '' });
  }

  async function prepareMp3(file, resume) {
    const total = await fileDuration(file);
    if (!total) throw new Error('녹음 파일 길이를 읽지 못했어요. 음성 메모(m4a)나 mp3 파일인지 확인해 주세요.');
    const bps = file.size / total;
    const step = Math.max(60, Math.min(REMOTE_SEG_SEC, Math.floor(MP3_MAX_BYTES / bps)));
    if (!resume) planSegments(total, step);
    fileJob = {
      sig: sigOf(file),
      makeSource: (seg) => {
        const len = seg.len || step;
        const a = Math.max(0, Math.floor(seg.t * bps)), b = Math.min(file.size, Math.ceil((seg.t + len) * bps));
        return { blob: file.slice(a, b, 'audio/mpeg'), mime: 'audio/mp3', sec: len };
      },
    };
  }

  async function prepareRemote(file, resume) {
    const total = await fileDuration(file);
    if (!total) throw new Error('녹음 파일 길이를 읽지 못했어요. 음성 메모(m4a)나 mp3 파일인지 확인해 주세요.');
    flow(0, 'active', '녹음 파일 올리는 중 0%', '와이파이에서 화면을 켜 둔 채로 기다려 주세요');
    const ref = await Gemini.uploadFile(cfg, file, (p) => flow(0, 'active', `녹음 파일 올리는 중 ${Math.round(p * 100)}%`, p >= 1 ? 'Gemini가 파일을 처리하고 있어요' : '와이파이에서 화면을 켜 둔 채로 기다려 주세요'));
    if (!resume) planSegments(total, REMOTE_SEG_SEC);
    fileJob = { sig: sigOf(file), makeSource: (seg) => ({ remote: ref, from: seg.t, to: seg.t + (seg.len || REMOTE_SEG_SEC) }) };
  }

  async function prepareDecoded(file, resume) {
    let audio;
    try {
      const buf = await file.arrayBuffer();
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const octx = new OAC(1, TARGET_RATE, TARGET_RATE); // 16kHz로 바로 디코딩해 메모리를 아낀다
      audio = await new Promise((res, rej) => { const p = octx.decodeAudioData(buf, res, rej); if (p?.then) p.then(res, rej); });
    } catch (e) {
      return prepareRemote(file, resume); // 여기서 못 열면 Gemini에 파일째 올려 본다
    }
    const rate = audio.sampleRate;
    const ch = audio.getChannelData(0);
    if (!resume) {
      planSegments(audio.duration, FILE_SEG_SEC);
      // 거의 무음인 구간은 빼 둔다
      S.segments = S.segments.filter((s) => {
        if (s.status !== 'pending') return true;
        return rms(ch.subarray(Math.floor(s.t * rate), Math.floor((s.t + s.len) * rate))) >= 0.002;
      });
    }
    fileJob = {
      sig: sigOf(file),
      makeSource: (seg) => {
        const slice = ch.subarray(Math.floor(seg.t * rate), Math.floor((seg.t + (seg.len || FILE_SEG_SEC)) * rate));
        return rate === TARGET_RATE ? encodeWav(slice) : encodeWav(downsample([slice], rate));
      },
    };
  }

  async function runFileSegments(list) {
    renderSegments(); persist();
    let done = 0;
    flow(0, 'done', '녹음 파일 준비 완료');
    const update = () => flow(1, 'active', `받아쓰기 ${done}/${list.length}`, '화면을 켜 둔 채로 기다려 주세요');
    update();
    // 2개씩 동시에 받아쓰기 (속도는 rateGate가 조절)
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const seg = list[next++];
        await transcribeSeg(seg, '');
        done++; update(); renderSegments(); persist();
      }
    };
    await Promise.all([worker(), worker()]);
    persist();
    renderAll();
    const failed = S.segments.filter((s) => s.status === 'failed').length;
    if (failed) {
      flow(1, 'error', `받아쓰기 ${failed}구간 실패`, "받아쓰기 탭의 '실패한 구간 다시'를 누르세요. 앱을 껐다 켰다면 같은 파일을 다시 고르면 실패한 구간만 이어서 해요.");
      return;
    }
    await makeFinal();
  }

  // 실패한 구간만 모아서 다시
  async function retryFailed() {
    const failed = S.segments.filter((s) => s.status === 'failed');
    if (!failed.length) return;
    const canFile = fileJob && S.fileSig === fileJob.sig;
    const live = failed.filter((s) => wavs.has(s.i) && !canFile);
    if (canFile) {
      failed.forEach((s) => { s.status = 'pending'; if (!wavs.has(s.i)) wavs.set(s.i, () => fileJob.makeSource(s)); });
      await runFileSegments(failed);
    } else if (live.length) {
      live.forEach((s) => { s.status = 'pending'; enqueue(s); });
      renderSegments();
    } else {
      toast('원본 소리가 남아 있지 않아요. 같은 녹음 파일을 다시 골라주세요.', 5000);
      $('fileInput').click();
    }
  }
  $('btnRetryFailed').addEventListener('click', retryFailed);
  $('btnCopyTr').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(transcriptText()); toast('받아쓰기 전체를 복사했어요.'); }
    catch (e) { toast('복사하지 못했어요.'); }
  });

  $('btnFile').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) processFile(f);
  });

  // ---------- 실시간 정리 ----------
  let liveBusy = false, liveLen = 0;
  async function runLive() {
    const text = transcriptText();
    if (liveBusy || text.length < 150 || text.length - liveLen < 150) return;
    liveBusy = true;
    try {
      S.live = await Gemini.liveSummary(cfg, readMeta(), text);
      S.live.updated = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      liveLen = text.length;
      renderLive(); persist();
    } catch (e) { toast(`실시간 정리 실패: ${e.message}`); }
    liveBusy = false;
  }

  function renderLive() {
    const L = S.live;
    $('liveEmpty').hidden = !!L;
    if (!L) { $('liveView').innerHTML = ''; return; }
    const list = (a) => (Array.isArray(a) && a.length ? `<ul>${a.map((x) => `<li>${mark(x)}</li>`).join('')}</ul>` : '');
    $('liveView').innerHTML = `
      <div class="live-meta">${esc(L.updated || '')} 기준 정리</div>
      <div class="live-block"><h3>${esc(L.title_guess || '설교 제목 추정 중')}</h3>
        ${(L.scripture || []).length ? `<div class="m-v">${(L.scripture || []).map(esc).join(', ')}</div>` : ''}
        ${L.now ? `<p style="margin:6px 0 0">지금: ${mark(L.now)}</p>` : ''}</div>
      ${(L.flow || []).map((f) => `<div class="live-block"><h3>${esc(f.heading)}</h3>${list(f.points)}</div>`).join('')}
      ${(L.key_sentences || []).length ? `<div class="live-block"><h3>핵심 문장</h3>${list(L.key_sentences)}</div>` : ''}
      ${(L.terms || []).length ? `<div class="live-block"><h3>핵심 용어</h3>${(L.terms || []).map((t) => `<span class="m-t">${esc(t)}</span>`).join(' · ')}</div>` : ''}`;
  }


  // 받아쓰기가 끝나면(드라이브가 연결돼 있으면) 받아쓰기 전체를 드라이브에 먼저 따로 저장해 둔다
  async function autoSaveTranscript() {
    if (!Drive.hasToken()) return;
    const text = transcriptText();
    if (text.length < 50) return;
    try {
      const r = await Drive.saveTranscript({ transcript: text, meta: readMeta(), prev: { ...(S.driveIds || {}), ...(S.saved || {}), ...(S.driveTx || {}) } });
      S.driveTx = { txtId: r.txtId };
      persist();
      toast(`받아쓰기를 드라이브 ${r.folder}에 저장했어요.`);
    } catch (e) { /* 저장 버튼을 누를 때 다시 시도됨 */ }
  }

  // ---------- 최종 정리 ----------
  let finalBusy = false;
  async function makeFinal() {
    const edited = $('trEditWrap').hidden ? '' : $('trEdit').value.trim();
    const text = edited || transcriptText();
    if (text.length < 50) { flow(1, 'error', '받아쓴 내용이 너무 적어요', '녹음이 제대로 됐는지 받아쓰기 탭에서 확인해 주세요'); toast('받아쓴 내용이 너무 적어서 정리할 수 없어요.'); return; }
    if (finalBusy) return;
    finalBusy = true;
    autoSaveTranscript();
    showTab('result');
    flow(1, 'done'); flow(2, 'active', '최종 정리 중 (1/2)', '설교 부분을 찾아 처음부터 끝까지 흐름을 파악하고 있어요');
    $('resEmpty').hidden = false; $('resEmpty').textContent = '설교 전체를 다시 읽고 정리하고 있어요. 보통 2~3분, 90분이 넘는 설교는 5~10분 걸려요.';
    try {
      const meta = readMeta();
      // 이 설교자에 대해 지금까지 학습한 설교 패턴을 불러와 정리에 쓴다
      const profile = await Learn.load(meta.preacher);
      window.MN_VOCAB = Learn.vocabOf(profile);
      const cleaned = Learn.clean(text); // 시간 표시·겹친 문단 같은 잡음 제거
      window.MN_CORE_CANDS = Learn.coreCands(cleaned.text.length > 50 ? cleaned.text : text); // 설교자가 밝힌 핵심 후보 문장
      window.MN_REPEATED = Learn.repeated(cleaned.text.length > 50 ? cleaned.text : text, 10); // 직접 센 반복 상위어 [[말, 횟수]]
      window.MN_SIGNALS = Learn.signals(cleaned.text.length > 50 ? cleaned.text : text); // 설교자가 결론지은 문장(문맥 신호)
      const doc = await Gemini.finalDoc(cfg, meta, cleaned.text.length > 50 ? cleaned.text : text, (n) => {
        if (n === 2) flow(2, 'active', '최종 정리 중 (2/2)', '한 장으로 정리하고 색깔 표시를 넣고 있어요');
        if (n === 3) flow(2, 'active', '최종 정리 점검·보충 중', '점검표에서 빠진 항목만 보충하고 있어요');
      }, Learn.toText(profile));
      // 이번 설교의 구조·용어 교정을 쌓아 다음 정리에 반영
      const learned = Learn.merge(profile, doc._notes, { ...meta, title: meta.title || doc.title }, S.id);
      const onDrive = await Learn.save(learned);
      window.MN_TERMS = Learn.termsText(learned);
      S.learnNote = `설교 패턴 학습: ${learned.preacher} ${learned.sermons}편 누적${onDrive ? ' (드라이브에도 저장)' : ''}`;
      doc.date = meta.date;
      doc.service_type = meta.service_type;
      if (meta.preacher) doc.preacher = meta.preacher;
      if (meta.title) doc.title = meta.title;
      if (meta.scripture && !doc.scripture_main) doc.scripture_main = meta.scripture;
      // 다시 정리해도 드라이브의 같은 파일을 갱신하도록 파일 id는 남겨 둔다
      if (S.saved) S.driveIds = { pdfId: S.saved.pdfId, txtId: S.saved.txtId };
      doc.app_version = window.APP_VERSION || '';
      S.final = doc; S.saved = null; pdfCache = null;
      if (!meta.title && doc.title) $('sermonTitle').value = doc.title;
      if (!meta.scripture && doc.scripture_main) $('sermonText').value = doc.scripture_main;
      persist();
      await renderFinal();
      flow(2, 'done', '정리 완료', `아래에서 확인하고 드라이브에 저장하세요 · ${S.learnNote}`);
      archive();
    } catch (e) {
      $('resEmpty').textContent = `정리하지 못했어요: ${e.message}`;
      $('resActions').hidden = false;
      flow(2, 'error', '정리 실패', e.message);
    }
    finalBusy = false;
  }

  async function renderFinal() {
    const has = !!S.final;
    $('resEmpty').hidden = has;
    if (!has) $('resEmpty').textContent = '녹음을 마치면 서론·본론·결론으로 정리된 결과가 여기에 나와요.';
    $('resActions').hidden = !(has || S.segments.length);
    $('btnDrive').disabled = $('btnShare').disabled = !has;
    $('saveInfo').innerHTML = S.saved ? `저장됨: ${esc(S.saved.folder)} · <a href="${esc(S.saved.pdfLink)}" target="_blank">PDF 열기</a> · <a href="${esc(S.saved.sheetLink)}" target="_blank">목록 시트</a>` : '';
    const ck = has && Array.isArray(S.final._check) ? S.final._check : null;
    $('checkBox').hidden = !ck;
    if (ck) $('checkBox').innerHTML = `<div class="ck-h"><b>정리 점검표</b> <span class="hint">${ck.filter((c) => c.ok).length}/${ck.length} 통과</span></div><ul class="ck">${ck.map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><span class="ck-i">${c.ok ? '✓' : '✗'}</span><span><b>${esc(c.label)}</b> <span class="hint">${esc(c.detail || '')}</span></span></li>`).join('')}</ul>${ck.every((c) => c.ok) ? '' : '<p class="hint">✗ 항목은 두 번 보충했지만 부족한 부분이에요. \'정리만 다시 하기\'로 다시 시도할 수 있어요.</p>'}`;
    $('btnPara').disabled = !has;
    $('paraBox').hidden = !(has && S.final.paragraph);
    if (has && S.final.paragraph) $('paraText').innerHTML = Markup.mark(S.final.paragraph);
    if (has) await SermonPdf.preview(S.final, $('docPreview'));
    else $('docPreview').innerHTML = '';
  }

  // ---------- 한 문단 정리 (한 장 정리와 별도) ----------
  let paraBusy = false;
  async function makeParagraph() {
    if (!S.final || paraBusy) return;
    paraBusy = true;
    $('btnPara').disabled = $('btnParaRedo').disabled = true;
    $('paraBox').hidden = false; $('paraText').textContent = '한 문단으로 정리하고 있어요. 30초쯤 걸려요.';
    try {
      const p = await Gemini.paragraph(cfg, readMeta(), S.final._notes || null, S.final);
      if (!p) throw new Error('문단을 받지 못했어요. 다시 눌러 주세요.');
      S.final.paragraph = p; persist(); archive();
      $('paraText').innerHTML = Markup.mark(p);
      $('paraBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      $('paraText').textContent = `한 문단 정리 실패: ${e.message}`;
      if (!S.final.paragraph) setTimeout(() => { if (!S.final?.paragraph) $('paraBox').hidden = true; }, 6000);
    }
    paraBusy = false;
    $('btnPara').disabled = $('btnParaRedo').disabled = false;
  }
  $('btnPara').addEventListener('click', () => (S.final?.paragraph ? $('paraBox').scrollIntoView({ behavior: 'smooth' }) : makeParagraph()));
  $('btnParaRedo').addEventListener('click', makeParagraph);
  $('btnParaCopy').addEventListener('click', async () => {
    const t = `${S.final.title || ''} (${S.final.scripture_main || ''})\n${Markup.strip(S.final.paragraph || '')}`;
    try { await navigator.clipboard.writeText(t); toast('한 문단 정리를 복사했어요.'); } catch (e) { toast('복사하지 못했어요.'); }
  });

  async function getPdf() {
    if (!pdfCache) {
      flow(3, 'active', 'PDF 만드는 중');
      pdfCache = await SermonPdf.toPdfBlob(S.final, $('pdfStage'));
      flow(3, 'idle', '정리 완료', '아래에서 확인하고 드라이브에 저장하세요');
    }
    return pdfCache;
  }
  const pdfName = () => `${S.final.date}_${(S.final.title || '말씀').replace(/[\\/:*?"<>|]+/g, ' ')}.pdf`;

  $('btnFinal').addEventListener('click', makeFinal);

  $('btnDrive').addEventListener('click', async () => {
    if (!S.final) return;
    const btn = $('btnDrive'); btn.disabled = true;
    try {
      await Drive.connect(); // 탭 직후 바로 호출해야 로그인 창이 열림
      const pdfBlob = await getPdf();
      flow(3, 'active', '드라이브에 저장 중');
      S.saved = await Drive.save({ pdfBlob, transcript: ($('trEditWrap').hidden ? '' : $('trEdit').value.trim()) || transcriptText(), doc: S.final, prev: { ...(S.driveTx || {}), ...(S.driveIds || {}), ...(S.saved || {}) } });
      persist(); archive(); await renderFinal();
      flow(3, 'done', '모두 완료', `드라이브 ${S.saved.folder}에 저장했어요`);
      toast(`${S.saved.folder} 폴더에 저장했어요.`);
    } catch (e) { flow(3, 'error', '드라이브 저장 실패', e.message); toast(e.message, 4000); }
    btn.disabled = false;
  });

  $('btnShare').addEventListener('click', async () => {
    if (!S.final) return;
    try {
      const blob = await getPdf();
      const file = new File([blob], pdfName(), { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: S.final.title }); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
  });

  // ---------- 디버그 로그 내보내기 ----------
  // 최근 정리 3번의 단계별 Gemini 요청·응답(받아쓰기 원문은 앞뒤만), 노트, 점검표, 최종 결과와 현재 기록의 상태를 JSON 파일로.
  // API 키·구글 토큰은 넣지 않는다.
  async function exportDebug() {
    const lastraw = store.get('mn_lastraw', null);
    const hist = store.get('mn_history', []);
    const cur = S ? {
      id: S.id, meta: S.meta, segments: (S.segments || []).map(({ i, t, len, status, text, error }) => ({ i, t, len, status, chars: (text || '').length, error: error || '' })),
      transcriptChars: (S.segments || []).reduce((n, x) => n + (x.text || '').length, 0),
      final: S.final ? { title: S.final.title, check: S.final._check || null, autoRed: S.final._autoRed || 0, stated_core: S.final.stated_core || '', doc: { ...S.final, _notes: undefined } } : null,
      notes: S.final?._notes || null,
    } : null;
    let profile = null;
    try { const p = await Learn.load(readMeta().preacher); profile = { preacher: p.preacher, sermons: p.sermons, seedVer: p.seedVer, guide: p.guide, vocab: p.vocab, term_fixes: p.term_fixes, patterns: p.patterns }; } catch (e) {}
    const data = {
      exportedAt: new Date().toISOString(), app: window.APP_VERSION || '', userAgent: navigator.userAgent,
      models: { stt: cfg.sttModel, ana: cfg.anaModel }, liveMin: cfg.liveMin, rpm: cfg.rpm, hasKey: !!cfg.key, drive: Drive.hasToken(),
      session: cur, historyCount: hist.length, lastBrokenResponse: lastraw,
      runs: window.MNDebug?.runs || [], recentErrors: window.MNDebug?.errors || [], profile,
    };
    const txt = JSON.stringify(data, null, 1).replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[키 가림]').replace(/ya29\.[0-9A-Za-z_\-.]+/g, '[토큰 가림]');
    const d = new Date(); const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const file = new File([txt], `말씀정리_디버그_${stamp}.json`, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: '말씀 정리 디버그 로그' }); return; }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`디버그 로그를 내보냈어요 (${Math.round(txt.length / 1024)}KB)`);
  }
  $('btnDebug').addEventListener('click', () => exportDebug().catch((e) => toast(e.message)));
  $('btnDebug2').addEventListener('click', () => exportDebug().catch((e) => toast(e.message)));

  // ---------- 설정 창 ----------
  function openSettings() {
    $('cfgKey').value = cfg.key; $('cfgSttModel').value = cfg.sttModel; $('cfgAnaModel').value = cfg.anaModel; $('cfgLiveMin').value = cfg.liveMin; $('cfgRpm').value = cfg.rpm;
    $('googleState').textContent = Drive.hasToken() ? '연결됨' : '';
    $('testState').textContent = '';
    $('settings').showModal();
  }
  function readCfg() {
    return {
      key: $('cfgKey').value.trim(),
      sttModel: $('cfgSttModel').value.trim() || DEFAULT_CFG.sttModel,
      anaModel: $('cfgAnaModel').value.trim() || DEFAULT_CFG.anaModel,
      liveMin: Math.min(15, Math.max(1, Number($('cfgLiveMin').value) || 3)),
      rpm: Math.min(60, Math.max(1, Number($('cfgRpm').value) || 8)),
    };
  }
  $('btnSettings').addEventListener('click', openSettings);
  $('btnSaveCfg').addEventListener('click', () => { cfg = readCfg(); store.set('mn_cfg', cfg); toast('저장했어요.'); });
  $('btnTest').addEventListener('click', async () => {
    $('testState').textContent = '확인 중…';
    try { await Gemini.ping(readCfg()); $('testState').textContent = 'Gemini 연결 정상이에요.'; }
    catch (e) { $('testState').textContent = e.message; }
  });
  $('btnGoogle').addEventListener('click', async () => {
    try { await Drive.connect(); $('googleState').textContent = '연결됨'; } catch (e) { $('googleState').textContent = e.message; }
  });

  // ---------- 처음 화면 ----------
  async function renderAll() {
    fillMeta();
    renderSegments(); renderLive();
    $('timer').textContent = fmt(S.elapsed || 0);
    const hasText = S.segments.some((s) => s.status === 'done');
    $('trEditWrap').hidden = !hasText;
    if (hasText) $('trEdit').value = transcriptText();
    $('recLabel').textContent = S.segments.length ? '이어서 녹음' : '녹음 시작';
    $('btnNew').hidden = !hasContent(S);
    await renderFinal();
  }

  $('appFoot').textContent = `말씀 정리 · 앱 버전 ${window.APP_VERSION || ''}`;

  async function boot() {
    Learn.load(readMeta().preacher).then((p) => { window.MN_TERMS = Learn.termsText(p); }).catch(() => {});
    if (new URLSearchParams(location.search).has('demo')) {
      try {
        const demo = await (await fetch('demo.json')).json();
        S = { ...emptySession(), ...demo };
      } catch (e) {}
    }
    await renderAll();
    resetFlow();
    if (S.saved) flow(3, 'done', '모두 완료', `드라이브 ${S.saved.folder}에 저장했어요`);
    else if (S.final) flow(2, 'done', '정리 완료', '아래에서 확인하고 드라이브에 저장하세요');
    else if (S.segments.length) flow(1, 'done', '녹음·받아쓰기 완료', '최종 정리 탭에서 정리를 만들 수 있어요');
    if (S.final) showTab('result');
    if (!cfg.key && !new URLSearchParams(location.search).has('demo')) setTimeout(openSettings, 300);
  }
  boot();
})();
