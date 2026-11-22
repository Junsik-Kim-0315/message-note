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
  window.Markup = { esc, mark, strip };
})();
