// 색깔 표시 문법: [[g|핵심]] [[r|마귀·사단 관련 핵심]] [[y|중요 문장]] [[t|핵심 용어]] [[v|성경 구절]]
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const re = /\[\[(g|r|y|t|v)\|([\s\S]*?)\]\]/g;
  function mark(s) {
    let out = esc(s);
    // 안쪽부터 여러 번 적용해서 겹친 표시도 처리
    for (let i = 0; i < 3; i++) {
      const next = out.replace(re, (_, k, body) => `<span class="m-${k}">${body}</span>`);
      if (next === out) break;
      out = next;
    }
    return out.replace(/\[\[|\]\]/g, '');
  }
  const strip = (s) => String(s ?? '').replace(re, '$2').replace(/\[\[(g|r|y|t|v)\||\]\]/g, '');
  window.Markup = { esc, mark, strip };
})();
