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
    const out = segs.map(([inMark, t]) => {
      if (inMark || !DEVIL.test(t)) return t;
      // 구절 단위(문장부호 사이)로 나눠 마귀 관련 말이 든 구절만 감싼다
      return t.split(/([.!?;,·]\s*|\s—\s|\s-\s|\(|\))/).map((part) => {
        if (!part || !DEVIL.test(part) || part.trim().length < 2) return part;
        const lead = part.match(/^\s*/)[0], tail = part.match(/\s*$/)[0];
        n++;
        return `${lead}[[r|${part.trim()}]]${tail}`;
      }).join('');
    }).join('');
    return [out, n];
  }
  window.Markup = { esc, mark, strip, autoRed };
})();
