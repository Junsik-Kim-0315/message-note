// Gemini 호출과 프롬프트
(function () {
  // 상시 축: 어떤 설교든 늘 중심에 두는 그리스도 쪽 말 (본문별 핵심어는 설교 노트의 text_keys로 따로 뽑는다)
  const CORE_KEYS = ['그리스도', '복음', '영적 싸움', '재창조'];
  const MARK_RULES = `색깔 표시 문법(문장 안에 그대로 넣기):
- [[g|...]] 초록 형광: 그리스도 쪽 핵심 메시지(복음, 창 3:15, 영적 싸움에서 이김, 재창조, 성막·헌신 등). 문서 전체에서 6~10곳.
- [[r|...]] 빨간 형광: 마귀·사단·사탄·뱀(옛 뱀, 창 3장의 뱀)·귀신·악한 영·흑암의 권세·정사와 권세·저주·참소와 관련된 핵심 내용과 구절(예: 요 8:44, 요일 3:8, 창 3:15 '뱀의 머리', 엡 6:10-18, 마 12:28-29, 눅 10:19). 특히 '깨뜨리다·내어쫓다·박살 내다·결박하다·멸하다·떠나가라·~할지어다' 같은 대적·선포 표현과 함께 나오면 반드시 빨강으로 표시한다. 빨강은 개수 제한이 없다: 요약·서론·대지·결론·관점·질문 어디서든 마귀 쪽(사단·뱀·귀신·흑암·저주·참소·광명한 천사·세상 신, 성막을 짓지 못하게 막는 것)이 나올 때마다 빨강으로 표시한다. 설교에 이런 내용이 있으면 본론과 요약에 빠뜨리지 말고, 없을 때만 쓰지 않는다.
- [[y|...]] 노란 형광: 각 대지에서 중요한 문장. 대지마다 1~3곳.
- [[t|...]] 핵심 용어(굵게+밑줄): 은혜, 언약, 회개 같은 신앙 핵심 용어가 처음 나올 때.
- [[v|...]] 성경 구절 인용: 예) [[v|요한복음 3:16]] 또는 인용된 말씀 본문.
표시는 겹치지 않게, 강조할 부분만 짧게 감싼다. 빨강은 마귀 쪽 문장·구절에만 칠하고, 여러 문장을 한꺼번에 감싸지 않는다. 같은 인용 안이라도 은혜·그리스도 쪽 문장(예: '이게 진짜 보여야 여러분이 은혜 속에서 사는 거예요')은 빨강 밖에 두고 필요하면 초록이나 노랑으로 칠한다.
호칭: 정리본에서는 '주님' 대신 '그리스도'(또는 '예수 그리스도')라고 쓴다.`;

  // thinking: 생각 단계 예산(0이면 끔). 받아쓰기는 생각이 필요 없고 느려지기만 해서 끈다.
  // 긴 설교(90분 이상)일수록 응답이 오래 걸리니 받아쓰기 길이에 맞춰 기다리는 시간을 늘린다
  const longWait = (base, text, perK, cap) => Math.min(cap, base + Math.round(String(text || '').length / 1000) * perK);

  // ---------- 디버그 로그 ----------
  // 정리 문제를 분석할 수 있게 단계별 요청·응답·노트·점검표를 기록한다. API 키·토큰은 절대 넣지 않는다.
  // 최근 정리 3번까지 휴대폰(localStorage mn_debug)에 남기고, 설정에서 파일로 내보낸다.
  const cap = (t, n) => { t = String(t ?? ''); return t.length > n ? `${t.slice(0, Math.floor(n * 0.7))}\n…(${t.length - n}자 생략)…\n${t.slice(-Math.floor(n * 0.3))}` : t; };
  const Debug = {
    runs: (() => { try { return JSON.parse(localStorage.getItem('mn_debug')) || []; } catch (e) { return []; } })(),
    errors: [],
    cur: null,
    begin(kind, info) { this.cur = { kind, at: new Date().toISOString(), app: window.APP_VERSION || '', info, steps: [] }; this.runs.unshift(this.cur); this.runs = this.runs.slice(0, 3); this.save(); },
    log(type, data) {
      const e = { t: new Date().toISOString(), type, ...data };
      if (this.cur) this.cur.steps.push(e);
      if (/error/.test(type)) { this.errors.unshift(e); this.errors = this.errors.slice(0, 30); }
      this.save();
    },
    end(status) { if (this.cur) { this.cur.status = status; this.cur.endAt = new Date().toISOString(); } this.save(); this.cur = null; },
    save() {
      for (let keep = 3; keep >= 1; keep--) {
        try { localStorage.setItem('mn_debug', JSON.stringify(this.runs.slice(0, keep))); return; } catch (e) { /* 저장 공간이 모자라면 오래된 기록부터 덜어 낸다 */ }
      }
    },
  };
  window.MNDebug = Debug;

  async function call(cfg, model, parts, { json = false, temperature = 0.3, timeoutMs = 120000, thinking = null, label = '' } = {}) {
    if (!cfg.key) throw new Error('설정에서 Gemini API 키를 넣어주세요.');
    const send = async (withThinking) => {
      const ctrl = new AbortController();
      const t0 = Date.now();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        // 긴 설교(90분 이상)는 노트 JSON이 길어 기본 출력 한도에서 잘린다 → 출력 한도를 넉넉히
        const generationConfig = { temperature, maxOutputTokens: json ? 65536 : 16384, ...(json ? { responseMimeType: 'application/json' } : {}) };
        if (withThinking && thinking != null) generationConfig.thinkingConfig = { thinkingBudget: thinking };
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
          body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data.error?.message || '';
          Debug.log('gemini-error', { label, model, status: res.status, message: cap(msg, 1000), ms: Date.now() - t0 });
          // 이 모델이 생각 예산 설정을 받지 않으면 빼고 다시
          if (withThinking && thinking != null && res.status === 400 && /thinking/i.test(msg)) return send(false);
          const err = new Error(res.status === 429 ? 'Gemini 사용 한도 초과(429): 잠시 뒤 자동으로 다시 해요' : `Gemini 오류 ${res.status}: ${msg}`.trim());
          err.status = res.status;
          // 429일 때 Gemini가 알려주는 대기 시간 (예: "37s")
          const ri = (data.error?.details || []).find((d) => d.retryDelay);
          if (ri) err.retryAfter = parseFloat(ri.retryDelay) * 1000;
          throw err;
        }
        const cand = data.candidates?.[0] || {};
        const text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
        if (label && label !== 'stt') Debug.log('gemini', { label, model, ms: Date.now() - t0, temperature, thinking, finish: cand.finishReason || '', usage: data.usageMetadata || null,
          prompt: cap(parts.filter((p) => p.text != null).map((p) => p.text).join('\n'), 12000), response: cap(text, 60000) });
        if (!json) return text.trim();
        try { return parseJson(text); } catch (e) {
          // 원인 확인용으로 마지막 깨진 응답을 휴대폰에 남겨 둔다
          try { localStorage.setItem('mn_lastraw', JSON.stringify({ at: new Date().toISOString(), finish: cand.finishReason || '', len: text.length, head: text.slice(0, 3000), tail: text.slice(-3000) })); } catch (x) {}
          e.truncated = cand.finishReason === 'MAX_TOKENS';
          e.finish = cand.finishReason || '';
          e.badJson = true;
          throw e;
        }
      } catch (e) {
        if (e.name === 'AbortError') Debug.log('gemini-error', { label, model, status: 'timeout', ms: Date.now() - t0 });
        else if (e.badJson) Debug.log('gemini-error', { label, model, status: 'bad-json', message: e.message, finish: e.finish || '' });
        if (e.name === 'AbortError') { const t = new Error(`Gemini 응답이 너무 오래 걸려요 (${Math.round(timeoutMs / 1000)}초 넘음).`); t.status = 'timeout'; throw t; }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    };
    // 네트워크가 잠깐 끊기면(아이폰 'Load failed', 'Failed to fetch') 3초·8초 뒤 다시 보낸다
    const isNet = (e) => e && !e.status && !e.badJson && /load failed|failed to fetch|network|internet|connection/i.test(String(e.message || ''));
    const sendNet = async (w) => {
      for (let k = 0; ; k++) {
        try { return await send(w); } catch (e) {
          if (!isNet(e) || k >= 2) { if (isNet(e)) e.message = `인터넷 연결이 끊겨 정리를 마치지 못했어요(${e.message}). 화면을 켜 둔 채 다시 시도해 주세요.`; throw e; }
          Debug.log('gemini-error', { label, model, status: 'network', message: String(e.message || ''), retry: k + 1 });
          await new Promise((r) => setTimeout(r, k ? 8000 : 3000));
        }
      }
    };
    try {
      return await sendNet(true);
    } catch (e) {
      // JSON이 깨져 왔으면 한 번 더: 문법을 지키라는 말을 덧붙이고 온도를 낮춰 다시 요청
      if (!e.badJson) throw e;
      const note = `\n\n[중요] 앞선 응답의 JSON 문법이 깨졌습니다(${e.truncated ? '길이 초과로 잘림' : '형식 오류'}). 이번에는 올바른 JSON만 출력하세요. 문자열 안에서는 큰따옴표(") 대신 작은따옴표(')나 「」를 쓰고, 항목 사이 쉼표를 빠뜨리지 말고, 인용은 짧게 줄여 전체를 더 간결하게 쓰세요.`;
      parts = parts.map((p, i) => (i === parts.length - 1 && p.text != null ? { text: p.text + note } : p));
      temperature = 0;
      try { return await sendNet(true); } catch (e2) {
        if (e2.badJson) e2.message = `정리 결과를 읽지 못했어요(${e2.truncated ? '응답이 너무 길어 잘림' : 'JSON 형식 오류'}${e2.finish && e2.finish !== 'STOP' ? `, ${e2.finish}` : ''}). 다시 시도해 주세요.`;
        throw e2;
      }
    }
  }

  function parseJson(text) {
    const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (e) {}
    const s0 = t.indexOf('{');
    const body = s0 >= 0 ? t.slice(s0) : t;
    try { const en = body.lastIndexOf('}'); if (en > 0) return JSON.parse(body.slice(0, en + 1)); } catch (e) {}
    // 문자열 안의 따옴표가 이스케이프 안 됐거나 쉼표가 빠진 경우를 고쳐 본다
    const loose = lenientJson(body);
    try { const en = loose.lastIndexOf('}'); if (en > 0) return JSON.parse(loose.slice(0, en + 1)); } catch (e) {}
    const fixedLoose = repairJson(loose);
    if (fixedLoose) { try { return JSON.parse(fixedLoose); } catch (e) {} }
    // 응답이 중간에 잘린 경우: 마지막 완전한 값까지 남기고 열린 괄호를 닫아 살린다
    const fixed = repairJson(body);
    if (fixed) { try { return JSON.parse(fixed); } catch (e) {} }
    throw new Error('정리 결과를 읽지 못했어요(응답이 잘렸어요). 다시 시도해 주세요.');
  }
  // 느슨한 JSON 고치기: 문자열 안 따옴표 이스케이프, 빠진 쉼표 넣기, 끝 쉼표 빼기, 문자열 안 줄바꿈
  function lenientJson(src) {
    let out = '', inStr = false, esc = false;
    const nextNon = (i) => { let j = i; while (j < src.length && /\s/.test(src[j])) j++; return [src[j], j]; };
    let prevEnd = false; // 바로 앞이 값의 끝이었는지 (빠진 쉼표 판단)
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inStr) {
        if (esc) { esc = false; out += c; continue; }
        if (c === '\\') { esc = true; out += c; continue; }
        if (c === '\n') { out += '\\n'; continue; }
        if (c === '"') {
          const [n] = nextNon(i + 1);
          if (n === undefined || n === ',' || n === '}' || n === ']' || n === ':') { inStr = false; prevEnd = true; out += c; }
          else out += '\\"';
          continue;
        }
        out += c; continue;
      }
      if (c === '"' || c === '{' || c === '[') { if (prevEnd) out += ','; prevEnd = false; if (c === '"') inStr = true; out += c; continue; }
      if (c === ',') { const [n] = nextNon(i + 1); prevEnd = false; if (n === '}' || n === ']') continue; out += c; continue; }
      if (c === '}' || c === ']') { prevEnd = true; out += c; continue; }
      if (c === ':') { prevEnd = false; out += c; continue; }
      if (/[0-9tfn\-]/.test(c) && !/\s/.test(c)) {
        // 숫자·true·false·null 값
        let j = i; while (j < src.length && /[0-9a-zA-Z.+\-]/.test(src[j])) j++;
        if (prevEnd) out += ',';
        out += src.slice(i, j); i = j - 1; prevEnd = true; continue;
      }
      out += c;
    }
    return out;
  }
  function repairJson(src) {
    const stack = []; let inStr = false, esc = false, lastSafe = -1;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') { stack.pop(); lastSafe = i; }
      else if (c === ',') lastSafe = i - 1;
    }
    if (lastSafe < 0) return '';
    // 마지막 안전한 지점까지 자르고, 그 지점 기준으로 열린 괄호를 다시 센다
    let cut = src.slice(0, lastSafe + 1).replace(/[,:\s]+$/, '');
    const st = []; inStr = false; esc = false;
    for (const c of cut) {
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{' || c === '[') st.push(c === '{' ? '}' : ']'); else if (c === '}' || c === ']') st.pop();
    }
    if (inStr) return '';
    cut = cut.replace(/,\s*"[^"]*"\s*$/, ''); // 값 없이 남은 키 제거
    return cut + st.reverse().join('');
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function transcribe(cfg, blob, prevTail, { mime = 'audio/wav', approxSec = 30 } = {}) {
    const len = approxSec >= 60 ? `약 ${Math.round(approxSec / 60)}분` : `약 ${approxSec}초`;
    const prompt = `이 오디오는 한국 교회 현장 예배 녹음의 ${len} 구간입니다.
들리는 말을 한국어로 처음부터 끝까지 빠짐없이 그대로 받아쓰세요. 요약하거나 줄이지 마세요.
- 성경 책 이름, 장·절, 교회 용어(은혜, 성령, 언약 등)는 바른 표기로 쓰세요.
- 설교가 순차통역될 수 있어요. 멀리서 작게 들리는 통역 목소리나 다른 언어는 받아쓰지 말고 설교자의 한국어만 쓰세요. 통역 때문에 문장 사이가 끊겨도 설교자의 말을 자연스럽게 이어 쓰세요.
- 잘 들리지 않는 부분은 지어내지 말고 생략하세요.
- 찬양·연주는 (찬양), 다 같이 하는 기도·신앙고백·광고는 (기도), (광고)처럼 한 줄로만 표시하고, 말소리가 없으면 아무것도 출력하지 마세요.
- 화자 이름, 시간, 설명 없이 받아쓴 문장만 출력하세요.
${window.MN_TERMS ? `- 이전에 자주 잘못 받아쓴 말(잘못→바름): ${window.MN_TERMS}\n` : ''}${prevTail ? `직전 구간의 끝부분(문맥 참고용, 다시 쓰지 마세요): "${prevTail}"` : ''}`;
    const data = await blobToBase64(blob);
    return call(cfg, cfg.sttModel, [{ text: prompt }, { inline_data: { mime_type: mime, data } }],
      { temperature: 0, thinking: 0, timeoutMs: approxSec >= 60 ? 240000 : 90000, label: 'stt' });
  }

  // ---------- 긴 녹음 파일: Gemini에 파일째 올리고 시간 구간별로 받아쓰기 ----------
  // 아이폰에서 한 시간 넘는 녹음을 통째로 풀면 메모리가 모자랄 수 있어서, 디코딩 없이 원본을 올린다.
  const API = 'https://generativelanguage.googleapis.com';
  async function uploadFile(cfg, file, onProgress) {
    const mime = file.type || (/\.m4a$/i.test(file.name) ? 'audio/mp4' : /\.wav$/i.test(file.name) ? 'audio/wav' : 'audio/mpeg');
    const boundary = 'mn' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ file: { display_name: file.name.slice(0, 100) } })}\r\n`,
      `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, file, `\r\n--${boundary}--`,
    ]);
    const res = await new Promise((resolve, reject) => {
      // 진행률을 보여주려고 XHR 사용
      const x = new XMLHttpRequest();
      x.open('POST', `${API}/upload/v1beta/files?uploadType=multipart`);
      x.setRequestHeader('x-goog-api-key', cfg.key);
      x.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => resolve({ status: x.status, text: x.responseText });
      x.onerror = () => reject(new Error('녹음 파일을 올리지 못했어요. 인터넷 연결을 확인해 주세요.'));
      x.send(body);
    });
    let data = {};
    try { data = JSON.parse(res.text); } catch (e) {}
    if (res.status >= 300 || !data.file) throw new Error(`파일 올리기 실패 ${res.status}: ${data.error?.message || ''}`.trim());
    let f = data.file;
    // 처리 완료(ACTIVE)까지 기다린다
    for (let i = 0; i < 90 && f.state === 'PROCESSING'; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const r = await fetch(`${API}/v1beta/${f.name}`, { headers: { 'x-goog-api-key': cfg.key } });
      if (r.ok) f = await r.json();
    }
    if (f.state && f.state !== 'ACTIVE') throw new Error('Gemini가 녹음 파일을 처리하지 못했어요.');
    return { uri: f.uri, mime: f.mimeType || mime };
  }

  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  async function transcribeRange(cfg, ref, from, to) {
    const prompt = `이 오디오는 한국 교회 현장 예배 전체 녹음입니다. 그중 ${mmss(from)}부터 ${mmss(to)}까지 구간만 들리는 말을 한국어로 그대로 받아쓰세요.
- 이 구간 밖의 내용은 절대 쓰지 마세요.
- 성경 책 이름, 장·절, 교회 용어(은혜, 성령, 언약 등)는 바른 표기로 쓰세요.
- 설교가 순차통역될 수 있어요. 멀리서 작게 들리는 통역 목소리나 다른 언어는 받아쓰지 말고 설교자의 한국어만 쓰세요. 통역 때문에 문장 사이가 끊겨도 설교자의 말을 자연스럽게 이어 쓰세요.
- 잘 들리지 않는 부분은 지어내지 말고 생략하세요.
- 찬양·연주는 (찬양), 다 같이 하는 기도·신앙고백·광고는 (기도), (광고)처럼 한 줄로만 표시하세요.
- 화자 이름, 시간, 설명 없이 받아쓴 문장만 출력하세요.${window.MN_TERMS ? `\n- 이전에 자주 잘못 받아쓴 말(잘못→바름): ${window.MN_TERMS}` : ''}`;
    return call(cfg, cfg.sttModel, [{ file_data: { mime_type: ref.mime, file_uri: ref.uri } }, { text: prompt }], { temperature: 0, thinking: 0, timeoutMs: 300000, label: 'stt' });
  }

  async function liveSummary(cfg, meta, transcript) {
    const prompt = `당신은 예배 설교를 듣는 사람을 돕는 정리 도우미입니다. 아래는 지금까지 진행된 설교의 실시간 받아쓰기입니다(음성인식이라 오타가 있을 수 있으니 문맥으로 바로잡아 이해하세요).
예배: ${meta.service_type || ''} / 설교자: ${meta.preacher || ''} / 본문 말씀: ${meta.scripture || '(미입력)'}
본문 말씀이 주어졌으면 그 본문의 내용과 문맥을 바탕으로 흐름을 이해하세요.

지금까지의 흐름을 JSON으로 정리하세요. 들은 내용에 없는 것은 지어내지 마세요. 앞뒤 맥락을 보고 설교의 핵심(많이 반복되고 힘준 말)으로 이어지는 내용을 중심으로 쓰고, 핵심을 보완·설명하는 예화는 살리고, 광고·행정·농담처럼 핵심과 전혀 이어지지 않는 것만 빼세요.
{
 "title_guess": "추정 설교 제목",
 "scripture": ["본문·인용 구절"],
 "now": "지금 다루고 있는 내용 한 문장",
 "flow": [{"heading": "흐름의 단계(예: 서론, 첫째 대지)", "points": ["요점"]}],
 "key_sentences": ["지금까지 가장 중요한 문장(표시 문법 사용)"],
 "terms": ["핵심 용어"]
}
${MARK_RULES}

[받아쓰기]
${transcript}`;
    return call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.2, thinking: 0, timeoutMs: longWait(90000, transcript, 1500, 200000), label: 'live' });
  }

  // 최종 정리는 두 단계로 한다.
  // 1단계: 예배 전체 받아쓰기에서 설교 부분을 찾아 처음부터 끝까지 흐름을 빠짐없이 상세 노트로 뽑는다.
  // 2단계: 그 노트를 A4 한 장 분량으로 압축하고 색깔 표시를 넣는다.
  // (한 번에 하면 긴 받아쓰기에서 마지막 부분만 붙잡아 정리하는 문제가 있었다)
  const infoLine = (meta) => `설교 정보: 날짜 ${meta.date} / 예배 ${meta.service_type || ''} / 설교자 ${meta.preacher || '미상'} / 사용자가 적은 제목 ${meta.title || '(없음, 추정할 것)'} / 사용자가 적은 본문 말씀 ${meta.scripture || '(없음, 추정할 것)'}`;

  // (검증용) 교회 언약기도와 정리본을 비교할 때만 쓴다. 정리 과정에는 넣지 않는다.
  // 교회 요약(언약기도): 1부·2부를 한꺼번에 붙여 넣어도 이 예배(몇 부, 날짜, 본문)에 맞는 것 하나를 고른다
  function pickRef(text, meta = {}) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const blocks = raw.split(/(?=\[\s*언약\s*기도\s*\])/).map((b) => b.trim()).filter((b) => b.replace(/\[\s*언약\s*기도\s*\]/, '').trim());
    if (blocks.length < 2) return raw;
    const bu = (String(meta.service_type || '').match(/(\d)\s*부/) || [])[1];
    const sc = String(meta.scripture || '').replace(/\s+/g, '');
    const [y, m, d] = String(meta.date || '').split('-').map((n) => parseInt(n, 10));
    const score = (b) => {
      const top = b.split('\n').slice(0, 3).join(' ');
      let n = 0;
      if (bu && new RegExp(`${bu}\\s*부`).test(top)) n += 3;
      if (sc && top.replace(/\s+/g, '').includes(sc)) n += 2;
      if (y && top.includes(`${y}년 ${m}월 ${d}일`)) n += 1;
      return n;
    };
    return blocks.map((b) => [score(b), b]).sort((a, b2) => b2[0] - a[0])[0][1];
  }
  // 기도문의 머리·끝 인사를 빼고 내용 구절만 나눈다 (점검표에서 하나씩 반영됐는지 본다)
  function refClauses(ref) {
    return String(ref || '').replace(/\[\s*언약\s*기도\s*\]/g, '').split('\n').filter((l) => !/^\s*\d{4}년/.test(l)).join(' ')
      .replace(/(살아계신|전능하신|사랑의|거룩하신)\s*하나님/g, '').replace(/예수\s*그리스도\s*(의\s*)?이름으로\s*기도(합|드립)니다\.?\s*아멘\.?/g, '')
      .split(/[.,]\s*|(?:하옵소서|감사드립니다|감사합니다)/).map((c) => c.replace(/^(한\s*주간|그리하여|그래서)\s*/, '').trim()).filter((c) => c.replace(/\s/g, '').length >= 8);
  }
  async function sermonNotes(cfg, meta, transcript, profileText) {
    const prompt = `당신은 한국 교회 설교를 꼼꼼히 듣고 노트하는 조교입니다. 아래는 현장 예배 전체의 음성인식 받아쓰기입니다(오타가 있으니 문맥으로 바로잡아 이해하세요).
${infoLine(meta)}

할 일:
0. 먼저 문맥과 맥락을 파악하세요. 제목의 낱말을 따라가지 말고 받아쓰기 자체에서 설교의 실제 흐름을 읽어 냅니다.
 a. 설교를 내용이 바뀌는 곳마다 단락(sections)으로 순서대로 나누고, 단락마다 설교자가 진단한 문제(사람이 무엇에 빠져 하나님을 잃는가: 마귀·육신 쪽), 제시한 해답(그리스도 쪽: 복음의 사실, 영적 싸움), 그 단락을 결론짓는 문장, 핵심어를 적으세요.
 b. 많이 반복된 말뿐 아니라, 한 번만 나와도 논증의 결론 자리('…이 말이에요', '…이겁니다', '그래서 …', '…축복합니다')에 나온 말은 핵심입니다(예: '무아지경으로 드디어 살게 된다 이 말이에요', '운명의 굴레').
 c. 마무리 기도는 결론(적용·사명) 쪽에 치우치는 경우가 많습니다. 본론 중간의 문제 진단과 해법(예: 허무주의·중독 → 즉각 회개, 나를 쳐 복종)을 마무리 기도 때문에 놓치지 마세요.
 c-1. 단락마다 그 내용이 설교의 핵심(설교자가 밝힌 핵심 문장, 가장 많이 반복된 말)으로 어떻게 이어지는지 판단해 role과 link에 적으세요. role은 '핵심'(핵심을 직접 말함), '연결'(예화·본문 해설이 핵심으로 이어지는 다리), '보완'(핵심을 뒷받침하거나 설명하는 예화·간증·비유), '곁가지'(광고·행정, 핵심과 전혀 이어지지 않는 농담) 중 하나입니다. 농담·일상 이야기도 핵심이나 흐름으로 이어지면(예: 바꾼 머리 모양 → 인생을 바꾸라는 말씀으로 연결) '연결'이나 '보완'입니다. 핵심과 조금이라도 이어져 핵심을 보완·설명하면 '보완'으로 두고, '곁가지'는 정말 무관한 것만입니다. 낯선 말이나 예화도 앞뒤 문맥을 보고 판단하세요. 예(2026-11-22 2부): 눅 14장 수종병 → 원죄를 그리스도 이름으로 풀지 못해 몸만 부푼 상태 → 혼인 잔치 윗자리에서 부끄러움 → '하나님 나라의 초대에 응답하라'는 오늘 핵심 문장으로 바로 이어지는 '연결'. 마스터 카드 일화(그리스도 이름으로 기도하는 권세를 설명), 무속촌·비행기 영접 기도(그리스도 사실의 가치를 몸으로 체험)는 '보완'. 재정위원 모집, 파리 농담은 '곁가지'.
 c-2. 설교자는 핵심을 말할 때 거의 늘 그 반대쪽과 짝지어 대조합니다. 단락마다 그리스도 쪽(아는 자·붙잡은 자·세우는 자)과 그 대조(모르는 자·알려고 하지 않는 자·빗나간 자·막는 것)를 pair에 짝으로 적으세요. 예(2026-11-22 2부): '창 3:15 사실의 가치를 아는 자는 즉각 찾아낸다' ↔ '그 사실에서 빗나가 가치를 못 느끼는 교회는 철학·심리학·종교로 전락하고, 잃어버려도 뭘 잃었는지 모르고 산다'.
 d. 단락들을 묶어 flow3를 만드세요: ① 하나님이 이미 해 주신 것(복음의 사실) ② 무엇에 빠져 하나님을 잃어버리고, 어떻게 돌이켜 싸워 이기는가 ③ 그리하여 어떤 삶·사명으로 열매 맺는가. 제목과 실제 흐름이 떨어져 있으면 title_gap에 적고 실제 흐름을 따릅니다(예: 2026-11-22 2부 눅 15:8-10은 제목은 드라크마였지만 실제 흐름은 창 3:15 사실의 가치 → 요 8:44 운명의 굴레·허무주의·중독 → 즉각 회개·나를 쳐 복종 → 통찰력·한 영혼의 가치·자발적 헌신·전도자의 기쁨).
${(window.MN_REPEATED || []).length ? ` f. 받아쓰기에서 직접 센 반복 상위어(그리스도·하나님·예수 제외, 괄호는 횟수): ${window.MN_REPEATED.map(([w, c]) => `${w}(${c})`).join(', ')}
   가장 많이 반복된 두세 말은 이 설교의 핵심어입니다. central_theme은 이 상위어로 세우고(예: 2부는 가치·사실 → '사실의 가치'), text_keys에 weight 3으로 넣고, 그 말이 설교에서 어떤 뜻으로 쓰였는지 theme_notes에 담으세요.
` : ''}${window.MN_SIGNALS ? ` e. 아래는 받아쓰기에서 설교자가 단락을 결론지은 문장을 앞·중간·끝 순서로 뽑은 것입니다. 흐름을 잡는 단서로 쓰세요.
${window.MN_SIGNALS}
` : ''}
1. 찬양, 대표기도, 광고, 헌금, 축도 등을 빼고 '설교'가 시작되는 곳과 끝나는 곳을 찾으세요. 설교 전 성경 봉독이 있으면 본문 파악에 쓰세요.
2. 설교의 처음부터 끝까지 흐름을 시간 순서대로 빠짐없이 노트하세요. 마지막 부분만이 아니라 앞·중간 부분의 주장과 설명을 반드시 고르게 담으세요. 설교의 대부분은 본론입니다.
3. 설교자가 실제로 한 말을 근거로 하고, 핵심 문장은 받아쓰기에서 그대로(오타만 고쳐) 인용하세요.
4. 받아쓰기에 같은 내용이 두 번 들어간 구간(겹쳐 올린 부분)은 한 번만 쓰세요. 시간 표시(00:00 등)나 출처 표시 줄은 무시하세요.
5. 설교 끝의 마무리 기도가 설교 요지를 정리하는 경우가 많으니 대지와 결론을 정할 때 참고하세요. 설교 중간의 교회 운영·광고 이야기는 비중을 낮추세요.
6-1. 그리스도 쪽도 똑같이 빠짐없이: 그리스도(예수는 그리스도, 여자의 후손), 복음, 영적 싸움, 재창조(죽을 몸도 살리심)에 대한 설교자의 핵심 문장을 christ_side에 원문 그대로 담으세요. 마귀 쪽만 많고 그리스도 쪽이 빠지면 잘못된 노트입니다.
6-2. 이번 본문과 관련된 핵심 언어를 text_keys에 뽑으세요. 본문 말씀에서 나왔거나 설교자가 본문을 풀며 거듭 쓴 말입니다(예: 출 25:1-9 설교라면 성막, 예물, 헌신, 유턴, 정체성). 설교마다 다르며, 정리본에 하나도 빠지지 않고 들어갑니다. 중요도는 (1) 반복 횟수(여러 번 되풀이할수록 중요)와 (2) 문맥상 강조(‘진짜’, ‘꼭’, ‘반드시’, ‘제발’, ‘이 비밀을 알아야 돼요’, 같은 말을 연달아 반복하거나 선포함, 질문하고 스스로 답함, ‘아멘’을 받아냄)로 판단해 weight(1~3)로 매기고 중요한 순서로 쓰세요. 설교자가 힘줘 말한 핵심 문장은 emphasized에 원문 그대로 담으세요.
6. 마귀·사단·사탄·뱀·귀신·흑암·저주·참소에 관한 말과 구절(요 8:44, 요일 3:8, 창 3:15 등), '깨뜨려라·내어쫓아라·박살 내라·결박하라·떠나가라·~할지어다' 같은 대적·선포 기도는 하나도 빠뜨리지 말고 spiritual_warfare에 원문 그대로(오타만 고쳐) 담으세요. 이 설교자에게는 매우 중요한 주제입니다.
6-3. 설교자가 '오늘 메시지의 핵심입니다', '세 가지 비밀', '첫째·둘째'처럼 직접 핵심이나 요점을 밝힌 곳을 반드시 찾아 stated_core, stated_points에 원문 그대로 담으세요(끝부분이나 마무리 기도 직전에 나오는 경우가 많습니다). '핵심'이라는 말이 없어도 '…하라고 오늘 하나님이 말씀하신 거예요', '오늘 이 비밀 하나만 깨달으면 끝난 거예요'처럼 오늘 말씀의 요지를 못 박는 문장이면 stated_core입니다. stated_core를 비워 두지 마세요.${(window.MN_CORE_CANDS || []).length ? `\n   받아쓰기에서 찾은 후보 문장(앱이 찾음, 이 중 오늘 말씀의 요지를 가장 잘 담은 것을 고르세요): ${window.MN_CORE_CANDS.map((c) => `「${c.text}」`).join(' / ')}` : ''}
7. 설교는 언제나 그리스도와 마귀의 대립과 싸움입니다. 그리스도 쪽(복음, 창 3:15 여자의 후손, 영적인 것, 영적 싸움)과 마귀 쪽(사단, 요 8:44, 육신, 뱀)이 이번 설교에서 각각 무엇으로 나타나는지 찾아 contrast에 담으세요. 예(출 25:1-9): 내 몸에 하나님의 성막을 지으라(그리스도) ↔ 짓지 못하게 완악하고 딱딱하게, 육신적으로만 살게 만드는 마귀의 역사를 깨뜨리라(마귀). 각 대지가 이 싸움의 어느 쪽을 말하는지도 보세요.
8. 이 설교의 구조적 특징(설교 시작·끝을 알리는 말, 대지를 나누는 표현, 예화·적용·마무리 방식)과 음성인식이 잘못 받아쓴 말(사람 이름, 성경 이름, 교회 용어)을 함께 분석하세요. 다음 설교를 더 잘 정리하기 위한 학습 자료로 쌓입니다.
${profileText ? `
[지금까지 학습한 이 설교자의 설교 패턴 — 설교 구간 찾기와 대지 나누기에 참고하되, 이번 설교 내용이 우선입니다]
${profileText}
` : ''}
아래 JSON 하나만 출력하세요.
{
 "sermon_found": true,
 "scripture_main": "주 본문",
 "title_guess": "설교 제목 추정",
 "big_idea": "설교 전체를 꿰는 중심 메시지 한두 문장",
 "central_theme": "설교가 실제로 끌고 간 중심 주제어 하나, 1~3단어의 짧은 말 (제목 낱말과 다를 수 있음. 예: 성막, 사실의 가치)",
 "title_gap": "제목과 실제 흐름의 관계 한 줄 (제목이 실제 흐름을 잘 담으면 빈 문자열)",
 "sections": [{"cue": "단락이 시작되는 말 몇 마디", "role": "핵심|연결|보완|곁가지", "link": "이 단락이 핵심으로 어떻게 이어지는가 한 줄", "pair": {"christ": "그리스도 쪽: 아는 자·붙잡은 자의 모습", "against": "대조: 모르거나 알려고 하지 않는 자, 빗나간 자, 막는 것"}, "problem": "설교자가 진단한 문제(마귀·육신 쪽), 없으면 빈 문자열", "answer": "제시한 해답(그리스도 쪽)", "conclusion": "단락을 결론짓는 문장 원문", "keys": ["핵심어 1~3개"]}],
 "flow3": {"grace": "① 감사: 하나님이 이미 해 주신 것, 복음의 사실(창 3:15, 십자가, 재창조)", "fight": "② 한 주간: 무엇(마귀·육신·요 8:44)에 빠져 하나님을 잃어버리고, 어떻게 돌이켜 영적 싸움으로 이기는가", "life": "③ 그리하여: 어떤 삶·사명으로 열매 맺는가"},
 "stated_core": "설교자가 '오늘 메시지의 핵심', '오늘 본문은' 처럼 직접 밝힌 핵심 문장 원문 (없으면 빈 문자열)",
 "stated_points": ["설교자가 '세 가지 비밀', '첫째·둘째'처럼 직접 밝힌 요점들 (없으면 빈 배열)"],
 "theme_notes": ["중심 주제에 대해 설교자가 한 설명·의미·적용을 빠짐없이(본문 해설 포함). 제목의 말(예: 그리스도의 몸, 성막, 건축, 예물)마다 설교자가 그 말을 어떻게 풀었는지와 구절(예: 엡 1:22-23 교회는 그의 몸, 요 2:19-21 성전된 자기 육체, 히 9:11 손으로 짓지 않은 장막)을 한 항목씩"],
 "contrast": {"build": "그리스도 쪽: 이번 설교에서 붙잡고 세울 것(복음·창 3:15·영적인 것)", "break": "마귀 쪽: 그것을 막는 것, 깨뜨릴 것(사단·요 8:44·육신·뱀)", "how": "영적 싸움으로 어떻게 깨뜨리고 세우는가"},
 "intro": ["서론에서 한 말씀의 요지들(농담·일상 이야기는 핵심이나 흐름에 이어질 때만, 어떻게 이어지는지와 함께. 인사·광고는 빼기)"],
 "points": [{"heading": "대지(소제목)", "claims": ["이 부분의 주장·설명 요지들"], "verses": ["인용 구절"], "illustrations": ["예화·간증 한 줄 요약"], "quotes": ["핵심 문장 원문"]}],
 "detail_keys": ["정리본에 꼭 남길 구체적 예화·인물·본문 세부를 가리키는 짧은 말 3~6개 (예: 이수정, 엘리야, 금·은·동). 핵심으로 이어지는('핵심'·'연결') 것만"],
 "break_keys": ["마귀 쪽: 주제를 막는 것을 가리키는 짧은 말 2~5개 (예: 완악함, 육신적, 질병의 저주, 참소)"],
 "conclusion": ["결론·결단 촉구의 요지들"],
 "application": ["설교자가 제시한 적용"],
 "text_keys": [{"key": "본문 핵심 언어", "meaning": "이 설교에서의 뜻 한 줄", "weight": 3}],
 "related_terms": [{"word": "제목의 말·본문 핵심 언어·많이 반복된 말", "same": ["이 설교에서 앞뒤 문맥상 같은 뜻이나 같은 맥락으로 쓰인 말(예: 건축 → 짓다·세우다, 그리스도의 몸 → 성막·성전·거룩케 하다)"]}],
 "emphasized": ["설교자가 반복하거나 힘줘 말한 핵심 문장 원문"],
 "christ_side": [{"key": "핵심어 (예: 성막, 헌신, 유턴, 정체성, 재창조)", "quote": "설교자의 핵심 문장 원문"}],
 "spiritual_warfare": ["마귀·사단·악한 영·유혹 관련 발언 (없으면 빈 배열)"],
 "scriptures": ["설교 중 인용된 모든 구절"],
 "style": {
   "start_cue": "설교가 시작될 때의 말이나 신호 (예: 본문 봉독 후 '오늘 말씀은…')",
   "end_cue": "설교가 끝날 때의 말이나 신호 (예: '기도하겠습니다')",
   "intro": "도입 방식 한 줄 (예: 지난주 설교 복습 → 질문 던지기)",
   "point_markers": ["대지를 나눌 때 쓰는 표현 그대로"],
   "transitions": ["자주 쓰는 연결·강조 표현"],
   "illustrations": "예화·간증을 쓰는 방식 한 줄",
   "application": "적용·결단을 촉구하는 방식 한 줄",
   "closing": "마무리 방식 한 줄",
   "structure": "이 설교의 전체 구조 한 줄 (예: 서론-본문 해설 3대지-예화-결단 기도)"
 },
 "term_fixes": [{"wrong": "받아쓰기에 잘못 나온 말", "right": "바른 말"}]
}
대지는 설교자가 '첫째, 둘째'처럼 나눴으면 그대로, 아니면 내용 흐름에 따라 2~5개로 나누세요.
분량: 원문 인용은 핵심 한 문장씩만 짧게, 같은 내용을 여러 필드에 되풀이하지 말고, 전체 JSON은 15,000자 이내로 쓰세요(설교가 90분 넘게 길어도). 인용문 안에서는 큰따옴표(") 대신 작은따옴표(')나 「」를 쓰세요(JSON이 깨지지 않게).

[받아쓰기 전체]
${transcript}`;
    const opt = { json: true, temperature: 0.2, thinking: 2048, timeoutMs: longWait(300000, transcript, 4000, 600000), label: 'notes(1단계 설교 노트)' };
    try {
      return await call(cfg, cfg.anaModel, [{ text: prompt }], opt);
    } catch (e) {
      // 긴 설교에서 노트가 너무 길어 응답이 잘리거나 깨지면, 더 짧게 쓰라고 한 번 더 요청한다
      if (!/정리 결과를 읽지 못했어요/.test(e.message || '')) throw e;
      const short = prompt.replace('아래 JSON 하나만 출력하세요.', '아래 JSON 하나만 출력하세요. 앞선 응답이 너무 길어 잘렸으니 이번에는 간결하게: 인용은 한 문장씩만, 배열마다 항목은 많아야 6개, 전체 8,000자 이내로 쓰세요.');
      return call(cfg, cfg.anaModel, [{ text: short }], opt);
    }
  }

  // 받침에 맞는 조사: 성막을, 예배를
  const eul = (w) => { const c = String(w || '').slice(-1).charCodeAt(0) - 0xac00; return c >= 0 && c < 11172 && c % 28 ? '을' : '를'; };
  // ---------- 정리본 점검표 ----------
  // 사용자가 요구한 필수 요소를 한꺼번에 검사한다. 빠진 항목만 보충하도록 고치기 호출에 넘기고, 결과는 화면에도 보여 준다.
  const norm = (s) => window.Markup.strip(Array.isArray(s) ? s.join(' ') : typeof s === 'object' && s ? JSON.stringify(s) : String(s || '')).replace(/\s+/g, '');
  const head = (k) => String(k || '').split(/[·(,/]/)[0].replace(/\s+/g, '');
  function marksOf(doc, k) {
    const re = new RegExp(`\\[\\[${k}\\|([\\s\\S]*?)\\]\\]`, 'g');
    const all = JSON.stringify(doc);
    return [...all.matchAll(re)].map((m) => m[1]);
  }
  // 조사·어미가 달라도 잡히게 두 글자 묶음이 얼마나 겹치는지로 본다
  const grams = (s) => { const t = norm(s).replace(/[^가-힣A-Za-z0-9]/g, ''); const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return [...out]; };
  // 문장의 핵심 낱말(조사·흔한 말 뺀 두 글자 이상) 중 정리본에 있는 개수
  const ANCHOR_STOP = /^(그리스도|하나님|예수|세상|육신적|사람|신자|성도|하는|있는|없는|자기|모든|우리|내가|나는|이런|그런|것|자|때|않는|못하는|없이|영적|아래서|된다)$/;
  const anchorHits = (s, whole) => [...new Set(String(s).split(/[\s,·'"()]+/).map((w) => w.replace(/(에게|에서|으로|하고|하며|하는|하게|했던|하다가|다가|에만|에도|이나|처럼|만|을|를|의|이|가|은|는|에|와|과|도|로|며|고)$/, '')).filter((w) => w.length >= 2 && !ANCHOR_STOP.test(w)))].filter((w) => whole.includes(w)).length;
  const overlap = (s, whole) => { const g2 = grams(s); if (!g2.length) return 1; return g2.filter((x) => whole.includes(x)).length / g2.length; };
  // 받아쓰기 원문 핵심 문장 다듬기: 군말·호칭을 덜고 너무 길면 문장 경계에서 자른다
  function tidyCore(s) {
    let t = window.Markup.strip(String(s || '')).replace(/\s+/g, ' ').trim()
      .replace(/^(그래서|자|여러분|그러니까)[,\s]+/g, '').replace(/(라는 게|라는 것이)\s*오늘\s*메시지의\s*핵심입니다\.?$/, '').replace(/["“”]/g, '')
      .replace(/(성막|성전|집)을 지라고/g, '$1을 지으라고'); // 받아쓰기가 '지으라고'를 '지라고'로 줄여 적는 일이 잦다
    if (t.length > 160) { const cut = t.slice(0, 160); const k = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf(','), cut.lastIndexOf(' ')); t = cut.slice(0, k > 80 ? k : 160).replace(/[,\s]+$/, '') + '…'; }
    return t;
  }
  // 같은 뜻·같은 맥락 표현(띄어쓰기 없앤 형태로 비교). 점검표 전체가 글자 그대로가 아니라 이 맥락으로 본다(사용자 기준).
  // 앱 기본값 + 노트의 related_terms(이 설교의 문맥에서 AI가 판단한 같은 맥락 말)를 합친다.
  const TITLE_SYN = {
    건축: ['짓', '지으', '지어', '세우', '세워', '건설', '건립', '쌓'],
    그리스도의몸: ['성막', '성전', '거룩', '내몸', '몸에', '처소'],
    예물: ['헌신', '드리', '드림', '헌물'],
    성전: ['성막', '몸'], 성막: ['성전', '처소'],
    의미: ['뜻', '비밀'],
  };
  let REL_NOTES = {};
  function setRelated(notes) {
    REL_NOTES = {};
    for (const r of (notes && notes.related_terms) || []) {
      const w = norm(r.word || ''); if (!w) continue;
      REL_NOTES[w] = [...new Set([...(REL_NOTES[w] || []), ...(r.same || []).map((x) => norm(x).replace(/(하다|다)$/, '')).filter((x) => x.length >= 1 && x !== w)])];
    }
  }
  const related = (w) => { const k = norm(w); return [...(TITLE_SYN[k] || []), ...(REL_NOTES[k] || [])]; };
  // text에 w가 있거나 같은 맥락 말이 있으면 그 말을, 없으면 ''
  function found(text, w) {
    const k = norm(w); if (!k) return '';
    if (text.includes(k)) return k;
    return related(k).find((x) => x && text.includes(x)) || '';
  }
  // '주님' 대신 '그리스도'(사용자 기준). 조사를 맞춰 바꾼다. 설교자 원문인 stated_core는 그대로 둔다.
  function lordToChrist(doc) {
    let n = 0;
    const R = (s) => (typeof s !== 'string' ? s : s.replace(/주님(께서|께|은|이|을|의|과|도|만|으로|에게)?/g, (m, j = '') => { n++; return `그리스도${{ 은: '는', 이: '께서', 을: '를', 과: '와', 으로: '로', 에게: '께' }[j] ?? j}`; }));
    const A = (a) => (Array.isArray(a) ? a.map(R) : R(a));
    doc.one_line = R(doc.one_line); doc.summary = A(doc.summary); doc.intro = A(doc.intro); doc.conclusion = A(doc.conclusion); doc.questions = A(doc.questions);
    (doc.body || []).forEach((b) => { b.heading = R(b.heading); b.paragraphs = A(b.paragraphs); });
    if (doc.perspectives) for (const k of Object.keys(doc.perspectives)) doc.perspectives[k] = A(doc.perspectives[k]);
    (doc.key_terms || []).forEach((t) => { t.meaning = R(t.meaning); });
    return n;
  }
  function redAll(doc) {
    let n = 0;
    // 먼저 마귀 쪽이 아닌 문장에 걸친 빨강을 벗기고(trimRed), 그다음 표시 밖에 남은 마귀 쪽 말을 빨강으로 감싼다(autoRed)
    const R = (s) => { if (typeof s !== 'string') return s; const [t] = window.Markup.trimRed(s); const [o, k] = window.Markup.autoRed(t); n += k; return o; };
    const A = (a) => (Array.isArray(a) ? a.map(R) : R(a));
    doc.one_line = R(doc.one_line); doc.summary = A(doc.summary); doc.intro = A(doc.intro); doc.conclusion = A(doc.conclusion); doc.questions = A(doc.questions);
    (doc.body || []).forEach((b) => { b.paragraphs = A(b.paragraphs); });
    if (doc.perspectives) for (const k of Object.keys(doc.perspectives)) doc.perspectives[k] = A(doc.perspectives[k]);
    return n;
  }
  function checkDoc(doc, notes, theme, meta = {}) {
    setRelated(notes);
    const items = [];
    const add = (key, label, ok, detail, fix) => items.push({ key, label, ok: !!ok, detail, fix });
    const body = Array.isArray(doc.body) ? doc.body : [];
    const whole = norm({ sc: doc.stated_core, t: doc.title, o: doc.one_line, s: doc.summary, i: doc.intro, b: body, c: doc.conclusion, k: doc.key_terms });
    const top = norm([doc.title, doc.one_line, doc.summary]);
    const count = (w) => (w ? whole.split(head(w)).length - 1 : 0);

    // 1. 중심 주제
    if (theme) {
      // '잃어버린 드라크마'처럼 여러 낱말이면 마지막 명사(드라크마)로 본다
      const t = head(String(theme).trim().split(/\s+/).pop());
      const heads = body.filter((b) => found(norm([b.heading, b.paragraphs]), t)).length;
      const n = whole.split(t).length - 1 + related(t).reduce((a, x) => a + whole.split(x).length - 1, 0);
      const ok = !!found(top, t) && heads >= Math.max(1, Math.floor(body.length / 2)) && n >= 3;
      add('theme', `중심 주제「${theme}」`, ok, `제목·요약 ${top.includes(t) ? '있음' : '없음'}, 대지 ${heads}/${body.length}, ${n}회`,
        `one_line과 summary 첫 줄에「${theme}」${eul(theme)} 넣고 대지 절반 이상의 내용에서「${theme}」와 연결하세요(대지 제목마다 같은 구절을 되풀이하지는 마세요). 노트의 theme_notes(설명·본문 해설)를 담으세요.`);
    }
    // 2. 그리스도 쪽
    const green = marksOf(doc, 'g');
    const christ = ['그리스도', '복음', '여자의후손', '창3:15', '영적싸움', '재창조'].filter((w) => whole.includes(w));
    add('christ', '그리스도 쪽 (복음·창 3:15·영적 싸움·재창조)', green.length >= 4 && christ.length >= 3, `초록 ${green.length}곳, ${christ.join('·') || '없음'}`,
      '노트의 christ_side와 contrast.build를 초록 표시로 보충하세요(그리스도, 복음, 창 3:15 여자의 후손, 영적 싸움, 재창조 중 설교에 나온 것).');
    // 3. 마귀 쪽: 주제를 막는 것과 깨뜨림
    const red = marksOf(doc, 'r');
    const breakKeys = (notes.break_keys || []).map(head).filter(Boolean);
    const hitBreak = breakKeys.filter((k) => found(whole, k));
    const devilHead = body.some((b) => /마귀|사단|사탄|원수|뱀|막는|못하게|굴레|요8:44|육신|흑암|중독|잃게|빼앗/.test(norm(b.heading)));
    // 노트의 spiritual_warfare(대적·선포·마귀 관련 발언)가 정리본 빨강에 얼마나 담겼는지
    const sw = (notes.spiritual_warfare || []).filter((x) => String(x).length >= 8);
    const redText = norm(red);
    const swHit = sw.filter((x) => overlap(x, redText) >= 0.3).length;
    const swOk = sw.length < 2 || swHit >= Math.ceil(sw.length * 0.6);
    const okDevil = red.length >= 3 && devilHead && swOk && (!breakKeys.length || hitBreak.length >= Math.min(2, breakKeys.length)) && /마귀|사단|사탄|막|못하게|굴레|요8:44|육신|흑암|중독/.test(top);
    add('devil', '마귀 쪽 (막고 빼앗는 것과 깨뜨림)', okDevil,
      `빨강 ${red.length}곳${doc._autoRed ? `(앱이 ${doc._autoRed}곳 보충)` : ''}, 마귀 관련 발언 ${swHit}/${sw.length}, 마귀 대지 ${devilHead ? '있음' : '없음'}, 막는 것 ${hitBreak.join('·') || '없음'}${breakKeys.length ? `/${breakKeys.length}` : ''}`,
      `본론에 '무엇이「${theme}」${eul(theme)} 막는가와 그리스도의 이름으로 깨뜨림' 대지를 두고(제목에 마귀·사단 또는 '막는'이 드러나게), summary에도 한 줄 넣으세요. 노트의 contrast.break, break_keys(${breakKeys.join(', ')}), spiritual_warfare의 대적·선포를 빨강으로 담으세요. 빠진 마귀 관련 발언: ${sw.filter((x) => overlap(x, redText) < 0.3).slice(0, 4).join(' / ')}`);
    // 4. 본문 핵심 언어
    const keys = (notes.text_keys || []).map((k) => k.key).filter(Boolean);
    const missKeys = keys.filter((k) => !found(whole, head(k)));
    add('keys', '본문 핵심 언어', !missKeys.length, keys.length ? (missKeys.length ? `빠짐: ${missKeys.join(', ')}` : keys.join(', ')) : '노트에 없음',
      `빠진 본문 핵심 언어(${missKeys.join(', ')})를(같은 뜻·같은 맥락의 말로 풀어도 됩니다) 각각 관련 대지나 요약에 굵게+밑줄로 넣으세요.`);
    // 5. 반복·강조된 말: 노트의 weight 3 핵심어 + 받아쓰기에서 직접 센 반복 상위어(가장 많은 말의 절반 이상 나온 말, 최대 3개)
    const rep = window.MN_REPEATED || [];
    const topN = rep.length ? rep[0][1] : 0;
    const topWords = rep.filter(([, c]) => c >= Math.max(8, topN * 0.5)).slice(0, 3).map(([w]) => w);
    const heavy = [...new Set([...topWords, ...[...(notes.text_keys || [])].filter((k) => (k.weight || 0) >= 3).map((k) => k.key)])];
    const headsAll = norm([doc.one_line, doc.summary, body.map((b) => b.heading)]);
    // 상위어는 앞(한 줄·요약·대지 제목)에 있고 본문 전체에서도 3번 이상 써야 통과
    const missHeavy = heavy.filter((k) => !found(headsAll, head(k)) || (topWords.includes(k) && count(k) + related(head(k)).reduce((a, x) => a + whole.split(x).length - 1, 0) < 3));
    add('weight', '많이 반복·강조된 말이 앞에', !missHeavy.length, (topWords.length ? `받아쓰기 반복: ${rep.slice(0, 5).map(([w, c]) => `${w} ${c}회`).join(', ')} · ` : '') + (heavy.length ? (missHeavy.length ? `앞에 없음: ${missHeavy.join(', ')}` : '모두 앞에 있음') : '해당 없음'),
      `설교에서 가장 많이 반복된 말(${missHeavy.join(', ')})을 one_line과 summary에 올리고, 대지 본문에서도 그 말이 설교에서 어떤 뜻인지(예: '사실'은 창 3:15 그리스도가 역사적 사실, '가치'는 그 사실을 내 몸에 적용해 아는 가장 귀한 것) 3번 이상 살려 쓰세요.`);
    // 6. 실제 예화·본문 해설
    const details = (notes.detail_keys || []).map(head).filter(Boolean);
    const hitD = details.filter((k) => found(whole, k));
    const needD = Math.min(details.length, Math.max(2, Math.ceil(details.length * 0.6)));
    add('detail', '설교의 실제 예화·본문 해설', hitD.length >= needD, details.length ? `${hitD.length}/${details.length} (${hitD.join('·') || '없음'})` : '노트에 없음',
      `빠진 예화·본문 세부(${details.filter((k) => !hitD.includes(k)).join(', ')})를 관련 대지에 설교자의 표현으로 한두 문장씩 넣으세요. 일반론 문장으로 바꾸지 마세요.`);
    // 7. 설교자가 직접 밝힌 핵심·요점
    const core = String(notes.stated_core || '').trim();
    const sp = (notes.stated_points || []).filter(Boolean);
    if (core || sp.length) {
      // 조사·어미가 달라도 잡히게 두 글자 묶음이 얼마나 겹치는지로 본다
      const hit = (s) => { const o = overlap(s, whole); return o >= 0.6 || (o >= 0.3 && anchorHits(s, whole) >= 2); }; // 바꿔 말해도 맥락이 같으면 반영
      const coreOk = !core || hit(core);
      const spHit = sp.filter(hit).length;
      add('stated', '설교자가 직접 밝힌 핵심·요점', coreOk && spHit >= Math.ceil(sp.length * 0.7), `${core ? (coreOk ? '핵심 반영' : '핵심 빠짐') : ''}${sp.length ? ` 요점 ${spHit}/${sp.length}` : ''}`.trim(),
        `설교자가 직접 밝힌 핵심("${core}")을 one_line에 살리고, 요점(${sp.join(' / ')})을 대지나 summary에 드러내세요.`);
    }
    // 7-1. 제목의 말: 사용자가 적은 제목의 낱말(예: 그리스도의 몸, 성막, 건축, 예물)이 본론에서 설명되는지
    // 쉼표로 나눈 짧은 구(예: '그리스도의 몸')는 통째로, 긴 구는 낱말로 본다
    const SKIP = /^(위해|위한|의미|하는|드리는|이르게|하게|통해|대한|오늘|하나님|그리스도|예수|찾아)$/;
    const tPhrase = new Set(); // 제목 앞머리의 짧은 구는 제목의 중심이라 반드시 풀어야 한다
    const tWords = [...new Set(String(meta.title || '').split(/[,·:]/).flatMap((ph) => {
      const t = ph.trim(); if (!t) return [];
      if (t.replace(/\s+/g, '').length <= 7 && /\s/.test(t)) { const k = t.replace(/\s+/g, ''); tPhrase.add(k); return [k]; }
      return t.split(/\s+/).filter((w) => !SKIP.test(w)).map((w) => w.replace(/(을|를|의|이|가|은|는|에|와|과|도|으로|로)$/, '')).filter((w) => w.length >= 2 && !SKIP.test(w));
    }))];
    const bodyText = norm([doc.intro, body.map((b) => b.paragraphs), doc.conclusion]);
    if (tWords.length) {
      // 제목 말은 같은 뜻·같은 맥락의 말로 풀어도 된다(사용자 기준: 건축 = 짓다, 그리스도의 몸 = 성막·성전·거룩케 하는 말)
      const missT = tWords.filter((w) => !found(bodyText, w));
      add('title', '제목의 말을 본문에서 풂', !missT.some((w) => tPhrase.has(w)) && missT.length <= Math.floor(tWords.length * 0.25) /* 제목과 실제 흐름이 조금 다른 설교도 있어 하나쯤은 봐준다 */, missT.length ? `본론에 없음: ${missT.join(', ')}` : tWords.map((w) => { const f = found(bodyText, w); return f && f !== w ? `${w}(=${f})` : w; }).join(', '),
        `제목의 말(${missT.join(', ')})이 이 설교에서 무엇을 뜻하는지 설교자의 설명과 구절로 본론에 담으세요(노트의 theme_notes·sections 참고).`);
    }
    // 7-2. 중심 주제 설명 범위: 노트 theme_notes(주제에 대한 설교자의 설명·본문 해설)가 정리본에 얼마나 담겼는지
    const tn = (notes.theme_notes || []).filter((x) => String(x).length >= 8);
    if (tn.length >= 3) {
      const missN = tn.filter((x) => overlap(x, whole) < 0.4);
      add('themeNotes', `중심 주제 설명 (${theme || '주제'})`, missN.length <= Math.floor(tn.length * 0.3), `${tn.length - missN.length}/${tn.length}`,
        `중심 주제에 대한 설교자의 다음 설명을 관련 대지에 담으세요(대지를 하나 더 만들어도 됩니다): ${missN.join(' / ')}`);
    }
    // 8. 문맥: 단락마다 설교자가 진단한 문제와 해답의 핵심어가 정리본에 남았는지 (중간 단락이 묻히지 않게)
    const secs = (notes.sections || []).filter((x) => (x.keys || []).length && !/곁가지/.test(x.role || ''));
    if (secs.length >= 2) {
      const missS = secs.filter((x) => !(x.keys || []).some((k) => whole.includes(head(k))));
      add('context', '단락별 문제·해답 (문맥)', missS.length <= Math.floor(secs.length * 0.25), `${secs.length - missS.length}/${secs.length} 단락${missS.length ? ` · 빠짐: ${missS.slice(0, 3).map((x) => (x.keys || []).join('·')).join(' / ')}` : ''}`,
        `다음 단락의 문제 진단과 해답을 관련 대지나 summary에 담으세요: ${missS.map((x) => `${(x.keys || []).join('·')} (${x.problem || ''} → ${x.answer || ''})`).join(' / ')}`);
    }
    // 8-1. 대지마다 대조 짝: 노트의 pair.against가 정리본에 담겼는지 + 대지 본문에 대조 표현이 있는지
    const pairs = (notes.sections || []).filter((x) => x.pair && x.pair.christ && x.pair.against && !/곁가지/.test(x.role || ''));
    if (pairs.length) {
      // 반대쪽을 바꿔 말해도(예: '로뎀나무 아래서 낙심한 엘리야처럼') 맥락이 같으면 담긴 것으로 본다: 글자 겹침 35% 이상, 또는 20% 이상이면서 핵심 낱말 2개 이상
      const missP = pairs.filter((x) => { const o = overlap(x.pair.against, whole); return !(o >= 0.35 || (o >= 0.2 && anchorHits(x.pair.against, whole) >= 2)); });
      // 대지가 많은 설교는 한 장에 모든 짝을 다 넣기 어려워 4개 중 1개까지는 봐준다(핵심 단락의 짝은 반드시)
      const missCore = missP.filter((x) => /핵심/.test(x.role || ''));
      const turn = /반면|그러나|하지만|못하|않|모르|빗나|대신|↔|막|깨뜨/;
      const withTurn = body.filter((b) => turn.test(window.Markup.strip((b.paragraphs || []).join(' ')))).length;
      add('pair', '핵심과 반대 내용 짝 (필수)', !missCore.length && missP.length <= Math.floor(pairs.length * 0.25) && withTurn >= Math.ceil(body.length * 0.8), // 사용자 요청: 핵심과 반대 내용이 나오면 반드시 넣는다
        `대조 ${pairs.length - missP.length}/${pairs.length}, 대조가 있는 대지 ${withTurn}/${body.length}`,
        `그리스도 쪽을 말한 대지 안에 설교자가 대조한 반대쪽을 한두 문장으로 짝지어 넣으세요(대조 표현 '반면', '그러나' 등): ${missP.map((x) => `${x.pair.christ} ↔ ${x.pair.against}`).join(' / ')}`);
    }
    // 9. 실제 흐름 세 단계(받은 은혜 → 싸워 이길 것 → 그리하여 살 삶)가 요약 3줄에 드러나는지
    const f3 = notes.flow3 || {};
    const fl = ['grace', 'fight', 'life'].filter((k) => f3[k]);
    if (fl.length === 3) {
      const sum = norm([doc.one_line, doc.summary]);
      const got = fl.filter((k) => overlap(f3[k], sum) >= 0.35);
      add('flow', '실제 흐름 (은혜 → 싸움 → 삶)', got.length === 3, `요약에 ${got.length}/3 (${fl.filter((k) => !got.includes(k)).map((k) => ({ grace: '받은 은혜', fight: '싸울 것', life: '그리하여 살 삶' })[k]).join('·') || '모두 있음'})`,
        `summary 3줄을 설교의 실제 흐름대로 쓰세요: ① ${f3.grace} ② ${f3.fight} ③ ${f3.life}`);
    }
    // 10. 한 장 분량
    const len = window.Markup.strip([doc.stated_core, doc.one_line, ...(doc.summary || []), ...(doc.intro || []), ...body.flatMap((b) => [b.heading, ...(b.paragraphs || [])]), ...(doc.conclusion || [])].join('')).length;
    const longHead = body.filter((b) => String(b.heading || '').length > 28).length;
    // 말씀 내용이 아닌 것(농담·외모·인사·광고·분위기 환기, 설교자 행동 묘사)이 들어갔는지
    const noiseTxt = [doc.one_line, doc.summary, doc.intro, body.map((b) => [b.heading, b.paragraphs]), doc.conclusion].flat(3).filter(Boolean).map(String);
    const noise = noiseTxt.filter((t) => NOISE.test(window.Markup.strip(t)));
    add('noise', '핵심과 상관없는 분위기 환기·인사·광고 없음', !noise.length, noise.length ? `들어감: ${noise.map((t) => window.Markup.strip(t).match(NOISE)[0]).join(', ')}` : '없음',
      '\'농담으로 주의를 환기하며\'처럼 설교자 행동만 묘사한 말과 인사·광고를 빼세요. 그 농담이 핵심이나 흐름에 이어진다면 행동 묘사 대신 무엇과 어떻게 이어지는지(예: ~처럼 인생도 바꿔야 한다)로 고쳐 쓰고, 이어지지 않으면 빼세요.');
    add('length', '한 장 분량', len <= 2000 && !longHead, `본문 ${len}자${longHead ? `, 긴 대지 제목 ${longHead}개` : ''}`,
      `전체를 1,500~1,800자로 줄이고(덜 중요한 설명부터, 그리스도 쪽과 반대쪽 대조 짝·마귀를 깨뜨리는 선포는 줄이지 말고), 대지 제목은 15자 안팎으로 짧게 쓰세요. 통과한 항목의 핵심은 지키세요.`);
    return items;
  }

  // 말씀 밖 내용(농담·외모·인사·광고·분위기 환기)과 설교자 행동 묘사
  // 핵심과 상관없이 주의를 끌거나 분위기를 푸는 데 쓴 말과 그 행동 묘사, 인사·광고. 농담 자체는 핵심·흐름에 이어지면 넣어도 된다(사용자 기준).
  const NOISE = /주의를\s*(환기|집중|끌)|분위기를\s*(풀|환기|띄|부드럽)|웃음을\s*(주|자아|유발)|(농담|우스갯소리)(으)?로\s*(시작|문을\s*열|주의|분위기)|인사말|광고|안부/;
  // 점검표 점수: 한 장 분량은 무게 3(한 장을 넘기면 PDF가 깨지므로 다른 항목보다 중요)
  const score = (ck) => ck.filter((c) => c.ok).length + (ck.find((c) => c.key === 'length')?.ok ? 2 : 0);
  // 농담 묘사 구절을 문장·구절 단위로 지운다. 문장 전체가 농담이면 문장을 빼고, '…농담으로 주의를 환기하며 ~'면 앞 구절만 뺀다.
  function stripNoise(doc) {
    let n = 0;
    const one = (t) => {
      if (typeof t !== 'string' || !NOISE.test(t)) return t;
      n++;
      let cut = t;
      for (let k = 0; k < 3 && NOISE.test(cut); k++) cut = cut.replace(/^[^.!?]*?(주의를\s*\S+|분위기를\s*\S+|웃음을\s*\S+|농담|우스갯소리|인사말|광고|안부)[^.!?,]*?(하며|한\s*뒤|한\s*후|하고|하면서|으로|로)\s+/, '');
      if (cut !== t && !NOISE.test(cut) && cut.trim().length > 15) return cut;
      return t.split(/(?<=[.!?])\s+/).filter((s) => !NOISE.test(s)).join(' ');
    };
    const arr = (a) => (Array.isArray(a) ? a.map(one).filter((x) => String(x || '').trim()) : one(a));
    doc.intro = arr(doc.intro); doc.summary = arr(doc.summary); doc.conclusion = arr(doc.conclusion);
    (doc.body || []).forEach((b) => { b.paragraphs = arr(b.paragraphs); });
    return n;
  }

  async function finalDoc(cfg, meta, transcript, onStep, profileText) {
    Debug.begin('final', { meta: { ...meta }, models: { stt: cfg.sttModel, ana: cfg.anaModel }, transcriptChars: String(transcript || '').length,
      repeated: window.MN_REPEATED || null, signals: window.MN_SIGNALS || '', vocab: window.MN_VOCAB || null, profile: cap(profileText, 8000) });
    try {
      const out = await finalDocInner(cfg, meta, transcript, onStep, profileText);
      Debug.log('result', { check: out._check, autoRed: out._autoRed || 0, stated_core: out.stated_core || '', doc: JSON.parse(JSON.stringify({ ...out, _notes: undefined })) });
      Debug.end(`ok ${out._check.filter((c) => c.ok).length}/${out._check.length}`);
      return out;
    } catch (e) {
      Debug.log('final-error', { message: e.message, status: e.status || '' });
      Debug.end('error');
      throw e;
    }
  }
  async function finalDocInner(cfg, meta, transcript, onStep, profileText) {
    onStep?.(1);
    const notes = await sermonNotes(cfg, meta, transcript, profileText);
    Debug.log('notes', { notes });
    window.MN_BREAK_KEYS = (notes.break_keys || []).map((k) => String(k).replace(/\s+/g, '')).filter((k) => k.length >= 2);
    setRelated(notes); // 이 설교에서 같은 맥락으로 쓰인 말: 점검표가 글자 대신 맥락으로 확인
    // 노트가 설교자 핵심을 비워 두면 앱이 찾은 후보 중 주제어가 든 것으로 채운다
    if (!String(notes.stated_core || '').trim() && (window.MN_CORE_CANDS || []).length) {
      const topW = (window.MN_REPEATED || []).slice(0, 3).map(([w]) => w).concat(notes.central_theme ? [String(notes.central_theme)] : []);
      const best = [...window.MN_CORE_CANDS].map((c) => ({ ...c, s: c.score + (topW.some((w) => c.text.includes(w)) ? 2 : 0) + (c.text.length >= 40 ? 1 : 0) })).sort((a, b) => b.s - a.s)[0];
      if (best) { notes.stated_core = best.text; Debug.log('stated-core-fallback', { picked: best.text, candidates: window.MN_CORE_CANDS }); }
    }
    // 정리본의 주인공: 노트의 중심 주제 → 가장 무거운 본문 핵심어 → 사용자가 적은 제목의 첫 말
    const theme = String(notes.central_theme || [...(notes.text_keys || [])].sort((a, b) => (b.weight || 0) - (a.weight || 0))[0]?.key || (meta.title || '').split(/[\s,·]/)[0] || '').trim();
    // 상시 축(그리스도·영적 싸움·재창조)과 이번 본문 핵심어 가운데 받아쓰기에 실제로 나온 말은 정리본에서 빠지지 않게 목록으로 넘긴다
    const flat = transcript.replace(/\s+/g, '');
    const topRep = (window.MN_REPEATED || []).slice(0, 6).map(([w]) => w);
    const mustKeys = [...new Set([...CORE_KEYS, ...topRep, ...(notes.text_keys || []).map((c) => c.key), ...(window.MN_VOCAB || [])])]
      .filter((k) => k && flat.includes(String(k).replace(/\s+/g, '').split(/[·(]/)[0])).slice(0, 24);
    // 실제 반복 횟수를 세어 중요도 판단에 쓰게 한다
    const countOf = (k) => flat.split(String(k).replace(/\s+/g, '').split(/[·(]/)[0]).length - 1;
    const counted = mustKeys.map((k) => `${k}(${countOf(k)}회)`);
    onStep?.(2);
    const prompt = `당신은 한국 교회 설교를 깊이 있게 정리하는 편집자입니다. 아래는 한 편의 설교를 처음부터 끝까지 노트한 자료입니다. 이것을 A4 한 장짜리 정리본으로 만드세요.
${infoLine(meta)}
본문 말씀이 주어졌으면 그것을 주 본문으로 삼고(scripture_main에 '출애굽기 25:1-9'처럼 책 이름을 풀어 쓴 형태로), 그 본문의 내용과 문맥에 비추어 설교를 해석하세요.

우선순위(위가 먼저, 한 장에 다 못 담으면 아래부터 줄이세요):
0. 설교의 실제 흐름(노트의 flow3: 받은 은혜 → 싸워 이길 것 → 그리하여 살 삶)이 정리의 뼈대입니다. 제목과 실제 흐름이 떨어져 있으면(노트의 title_gap) 제목의 낱말보다 실제 흐름을 따르세요. summary 3줄은 이 세 흐름을 차례로 한 줄씩 씁니다. 노트의 sections에 나온 문제 진단과 해답이 정리본에서 빠지지 않게 하세요(특히 본론 중간 단락). '연결'·'보완' 단락의 예화·본문 해설은 그것이 핵심을 어떻게 잇거나 보완·설명하는지(노트의 link)를 한 문장으로 함께 써서 독자가 흐름을 따라갈 수 있게 하세요('보완'은 분량에 맞춰 짧게). 핵심과 전혀 이어지지 않는 '곁가지'만 빼세요.
- [필수] 핵심과 반대되는 내용이 설교에 나오면 반드시 넣으세요. 대지마다 대조를 짝으로: 그리스도 쪽(아는 자·붙잡은 자)을 말하는 대지에는 같은 대지 안에 설교자가 대조한 반대쪽(모르는 자·알려고 하지 않는 자·빗나간 자, 노트 sections의 pair.against)을 한두 문장으로 함께 쓰세요. 예: '창 3:15 사실의 가치를 아는 자는 즉각 찾아낸다. 반면 그 사실에서 빗나가 가치를 못 느끼는 교회는 철학·심리학·종교로 전락하고, 잃어버려도 뭘 잃었는지 모르고 산다.'
0-1. 설교자가 직접 밝힌 핵심(노트의 stated_core)과 요점(stated_points)이 있으면 그것이 정답입니다. one_line은 stated_core를 살려 쓰고, stated_points는 대지나 summary에 그대로 드러내세요.
1. 설교의 중심 주제「${theme}」가 정리본의 주인공입니다. 제목·one_line·summary 첫 줄에 들어가고, 대지마다 이 주제와 어떻게 이어지는지 내용으로 드러나야 합니다. 같은 긴 구절을 대지 제목마다 되풀이하지 말고, 대지 제목은 각 대지의 고유한 내용을 짧게(15자 안팎) 쓰세요. 노트의 theme_notes(중심 주제에 대한 설명·본문 해설·의미)는 줄이지 말고 담으세요. 다른 어떤 규칙도 이 주제의 비중을 줄이면 안 됩니다.
2. 그 주제를 둘러싼 그리스도와 마귀의 대립(아래 설명).
3. 본문 핵심 언어(text_keys)와 반복·강조된 말.
4. 예화, 마귀 관련 세부 선포, 용어 풀이, 여러 관점, 묵상 질문.

구조 고정: 본론에는 반드시 '마귀 쪽: 무엇이「${theme}」${eul(theme)} 막는가(짓지 못하게·하지 못하게 하는 것)와 그것을 그리스도의 이름으로 깨뜨림'을 다루는 대지가 하나 있어야 합니다(노트의 contrast.break, break_keys, spiritual_warfare). 그리스도 쪽 대지와 마귀 쪽 대지가 함께 있어야 대립이 드러납니다.

중요:
- 설교 전체 흐름을 고르게 담으세요. 본론(대지들)이 가장 길고 비중이 커야 하며, 결론은 짧게 마무리만 합니다.
- 말씀은 언제나 그리스도와 마귀의 대립과 싸움입니다. 노트의 contrast(그리스도 쪽 ↔ 마귀 쪽)가 정리본의 뼈대입니다. one_line과 summary에 이 대립을 드러내고, 대지 순서도 이 대립이 보이게 짜세요(세울 것은 초록, 깨뜨릴 것은 빨강).
- 그리스도 쪽과 마귀 쪽을 균형 있게 담으세요. 노트의 text_keys(이번 본문의 핵심 언어)는 대지 제목이나 요약에 드러나게 빠짐없이 쓰고 굵게+밑줄로 표시하세요. key_terms도 text_keys에서 고르세요. 그리스도 쪽 핵심 메시지(christ_side)는 초록으로 표시하세요.
${mustKeys.length ? `- 받아쓰기에 나온 다음 핵심어는 정리본에 반드시 한 번 이상 쓰세요(괄호는 받아쓰기에서 나온 횟수): ${counted.join(', ')}
- 중요도는 반복 횟수와 문맥상 강조(노트의 weight, emphasized)로 정하세요. 많이 반복되고 힘줘 말한 것일수록 one_line·summary·대지 제목과 초록 표시에 쓰고, 한두 번 스치듯 나온 것은 본문 속에 짧게만 넣으세요.
` : ''}- 노트의 spiritual_warfare(마귀·사단·뱀·귀신을 깨뜨리고 쫓아내는 내용)는 관련 대지 안에 녹여 빨간 표시로 꼭 드러내고, 있다면 summary에도 한 줄 넣으세요.
- one_line과 초록 표시는 노트의 big_idea와 각 대지의 핵심 주장에서 뽑으세요(마지막 당부만으로 채우지 마세요).
- 구체성을 지키세요: 대지마다 설교자가 실제로 든 예화·인물·사건·본문 해설 세부(예: 이수정의 마가복음 번역, 엘리야와 7천 명, 금·은·동과 실·기름·향품·보석의 의미)를 하나 이상 넣고, 설교자의 표현을 살리세요. '~해야 합니다'로 끝나는 일반론 문장만으로 채우면 잘못된 정리입니다. 서론에는 설교가 실제로 어떻게 말씀으로 들어갔는지(첫 본문·첫 질문·현실 진단)를 짧게 담으세요. 농담·일상 이야기도 핵심이나 흐름에 이어지면(핵심을 설명·보완하거나 다음 말씀으로 연결되면) 넣되, 그 이야기가 핵심과 어떻게 이어지는지를 쓰세요. 이어지지 않는 농담과 인사·광고는 빼세요. '설교자가 농담으로 주의를 환기하며'처럼 설교자의 행동만 묘사하는 문장은 쓰지 마세요.
- 노트에 없는 내용을 설교자가 한 말처럼 지어내지 마세요('여러 관점'은 본문 배경 지식을 보충해도 됩니다).

아래 JSON 하나만 출력하세요.
{
 "title": "설교 제목",
 "scripture_main": "주 본문",
 "scriptures": ["설교에서 인용된 구절들"],
 "category": "주제 분류 하나 (예: 믿음, 기도, 구원, 영적 전쟁, 공동체, 고난, 감사, 선교, 성품, 예배, 가정 중 가장 알맞은 것 또는 새 분류)",
 "tags": ["주제 태그 3~6개"],
 "stated_core": "설교자가 '오늘 메시지의 핵심', '이 비밀을 알아야 돼요'처럼 직접 밝힌 핵심 문장을 원문 그대로(오타·군더더기만 고쳐, 120자 안팎). 노트의 stated_core. 없으면 빈 문자열",
 "one_line": "설교 핵심 한 문장(표시 문법 가능)",
 "summary": ["한눈에 보는 요약 3줄"],
 "intro": ["서론 1문단"],
 "body": [{"heading": "1. 대지 제목", "verses": ["이 대지의 구절"], "paragraphs": ["문단"]}],
 "conclusion": ["결론 1문단"],
 "perspectives": {"context": ["본문의 역사적·문학적 문맥 1문장"], "theology": ["신학적 메시지 1문장"], "application": ["삶의 적용 1문장"]},
 "key_terms": [{"term": "용어", "meaning": "설교에서의 의미"}],
 "questions": ["묵상·적용 질문 2~3개"]
}
분량(전체 1,400~1,800자): summary 3줄 / intro 2~3문장 / body 대지 3~5개(중심 주제·제목의 말을 풀려면 대지를 늘리세요), 대지마다 1문단 3~4문장 / conclusion 2문장 / key_terms 최대 3개.
문장은 설교자의 말투를 살리되 간결한 문어체로 쓰세요.
${profileText ? `[이 설교자의 평소 설교 구조 — 대지 구분과 비중을 정할 때 참고]
${profileText}
` : ''}${MARK_RULES}

[설교 노트]
${JSON.stringify(notes, null, 1)}`;
    const doc = await call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.3, thinking: 1024, timeoutMs: 300000, label: 'doc(2단계 한 장 정리)' });
    // 점검표로 한꺼번에 검사하고, 빠진 항목만 보충한다(최대 3번). 이미 맞는 부분은 그대로 둔다.
    let out = doc;
    onStep?.(3);
    let check = checkDoc(out, notes, theme, meta);
    Debug.log('check', { round: 0, theme, mustKeys: counted, check: check.map(({ key, ok, detail }) => ({ key, ok, detail })) });
    for (let round = 0; round < 3 && check.some((c) => !c.ok); round++) {
      const miss = check.filter((c) => !c.ok);
      onStep?.(3, { round: round + 1, miss: miss.length });
      try {
        const fixPrompt = `아래 설교 정리본(JSON)을 점검표로 검사했더니 다음 항목이 빠졌거나 약합니다.
${miss.map((c, i) => `${i + 1}. ${c.label}: ${c.detail}\n   → ${c.fix}`).join('\n')}

이미 통과한 항목(${check.filter((c) => c.ok).map((c) => c.label).join(', ') || '없음'})은 그대로 지키세요. 기존 문장·표시·예화를 지우거나 일반론으로 바꾸지 말고, 빠진 것만 보충하세요.
전체 분량(1,400~1,800자)과 대지 제목 길이(15자 안팎)는 지키세요. 보충한 만큼 다른 문장을 줄이고, 한 장에 넘치면 여러 관점·용어 풀이·묵상 질문을 줄이세요. 같은 JSON 형식과 표시 문법으로, JSON 하나만 출력하세요.
${MARK_RULES}

[정리본]
${JSON.stringify(out, null, 1)}

[설교 노트]
${JSON.stringify({ central_theme: notes.central_theme, flow3: notes.flow3, sections: notes.sections, theme_notes: notes.theme_notes, contrast: notes.contrast, break_keys: notes.break_keys, spiritual_warfare: notes.spiritual_warfare, christ_side: notes.christ_side, text_keys: notes.text_keys, detail_keys: notes.detail_keys, points: notes.points }, null, 1)}`;
        const fixed = await call(cfg, cfg.anaModel, [{ text: fixPrompt }], { json: true, temperature: 0.2, thinking: 1024, timeoutMs: 300000, label: `fix(점검표 보충 ${round + 1})` });
        if (fixed && Array.isArray(fixed.body) && fixed.body.length) {
          const again = checkDoc(fixed, notes, theme, meta);
          // 보충한 결과가 통과 항목을 더 잃지 않았을 때만 바꾼다
          const accept = score(again) >= score(check);
          Debug.log('check', { round: round + 1, accepted: accept, check: again.map(({ key, ok, detail }) => ({ key, ok, detail })) });
          if (accept) { out = fixed; check = again; }
        }
      } catch (e) { Debug.log('fix-error', { round: round + 1, message: e.message }); if (!/연결|network|load failed|fetch/i.test(e.message)) break; /* 연결 문제면 다음 라운드로 한 번 더, 그 밖의 실패는 지금 결과로 진행 */ }
    }
    // 한 장을 넘으면 줄이기만 하는 단계를 한 번 더 한다(내용·표시는 그대로, 문장만 압축)
    if (check.some((c) => c.key === 'length' && !c.ok)) {
      onStep?.(3, { round: 'shorten', miss: 1 });
      try {
        const lenNow = check.find((c) => c.key === 'length').detail;
        const shortPrompt = `아래 설교 정리본(JSON)이 한 장을 넘습니다(${lenNow}). 본문(intro·body·conclusion·summary·one_line)을 1,600~1,800자로 줄이세요.
- 대지 수, 대지 제목, 표시([[g|…]] [[r|…]] [[t|…]] [[v|…]] [[y|…]]), 설교자가 직접 밝힌 핵심, 예화 이름, 그리스도와 마귀의 대조 짝은 그대로 두세요.
- 같은 말을 되풀이한 문장, 긴 인용, 수식어를 줄이세요. 여러 관점·용어 풀이·묵상 질문도 짧게 하세요.
- 새 내용은 넣지 마세요. 같은 JSON 형식으로, JSON 하나만 출력하세요.
${MARK_RULES}

[정리본]
${JSON.stringify(out, null, 1)}`;
        const short = await call(cfg, cfg.anaModel, [{ text: shortPrompt }], { json: true, temperature: 0.2, thinking: 512, timeoutMs: 240000, label: 'shorten(한 장으로 줄이기)' });
        if (short && Array.isArray(short.body) && short.body.length) {
          const again = checkDoc(short, notes, theme, meta);
          const lenOk = again.find((c) => c.key === 'length')?.ok;
          const lost = check.filter((c) => c.ok).length - (again.filter((c) => c.ok).length - 1);
          Debug.log('check', { round: 'shorten', accepted: lenOk && lost <= 1, check: again.map(({ key, ok, detail }) => ({ key, ok, detail })) });
          if (lenOk && lost <= 1) { out = short; check = again; }
        }
      } catch (e) { Debug.log('fix-error', { round: 'shorten', message: e.message }); }
    }
    // 마지막 안전장치: 그래도 남은 '주의 환기' 묘사·인사·광고 구절만 앱이 지운다(핵심에 이어진 농담 내용은 남긴다)
    if (stripNoise(out)) check = checkDoc(out, notes, theme, meta);
    // 설교자가 직접 밝힌 핵심은 모델이 바꿔 쓰거나 빼먹는 일이 잦아, 노트의 원문을 정리본에 그대로 넣는다
    const sc = tidyCore(notes.stated_core);
    if (sc && (!out.stated_core || overlap(sc, norm(out.stated_core)) < 0.6)) {
      out.stated_core = sc;
      check = checkDoc(out, notes, theme, meta);
    }
    if (out.stated_core) out.stated_core = tidyCore(out.stated_core);
    out._lord = lordToChrist(out);
    // 빨강 마무리: 표시 밖에 남은 마귀·사단·저주·참소·흑암·결박 등을 빨강으로 감싼다
    out._autoRed = redAll(out);
    if (out._autoRed) check = checkDoc(out, notes, theme, meta);
    out._check = check.map(({ key, label, ok, detail }) => ({ key, label, ok, detail }));
    out._notes = notes;
    out._theme = theme;
    return out;
  }

  // 한 문단 정리: 이미 만든 설교 노트(없으면 정리본)를 바탕으로 같은 우선순위로 한 문단만 쓴다
  async function paragraph(cfg, meta, notes, doc) {
    const theme = (notes && notes.central_theme) || doc?._theme || '';
    const src = notes ? { big_idea: notes.big_idea, central_theme: notes.central_theme, flow3: notes.flow3, stated_core: notes.stated_core, sections: (notes.sections || []).filter((x) => !/곁가지/.test(x.role || '')), theme_notes: notes.theme_notes, contrast: notes.contrast, text_keys: notes.text_keys, emphasized: notes.emphasized, christ_side: notes.christ_side, spiritual_warfare: notes.spiritual_warfare, points: notes.points, conclusion: notes.conclusion }
      : { title: doc.title, one_line: doc.one_line, summary: doc.summary, intro: doc.intro, body: doc.body, conclusion: doc.conclusion };
    const prompt = `당신은 한국 교회 설교를 깊이 있게 정리하는 편집자입니다. 아래 설교 자료를 '한 문단'으로 정리하세요.
${infoLine(meta)}
우선순위:
0. 문단은 설교의 실제 흐름 세 단계로 이어 씁니다: 하나님이 이미 해 주신 것(받은 은혜·복음의 사실) → 무엇에 빠져 하나님을 잃어버리고 어떻게 돌이켜 싸워 이기는가 → 그리하여 어떤 삶을 사는가. 설교 노트의 flow3와 sections를 따르세요.
0-1. 설교 전체의 맥락과 흐름에서 핵심으로 이어지는 내용을 쓰세요. 핵심을 보완·설명하는 예화는 그 관계가 드러나게 넣고, 핵심과 전혀 이어지지 않는 곁가지만 빼세요.
1. 설교의 중심 주제${theme ? `「${theme}」` : ''}를 첫 문장에 넣으세요. 제목 낱말과 실제 흐름이 다르면 실제 흐름을 따르세요.
2. 말씀은 언제나 그리스도(복음, 창 3:15, 영적인 것, 영적 싸움)와 마귀(사단, 요 8:44, 육신, 뱀)의 대립과 싸움입니다. 이 설교에서 그 대립이 무엇인지 드러내세요.
3. 본문 핵심 언어와 많이 반복·강조된 말을 살리세요.
4. 마지막 문장은 결단·적용으로 맺으세요.
형식: 한 문단, 6~9문장, 400~600자. 줄바꿈·목록·제목 없이 이어지는 문어체 문단. 설교자가 하지 않은 말을 지어내지 마세요.
${MARK_RULES}
노란 표시는 쓰지 말고, 초록은 2~3곳, 빨강은 1~2곳, 핵심 용어 표시는 2~4곳만 쓰세요.
아래 JSON 하나만 출력하세요: {"paragraph": "문단"}

[설교 자료]
${JSON.stringify(src, null, 1)}`;
    Debug.begin('paragraph', { meta: { ...meta } });
    let r;
    try { r = await call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.3, thinking: 512, timeoutMs: 180000, label: 'paragraph(한 문단)' }); Debug.end('ok'); }
    catch (e) { Debug.end('error'); throw e; }
    return String(r.paragraph || '').trim();
  }

  async function ping(cfg) {
    return call(cfg, cfg.anaModel, [{ text: '“확인”이라고만 답하세요.' }], { temperature: 0, timeoutMs: 30000 });
  }

  window.Gemini = { transcribe, transcribeRange, uploadFile, liveSummary, finalDoc, paragraph, checkDoc, pickRef, refClauses, ping };
})();
