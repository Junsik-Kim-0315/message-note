// 설교 구조 학습: 정리할 때마다 그 설교의 구조·용어 교정을 뽑아 설교자별로 쌓고, 다음 정리에 넣는다.
// 휴대폰(localStorage)과 구글 드라이브(말씀 정리/설교 분석/설교패턴_설교자.json)에 함께 보관.
(function () {
  const FIELDS = ['start_cue', 'end_cue', 'intro', 'point_markers', 'transitions', 'illustrations', 'application', 'closing', 'structure'];
  const LABELS = {
    structure: '전체 구조', start_cue: '설교 시작 신호', end_cue: '설교 끝 신호', intro: '도입 방식', point_markers: '대지 나누는 표현',
    transitions: '자주 쓰는 연결·강조 표현', illustrations: '예화·간증', application: '적용·결단 촉구', closing: '마무리',
  };
  // '김서권 목사', '김서권목사님' 모두 같은 사람으로 본다
  const keyOf = (preacher) => (preacher || '').trim().replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s*(담임|원로|부)?\s*(목사|전도사|강도사|선교사|장로|교수)님?$/, '').trim() || '공통';
  const fileOf = (preacher) => `설교패턴_${keyOf(preacher)}.json`;
  const empty = (preacher) => ({ preacher: keyOf(preacher), sermons: 0, updated: '', patterns: {}, term_fixes: {}, history: [] });

  function localGet(preacher) {
    try { return JSON.parse(localStorage.getItem('mn_profile_' + keyOf(preacher))) || null; } catch (e) { return null; }
  }
  function localSet(p) { try { localStorage.setItem('mn_profile_' + p.preacher, JSON.stringify(p)); } catch (e) {} }

  // 휴대폰과 드라이브 중 더 많이 학습된 쪽을 쓴다
  async function load(preacher) {
    let p = localGet(preacher);
    try {
      const d = await window.Drive.loadJson(fileOf(preacher));
      if (d && (!p || (d.sermons || 0) > (p.sermons || 0))) p = d;
    } catch (e) {}
    p = p || empty(preacher);
    // 직접 분석해 둔 기본 패턴(profiles/설교자.json)이 있으면 합쳐 둔다. 기본 패턴이 고쳐지면(version) 다시 합친다.
    {
      try {
        const r = await fetch(`profiles/${encodeURIComponent(keyOf(preacher))}.json?v=${window.APP_VERSION || ''}`);
        if (r.ok) {
          const s = await r.json();
          const ver = s.version || s.updated || '1';
          if (p.seedVer === ver) return p;
          p.seedVer = ver;
          p.guide = s.guide || []; p.vocab = s.vocab || [];
          // 교회 요약(언약기도) 모범: 기본 패턴의 것과 정리하며 쌓인 것을 합친다
          p.refs = [...(p.refs || []), ...(s.refs || [])].filter((x, i, a) => a.findIndex((y) => y.ref === x.ref) === i).slice(0, 8);
          for (const f of FIELDS) p.patterns[f] = [...(p.patterns[f] || []), ...((s.patterns || {})[f] || [])].filter((v, i, a) => a.indexOf(v) === i).slice(0, 12);
          p.term_fixes = { ...(s.term_fixes || {}), ...(p.term_fixes || {}) };
          p.seedFrom = (s.history || []).map((h) => h.title).join(', '); // 기본 패턴의 출처 (편수에는 넣지 않음)
        }
      } catch (e) {}
      p.seeded = true;
    }
    return p;
  }

  const uniqPush = (list, items, cap) => {
    const out = [...(list || [])];
    for (const it of items) {
      const s = String(it || '').trim();
      if (!s) continue;
      const i = out.indexOf(s);
      if (i >= 0) out.splice(i, 1);
      out.unshift(s); // 최근 것이 앞으로
    }
    return out.slice(0, cap);
  };

  // 이번 정리의 분석 결과를 쌓는다. 같은 기록을 다시 정리하면 한 번만 센다.
  function merge(profile, notes, meta, sessionId) {
    const p = JSON.parse(JSON.stringify(profile || empty(meta.preacher)));
    const st = notes?.style || {};
    for (const f of FIELDS) {
      const v = st[f];
      p.patterns[f] = uniqPush(p.patterns[f], Array.isArray(v) ? v : [v], f === 'point_markers' || f === 'transitions' ? 12 : 6);
    }
    for (const t of notes?.term_fixes || []) {
      const w = String(t.wrong || '').trim(), r = String(t.right || '').trim();
      if (w && r && w !== r) p.term_fixes[w] = r;
    }
    const keys = Object.keys(p.term_fixes);
    if (keys.length > 80) keys.slice(0, keys.length - 80).forEach((k) => delete p.term_fixes[k]);
    // 사용자가 붙여 넣은 교회 요약(언약기도)은 다음 정리의 모범 답안으로 쌓는다
    if (meta.ref) p.refs = [{ date: meta.date, title: meta.title || notes?.title_guess || '', ref: meta.ref }, ...(p.refs || []).filter((x) => x.ref !== meta.ref)].slice(0, 8);
    const h = { id: sessionId, date: meta.date, title: meta.title || notes?.title_guess || '', points: (notes?.points || []).length };
    p.history = [h, ...(p.history || []).filter((x) => x.id !== sessionId)].slice(0, 50);
    p.sermons = p.history.length;
    p.updated = new Date().toISOString();
    return p;
  }

  async function save(p) {
    localSet(p);
    try { return await window.Drive.saveJson(fileOf(p.preacher), p); } catch (e) { return false; }
  }

  // 프롬프트에 넣을 요약
  function toText(p) {
    if (!p || (!p.sermons && !p.guide?.length && !p.refs?.length)) return '';
    const lines = [`(지금까지 ${p.sermons}편을 분석함)`];
    if (p.guide?.length) lines.push('[설교 구조 지침]', ...p.guide.map((g) => `- ${g}`), '[관찰된 패턴]');
    if (p.vocab?.length) lines.push(`- 이 설교자의 핵심 어휘(정리할 때 그대로 살릴 것): ${p.vocab.join(', ')}`);
    for (const f of ['structure', 'start_cue', 'end_cue', 'intro', 'point_markers', 'transitions', 'illustrations', 'application', 'closing']) {
      const v = p.patterns?.[f];
      if (v?.length) lines.push(`- ${LABELS[f]}: ${v.slice(0, f === 'point_markers' || f === 'transitions' ? 8 : 3).join(' / ')}`);
    }
    const tf = Object.entries(p.term_fixes || {});
    if (tf.length) lines.push(`- 자주 잘못 받아쓰는 말: ${tf.slice(-30).map(([w, r]) => `${w}→${r}`).join(', ')}`);
    if (p.refs?.length) lines.push('[모범 정리: 교회가 낸 설교 요약(언약기도). 정리할 때 이런 흐름과 말을 목표로 할 것]', ...p.refs.slice(0, 2).map((x) => `- ${x.date || ''} ${x.title || ''}: ${String(x.ref).replace(/\s+/g, ' ').slice(0, 420)}`));
    return lines.join('\n');
  }
  const termsText = (p) => Object.entries(p?.term_fixes || {}).slice(-30).map(([w, r]) => `${w}→${r}`).join(', ');

  function toHtml(p, esc) {
    if (!p || (!p.sermons && !p.guide?.length && !p.refs?.length)) return '<p class="hint">아직 학습한 설교가 없어요. 정리를 한 번 하면 여기에 쌓여요.</p>';
    let h = `<p class="hint"><b>${esc(p.preacher)}</b> · ${p.sermons}편 분석 · 마지막 ${esc((p.updated || '').slice(0, 10))}</p><dl class="learn">`;
    if (p.seedFrom) h += `<dt>기본 패턴 출처</dt><dd>${esc(p.seedFrom)} 받아쓰기 직접 분석</dd>`;
    if (p.guide?.length) h += `<dt>설교 구조 지침</dt><dd>${p.guide.map(esc).join('<br>')}</dd>`;
    if (p.refs?.length) h += `<dt>모범 정리 (교회 요약·언약기도)</dt><dd>${p.refs.map((x) => `<b>${esc(x.date || '')} ${esc(x.title || '')}</b><br>${esc(String(x.ref).replace(/\[\s*언약\s*기도\s*\]/g, '').trim())}`).join('<br><br>')}</dd>`;
    if (p.vocab?.length) h += `<dt>핵심 어휘</dt><dd>${p.vocab.map(esc).join(' · ')}</dd>`;
    for (const f of ['structure', 'start_cue', 'end_cue', 'intro', 'point_markers', 'transitions', 'illustrations', 'application', 'closing']) {
      const v = p.patterns?.[f];
      if (v?.length) h += `<dt>${LABELS[f]}</dt><dd>${v.map(esc).join('<br>')}</dd>`;
    }
    const tf = Object.entries(p.term_fixes || {});
    if (tf.length) h += `<dt>받아쓰기 교정 (${tf.length}개)</dt><dd>${tf.map(([w, r]) => `${esc(w)} → <b>${esc(r)}</b>`).join('<br>')}</dd>`;
    h += `<dt>분석한 설교</dt><dd>${(p.history || []).map((x) => `${esc(x.date || '')} ${esc(x.title || '')} (대지 ${x.points})`).join('<br>')}</dd></dl>`;
    return h;
  }

  // 정리 전에 받아쓰기 잡음을 걷어낸다
  // - 줄 앞의 시간 표시(05:00, 0:00), 'church 138-163 11:21:40~…', '유튜브: (17:30)', 홀로 남은 괄호
  // - 여러 녹음을 겹쳐 붙이거나 받아쓰기가 같은 말을 되풀이해 생긴 중복 문장 (가까운 곳에서 다시 나온 긴 문장만)
  function clean(text) {
    const norm = (s) => s.replace(/[\s.,!?'"“”‘’·…~()\-\/:]+/g, '');
    let removed = 0;
    const lines = String(text || '').split(/\n/).map((line) => {
      const before = line;
      line = line
        .replace(/^\s*church\s+[\d\-]+\s+[\d:]+\s*~\s*[\d:]+\s*/i, '')
        .replace(/^\s*(유튜브|youtube)\s*[:：]\s*\(?\d{1,2}:\d{2}(:\d{2})?\)?\s*/i, '')
        .replace(/^\s*[{}\[\]]+\s*/, '')
        .replace(/^\s*\(?\d{1,2}:\d{2}(:\d{2})?\)?\s*/, '');
      if (line !== before) removed++;
      return line;
    });
    const recent = []; // 최근 문장들
    const out = lines.map((line) => line.split(/(?<=[.?!])\s+/).filter((sent) => {
      const k = norm(sent);
      if (k.length < 15) return true;
      if (recent.includes(k)) { removed++; return false; }
      recent.push(k); if (recent.length > 80) recent.shift();
      return true;
    }).join(' '));
    return { text: out.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), removed };
  }

  // 정리할 때 반드시 살릴 설교자 핵심 어휘를 넘긴다
  const vocabOf = (p) => (p?.vocab || []).map((v) => String(v).split(/[(]/)[0].trim());
  window.Learn = { vocabOf, load, merge, save, toText, termsText, toHtml, keyOf, clean };
})();
