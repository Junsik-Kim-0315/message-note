(function () {
  const { esc, mark } = window.Markup;
  const $ = (id) => document.getElementById(id);
  const SEG_SEC = 30;
  const TARGET_RATE = 16000;

  // ---------- 설정 ----------
  const DEFAULT_CFG = { key: '', sttModel: 'gemini-2.5-flash', anaModel: 'gemini-2.5-flash', liveMin: 3 };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  let cfg = { ...DEFAULT_CFG, ...store.get('mn_cfg', {}) };

  // ---------- 세션 상태 ----------
  const emptySession = () => ({ meta: {}, segments: [], live: null, final: null, elapsed: 0, saved: null });
  let S = store.get('mn_session', null) || emptySession();
  S.segments.forEach((s) => { if (s.status === 'pending') s.status = 'failed'; });
  const wavs = new Map(); // 세그먼트 번호 → 오디오(재시도용, 메모리에만)
  let pdfCache = null;

  function persist() {
    const meta = readMeta();
    S.meta = meta;
    store.set('mn_session', { ...S, segments: S.segments.map(({ i, t, status, text }) => ({ i, t, status, text })) });
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
      date: S.meta?.date || today(),
      service_type: $('serviceType').value,
      preacher: $('preacher').value.trim(),
      title: $('sermonTitle').value.trim(),
      scripture: $('sermonText').value.trim(),
    };
  }
  function fillMeta() {
    const last = store.get('mn_lastmeta', {});
    $('serviceType').value = S.meta.service_type || last.service_type || '주일예배';
    $('preacher').value = S.meta.preacher ?? last.preacher ?? '';
    $('sermonTitle').value = S.meta.title || '';
    $('sermonText').value = S.meta.scripture || '';
  }
  ['serviceType', 'preacher', 'sermonTitle', 'sermonText'].forEach((id) => $(id).addEventListener('change', () => {
    persist(); store.set('mn_lastmeta', { service_type: $('serviceType').value, preacher: $('preacher').value.trim() });
  }));

  // ---------- 받아쓰기 목록 ----------
  const transcriptText = () => S.segments.filter((s) => (s.status === 'done' || s.status === 'gap') && s.text).map((s) => s.text).join('\n');

  function renderSegments() {
    $('trEmpty').hidden = S.segments.length > 0;
    $('trList').innerHTML = S.segments.map((s) => {
      const label = s.status === 'pending' ? '받아쓰는 중…' : s.status === 'failed' ? '인식 실패' : '';
      const retry = s.status === 'failed' && wavs.has(s.i) ? ` <button class="btn" data-retry="${s.i}">다시</button>` : '';
      return `<div class="seg ${s.status}"><div class="t">${fmt(s.t)} ${label}${retry}</div>${esc(s.text || '')}</div>`;
    }).join('');
  }
  $('trList').addEventListener('click', (e) => {
    const i = e.target.dataset?.retry;
    if (i != null) { const seg = S.segments.find((s) => s.i === Number(i)); seg.status = 'pending'; renderSegments(); enqueue(seg); }
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
  async function transcribeSeg(seg, prevTail) {
    let wav = wavs.get(seg.i);
    if (typeof wav === 'function') wav = wav();
    if (!wav) { seg.status = 'failed'; return; }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        seg.text = await Gemini.transcribe(cfg, wav, prevTail);
        seg.status = 'done'; wavs.delete(seg.i);
        return;
      } catch (e) {
        if (attempt === 2) { seg.status = 'failed'; toast(e.message); }
        else await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
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
    setStatus('녹음 중');
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
  function confirmNew() {
    if (!(S.final || S.segments.length)) return true;
    if (confirm('이전 내용이 있어요. 지우고 새로 시작할까요?\n(취소하면 이어서 진행해요)')) {
      S = emptySession(); S.meta = { date: today() }; wavs.clear(); pdfCache = null; segCounter = 0; liveLen = 0;
      renderAll();
    }
    return true;
  }

  async function stopRec() {
    if (!rec) return;
    flushSegment(true);
    S.elapsed = elapsedNow();
    const r = rec; rec = null;
    await closeCapture(r.cap);
    clearInterval(tick); clearInterval(liveTimer);
    try { await wakeLock?.release(); } catch (e) {} wakeLock = null;
    $('btnRec').classList.remove('on'); $('recLabel').textContent = '이어서 녹음';
    setStatus('받아쓰기 마무리 중');
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
  const FILE_SEG_SEC = 60;
  async function processFile(file) {
    if (!cfg.key) { openSettings(); toast('먼저 Gemini API 키를 넣어주세요.'); return; }
    if (rec) { toast('녹음 중에는 파일을 올릴 수 없어요.'); return; }
    confirmNew();
    if (!S.meta.date) {
      const d = new Date(file.lastModified || Date.now());
      S.meta.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    showTab('transcript');
    setStatus('녹음 파일 여는 중');
    lockScreen();
    let audio;
    try {
      const buf = await file.arrayBuffer();
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const octx = new OAC(1, TARGET_RATE, TARGET_RATE); // 16kHz로 바로 디코딩해 메모리를 아낀다
      audio = await new Promise((res, rej) => { const p = octx.decodeAudioData(buf, res, rej); if (p?.then) p.then(res, rej); });
    } catch (e) {
      setStatus('대기 중');
      toast('이 녹음 파일을 열 수 없어요. 음성 메모(m4a)나 mp3, wav 파일을 올려주세요.', 5000);
      return;
    }
    const rate = audio.sampleRate;
    const ch = audio.getChannelData(0);
    const total = audio.duration;
    S.elapsed = Math.max(S.elapsed || 0, total);
    $('timer').textContent = fmt(total);
    const offset = S.segments.length ? (S.segments[S.segments.length - 1].t + SEG_SEC) : 0;
    const list = [];
    for (let s = 0; s < ch.length; s += rate * FILE_SEG_SEC) {
      const slice = ch.subarray(s, Math.min(ch.length, s + rate * FILE_SEG_SEC));
      if (slice.length < rate * 2) continue;
      const toWav = () => {
        if (rate === TARGET_RATE) return encodeWav(slice);
        return encodeWav(downsample([slice], rate));
      };
      if (rms(slice) < 0.002) continue;
      const seg = { i: segCounter++, t: offset + s / rate, status: 'pending', text: '' };
      wavs.set(seg.i, toWav);
      S.segments.push(seg);
      list.push(seg);
    }
    renderSegments(); persist();
    let done = 0;
    const update = () => setStatus(`파일 받아쓰기 ${done}/${list.length}`);
    update();
    // 3개씩 동시에 받아쓰기
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const seg = list[next++];
        await transcribeSeg(seg, '');
        done++; update(); renderSegments();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    persist();
    const failed = list.filter((s) => s.status === 'failed').length;
    if (failed) toast(`${failed}개 구간을 받아쓰지 못했어요. 받아쓰기 탭에서 '다시'를 눌러주세요.`, 5000);
    renderAll();
    await makeFinal();
  }

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

  // ---------- 최종 정리 ----------
  let finalBusy = false;
  async function makeFinal() {
    const edited = $('trEditWrap').hidden ? '' : $('trEdit').value.trim();
    const text = edited || transcriptText();
    if (text.length < 50) { setStatus('대기 중'); toast('받아쓴 내용이 너무 적어서 정리할 수 없어요.'); return; }
    if (finalBusy) return;
    finalBusy = true;
    showTab('result');
    setStatus('최종 정리 중 (1~2분)');
    $('resEmpty').hidden = false; $('resEmpty').textContent = '설교 전체를 다시 읽고 정리하고 있어요. 1~2분 걸려요.';
    try {
      const meta = readMeta();
      const doc = await Gemini.finalDoc(cfg, meta, text);
      doc.date = meta.date;
      doc.service_type = meta.service_type;
      if (meta.preacher) doc.preacher = meta.preacher;
      if (meta.title) doc.title = meta.title;
      if (meta.scripture && !doc.scripture_main) doc.scripture_main = meta.scripture;
      S.final = doc; S.saved = null; pdfCache = null;
      if (!meta.title && doc.title) $('sermonTitle').value = doc.title;
      if (!meta.scripture && doc.scripture_main) $('sermonText').value = doc.scripture_main;
      persist();
      await renderFinal();
      setStatus('정리 완료');
    } catch (e) {
      $('resEmpty').textContent = `정리하지 못했어요: ${e.message}`;
      $('resActions').hidden = false;
      setStatus('정리 실패');
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
    if (has) await SermonPdf.preview(S.final, $('docPreview'));
    else $('docPreview').innerHTML = '';
  }

  async function getPdf() {
    if (!pdfCache) {
      setStatus('PDF 만드는 중');
      pdfCache = await SermonPdf.toPdfBlob(S.final, $('pdfStage'));
      setStatus('정리 완료');
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
      setStatus('드라이브에 저장 중');
      S.saved = await Drive.save({ pdfBlob, transcript: ($('trEditWrap').hidden ? '' : $('trEdit').value.trim()) || transcriptText(), doc: S.final });
      persist(); await renderFinal();
      setStatus('드라이브 저장 완료');
      toast(`${S.saved.folder} 폴더에 저장했어요.`);
    } catch (e) { setStatus('저장 실패'); toast(e.message, 4000); }
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

  // ---------- 설정 창 ----------
  function openSettings() {
    $('cfgKey').value = cfg.key; $('cfgSttModel').value = cfg.sttModel; $('cfgAnaModel').value = cfg.anaModel; $('cfgLiveMin').value = cfg.liveMin;
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
    if (S.segments.length) $('recLabel').textContent = '이어서 녹음';
    await renderFinal();
  }

  async function boot() {
    if (new URLSearchParams(location.search).has('demo')) {
      try {
        const demo = await (await fetch('demo.json')).json();
        S = { ...emptySession(), ...demo };
      } catch (e) {}
    }
    await renderAll();
    if (S.final) showTab('result');
    if (!cfg.key && !new URLSearchParams(location.search).has('demo')) setTimeout(openSettings, 300);
  }
  boot();
})();
