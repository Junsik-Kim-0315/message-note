// Gemini 호출과 프롬프트
(function () {
  const MARK_RULES = `색깔 표시 문법(문장 안에 그대로 넣기):
- [[g|...]] 초록 형광: 설교 전체의 핵심 메시지. 문서 전체에서 4~8곳만.
- [[r|...]] 빨간 형광: 마귀·사단·사탄·악한 영·영적 전쟁·유혹과 관련된 핵심 내용. 해당 내용이 없으면 쓰지 않는다.
- [[y|...]] 노란 형광: 각 대지에서 중요한 문장. 대지마다 1~3곳.
- [[t|...]] 핵심 용어(굵게+밑줄): 은혜, 언약, 회개 같은 신앙 핵심 용어가 처음 나올 때.
- [[v|...]] 성경 구절 인용: 예) [[v|요한복음 3:16]] 또는 인용된 말씀 본문.
표시는 겹치지 않게, 강조할 부분만 짧게 감싼다.`;

  // thinking: 생각 단계 예산(0이면 끔). 받아쓰기는 생각이 필요 없고 느려지기만 해서 끈다.
  async function call(cfg, model, parts, { json = false, temperature = 0.3, timeoutMs = 120000, thinking = null } = {}) {
    if (!cfg.key) throw new Error('설정에서 Gemini API 키를 넣어주세요.');
    const send = async (withThinking) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const generationConfig = { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) };
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
          // 이 모델이 생각 예산 설정을 받지 않으면 빼고 다시
          if (withThinking && thinking != null && res.status === 400 && /thinking/i.test(msg)) return send(false);
          const err = new Error(res.status === 429 ? 'Gemini 사용 한도 초과(429): 잠시 뒤 자동으로 다시 해요' : `Gemini 오류 ${res.status}: ${msg}`.trim());
          err.status = res.status;
          // 429일 때 Gemini가 알려주는 대기 시간 (예: "37s")
          const ri = (data.error?.details || []).find((d) => d.retryDelay);
          if (ri) err.retryAfter = parseFloat(ri.retryDelay) * 1000;
          throw err;
        }
        const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
        if (!json) return text.trim();
        return parseJson(text);
      } catch (e) {
        if (e.name === 'AbortError') { const t = new Error(`Gemini 응답이 너무 오래 걸려요 (${Math.round(timeoutMs / 1000)}초 넘음).`); t.status = 'timeout'; throw t; }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    };
    return send(true);
  }

  function parseJson(text) {
    const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (e) {
      const s = t.indexOf('{'), en = t.lastIndexOf('}');
      if (s >= 0 && en > s) return JSON.parse(t.slice(s, en + 1));
      throw new Error('정리 결과를 읽지 못했어요. 다시 시도해 주세요.');
    }
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
들리는 말을 한국어로 그대로 받아쓰세요.
- 성경 책 이름, 장·절, 교회 용어(은혜, 성령, 언약 등)는 바른 표기로 쓰세요.
- 잘 들리지 않는 부분은 지어내지 말고 생략하세요.
- 찬양·연주는 (찬양), 다 같이 하는 기도·신앙고백·광고는 (기도), (광고)처럼 한 줄로만 표시하고, 말소리가 없으면 아무것도 출력하지 마세요.
- 화자 이름, 시간, 설명 없이 받아쓴 문장만 출력하세요.
${prevTail ? `직전 구간의 끝부분(문맥 참고용, 다시 쓰지 마세요): "${prevTail}"` : ''}`;
    const data = await blobToBase64(blob);
    return call(cfg, cfg.sttModel, [{ text: prompt }, { inline_data: { mime_type: mime, data } }],
      { temperature: 0, thinking: 0, timeoutMs: approxSec >= 60 ? 240000 : 90000 });
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
- 잘 들리지 않는 부분은 지어내지 말고 생략하세요.
- 찬양·연주는 (찬양), 다 같이 하는 기도·신앙고백·광고는 (기도), (광고)처럼 한 줄로만 표시하세요.
- 화자 이름, 시간, 설명 없이 받아쓴 문장만 출력하세요.`;
    return call(cfg, cfg.sttModel, [{ file_data: { mime_type: ref.mime, file_uri: ref.uri } }, { text: prompt }], { temperature: 0, thinking: 0, timeoutMs: 300000 });
  }

  async function liveSummary(cfg, meta, transcript) {
    const prompt = `당신은 예배 설교를 듣는 사람을 돕는 정리 도우미입니다. 아래는 지금까지 진행된 설교의 실시간 받아쓰기입니다(음성인식이라 오타가 있을 수 있으니 문맥으로 바로잡아 이해하세요).
예배: ${meta.service_type || ''} / 설교자: ${meta.preacher || ''} / 본문 말씀: ${meta.scripture || '(미입력)'}
본문 말씀이 주어졌으면 그 본문의 내용과 문맥을 바탕으로 흐름을 이해하세요.

지금까지의 흐름을 JSON으로 정리하세요. 들은 내용에 없는 것은 지어내지 마세요.
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
    return call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.2, thinking: 0, timeoutMs: 90000 });
  }

  async function finalDoc(cfg, meta, transcript) {
    const prompt = `당신은 한국 교회 설교를 깊이 있게 정리하는 편집자입니다. 아래는 현장 예배의 음성인식 받아쓰기 전체입니다. 찬양, 기도, 광고, 헌금, 축도 등 설교가 아닌 부분이 섞여 있을 수 있으니 설교 부분만 골라 정리하세요(설교 전 성경 봉독은 본문 파악에 활용). 음성인식 오류는 문맥으로 바로잡되, 설교자가 말하지 않은 내용을 덧붙이지 마세요(단, '여러 관점' 항목은 본문의 배경 지식을 보충해도 됩니다).

설교 정보: 날짜 ${meta.date} / 예배 ${meta.service_type || ''} / 설교자 ${meta.preacher || '미상'} / 사용자가 적은 제목 ${meta.title || '(없음, 추정할 것)'} / 사용자가 적은 본문 말씀 ${meta.scripture || '(없음, 추정할 것)'}
본문 말씀이 주어졌으면 그것을 주 본문으로 삼고(scripture_main에 '출애굽기 25:1-9'처럼 책 이름을 풀어 쓴 형태로), 그 본문의 내용과 문맥에 비추어 설교를 해석하세요. 받아쓰기의 성경 구절 오인식도 이 본문을 기준으로 바로잡으세요.

설교를 문맥에 따라 서론·본론(대지별)·결론으로 재구성하고 아래 JSON 하나만 출력하세요.
{
 "title": "설교 제목",
 "scripture_main": "주 본문 (예: 요한복음 3:16-21)",
 "scriptures": ["설교에서 인용된 구절들"],
 "category": "주제 분류 하나 (예: 믿음, 기도, 구원, 영적 전쟁, 공동체, 고난, 감사, 선교, 성품, 가정 중 가장 알맞은 것 또는 새 분류)",
 "tags": ["주제 태그 3~6개"],
 "one_line": "설교 핵심 한 문장(표시 문법 가능)",
 "summary": ["한눈에 보는 요약 3~5줄"],
 "intro": ["서론 문단들"],
 "body": [{"heading": "1. 첫째 대지 제목", "verses": ["이 대지의 구절"], "paragraphs": ["문단들"]}],
 "conclusion": ["결론 문단들"],
 "perspectives": {
   "context": ["본문의 역사적·문학적 문맥과 배경"],
   "theology": ["신학적 메시지와 성경 전체 흐름에서의 의미"],
   "application": ["오늘 내 삶에 적용할 점"]
 },
 "key_terms": [{"term": "용어", "meaning": "설교에서의 의미"}],
 "questions": ["묵상·적용 질문 3~5개"]
}
이 정리는 A4 한 장에 들어가야 합니다. 분량을 꼭 지키세요(전체 1,300자 안팎).
- summary 3줄, 각 줄 짧게
- intro 1문단(2~3문장)
- body 대지 2~4개, 대지마다 1문단(2~4문장)
- conclusion 1문단(2~3문장)
- perspectives의 context, theology, application은 각각 1문장
- key_terms 최대 3개(뜻은 짧게), questions 2~3개
문장은 설교자의 말투를 살리되 간결한 문어체로 쓰고, 예화와 간증은 한 줄로 핵심만 남기세요.
${MARK_RULES}

[받아쓰기 전체]
${transcript}`;
    return call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.3, thinking: 1024, timeoutMs: 300000 });
  }

  async function ping(cfg) {
    return call(cfg, cfg.anaModel, [{ text: '“확인”이라고만 답하세요.' }], { temperature: 0, timeoutMs: 30000 });
  }

  window.Gemini = { transcribe, transcribeRange, uploadFile, liveSummary, finalDoc, ping };
})();
