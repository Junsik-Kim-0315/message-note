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
          delete p.refs;
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
    if (!p || (!p.sermons && !p.guide?.length && !p.patterns?.structure?.length)) return '';
    const lines = [`(지금까지 ${p.sermons}편을 분석함)`];
    if (p.guide?.length) lines.push('[설교 구조 지침]', ...p.guide.map((g) => `- ${g}`), '[관찰된 패턴]');
    if (p.vocab?.length) lines.push(`- 이 설교자의 핵심 어휘(정리할 때 그대로 살릴 것): ${p.vocab.join(', ')}`);
    for (const f of ['structure', 'start_cue', 'end_cue', 'intro', 'point_markers', 'transitions', 'illustrations', 'application', 'closing']) {
      const v = p.patterns?.[f];
      if (v?.length) lines.push(`- ${LABELS[f]}: ${v.slice(0, f === 'point_markers' || f === 'transitions' ? 8 : 3).join(' / ')}`);
    }
    const tf = Object.entries(p.term_fixes || {});
    if (tf.length) lines.push(`- 자주 잘못 받아쓰는 말: ${tf.slice(-30).map(([w, r]) => `${w}→${r}`).join(', ')}`);
    return lines.join('\n');
  }
  const termsText = (p) => Object.entries(p?.term_fixes || {}).slice(-30).map(([w, r]) => `${w}→${r}`).join(', ');

  function toHtml(p, esc) {
    if (!p || (!p.sermons && !p.guide?.length && !p.patterns?.structure?.length)) return '<p class="hint">아직 학습한 설교가 없어요. 정리를 한 번 하면 여기에 쌓여요.</p>';
    let h = `<p class="hint"><b>${esc(p.preacher)}</b> · ${p.sermons}편 분석 · 마지막 ${esc((p.updated || '').slice(0, 10))}</p><dl class="learn">`;
    if (p.seedFrom) h += `<dt>기본 패턴 출처</dt><dd>${esc(p.seedFrom)} 받아쓰기 직접 분석</dd>`;
    if (p.guide?.length) h += `<dt>설교 구조 지침</dt><dd>${p.guide.map(esc).join('<br>')}</dd>`;
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

  // 문맥 신호: 설교자가 '…이 말이에요', '…이겁니다', '…축복합니다'처럼 한 단락을 결론짓는 문장을 순서대로 뽑는다.
  // 한 번만 나온 말이라도 결론 자리에 나오면 핵심이다(예: 2부의 '무아지경으로 드디어 살게 된다 이 말이에요').
  // 설교를 앞·중간·끝 셋으로 나눠 표시해, 중간의 문제 진단·해법이 끝부분에 묻히지 않게 한다.
  function signals(text) {
    const sents = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/);
    const end = /(이\s*말이에요|이\s*말이야|이\s*말입니다|이겁니다|이거예요|이게\s*핵심|핵심입니다|비밀입니다|축복합니다|하시기를|돼야\s*돼요|해야\s*돼요|해야\s*됩니다|하는\s*거예요|된다는\s*거예요)[.!]?$/;
    const n = sents.length || 1;
    const picked = [];
    // 힘준 말('진짜·반드시·핵심·비밀')과 바로 되풀이한 말('중독입니다, 중독.')도 함께 고른다
    const emph = /(진짜|반드시|핵심|비밀|명심|기억하|잊지)/;
    const again = (t, nx) => nx.length < 20 && (t.match(/[가-힣]{2,}/g) || []).some((w) => nx.startsWith(w.slice(0, 2)));
    sents.forEach((s, i) => { const t = s.trim(); if (t.length >= 12 && t.length <= 220 && (end.test(t) || emph.test(t) || again(t, (sents[i + 1] || '').trim()))) picked.push([i, t]); });
    // 너무 많으면 앞·중간·끝에서 고르게 덜어 낸다
    const thirds = [0, 1, 2].map((k) => picked.filter(([i]) => Math.min(2, Math.floor((i * 3) / n)) === k));
    const per = 25;
    const thin = (arr) => arr.length <= per ? arr : arr.filter((_, j) => j % Math.ceil(arr.length / per) === 0);
    const label = ['앞', '중간', '끝'];
    return thirds.map((a, k) => a.length ? `(${label[k]}) ` + thin(a).map(([, t]) => t).join(' / ') : '').filter(Boolean).join('\n');
  }

  // 반복 상위어: 받아쓰기에서 내용어(명사 위주)를 직접 세어 많이 반복된 순서로 돌려준다.
  // 그리스도·하나님·예수처럼 어느 설교에나 많은 말은 뺀다(예: 2026-11-22 2부는 가치 31회, 사실 28회 / 1부는 성막 38회).
  const STOP = new Set(('여러분 우리 그래서 그러니까 이제 지금 오늘 이렇게 그렇게 그런데 그러면 정말 진짜 이런 그런 저런 무엇 뭐예요 그거 이거 이것 그것 저거 너무 다시 같은 모든 이미 그리고 하지만 때문 사람 사람들 이게 그냥 어떻게 얼마나 가지고 자꾸 계속 여기 거기 저기 하나 한번 아멘 목사님 교회 말씀 이름 너희 우리들 자기 마음 세상 문제 함께 축복 할렐루야 예배 성도 가족 그분 당신 저희 나라 생각 여러분들 이번 보세 그랬어 그랬잖아 있어 없어 그때 아니 바로 항상 언제나 맞아 정도 순간 모습 이야기 얘기 부분 경우 시간 오늘날 처음 마지막 다음 이상 무슨 어디 누구 언제 왜냐 정말로 겁니다 그래 축복합니다 된다 주신 말이 거예 그게 이건 저건 뭐냐 거기서 어느 날마다').split(' '));
  const ALWAYS = new Set(['예수', '하나님', '그리스도', '예수님', '주님', '그리스']);
  const particle = /(으로부터|에게서|으로서|으로써|이라는|라는|이라고|라고|에서는|에게는|으로는|까지|부터|에서|에게|으로|이랑|처럼|보다|이다|이고|이며|이요|이죠|입니다|이에요|예요|이야|이나|이든|만큼|들이|들은|들을|들의|들도|들에|은|는|이|가|을|를|의|에|와|과|도|만|로|들|요|야)$/;
  const verbish = /(하|되|있|없|했|됐|봤|줬|갔|왔|겠|시|고|서|게|지|면|니|며|던|는데|어|아|여|자|죠|네|데|까|든|러|려|도록|면서|다|요|라)$/;
  function repeated(text, n = 10) {
    const m = new Map();
    for (const w of String(text || '').split(/[^가-힣]+/)) {
      if (w.length < 2) continue;
      const b = w.replace(particle, '');
      if (b.length < 2 || STOP.has(b) || ALWAYS.has(b) || ALWAYS.has(w.slice(0, 4)) || (b === w && verbish.test(w))) continue;
      m.set(b, (m.get(b) || 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  }

  // 설교자가 직접 핵심을 밝혔을 가능성이 높은 문장 후보: '오늘 메시지의 핵심', '세 가지 비밀', '오늘 하나님이 말씀하신 거예요', '이 비밀 하나만' 등
  // (2026-11-22 1부는 '핵심'이라는 말 없이 '…몸에 성막을 지으라고 오늘 하나님이 말씀하신 거예요'로 밝혀 노트가 놓쳤다)
  function coreCands(text) {
    const sents = String(text || '').replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/);
    const cues = [[/(오늘\s*)?(메시지|말씀)의\s*핵심/, 5], [/핵심입니다|핵심이에요/, 4], [/(세|두|네)\s*가지\s*비밀/, 4], [/오늘\s*.{0,60}(말씀하신|하신|주신)\s*거예요/, 3], [/이\s*비밀\s*하나만|이\s*비밀을\s*알아야/, 3], [/^그래서\s*오늘[,\s]/, 2]];
    const out = [];
    sents.forEach((s, i) => {
      for (const [re, w] of cues) {
        if (!re.test(s)) continue;
        let t = s.trim(); if (t.length < 25 && sents[i - 1]) t = `${sents[i - 1].trim()} ${t}`;
        out.push({ score: w, at: i / (sents.length || 1), text: t.slice(0, 260) });
        break;
      }
    });
    return out.sort((a, b) => b.score - a.score || b.at - a.at).slice(0, 6);
  }

  // 정리할 때 반드시 살릴 설교자 핵심 어휘를 넘긴다
  const vocabOf = (p) => (p?.vocab || []).map((v) => String(v).split(/[(]/)[0].trim());
  window.Learn = { coreCands, repeated, signals, vocabOf, load, merge, save, toText, termsText, toHtml, keyOf, clean };
})();
