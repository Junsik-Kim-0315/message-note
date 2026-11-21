// 최종 정리 JSON → A4 페이지들 → PDF
(function () {
  const { esc, mark } = window.Markup;
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const paras = (list) => arr(list).map((p) => `<p>${mark(p)}</p>`);
  const bullets = (list, tag = 'ul') => {
    const items = arr(list);
    return items.length ? `<${tag}>${items.map((x) => `<li>${mark(x)}</li>`).join('')}</${tag}>` : '';
  };

  // 페이지 나누기를 위해 블록 단위(문단·제목)로 만든다
  function buildBlocks(d) {
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
    b.push(`<div class="summary-box"><div class="one">${mark(d.one_line || '')}</div>${bullets(d.summary)}</div>`);
    const tags = arr(d.tags);
    if (tags.length || d.category) {
      b.push(`<div class="tagline">${d.category ? `분류 <b>${esc(d.category)}</b> · ` : ''}${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`);
    }
    if (arr(d.scriptures).length) b.push(`<div class="verses">인용 구절: ${arr(d.scriptures).map(esc).join(', ')}</div>`);

    b.push('<h2>서론</h2>');
    b.push(...paras(d.intro));
    b.push('<h2>본론</h2>');
    arr(d.body).forEach((sec, i) => {
      b.push(`<h3>${esc(sec.heading || `대지 ${i + 1}`)}</h3>`);
      if (arr(sec.verses).length) b.push(`<div class="verses">${arr(sec.verses).map(esc).join(', ')}</div>`);
      b.push(...paras(sec.paragraphs));
    });
    b.push('<h2>결론</h2>');
    b.push(...paras(d.conclusion));

    const pv = d.perspectives || {};
    if (pv.context || pv.theology || pv.application) {
      b.push('<h2>여러 관점에서 보기</h2>');
      if (pv.context) { b.push('<h3>본문의 문맥과 배경</h3>'); b.push(...paras(pv.context)); }
      if (pv.theology) { b.push('<h3>신학적 메시지</h3>'); b.push(...paras(pv.theology)); }
      if (pv.application) { b.push('<h3>삶의 적용</h3>'); b.push(...paras(pv.application)); }
    }
    if (arr(d.key_terms).length) {
      b.push('<h2>핵심 용어</h2>');
      arr(d.key_terms).forEach((t) => b.push(`<dl class="terms"><dt>${esc(t.term)}</dt><dd>${mark(t.meaning)}</dd></dl>`));
    }
    if (arr(d.questions).length) {
      b.push('<h2>묵상과 적용 질문</h2>');
      b.push(bullets(d.questions, 'ol'));
    }
    return b;
  }

  function newPage(stage, footLeft) {
    const page = document.createElement('div');
    page.className = 'page';
    page.innerHTML = `<div class="content"></div><div class="foot"><span>${esc(footLeft)}</span><span class="pn"></span></div>`;
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
      words.forEach((w) => {
        const sp = document.createElement('span');
        sp.className = `${cls} piece`;
        sp.textContent = w;
        el.appendChild(sp);
      });
    });
  }

  // 블록을 A4 페이지에 차례로 채운다
  async function layout(d, stage) {
    await ensureFonts();
    stage.innerHTML = '';
    const foot = `${d.date || ''} ${d.title || ''}`.trim();
    const blocks = buildBlocks(d);
    let page = newPage(stage, foot);
    let content = page.querySelector('.content');
    for (const html of blocks) {
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      splitMarks(tmp);
      const nodes = [...tmp.childNodes];
      nodes.forEach((n) => content.appendChild(n));
      if (content.scrollHeight > content.clientHeight + 1 && content.childNodes.length > nodes.length) {
        nodes.forEach((n) => n.remove());
        // 제목만 페이지 끝에 남지 않게 함께 넘긴다
        const carry = [];
        const last = content.lastElementChild;
        if (last && /^H[23]$/.test(last.tagName)) carry.push(last);
        page = newPage(stage, foot);
        content = page.querySelector('.content');
        carry.forEach((n) => content.appendChild(n));
        nodes.forEach((n) => content.appendChild(n));
      }
    }
    const pages = [...stage.querySelectorAll('.page')];
    pages.forEach((p, i) => (p.querySelector('.pn').textContent = `${i + 1} / ${pages.length}`));
    return pages;
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
    pdf.setProperties({ title: d.title || '말씀 정리', subject: d.scripture_main || '' });
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
