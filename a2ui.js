// A2UI 1.0(Agent-to-UI) 작은 렌더러: 빌드 없이 쓰려고 기본 카탈로그 중 일부만 순수 JS로 그린다.
// 메시지: {"version":"1.0", createSurface|updateComponents|updateDataModel|deleteSurface: {...}}
// 지원 컴포넌트: Text, Column, Row, List, Card, Button, Divider, Icon, CheckBox, Tabs(간단히)
// 버튼을 누르면 onAction({version:'1.0', action:{name, surfaceId, sourceComponentId, timestamp, context, userMessage?}})를 부른다.
// Text 안의 색깔 문법([[g|…]] 등)은 Markup.mark로 그대로 살린다.
(function () {
  const BASIC_CATALOG = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const markText = (s) => (window.Markup ? window.Markup.mark(String(s ?? '')) : esc(s));

  // JSON 포인터 읽기·쓰기
  const segs = (p) => String(p || '/').split('/').filter(Boolean).map((x) => x.replace(/~1/g, '/').replace(/~0/g, '~'));
  function getAt(obj, path) {
    let cur = obj;
    for (const k of segs(path)) { if (cur == null) return undefined; cur = cur[k]; }
    return cur;
  }
  function setAt(obj, path, value) {
    const ks = segs(path);
    if (!ks.length) return value == null ? {} : value;
    let cur = obj;
    ks.slice(0, -1).forEach((k) => { if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; });
    const last = ks[ks.length - 1];
    if (value === null) delete cur[last]; else cur[last] = value;
    return obj;
  }

  class Surface {
    constructor(id, catalogId, host) {
      this.id = id; this.catalogId = catalogId || BASIC_CATALOG; this.host = host;
      this.components = new Map(); this.data = {};
      this.el = document.createElement('div');
      this.el.className = 'a2ui-surface'; this.el.dataset.surfaceId = id;
    }
    // 값 풀기: 문자열·숫자 그대로, {"@path"} 는 데이터 모델에서(상대 경로는 scope 기준)
    resolve(v, scope) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const p = v['@path'] ?? v.path;
        if (typeof p === 'string') return getAt(this.data, p.startsWith('/') ? p : `${scope || ''}/${p}`);
        if ('literalString' in v) return v.literalString;
      }
      return v;
    }
    resolveCtx(ctx, scope) {
      const out = {};
      Object.entries(ctx || {}).forEach(([k, v]) => { out[k] = this.resolve(v, scope); });
      return out;
    }
    render() {
      this.el.innerHTML = '';
      const root = this.components.has('root') ? 'root' : [...this.components.keys()][0];
      if (root) this.el.appendChild(this.build(root, '', new Set()));
    }
    kids(c, scope, seen) {
      const ch = c.children;
      if (Array.isArray(ch)) return ch.map((id) => this.build(id, scope, seen));
      if (ch && typeof ch === 'object' && ch.componentId) {
        const p = ch.path || ch['@path'] || '';
        const full = p.startsWith('/') ? p : `${scope}/${p}`;
        const arr = getAt(this.data, full);
        const keys = Array.isArray(arr) ? arr.map((_, i) => i) : arr && typeof arr === 'object' ? Object.keys(arr) : [];
        return keys.map((k) => this.build(ch.componentId, `${full}/${k}`, seen));
      }
      if (c.child) return [this.build(c.child, scope, seen)];
      return [];
    }
    build(id, scope, seen) {
      const c = this.components.get(id);
      const el = document.createElement('div');
      if (!c) { el.className = 'a2ui-missing'; return el; }
      if (seen.has(`${id}@${scope}`)) return el; // 순환 방지
      const s2 = new Set(seen); s2.add(`${id}@${scope}`);
      const type = c.component;
      const R = (v) => this.resolve(v, scope);
      switch (type) {
        case 'Text': {
          const v = R(c.variant) || 'body';
          const tag = /^h[1-5]$/.test(v) ? v.replace(/h(\d)/, (_, n) => `h${Math.min(6, +n + 2)}`) : 'p';
          const t = document.createElement(tag);
          t.className = `a2ui-text a2ui-${v}`;
          t.innerHTML = markText(R(c.text));
          return t;
        }
        case 'Column': case 'Row': case 'List': {
          el.className = `a2ui-${type.toLowerCase()}${type === 'List' && R(c.direction) === 'horizontal' ? ' a2ui-row' : ''}`;
          if (c.align) el.dataset.align = R(c.align);
          if (c.justify) el.dataset.justify = R(c.justify);
          this.kids(c, scope, s2).forEach((k) => el.appendChild(k));
          return el;
        }
        case 'Card': {
          el.className = 'a2ui-card';
          const tone = R(c.tone); if (tone) el.dataset.tone = tone; // 앱 확장: green/red/yellow 테두리
          this.kids(c, scope, s2).forEach((k) => el.appendChild(k));
          return el;
        }
        case 'Divider': { const hr = document.createElement('hr'); hr.className = 'a2ui-divider'; return hr; }
        case 'Icon': { const i = document.createElement('span'); i.className = 'a2ui-icon'; i.textContent = ICONS[R(c.name)] || '•'; return i; }
        case 'CheckBox': {
          const lab = document.createElement('label'); lab.className = 'a2ui-check';
          const box = document.createElement('input'); box.type = 'checkbox';
          const vp = c.value && (c.value['@path'] || c.value.path);
          box.checked = !!R(c.value);
          box.addEventListener('change', () => { if (vp) setAt(this.data, vp.startsWith('/') ? vp : `${scope}/${vp}`, box.checked); });
          lab.appendChild(box);
          const sp = document.createElement('span'); sp.innerHTML = markText(R(c.label)); lab.appendChild(sp);
          return lab;
        }
        case 'Tabs': {
          el.className = 'a2ui-tabs';
          const bar = document.createElement('div'); bar.className = 'a2ui-tabbar';
          const body = document.createElement('div');
          const tabs = Array.isArray(c.tabs) ? c.tabs : [];
          const show = (i) => {
            body.innerHTML = ''; if (tabs[i]) body.appendChild(this.build(tabs[i].child, scope, s2));
            [...bar.children].forEach((b, j) => b.classList.toggle('on', j === i));
          };
          tabs.forEach((t, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = R(t.title) || `${i + 1}`; b.onclick = () => show(i); bar.appendChild(b); });
          el.append(bar, body); show(0);
          return el;
        }
        case 'Button': {
          const b = document.createElement('button');
          b.type = 'button';
          const variant = R(c.variant) || (c.primary ? 'primary' : 'default');
          b.className = `btn small a2ui-button${variant === 'primary' ? ' primary' : ''}${variant === 'borderless' ? ' a2ui-borderless' : ''}`;
          const inner = this.kids(c, scope, s2);
          if (inner.length) inner.forEach((k) => b.appendChild(k)); else b.textContent = R(c.label) || '확인';
          const ev = c.action && (c.action.event || c.action);
          b.addEventListener('click', () => {
            if (!ev || !ev.name) return;
            const msg = { version: '1.0', action: { name: ev.name, surfaceId: this.id, sourceComponentId: id, timestamp: new Date().toISOString(), context: this.resolveCtx(ev.context, scope) } };
            const um = R(ev.userMessage); if (um) msg.action.userMessage = String(um);
            this.host.onAction(msg, b);
          });
          return b;
        }
        default: {
          // 모르는 컴포넌트: 안에 글이 있으면 글로라도 보여 준다
          el.className = 'a2ui-unknown';
          const txt = R(c.text) || R(c.label);
          if (txt) el.innerHTML = markText(txt);
          this.kids(c, scope, s2).forEach((k) => el.appendChild(k));
          return el;
        }
      }
    }
  }
  const ICONS = { check: '✓', star: '★', warning: '⚠', info: 'ℹ', book: '📖', cross: '✝', favorite: '♥', close: '✕', arrowForward: '→', lightbulb: '💡' };

  class Host {
    constructor(container, onAction) { this.container = container; this.onAction = onAction || (() => {}); this.surfaces = new Map(); }
    // 메시지 여러 개를 차례로 적용한다. 잘못된 메시지는 건너뛰고 이유를 돌려준다.
    apply(messages) {
      const errors = [];
      const touched = new Set();
      (Array.isArray(messages) ? messages : [messages]).forEach((m, i) => {
        try {
          if (!m || typeof m !== 'object') throw new Error('메시지가 객체가 아님');
          if (m.createSurface) {
            const { surfaceId, catalogId, components, dataModel } = m.createSurface;
            if (!surfaceId) throw new Error('surfaceId 없음');
            let s = this.surfaces.get(surfaceId);
            if (!s) { s = new Surface(surfaceId, catalogId, this); this.surfaces.set(surfaceId, s); this.container.appendChild(s.el); }
            if (dataModel && typeof dataModel === 'object') s.data = dataModel;
            (components || []).forEach((c) => c && c.id && s.components.set(c.id, c));
            touched.add(s);
          } else if (m.updateComponents) {
            const s = this.need(m.updateComponents.surfaceId);
            (m.updateComponents.components || []).forEach((c) => c && c.id && s.components.set(c.id, c));
            touched.add(s);
          } else if (m.updateDataModel) {
            const s = this.need(m.updateDataModel.surfaceId);
            s.data = setAt(s.data, m.updateDataModel.path || '/', m.updateDataModel.value === undefined ? null : m.updateDataModel.value);
            touched.add(s);
          } else if (m.deleteSurface) {
            const s = this.surfaces.get(m.deleteSurface.surfaceId);
            if (s) { s.el.remove(); this.surfaces.delete(s.id); touched.delete(s); }
          } else throw new Error('모르는 메시지');
        } catch (e) { errors.push(`${i}: ${e.message}`); }
      });
      touched.forEach((s) => s.render());
      return errors;
    }
    need(id) {
      let s = this.surfaces.get(id);
      if (!s) { s = new Surface(id, BASIC_CATALOG, this); this.surfaces.set(id, s); this.container.appendChild(s.el); } // createSurface 없이 와도 만들어 준다
      return s;
    }
  }

  window.A2UI = { Host, BASIC_CATALOG, getAt, setAt };
})();
