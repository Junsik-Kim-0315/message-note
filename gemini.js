// Gemini 호출과 프롬프트
(function () {
  const MARK_RULES = `색깔 표시 문법(문장 안에 그대로 넣기):
- [[g|...]] 초록 형광: 설교 전체의 핵심 메시지. 문서 전체에서 4~8곳만.
- [[r|...]] 빨간 형광: 마귀·사단·사탄·뱀(옛 뱀, 창 3장의 뱀)·귀신·악한 영·흑암의 권세·정사와 권세·저주·참소와 관련된 핵심 내용과 구절(예: 요 8:44, 요일 3:8, 창 3:15 '뱀의 머리', 엡 6:10-18, 마 12:28-29, 눅 10:19). 특히 '깨뜨리다·내어쫓다·박살 내다·결박하다·멸하다·떠나가라·~할지어다' 같은 대적·선포 표현과 함께 나오면 반드시 빨강으로 표시한다. 설교에 이런 내용이 있으면 본론과 요약에 빠뜨리지 말고, 없을 때만 쓰지 않는다.
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
들리는 말을 한국어로 처음부터 끝까지 빠짐없이 그대로 받아쓰세요. 요약하거나 줄이지 마세요.
- 성경 책 이름, 장·절, 교회 용어(은혜, 성령, 언약 등)는 바른 표기로 쓰세요.
- 설교가 순차통역될 수 있어요. 멀리서 작게 들리는 통역 목소리나 다른 언어는 받아쓰지 말고 설교자의 한국어만 쓰세요. 통역 때문에 문장 사이가 끊겨도 설교자의 말을 자연스럽게 이어 쓰세요.
- 잘 들리지 않는 부분은 지어내지 말고 생략하세요.
- 찬양·연주는 (찬양), 다 같이 하는 기도·신앙고백·광고는 (기도), (광고)처럼 한 줄로만 표시하고, 말소리가 없으면 아무것도 출력하지 마세요.
- 화자 이름, 시간, 설명 없이 받아쓴 문장만 출력하세요.
${window.MN_TERMS ? `- 이전에 자주 잘못 받아쓴 말(잘못→바름): ${window.MN_TERMS}\n` : ''}${prevTail ? `직전 구간의 끝부분(문맥 참고용, 다시 쓰지 마세요): "${prevTail}"` : ''}`;
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
- 설교가 순차통역될 수 있어요. 멀리서 작게 들리는 통역 목소리나 다른 언어는 받아쓰지 말고 설교자의 한국어만 쓰세요. 통역 때문에 문장 사이가 끊겨도 설교자의 말을 자연스럽게 이어 쓰세요.
- 잘 들리지 않는 부분은 지어내지 말고 생략하세요.
- 찬양·연주는 (찬양), 다 같이 하는 기도·신앙고백·광고는 (기도), (광고)처럼 한 줄로만 표시하세요.
- 화자 이름, 시간, 설명 없이 받아쓴 문장만 출력하세요.${window.MN_TERMS ? `\n- 이전에 자주 잘못 받아쓴 말(잘못→바름): ${window.MN_TERMS}` : ''}`;
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

  // 최종 정리는 두 단계로 한다.
  // 1단계: 예배 전체 받아쓰기에서 설교 부분을 찾아 처음부터 끝까지 흐름을 빠짐없이 상세 노트로 뽑는다.
  // 2단계: 그 노트를 A4 한 장 분량으로 압축하고 색깔 표시를 넣는다.
  // (한 번에 하면 긴 받아쓰기에서 마지막 부분만 붙잡아 정리하는 문제가 있었다)
  const infoLine = (meta) => `설교 정보: 날짜 ${meta.date} / 예배 ${meta.service_type || ''} / 설교자 ${meta.preacher || '미상'} / 사용자가 적은 제목 ${meta.title || '(없음, 추정할 것)'} / 사용자가 적은 본문 말씀 ${meta.scripture || '(없음, 추정할 것)'}`;

  async function sermonNotes(cfg, meta, transcript, profileText) {
    const prompt = `당신은 한국 교회 설교를 꼼꼼히 듣고 노트하는 조교입니다. 아래는 현장 예배 전체의 음성인식 받아쓰기입니다(오타가 있으니 문맥으로 바로잡아 이해하세요).
${infoLine(meta)}

할 일:
1. 찬양, 대표기도, 광고, 헌금, 축도 등을 빼고 '설교'가 시작되는 곳과 끝나는 곳을 찾으세요. 설교 전 성경 봉독이 있으면 본문 파악에 쓰세요.
2. 설교의 처음부터 끝까지 흐름을 시간 순서대로 빠짐없이 노트하세요. 마지막 부분만이 아니라 앞·중간 부분의 주장과 설명을 반드시 고르게 담으세요. 설교의 대부분은 본론입니다.
3. 설교자가 실제로 한 말을 근거로 하고, 핵심 문장은 받아쓰기에서 그대로(오타만 고쳐) 인용하세요.
4. 받아쓰기에 같은 내용이 두 번 들어간 구간(겹쳐 올린 부분)은 한 번만 쓰세요. 시간 표시(00:00 등)나 출처 표시 줄은 무시하세요.
5. 설교 끝의 마무리 기도가 설교 요지를 정리하는 경우가 많으니 대지와 결론을 정할 때 참고하세요. 설교 중간의 교회 운영·광고 이야기는 비중을 낮추세요.
6. 마귀·사단·사탄·뱀·귀신·흑암·저주·참소에 관한 말과 구절(요 8:44, 요일 3:8, 창 3:15 등), '깨뜨려라·내어쫓아라·박살 내라·결박하라·떠나가라·~할지어다' 같은 대적·선포 기도는 하나도 빠뜨리지 말고 spiritual_warfare에 원문 그대로(오타만 고쳐) 담으세요. 이 설교자에게는 매우 중요한 주제입니다.
7. 이 설교의 구조적 특징(설교 시작·끝을 알리는 말, 대지를 나누는 표현, 예화·적용·마무리 방식)과 음성인식이 잘못 받아쓴 말(사람 이름, 성경 이름, 교회 용어)을 함께 분석하세요. 다음 설교를 더 잘 정리하기 위한 학습 자료로 쌓입니다.
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
 "intro": ["서론에서 한 말의 요지들"],
 "points": [{"heading": "대지(소제목)", "claims": ["이 부분의 주장·설명 요지들"], "verses": ["인용 구절"], "illustrations": ["예화·간증 한 줄 요약"], "quotes": ["핵심 문장 원문"]}],
 "conclusion": ["결론·결단 촉구의 요지들"],
 "application": ["설교자가 제시한 적용"],
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

[받아쓰기 전체]
${transcript}`;
    return call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.2, thinking: 2048, timeoutMs: 300000 });
  }

  async function finalDoc(cfg, meta, transcript, onStep, profileText) {
    onStep?.(1);
    const notes = await sermonNotes(cfg, meta, transcript, profileText);
    onStep?.(2);
    const prompt = `당신은 한국 교회 설교를 깊이 있게 정리하는 편집자입니다. 아래는 한 편의 설교를 처음부터 끝까지 노트한 자료입니다. 이것을 A4 한 장짜리 정리본으로 만드세요.
${infoLine(meta)}
본문 말씀이 주어졌으면 그것을 주 본문으로 삼고(scripture_main에 '출애굽기 25:1-9'처럼 책 이름을 풀어 쓴 형태로), 그 본문의 내용과 문맥에 비추어 설교를 해석하세요.

중요:
- 설교 전체 흐름을 고르게 담으세요. 본론(대지들)이 가장 길고 비중이 커야 하며, 결론은 짧게 마무리만 합니다.
- 노트의 spiritual_warfare(마귀·사단·뱀·귀신을 깨뜨리고 쫓아내는 내용)는 관련 대지 안에 녹여 빨간 표시로 꼭 드러내고, 있다면 summary에도 한 줄 넣으세요.
- one_line과 초록 표시는 노트의 big_idea와 각 대지의 핵심 주장에서 뽑으세요(마지막 당부만으로 채우지 마세요).
- 노트에 없는 내용을 설교자가 한 말처럼 지어내지 마세요('여러 관점'은 본문 배경 지식을 보충해도 됩니다).

아래 JSON 하나만 출력하세요.
{
 "title": "설교 제목",
 "scripture_main": "주 본문",
 "scriptures": ["설교에서 인용된 구절들"],
 "category": "주제 분류 하나 (예: 믿음, 기도, 구원, 영적 전쟁, 공동체, 고난, 감사, 선교, 성품, 예배, 가정 중 가장 알맞은 것 또는 새 분류)",
 "tags": ["주제 태그 3~6개"],
 "one_line": "설교 핵심 한 문장(표시 문법 가능)",
 "summary": ["한눈에 보는 요약 3줄"],
 "intro": ["서론 1문단"],
 "body": [{"heading": "1. 대지 제목", "verses": ["이 대지의 구절"], "paragraphs": ["문단"]}],
 "conclusion": ["결론 1문단"],
 "perspectives": {"context": ["본문의 역사적·문학적 문맥 1문장"], "theology": ["신학적 메시지 1문장"], "application": ["삶의 적용 1문장"]},
 "key_terms": [{"term": "용어", "meaning": "설교에서의 의미"}],
 "questions": ["묵상·적용 질문 2~3개"]
}
분량(전체 1,300~1,500자): summary 3줄 / intro 2~3문장 / body 대지 2~4개, 대지마다 1문단 3~4문장 / conclusion 2문장 / key_terms 최대 3개.
문장은 설교자의 말투를 살리되 간결한 문어체로 쓰세요.
${profileText ? `[이 설교자의 평소 설교 구조 — 대지 구분과 비중을 정할 때 참고]
${profileText}
` : ''}${MARK_RULES}

[설교 노트]
${JSON.stringify(notes, null, 1)}`;
    const doc = await call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.3, thinking: 1024, timeoutMs: 300000 });
    doc._notes = notes;
    return doc;
  }

  async function ping(cfg) {
    return call(cfg, cfg.anaModel, [{ text: '“확인”이라고만 답하세요.' }], { temperature: 0, timeoutMs: 30000 });
  }

  window.Gemini = { transcribe, transcribeRange, uploadFile, liveSummary, finalDoc, ping };
})();
