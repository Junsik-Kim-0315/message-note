// Gemini 호출과 프롬프트
(function () {
  // 상시 축: 어떤 설교든 늘 중심에 두는 그리스도 쪽 말 (본문별 핵심어는 설교 노트의 text_keys로 따로 뽑는다)
  const CORE_KEYS = ['그리스도', '복음', '영적 싸움', '재창조'];
  const MARK_RULES = `색깔 표시 문법(문장 안에 그대로 넣기):
- [[g|...]] 초록 형광: 그리스도 쪽 핵심 메시지(복음, 창 3:15, 영적 싸움에서 이김, 재창조, 성막·헌신 등). 문서 전체에서 6~10곳.
- [[r|...]] 빨간 형광: 마귀·사단·사탄·뱀(옛 뱀, 창 3장의 뱀)·귀신·악한 영·흑암의 권세·정사와 권세·저주·참소와 관련된 핵심 내용과 구절(예: 요 8:44, 요일 3:8, 창 3:15 '뱀의 머리', 엡 6:10-18, 마 12:28-29, 눅 10:19). 특히 '깨뜨리다·내어쫓다·박살 내다·결박하다·멸하다·떠나가라·~할지어다' 같은 대적·선포 표현과 함께 나오면 반드시 빨강으로 표시한다. 설교에 이런 내용이 있으면 본론과 요약에 빠뜨리지 말고, 없을 때만 쓰지 않는다.
- [[y|...]] 노란 형광: 각 대지에서 중요한 문장. 대지마다 1~3곳.
- [[t|...]] 핵심 용어(굵게+밑줄): 은혜, 언약, 회개 같은 신앙 핵심 용어가 처음 나올 때.
- [[v|...]] 성경 구절 인용: 예) [[v|요한복음 3:16]] 또는 인용된 말씀 본문.
표시는 겹치지 않게, 강조할 부분만 짧게 감싼다.`;

  // thinking: 생각 단계 예산(0이면 끔). 받아쓰기는 생각이 필요 없고 느려지기만 해서 끈다.
  // 긴 설교(90분 이상)일수록 응답이 오래 걸리니 받아쓰기 길이에 맞춰 기다리는 시간을 늘린다
  const longWait = (base, text, perK, cap) => Math.min(cap, base + Math.round(String(text || '').length / 1000) * perK);

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
    return call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.2, thinking: 0, timeoutMs: longWait(90000, transcript, 1500, 200000) });
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
6-1. 그리스도 쪽도 똑같이 빠짐없이: 그리스도(예수는 그리스도, 여자의 후손), 복음, 영적 싸움, 재창조(죽을 몸도 살리심)에 대한 설교자의 핵심 문장을 christ_side에 원문 그대로 담으세요. 마귀 쪽만 많고 그리스도 쪽이 빠지면 잘못된 노트입니다.
6-2. 이번 본문과 관련된 핵심 언어를 text_keys에 뽑으세요. 본문 말씀에서 나왔거나 설교자가 본문을 풀며 거듭 쓴 말입니다(예: 출 25:1-9 설교라면 성막, 예물, 헌신, 유턴, 정체성). 설교마다 다르며, 정리본에 하나도 빠지지 않고 들어갑니다. 중요도는 (1) 반복 횟수(여러 번 되풀이할수록 중요)와 (2) 문맥상 강조(‘진짜’, ‘꼭’, ‘반드시’, ‘제발’, ‘이 비밀을 알아야 돼요’, 같은 말을 연달아 반복하거나 선포함, 질문하고 스스로 답함, ‘아멘’을 받아냄)로 판단해 weight(1~3)로 매기고 중요한 순서로 쓰세요. 설교자가 힘줘 말한 핵심 문장은 emphasized에 원문 그대로 담으세요.
6. 마귀·사단·사탄·뱀·귀신·흑암·저주·참소에 관한 말과 구절(요 8:44, 요일 3:8, 창 3:15 등), '깨뜨려라·내어쫓아라·박살 내라·결박하라·떠나가라·~할지어다' 같은 대적·선포 기도는 하나도 빠뜨리지 말고 spiritual_warfare에 원문 그대로(오타만 고쳐) 담으세요. 이 설교자에게는 매우 중요한 주제입니다.
6-3. 설교자가 '오늘 메시지의 핵심입니다', '세 가지 비밀', '첫째·둘째'처럼 직접 핵심이나 요점을 밝힌 곳을 반드시 찾아 stated_core, stated_points에 원문 그대로 담으세요(끝부분이나 마무리 기도 직전에 나오는 경우가 많습니다).
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
 "central_theme": "제목과 본문의 중심 주제어 하나, 1~3단어의 짧은 말 (예: 성막, 잃어버린 드라크마)",
 "stated_core": "설교자가 '오늘 메시지의 핵심', '오늘 본문은' 처럼 직접 밝힌 핵심 문장 원문 (없으면 빈 문자열)",
 "stated_points": ["설교자가 '세 가지 비밀', '첫째·둘째'처럼 직접 밝힌 요점들 (없으면 빈 배열)"],
 "theme_notes": ["중심 주제에 대해 설교자가 한 설명·의미·적용을 빠짐없이(본문 해설 포함)"],
 "contrast": {"build": "그리스도 쪽: 이번 설교에서 붙잡고 세울 것(복음·창 3:15·영적인 것)", "break": "마귀 쪽: 그것을 막는 것, 깨뜨릴 것(사단·요 8:44·육신·뱀)", "how": "영적 싸움으로 어떻게 깨뜨리고 세우는가"},
 "intro": ["서론에서 한 말의 요지들"],
 "points": [{"heading": "대지(소제목)", "claims": ["이 부분의 주장·설명 요지들"], "verses": ["인용 구절"], "illustrations": ["예화·간증 한 줄 요약"], "quotes": ["핵심 문장 원문"]}],
 "detail_keys": ["정리본에 꼭 남길 구체적 예화·인물·본문 세부를 가리키는 짧은 말 3~6개 (예: 이수정, 엘리야, 금·은·동)"],
 "break_keys": ["마귀 쪽: 주제를 막는 것을 가리키는 짧은 말 2~5개 (예: 완악함, 육신적, 질병의 저주, 참소)"],
 "conclusion": ["결론·결단 촉구의 요지들"],
 "application": ["설교자가 제시한 적용"],
 "text_keys": [{"key": "본문 핵심 언어", "meaning": "이 설교에서의 뜻 한 줄", "weight": 3}],
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

