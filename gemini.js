// Gemini 호출과 프롬프트
(function () {
  const MARK_RULES = `색깔 표시 문법(문장 안에 그대로 넣기):
- [[g|...]] 초록 형광: 설교 전체의 핵심 메시지. 문서 전체에서 4~8곳만.
- [[r|...]] 빨간 형광: 마귀·사단·사탄·악한 영·영적 전쟁·유혹과 관련된 핵심 내용. 해당 내용이 없으면 쓰지 않는다.
- [[y|...]] 노란 형광: 각 대지에서 중요한 문장. 대지마다 1~3곳.
- [[t|...]] 핵심 용어(굵게+밑줄): 은혜, 언약, 회개 같은 신앙 핵심 용어가 처음 나올 때.
- [[v|...]] 성경 구절 인용: 예) [[v|요한복음 3:16]] 또는 인용된 말씀 본문.
표시는 겹치지 않게, 강조할 부분만 짧게 감싼다.`;

  async function call(cfg, model, parts, { json = false, temperature = 0.3, timeoutMs = 120000 } = {}) {
    if (!cfg.key) throw new Error('설정에서 Gemini API 키를 넣어주세요.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.key },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature, ...(json ? { responseMimeType: 'application/json' } : {}) },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Gemini 오류 ${res.status}: ${data.error?.message || ''}`.trim());
      const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      if (!json) return text.trim();
      return parseJson(text);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Gemini 응답이 너무 오래 걸려요.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
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

  async function transcribe(cfg, wavBlob, prevTail) {
    const prompt = `이 오디오는 한국 교회 현장 예배 설교 녹음의 약 30초 구간입니다.
들리는 말을 한국어로 그대로 받아쓰세요.
- 성경 책 이름, 장·절, 교회 용어(은혜, 성령, 언약 등)는 바른 표기로 쓰세요.
- 잘 들리지 않는 부분은 지어내지 말고 생략하세요.
- 찬양·음악만 나오면 (찬양), 말소리가 없으면 아무것도 출력하지 마세요.
- 화자 이름, 시간, 설명 없이 받아쓴 문장만 출력하세요.
${prevTail ? `직전 구간의 끝부분(문맥 참고용, 다시 쓰지 마세요): "${prevTail}"` : ''}`;
    const data = await blobToBase64(wavBlob);
    return call(cfg, cfg.sttModel, [{ text: prompt }, { inline_data: { mime_type: 'audio/wav', data } }], { temperature: 0, timeoutMs: 90000 });
  }

  async function liveSummary(cfg, meta, transcript) {
    const prompt = `당신은 예배 설교를 듣는 사람을 돕는 정리 도우미입니다. 아래는 지금까지 진행된 설교의 실시간 받아쓰기입니다(음성인식이라 오타가 있을 수 있으니 문맥으로 바로잡아 이해하세요).
예배: ${meta.service_type || ''} / 설교자: ${meta.preacher || ''}

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
    return call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.2 });
  }

  async function finalDoc(cfg, meta, transcript) {
    const prompt = `당신은 한국 교회 설교를 깊이 있게 정리하는 편집자입니다. 아래는 현장 예배 설교의 음성인식 받아쓰기 전체입니다. 음성인식 오류는 문맥으로 바로잡되, 설교자가 말하지 않은 내용을 덧붙이지 마세요(단, '여러 관점' 항목은 본문의 배경 지식을 보충해도 됩니다).

설교 정보: 날짜 ${meta.date} / 예배 ${meta.service_type || ''} / 설교자 ${meta.preacher || '미상'} / 사용자가 적은 제목 ${meta.title || '(없음, 추정할 것)'}

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
문단은 설교자의 말투를 살리되 읽기 좋은 문어체로 다듬고, 각 문단은 2~5문장으로 쓰세요. 예화와 간증도 핵심만 살려 넣으세요.
${MARK_RULES}

[받아쓰기 전체]
${transcript}`;
    return call(cfg, cfg.anaModel, [{ text: prompt }], { json: true, temperature: 0.3, timeoutMs: 240000 });
  }

  async function ping(cfg) {
    return call(cfg, cfg.anaModel, [{ text: '“확인”이라고만 답하세요.' }], { temperature: 0, timeoutMs: 30000 });
  }

  window.Gemini = { transcribe, liveSummary, finalDoc, ping };
})();
