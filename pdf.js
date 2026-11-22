// 최종 정리 JSON → A4 페이지들 → PDF
(function () {
  const { mark } = window.Markup;
  const esc = (s) => window.Markup.esc(window.Markup.strip(s)); // 제목·태그 같은 칸에 표시 문법이 섞여 와도 기호가 보이지 않게
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const paras = (list) => arr(list).map((p) => `<p>${mark(p)}</p>`);
  const bullets = (list, tag = 'ul') => {
    const items = arr(list);
    return items.length ? `<${tag}>${items.map((x) => `<li>${mark(x)}</li>`).join('')}</${tag}>` : '';
  };

  // 한 장에 담을 블록들. drop에 든 항목은 넣지 않는다 (넘칠 때 덜 중요한 것부터 뺌)
  function buildBlocks(d, drop = new Set()) {
    const b = [];
    const meta = [
      d.date && `<b>${esc(d.date)}</b>`,
      d.service_type && esc(d.service_type),
      d.preacher && esc(d.preacher),
      d.scripture_main && `본문 <b>${esc(d.scripture_main)}</b>`,
    ].filter(Boolean).join(' · ');
    b.push(`<h1>${esc(d.title || '제목 없음')}</h1><div class="doc-meta">${meta}</div>`);
    b.push(`<div class="legend">
      <span><span class="m-g">초록</span> 핵심 메시지</span>
      <span><span class="m-r">빨강</span> 마귀·사단 관련 핵심</span>
      <span><span class="m-y">노랑</span> 중요한 문장</span>
      <span><span class="m-t">굵게+밑줄</span> 핵심 용어</span>
      <span><span class="m-v">파랑</span> 성경 구절</span></div>`);
    b.push(`<div class="summary-box"><div class="one">${mark(d.one_line || '')}</div>${drop.has('summary') ? '' : bullets(d.summary)}</div>`);
    const tags = arr(d.tags);
    if (!drop.has('tags') && (tags.length || d.category || arr(d.scriptures).length)) {
      b.push(`<div class="tagline">${d.category ? `분류 <b>${esc(d.category)}</b> · ` : ''}${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${arr(d.scriptures).length ? ` <span class="m-v">${arr(d.scriptures).map(esc).join(', ')}</span>` : ''}</div>`);
    }
    b.push('<h2>서론</h2>');
    b.push(...paras(d.intro));
    b.push('<h2>본론</h2>');
    arr(d.body).forEach((sec, i) => {
      const v = arr(sec.verses).length ? ` <span class="verses">(${arr(sec.verses).map(esc).join(', ')})</span>` : '';
      b.push(`<h3>${esc(sec.heading || `대지 ${i + 1}`)}${v}</h3>`);
      b.push(...paras(sec.paragraphs));
    });
    b.push('<h2>결론</h2>');
    b.push(...paras(d.conclusion));

    const pv = d.perspectives || {};
    const one = (x) => arr(x).join(' ');
    const pvItems = [
      !drop.has('context') && pv.context && `<li><span class="lbl">문맥</span> ${mark(one(pv.context))}</li>`,
      !drop.has('theology') && pv.theology && `<li><span class="lbl">신학</span> ${mark(one(pv.theology))}</li>`,
      pv.application && `<li><span class="lbl">적용</span> ${mark(one(pv.application))}</li>`,
    ].filter(Boolean);
    if (pvItems.length) b.push(`<h2>여러 관점</h2><ul>${pvItems.join('')}</ul>`);
    if (!drop.has('terms') && arr(d.key_terms).length) {
      b.push(`<p><span class="lbl">핵심 용어</span> ${arr(d.key_terms).map((t) => `<span class="m-t">${esc(t.term)}</span> ${mark(t.meaning)}`).join(' · ')}</p>`);
    }
    if (!drop.has('questions') && arr(d.questions).length) {
      b.push(`<h2>묵상 질문</h2>${bullets(drop.has('questions2') ? arr(d.questions).slice(0, 2) : d.questions, 'ol')}`);
    }
    return b;
  }

  function newPage(stage, footLeft) {
    const page = document.createElement('div');
    page.className = 'page';
    page.innerHTML = `<div class="content"></div><div class="foot"><span>${esc(footLeft)}</span><span class="pn">말씀 정리 앱 ${esc(window.APP_VERSION || '')}</span></div>`;
    stage.appendChild(page);
    return page;
  }

  async function ensureFonts() {
    try {
      await Promise.all([
        document.fonts.load('400 15px "Noto Serif KR"', '가'),
        document.fonts.load('700 15px "Noto Serif KR"', '가'),
        document.fonts.load('700 15px "Noto Sans KR"', '가'),
        document.fonts.load('900 15px "Noto Sans KR"', '가'),
      ]);
      await document.fonts.ready;
    } catch (e) { /* 글꼴을 못 받아도 기본 글꼴로 진행 */ }
  }

  // html2canvas는 여러 줄에 걸친 형광 표시를 한 덩어리 사각형으로 칠해 앞 글자를 가린다.
  // 그래서 표시를 단어 단위 조각으로 나눠 줄이 바뀌어도 바르게 칠해지게 한다.
  function splitMarks(root) {
    root.querySelectorAll('.m-g,.m-r,.m-y,.m-t,.m-v').forEach((el) => {
      if (el.children.length) return;
      const cls = el.className;
      const words = el.textContent.split(/(?<=\s)/);
      if (words.length < 2) return;
      el.className = '';
      el.textContent = '';
      // 단어는 줄바꿈 없는 조각, 뒤 공백은 따로 같은 색 조각으로 둬서 공백에서만 줄이 바뀌게 한다
      words.forEach((w) => {
        const m = w.match(/^(\S*)(\s*)$/) || [w, w, ''];
        if (m[1]) { const sp = document.createElement('span'); sp.className = `${cls} piece`; sp.textContent = m[1]; el.appendChild(sp); }
        if (m[2]) { const gap = document.createElement('span'); gap.className = `${cls} gap`; gap.textContent = m[2]; el.appendChild(gap); }
      });
    });
  }

  // A4 한 장에 맞춘다: 글자를 조금씩 줄이고, 그래도 넘치면 덜 중요한 항목부터 뺀다
  const SIZES = [14, 13.5, 13, 12.5, 12, 11.5, 11];
  const DROPS = [[], ['terms'], ['terms', 'questions2'], ['terms', 'questions2', 'context'],
    ['terms', 'questions', 'context', 'theology'], ['terms', 'questions', 'context', 'theology', 'tags', 'summary']];
  async function layout(d, stage) {
    await ensureFonts();
    const foot = `${d.date || ''} ${d.title || ''}`.trim();
    for (const drop of DROPS) {
      stage.innerHTML = '';
      const page = newPage(stage, foot);
      const content = page.querySelector('.content');
      const tmp = document.createElement('div');
      tmp.innerHTML = buildBlocks(d, new Set(drop)).join('');
      splitMarks(tmp);
      [...tmp.childNodes].forEach((n) => content.appendChild(n));
      for (const s of SIZES) {
        page.style.fontSize = `${s}px`;
        if (content.scrollHeight <= content.clientHeight + 1) return [page];
      }
    }
    return [...stage.querySelectorAll('.page')]; // 마지막 단계(가장 작게)로 남긴다
  }

  async function toPdfBlob(d, stage) {
    const pages = await layout(d, stage);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const img = canvas.toDataURL('image/jpeg', 0.9);
      if (i > 0) pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
      canvas.width = canvas.height = 0; // 아이폰 메모리 반환
    }
    pdf.setProperties({ title: d.title || '말씀 정리', subject: d.scripture_main || '', creator: `말씀 정리 앱 ${window.APP_VERSION || ''}` });
    return pdf.output('blob');
  }

  // 화면 미리보기: 같은 페이지를 폭에 맞게 축소해서 보여준다
  async function preview(d, container) {
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:-10000px;top:0';
    document.body.appendChild(stage);
    const pages = await layout(d, stage);
    container.innerHTML = '';
    const w = container.clientWidth || 360;
    const scale = Math.min(1, w / 794);
    pages.forEach((p) => {
      const wrap = document.createElement('div');
      wrap.className = 'page-wrap';
      wrap.style.height = `${1123 * scale + 12}px`;
      p.style.transform = `scale(${scale})`;
      wrap.appendChild(p);
      container.appendChild(wrap);
    });
    stage.remove();
  }

  window.SermonPdf = { toPdfBlob, preview, buildBlocks };
})();