[받아쓰기 전체]
${transcript}`;
    return call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.2, thinking: 2048, timeoutMs: longWait(300000, transcript, 4000, 600000) });
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
  function checkDoc(doc, notes, theme) {
    const items = [];
    const add = (key, label, ok, detail, fix) => items.push({ key, label, ok: !!ok, detail, fix });
    const body = Array.isArray(doc.body) ? doc.body : [];
    const whole = norm({ t: doc.title, o: doc.one_line, s: doc.summary, i: doc.intro, b: body, c: doc.conclusion, k: doc.key_terms });
    const top = norm([doc.title, doc.one_line, doc.summary]);
    const count = (w) => (w ? whole.split(head(w)).length - 1 : 0);

    // 1. 중심 주제
    if (theme) {
      // '잃어버린 드라크마'처럼 여러 낱말이면 마지막 명사(드라크마)로 본다
      const t = head(String(theme).trim().split(/\s+/).pop());
      const heads = body.filter((b) => norm([b.heading, b.paragraphs]).includes(t)).length;
      const n = whole.split(t).length - 1;
      const ok = top.includes(t) && heads >= Math.ceil(body.length / 2) && n >= 4;
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
    const hitBreak = breakKeys.filter((k) => whole.includes(k));
    const devilHead = body.some((b) => /마귀|사단|사탄|원수|뱀|막는|못하게/.test(norm(b.heading)));
    const okDevil = red.length >= 3 && devilHead && (!breakKeys.length || hitBreak.length >= Math.min(2, breakKeys.length)) && /마귀|사단|사탄|막|못하게/.test(top);
    add('devil', '마귀 쪽 (막고 빼앗는 것과 깨뜨림)', okDevil,
      `빨강 ${red.length}곳, 마귀 대지 ${devilHead ? '있음' : '없음'}, 막는 것 ${hitBreak.join('·') || '없음'}${breakKeys.length ? `/${breakKeys.length}` : ''}`,
      `본론에 '무엇이「${theme}」${eul(theme)} 막는가와 그리스도의 이름으로 깨뜨림' 대지를 두고(제목에 마귀·사단 또는 '막는'이 드러나게), summary에도 한 줄 넣으세요. 노트의 contrast.break, break_keys(${breakKeys.join(', ')}), spiritual_warfare의 대적·선포를 빨강으로 담으세요.`);
    // 4. 본문 핵심 언어
    const keys = (notes.text_keys || []).map((k) => k.key).filter(Boolean);
    const missKeys = keys.filter((k) => !whole.includes(head(k)));
    add('keys', '본문 핵심 언어', !missKeys.length, keys.length ? (missKeys.length ? `빠짐: ${missKeys.join(', ')}` : keys.join(', ')) : '노트에 없음',
      `빠진 본문 핵심 언어(${missKeys.join(', ')})를 각각 관련 대지나 요약에 굵게+밑줄로 넣으세요.`);
    // 5. 반복·강조된 말
    const heavy = [...(notes.text_keys || [])].filter((k) => (k.weight || 0) >= 3).map((k) => k.key);
    const headsAll = norm([doc.one_line, doc.summary, body.map((b) => b.heading)]);
    const missHeavy = heavy.filter((k) => !headsAll.includes(head(k)));
    add('weight', '많이 반복·강조된 말이 앞에', !missHeavy.length, heavy.length ? (missHeavy.length ? `앞에 없음: ${missHeavy.join(', ')}` : heavy.join(', ')) : '해당 없음',
      `많이 반복·강조된 말(${missHeavy.join(', ')})을 one_line·summary·대지 제목 중 한 곳에 올리세요.`);
    // 6. 실제 예화·본문 해설
    const details = (notes.detail_keys || []).map(head).filter(Boolean);
    const hitD = details.filter((k) => whole.includes(k));
    const needD = Math.min(details.length, Math.max(2, Math.ceil(details.length * 0.6)));
    add('detail', '설교의 실제 예화·본문 해설', hitD.length >= needD, details.length ? `${hitD.length}/${details.length} (${hitD.join('·') || '없음'})` : '노트에 없음',
      `빠진 예화·본문 세부(${details.filter((k) => !hitD.includes(k)).join(', ')})를 관련 대지에 설교자의 표현으로 한두 문장씩 넣으세요. 일반론 문장으로 바꾸지 마세요.`);
    // 7. 설교자가 직접 밝힌 핵심·요점
    const core = String(notes.stated_core || '').trim();
    const sp = (notes.stated_points || []).filter(Boolean);
    if (core || sp.length) {
      // 조사·어미가 달라도 잡히게 두 글자 묶음이 얼마나 겹치는지로 본다
      const grams = (s) => { const t = norm(s).replace(/[^가-힣A-Za-z0-9]/g, ''); const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return [...out]; };
      const hit = (s) => { const g2 = grams(s); if (!g2.length) return true; return g2.filter((x) => whole.includes(x)).length / g2.length >= 0.6; };
      const coreOk = !core || hit(core);
      const spHit = sp.filter(hit).length;
      add('stated', '설교자가 직접 밝힌 핵심·요점', coreOk && spHit >= Math.ceil(sp.length * 0.7), `${core ? (coreOk ? '핵심 반영' : '핵심 빠짐') : ''}${sp.length ? ` 요점 ${spHit}/${sp.length}` : ''}`.trim(),
        `설교자가 직접 밝힌 핵심("${core}")을 one_line에 살리고, 요점(${sp.join(' / ')})을 대지나 summary에 드러내세요.`);
    }
    // 8. 한 장 분량
    const len = window.Markup.strip([doc.one_line, ...(doc.summary || []), ...(doc.intro || []), ...body.flatMap((b) => [b.heading, ...(b.paragraphs || [])]), ...(doc.conclusion || [])].join('')).length;
    const longHead = body.filter((b) => String(b.heading || '').length > 28).length;
    add('length', '한 장 분량', len <= 1800 && !longHead, `본문 ${len}자${longHead ? `, 긴 대지 제목 ${longHead}개` : ''}`,
      `전체를 1,300~1,600자로 줄이고(덜 중요한 설명부터), 대지 제목은 15자 안팎으로 짧게 쓰세요. 통과한 항목의 핵심은 지키세요.`);
    return items;
  }

  async function finalDoc(cfg, meta, transcript, onStep, profileText) {
    onStep?.(1);
    const notes = await sermonNotes(cfg, meta, transcript, profileText);
    // 정리본의 주인공: 노트의 중심 주제 → 가장 무거운 본문 핵심어 → 사용자가 적은 제목의 첫 말
    const theme = String(notes.central_theme || [...(notes.text_keys || [])].sort((a, b) => (b.weight || 0) - (a.weight || 0))[0]?.key || (meta.title || '').split(/[\s,·]/)[0] || '').trim();
    // 상시 축(그리스도·영적 싸움·재창조)과 이번 본문 핵심어 가운데 받아쓰기에 실제로 나온 말은 정리본에서 빠지지 않게 목록으로 넘긴다
    const flat = transcript.replace(/\s+/g, '');
    const mustKeys = [...new Set([...CORE_KEYS, ...(notes.text_keys || []).map((c) => c.key), ...(window.MN_VOCAB || [])])]
      .filter((k) => k && flat.includes(String(k).replace(/\s+/g, '').split(/[·(]/)[0])).slice(0, 24);
    // 실제 반복 횟수를 세어 중요도 판단에 쓰게 한다
    const countOf = (k) => flat.split(String(k).replace(/\s+/g, '').split(/[·(]/)[0]).length - 1;
    const counted = mustKeys.map((k) => `${k}(${countOf(k)}회)`);
    onStep?.(2);
    const prompt = `당신은 한국 교회 설교를 깊이 있게 정리하는 편집자입니다. 아래는 한 편의 설교를 처음부터 끝까지 노트한 자료입니다. 이것을 A4 한 장짜리 정리본으로 만드세요.
