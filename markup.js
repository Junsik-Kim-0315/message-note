// 색깔 표시 문법: [[g|핵심]] [[r|마귀·사단 관련 핵심]] [[y|중요 문장]] [[t|핵심 용어]] [[v|성경 구절]]
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const re = /\[\[(g|r|y|t|v)\|([\s\S]*?)\]\]/g;
  // 모델이 표시를 조금 틀리게 쓴 경우를 바로잡는다: [t|x], [[t|x], [[t: x]], [[ t | x ]] 등
  const fix = (s) => String(s ?? '')
    .replace(/\[{1,2}\s*([grytv])\s*[|:｜]\s*/g, '[[$1|')
    .replace(/(\[\[[grytv]\|[^\[\]]*?)\](?!\])/g, '$1]]');
  // 짝이 안 맞아 남은 표시 조각(예: 't|', '[[', ']]')은 지운다
  const clean = (s) => s.replace(/\[\[[grytv]\||\[\[|\]\]/g, '').replace(/(^|[\s(“"';>])[grytv]\|/g, '$1');
  function mark(s) {
    let out = esc(fix(s));
    // 안쪽부터 여러 번 적용해서 겹친 표시도 처리
    for (let i = 0; i < 3; i++) {
      const next = out.replace(re, (_, k, body) => `<span class="m-${k}">${body}</span>`);
      if (next === out) break;
      out = next;
    }
    return clean(out);
  }
  const strip = (s) => clean(fix(s).replace(re, '$2'));
  // 빨강 자동 보충: 표시 밖(바깥 깊이 0)에 마귀·사단 관련 말이 남아 있으면 그 말이 든 구절을 [[r|…]]로 감싼다.
  // 모델이 '사단'이 직접 나온 곳에만 빨강을 칠하고 저주·참소·흑암·결박 같은 말은 놓치는 일이 잦아서 앱이 마무리한다.
  const DEVIL = /마귀|사단|사탄|뱀|귀신|흑암|저주|참소|요\s?8:44|요한복음 8장 44절|요일\s?3:8|결박|떠나갈지어다|떠나가라|무너질지어다|깨어질지어다|부서질지어다|박살|광명한 천사|세상 신|악한 영|불화살|원수의 능력|어둠의 권세|정사와 권세/;
  // 이 설교에서 마귀 쪽으로 진단된 말(노트의 break_keys, 예: 육신적 무능·완악함)도 빨강 대상에 넣는다
  const isDevil = (t) => DEVIL.test(t) || (window.MN_BREAK_KEYS || []).some((k) => k && k.length >= 2 && String(t).replace(/\s+/g, '').includes(k));
  // 앱이 스스로 칠하는 빨강은 '마귀'라는 낱말만 보고 칠하지 않는다(사용자 기준: 핵심과 연관·대조되고 흐름에 맞는 곳에만).
  // ① 대적 선포(결박·떠나가라·~할지어다·박살, 요 8:44) ② 이 설교에서 막는 것으로 진단된 말(break_keys)
  // ③ 마귀 쪽 낱말 + 노트가 문맥으로 뽑은 마귀 쪽 내용(설교자의 대적 발언·막는 것·대조의 반대쪽)의 핵심 낱말이 함께 있을 때만
  const DECL = /결박|떠나갈지어다|떠나가라|무너질지어다|깨어질지어다|부서질지어다|박살|요\s?8:44|요한복음 8장 44절|요일\s?3:8/;
  const breakHit = (t) => (window.MN_BREAK_KEYS || []).some((k) => k && k.length >= 2 && String(t).replace(/\s+/g, '').includes(k));
  const ctxRed = (t) => {
    const ctx = window.MN_RED_CTX;
    if (!Array.isArray(ctx)) return isDevil(t); // 노트가 없을 때(실시간 정리 등)는 예전처럼
    const z = String(t).replace(/\s+/g, '');
    return DECL.test(t) || breakHit(t) || (DEVIL.test(t) && ctx.some((w) => z.includes(w)));
  };
  function autoRed(src) {
    const s = fix(src);
    // 깊이 0 구간으로 나눈다
    const segs = []; let depth = 0, buf = '';
    for (let i = 0; i < s.length; i++) {
      if (s.startsWith('[[', i) && /[grytv]\|/.test(s.slice(i + 2, i + 4))) { if (depth === 0) { segs.push([0, buf]); buf = ''; } depth++; buf += s.slice(i, i + 4); i += 3; continue; }
      if (s.startsWith(']]', i) && depth > 0) { buf += ']]'; i += 1; depth--; if (depth === 0) { segs.push([1, buf]); buf = ''; } continue; }
      buf += s[i];
    }
    segs.push([depth ? 1 : 0, buf]);
    let n = 0;
    const out = segs.map(([inMark, t], si) => {
      if (inMark || !ctxRed(t)) return t;
      // 바로 앞 표시에 붙은 조사('…]]으로 성전을')는 그대로 두고 그 뒤부터 본다
      if (si > 0 && segs[si - 1][0] && /^[^\s.,!?]/.test(t)) {
        // '…]]할 때 세상 신의' 처럼 앞말에 매인 '때·것·수' 같은 말까지 건너뛴다
        const m0 = t.match(/^[^\s.,!?]+(\s+(때|것|수|줄|뿐|중|데|만큼|대로)(?=[\s,.]|[은는이가을를에도]))?/);
        const k = m0 ? m0[0].length : -1;
        if (k > 0) { const [o, m] = autoRed(t.slice(k)); n += m; return t.slice(0, k) + o; }
        return t;
      }
      // 구절 단위(문장부호 사이)로 나눠 마귀 관련 말이 든 구절만 감싼다
      return t.split(/([.!?;,·]\s*|\s—\s|\s-\s|\(|\))/).map((part) => {
        if (!part || !ctxRed(part) || part.trim().length < 2) return part;
        const lead = part.match(/^[\s"'“”‘’「」]*/)[0], tail = part.match(/[\s"'“”‘’「」]*$/)[0]; // 따옴표는 빨강 밖에
        if (part.length - lead.length - tail.length < 2) return part;
        n++;
        return `${lead}[[r|${part.slice(lead.length, part.length - tail.length)}]]${tail}`;
      }).join('');
    }).join('');
    // 쉼표·띄어쓰기만 사이에 둔 빨강 조각은 하나로 잇는다('[[r|완악함]], [[r|질병의 저주]]' → '[[r|완악함, 질병의 저주]]')
    let merged = out, prev;
    do { prev = merged; merged = merged.replace(/(\[\[r\|[^\[\]]*)\]\](,?\s*)\[\[r\|/g, '$1$2'); } while (merged !== prev);
    return [merged, n];
  }
  // 빨강 다듬기: AI가 빨강을 여러 문장에 걸쳐 칠하면 마귀 쪽이 아닌 문장까지 빨개진다
  // (예: '마귀 있다. 불화살 쏘는 놈 있다. 이게 진짜 보여야 여러분이 은혜 속에서 사는 거예요' 전체가 빨강)
  // → 빨강 안을 문장·구절로 나눠 마귀 쪽 말이 없는 문장은 빨강을 벗기고, 그리스도·은혜 쪽 구절도 벗긴다
  const CHRIST = /그리스도|예수|은혜|복음|성령|하나님\s*나라|승리|재창조|생명|구원|감사|축복|여자의\s*후손/;
  // 회복·세움 쪽 말: 마귀 쪽 말이 없는 구절에 이런 말이 있으면 뉘앙스가 바뀐 것(예: '흑암 경제가 무너지고 | 미래 성전이 세워집니다')
  const RESTORE = /세워|세우|세운|살리|살릴|살아|회복|열리|열린|누리|일어서|일어나|드리|이루|성전이|성막이|축복|감사|기쁨|승리|빛나|번성|부흥/;
  const good = (c) => !isDevil(c) && (CHRIST.test(c) || RESTORE.test(c));
  // 구절 나누기: 쉼표, 그리고 '-고/-며/-면서/-지만/-는데/-니/-면/-서/-ㄹ 때' 같은 이음말 뒤
  const CLAUSE = /(,\s*|(?<=(?:[가-힣](?:고|며|면서|지만|는데|니까|으니|면|어서|아서|해서)|\s때))\s+)/;
  function splitRed(s) {
    const cl = s.split(CLAUSE);
    if (cl.length < 3 || !cl.some((c, i) => i % 2 === 0 && c.trim() && good(c))) return null;
    return cl.map((c, i) => (i % 2 || !c.trim() ? c : good(c) ? c : `[[r|${c}]]`)).join('');
  }
  const joinRed = (t) => { let m = t, p; do { p = m; m = m.replace(/(\[\[r\|[^\[\]]*)\]\](,?\s*)\[\[r\|/g, '$1$2'); } while (m !== p); return m; };
  // 빨강 다듬기: 빨강 안을 문장·구절로 나눠, 마귀 쪽 말이 없는 문장은 빨강을 벗기고
  // 마귀 쪽 문장 안에서도 그리스도·은혜·회복 쪽으로 뉘앙스가 바뀐 구절은 빨강 밖으로 뺀다
  // (예: '마귀 있다. … 이게 진짜 보여야 여러분이 은혜 속에서 사는 거예요', '흑암 경제가 무너지고 다음 세대를 살릴 미래 성전이 세워집니다')
  function trimRed(src) {
    let n = 0;
    const out = String(src || '').replace(/\[\[r\|([^\[\]]*)\]\]/g, (m, inner) => {
      const parts = inner.split(/(?<=[.!?])\s+/).map((s) => {
        if (!isDevil(s)) { n++; return s; }
        const sp = splitRed(s);
        if (sp) { n++; return sp; }
        return `[[r|${s}]]`;
      });
      return parts.join(' ');
    });
    return [n ? joinRed(out) : String(src || ''), n];
  }
  window.Markup = { esc, mark, strip, autoRed, trimRed, isDevil };
})();