${infoLine(meta)}
본문 말씀이 주어졌으면 그것을 주 본문으로 삼고(scripture_main에 '출애굽기 25:1-9'처럼 책 이름을 풀어 쓴 형태로), 그 본문의 내용과 문맥에 비추어 설교를 해석하세요.

우선순위(위가 먼저, 한 장에 다 못 담으면 아래부터 줄이세요):
0. 설교자가 직접 밝힌 핵심(노트의 stated_core)과 요점(stated_points)이 있으면 그것이 정답입니다. one_line은 stated_core를 살려 쓰고, stated_points는 대지나 summary에 그대로 드러내세요.
1. 제목과 본문의 중심 주제「${theme}」가 정리본의 주인공입니다. 제목·one_line·summary 첫 줄에 들어가고, 대지마다 이 주제와 어떻게 이어지는지 내용으로 드러나야 합니다. 같은 긴 구절을 대지 제목마다 되풀이하지 말고, 대지 제목은 각 대지의 고유한 내용을 짧게(15자 안팎) 쓰세요. 노트의 theme_notes(중심 주제에 대한 설명·본문 해설·의미)는 줄이지 말고 담으세요. 다른 어떤 규칙도 이 주제의 비중을 줄이면 안 됩니다.
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
- 구체성을 지키세요: 대지마다 설교자가 실제로 든 예화·인물·사건·본문 해설 세부(예: 이수정의 마가복음 번역, 엘리야와 7천 명, 금·은·동과 실·기름·향품·보석의 의미)를 하나 이상 넣고, 설교자의 표현을 살리세요. '~해야 합니다'로 끝나는 일반론 문장만으로 채우면 잘못된 정리입니다. 서론에는 설교가 실제로 어떻게 시작했는지도 짧게 담으세요.
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
    // 점검표로 한꺼번에 검사하고, 빠진 항목만 보충한다(최대 2번). 이미 맞는 부분은 그대로 둔다.
    let out = doc;
    let check = checkDoc(out, notes, theme);
    for (let round = 0; round < 2 && check.some((c) => !c.ok); round++) {
      onStep?.(3);
      const miss = check.filter((c) => !c.ok);
      try {
        const fixPrompt = `아래 설교 정리본(JSON)을 점검표로 검사했더니 다음 항목이 빠졌거나 약합니다.
${miss.map((c, i) => `${i + 1}. ${c.label}: ${c.detail}\n   → ${c.fix}`).join('\n')}

이미 통과한 항목(${check.filter((c) => c.ok).map((c) => c.label).join(', ') || '없음'})은 그대로 지키세요. 기존 문장·표시·예화를 지우거나 일반론으로 바꾸지 말고, 빠진 것만 보충하세요.
전체 분량(1,300~1,600자)과 대지 제목 길이(15자 안팎)는 지키세요. 보충한 만큼 다른 문장을 줄이고, 한 장에 넘치면 여러 관점·용어 풀이·묵상 질문을 줄이세요. 같은 JSON 형식과 표시 문법으로, JSON 하나만 출력하세요.
${MARK_RULES}

[정리본]
${JSON.stringify(out, null, 1)}

[설교 노트]
${JSON.stringify({ central_theme: notes.central_theme, theme_notes: notes.theme_notes, contrast: notes.contrast, break_keys: notes.break_keys, spiritual_warfare: notes.spiritual_warfare, christ_side: notes.christ_side, text_keys: notes.text_keys, detail_keys: notes.detail_keys, points: notes.points }, null, 1)}`;
        const fixed = await call(cfg, cfg.anaModel, [{ text: fixPrompt }], { json: true, temperature: 0.2, thinking: 1024, timeoutMs: 300000 });
        if (fixed && Array.isArray(fixed.body) && fixed.body.length) {
          const again = checkDoc(fixed, notes, theme);
          // 보충한 결과가 통과 항목을 더 잃지 않았을 때만 바꾼다
          if (again.filter((c) => c.ok).length >= check.filter((c) => c.ok).length) { out = fixed; check = again; }
        }
      } catch (e) { break; /* 고치기 실패해도 지금 결과로 진행 */ }
    }
    out._check = check.map(({ key, label, ok, detail }) => ({ key, label, ok, detail }));
    out._notes = notes;
    out._theme = theme;
    return out;
  }

  // 한 문단 정리: 이미 만든 설교 노트(없으면 정리본)를 바탕으로 같은 우선순위로 한 문단만 쓴다
  async function paragraph(cfg, meta, notes, doc) {
    const theme = (notes && notes.central_theme) || doc?._theme || '';
    const src = notes ? { big_idea: notes.big_idea, central_theme: notes.central_theme, theme_notes: notes.theme_notes, contrast: notes.contrast, text_keys: notes.text_keys, emphasized: notes.emphasized, christ_side: notes.christ_side, spiritual_warfare: notes.spiritual_warfare, points: notes.points, conclusion: notes.conclusion }
      : { title: doc.title, one_line: doc.one_line, summary: doc.summary, intro: doc.intro, body: doc.body, conclusion: doc.conclusion };
    const prompt = `당신은 한국 교회 설교를 깊이 있게 정리하는 편집자입니다. 아래 설교 자료를 '한 문단'으로 정리하세요.
${infoLine(meta)}
우선순위:
1. 제목과 본문의 중심 주제${theme ? `「${theme}」` : ''}가 문단의 주인공입니다. 첫 문장에 넣고 문단 전체가 이 주제를 풉니다.
2. 말씀은 언제나 그리스도(복음, 창 3:15, 영적인 것, 영적 싸움)와 마귀(사단, 요 8:44, 육신, 뱀)의 대립과 싸움입니다. 이 설교에서 그 대립이 무엇인지 드러내세요.
3. 본문 핵심 언어와 많이 반복·강조된 말을 살리세요.
4. 마지막 문장은 결단·적용으로 맺으세요.
형식: 한 문단, 6~9문장, 400~600자. 줄바꿈·목록·제목 없이 이어지는 문어체 문단. 설교자가 하지 않은 말을 지어내지 마세요.
${MARK_RULES}
노란 표시는 쓰지 말고, 초록은 2~3곳, 빨강은 1~2곳, 핵심 용어 표시는 2~4곳만 쓰세요.
아래 JSON 하나만 출력하세요: {"paragraph": "문단"}

[설교 자료]
${JSON.stringify(src, null, 1)}`;
    const r = await call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.3, thinking: 512, timeoutMs: 180000 });
    return String(r.paragraph || '').trim();
  }

  async function ping(cfg) {
    return call(cfg, cfg.anaModel, [{ text: '“확인”이라고만 답하세요.' }], { temperature: 0, timeoutMs: 30000 });
  }

  window.Gemini = { transcribe, transcribeRange, uploadFile, liveSummary, finalDoc, paragraph, checkDoc, ping };
})();
