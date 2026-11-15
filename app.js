/*
 * コンペ幹事サポートツール 画面
 * 計算は logic.js（GolfLogic）に任せ、ここでは表示・入力・保存だけを扱う。
 */
(function () {
  'use strict';

  const L = window.GolfLogic;
  const APP_ID = 'golf-compe-tool';
  const STORE_KEY = 'golfCompeTool.v1';
  const BACKUP_REMIND_DAYS = 30;

  const $app = document.getElementById('app');
  const $title = document.getElementById('title');
  const $back = document.getElementById('backBtn');
  const $toast = document.getElementById('toast');
  const $overlay = document.getElementById('overlay');

  // ---------------------------------------------------------------- 保存
  let storageOK = true;

  function emptyState() {
    return { members: [], settings: L.cloneDefaults(), current: null, last: null, lastBackupAt: null };
  }

  function sanitizeState(d) {
    const s = emptyState();
    if (!d || typeof d !== 'object') return s;
    if (Array.isArray(d.members)) {
      s.members = d.members
        .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string' && Number.isInteger(m.hc) && m.hc >= 0)
        .map((m) => ({ id: m.id, name: m.name, hc: m.hc }));
    }
    s.settings = L.normalizeSettings(d.settings);
    const c = d.current;
    if (c && typeof c === 'object' && Array.isArray(c.participantIds)) {
      s.current = {
        date: typeof c.date === 'string' ? c.date : today(),
        participantIds: c.participantIds.filter((x) => typeof x === 'string'),
        scores: c.scores && typeof c.scores === 'object' ? c.scores : {},
        tieOrders: c.tieOrders && typeof c.tieOrders === 'object' ? c.tieOrders : {},
      };
    }
    if (d.last && typeof d.last === 'object' && d.last.result) s.last = d.last;
    if (typeof d.lastBackupAt === 'string') s.lastBackupAt = d.lastBackupAt;
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? sanitizeState(JSON.parse(raw)) : emptyState();
    } catch (e) {
      storageOK = false;
      return emptyState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      storageOK = true;
    } catch (e) {
      storageOK = false;
      toast('端末への保存に失敗しました。バックアップを書き出してください。');
    }
  }

  let state = load();

  // ---------------------------------------------------------------- 共通
  function esc(v) {
    return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function fmtDate(iso) {
    return iso ? iso.replace(/-/g, '/') : '';
  }
  function toHalfWidth(s) {
    return String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  }
  function parseIntField(str, maxDigits) {
    const t = toHalfWidth(str).trim();
    if (!new RegExp(`^\\d{1,${maxDigits}}$`).test(t)) return null;
    return parseInt(t, 10);
  }
  function fmtPt(n) {
    return String(Math.round(n * 100) / 100);
  }
  function rateLabel(p) {
    return p % 10 === 0 ? `${p / 10}割` : `${p}%`;
  }
  function toast(msg) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { $toast.hidden = true; }, 2600);
  }
  function go(route) {
    if (location.hash === '#' + route) render();
    else location.hash = route;
  }
  function daysSince(iso) {
    return (Date.now() - new Date(iso).getTime()) / 86400000;
  }

  /** 入力中コンペの参加者（名簿の最新の氏名・HC を使う） */
  function getPlayers(cur) {
    const byId = new Map(state.members.map((m) => [m.id, m]));
    return cur.participantIds.filter((id) => byId.has(id)).map((id) => {
      const m = byId.get(id);
      const sc = cur.scores[id] || {};
      return {
        id, name: m.name, hc: m.hc,
        gross: Number.isInteger(sc.gross) ? sc.gross : null,
        nearPin: sc.nearPin || 0, driving: sc.driving || 0, birdie: sc.birdie || 0,
      };
    });
  }
  function scoreOf(id) {
    const cur = state.current;
    if (!cur.scores[id]) cur.scores[id] = { gross: null, nearPin: 0, driving: 0, birdie: 0 };
    return cur.scores[id];
  }

  // ---------------------------------------------------------------- ルーティング
  const PARENT = {
    '/members': '/', '/select': '/', '/input': '/select', '/tie': '/input', '/result': '/input',
    '/last': '/', '/settings': '/', '/backup': '/',
  };
  const VIEWS = {
    '/': viewHome, '/members': viewMembers, '/select': viewSelect, '/input': viewInput,
    '/tie': viewTie, '/result': viewResult, '/last': viewLast, '/settings': viewSettings, '/backup': viewBackup,
  };
  let lastRoute = null;

  function route() {
    const r = location.hash.replace(/^#/, '') || '/';
    return VIEWS[r] ? r : '/';
  }

  function render() {
    const r = route();
    const routeChanged = r !== lastRoute;
    lastRoute = r;
    if (routeChanged) {
      if (r === '/') selectDraft = null; // ホームに戻ったら未確定の参加者選択は捨てる
      if (r !== '/members') editingId = null;
    }
    $back.hidden = r === '/';
    const out = VIEWS[r]();
    if (out === undefined) return; // リダイレクト済み
    $title.textContent = out.title;
    $app.innerHTML = out.html;
    if (routeChanged) window.scrollTo(0, 0);
    if (out.after) out.after();
  }

  $back.addEventListener('click', () => go(PARENT[route()] || '/'));
  window.addEventListener('hashchange', render);

  // ---------------------------------------------------------------- ホーム
  function viewHome() {
    const cur = state.current;
    const banners = [];
    if (!storageOK) banners.push(`<div class="banner error">この端末ではデータを保存できません（プライベートブラウズ等）。閉じると入力内容が消えます。</div>`);
    if (state.members.length && (!state.lastBackupAt || daysSince(state.lastBackupAt) > BACKUP_REMIND_DAYS)) {
      banners.push(`<div class="banner warn">${state.lastBackupAt ? `最後のバックアップから${Math.floor(daysSince(state.lastBackupAt))}日経っています。` : 'まだバックアップがありません。'}
        端末のデータが消えた場合に備えて、<a href="#/backup">バックアップ</a>を書き出してください。</div>`);
    }
    const curInfo = cur ? `${fmtDate(cur.date)}・${getPlayers(cur).length}人` : '';
    const html = `
      ${banners.join('')}
      <div class="menu">
        ${cur ? `<button class="btn primary" data-action="nav" data-href="/input">入力の続き <span class="sub">${esc(curInfo)}</span></button>` : ''}
        <button class="btn ${cur ? '' : 'primary'}" data-action="new-compe">新しいコンペを始める</button>
        ${state.last ? `<button class="btn" data-action="nav" data-href="/last">前回の結果 <span class="sub">${esc(fmtDate(state.last.date))}</span></button>` : ''}
        <h2>準備・管理</h2>
        <button class="btn" data-action="nav" data-href="/members">名簿 <span class="sub">${state.members.length}人</span></button>
        <button class="btn" data-action="nav" data-href="/settings">ルール設定</button>
        <button class="btn" data-action="nav" data-href="/backup">バックアップ・復元 <span class="sub">${state.lastBackupAt ? esc(fmtDate(state.lastBackupAt.slice(0, 10))) : '未実施'}</span></button>
      </div>`;
    return { title: state.settings.competitionName || 'コンペ幹事サポート', html };
  }

  // ---------------------------------------------------------------- 名簿
  let editingId = null;

  function viewMembers() {
    const m = state.members;
    const rows = m.map((mem) => editingId === mem.id ? `
      <li><form data-form="member-edit" data-id="${esc(mem.id)}" style="width:100%" autocomplete="off" novalidate>
        <div class="settings-grid" style="grid-template-columns:2fr 1fr">
          <label class="field">氏名<input type="text" name="name" maxlength="20" value="${esc(mem.name)}" required></label>
          <label class="field">HC<input type="text" name="hc" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${mem.hc}" required></label>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn primary">保存</button>
          <button type="button" class="btn" data-action="member-cancel">やめる</button>
        </div>
        <button type="button" class="btn danger" data-action="member-delete" data-id="${esc(mem.id)}">名簿から削除</button>
      </form></li>` : `
      <li><span class="name">${esc(mem.name)}</span><span class="hc">HC ${mem.hc}</span>
        <button type="button" class="edit" data-action="member-edit" data-id="${esc(mem.id)}">編集</button></li>`).join('');
    const html = `
      <form class="card" data-form="member-add" autocomplete="off" novalidate>
        <div class="settings-grid" style="grid-template-columns:2fr 1fr">
          <label class="field">氏名<input type="text" name="name" maxlength="20" required></label>
          <label class="field">HC（整数）<input type="text" name="hc" inputmode="numeric" pattern="[0-9]*" maxlength="2" required></label>
        </div>
        <button class="btn primary" type="submit">名簿に追加</button>
      </form>
      <h2>名簿（${m.length}人）</h2>
      ${m.length ? `<ul class="list">${rows}</ul>` : `<div class="card empty">まだメンバーがいません。上のフォームから追加してください。</div>`}
      <p class="muted">HC はコンペ結果を確定すると自動で更新されます。手で直す場合は「編集」から変更してください。</p>`;
    return { title: '名簿', html };
  }

  function readMemberForm(form) {
    const name = form.elements.name.value.trim();
    const hc = parseIntField(form.elements.hc.value, 2);
    if (!name) { toast('氏名を入力してください。'); return null; }
    if (hc === null || hc > L.HC_MAX) { toast(`HC は 0〜${L.HC_MAX} の整数で入力してください。`); return null; }
    return { name, hc };
  }

  // ---------------------------------------------------------------- 参加者選択
  let selectDraft = null; // { date, ids:Set, fresh }

  function ensureSelectDraft() {
    if (selectDraft) return;
    const cur = state.current;
    selectDraft = cur
      ? { date: cur.date, ids: new Set(cur.participantIds), fresh: false }
      : { date: today(), ids: new Set(), fresh: true };
  }

  function viewSelect() {
    ensureSelectDraft();
    const m = state.members;
    const n = m.filter((x) => selectDraft.ids.has(x.id)).length;
    const html = `
      <label class="field">開催日<input type="date" data-input="sel-date" value="${esc(selectDraft.date)}"></label>
      ${m.length ? `
        <div class="btn-row">
          <button type="button" class="btn" data-action="select-all">全員を選ぶ</button>
          <button type="button" class="btn" data-action="select-none">選択を外す</button>
        </div>
        <ul class="list">${m.map((mem) => `
          <li><label><input type="checkbox" data-input="sel" data-id="${esc(mem.id)}" ${selectDraft.ids.has(mem.id) ? 'checked' : ''}>
            <span class="name">${esc(mem.name)}</span><span class="hc">HC ${mem.hc}</span></label></li>`).join('')}
        </ul>
        <p class="muted">名簿にいない人は、先に<a href="#/members">名簿</a>に追加してください。</p>`
      : `<div class="card empty">名簿にメンバーがいません。<br><br><button class="btn primary" data-action="nav" data-href="/members">名簿に追加する</button></div>`}
      <div class="bottom-bar"><div class="inner">
        <button class="btn primary" data-action="select-commit" id="selCommit" ${n < 2 ? 'disabled' : ''}>スコア入力へ（<span id="selCount">${n}</span>人）</button>
      </div></div>`;
    return { title: '参加者を選ぶ', html };
  }

  function refreshSelectCount() {
    const n = state.members.filter((x) => selectDraft.ids.has(x.id)).length;
    const c = document.getElementById('selCount');
    if (c) c.textContent = n;
    const b = document.getElementById('selCommit');
    if (b) b.disabled = n < 2;
  }

  // ---------------------------------------------------------------- スコア入力
  function countersHtml(players) {
    const np = players.reduce((a, p) => a + p.nearPin, 0);
    const dr = players.reduce((a, p) => a + p.driving, 0);
    const done = players.filter((p) => p.gross !== null).length;
    const cls = (v, max) => (v > max ? 'over' : v === max ? 'full' : '');
    return `
      <div class="counter ${done === players.length ? 'full' : ''}">グロス入力<br><b>${done}/${players.length}</b></div>
      <div class="counter ${cls(np, L.NEAR_PIN_MAX)}">ニアピン<br><b>${np}/${L.NEAR_PIN_MAX}</b></div>
      <div class="counter ${cls(dr, L.DRIVING_MAX)}">ドラコン<br><b>${dr}/${L.DRIVING_MAX}</b></div>`;
  }

  function stepHtml(p, key, label) {
    return `<div class="cell">${label}
      <div class="step" data-id="${esc(p.id)}" data-key="${key}">
        <button type="button" data-action="step" data-delta="-1" aria-label="${p.name}の${label}を1減らす">−</button>
        <output>${p[key]}</output>
        <button type="button" data-action="step" data-delta="1" aria-label="${p.name}の${label}を1増やす">＋</button>
      </div></div>`;
  }

  function viewInput() {
    const cur = state.current;
    if (!cur) { location.replace('#/'); return; }
    const players = getPlayers(cur);
    const html = `
      <div class="counters" id="counters">${countersHtml(players)}</div>
      <div id="inputMsg"></div>
      <p class="muted">${esc(fmtDate(cur.date))}・${players.length}人。入力は自動で保存されます。</p>
      ${players.map((p) => `
        <div class="card player">
          <div class="player-head"><span class="name">${esc(p.name)}</span>
            <span class="meta">HC ${p.hc}・NET <span id="net-${esc(p.id)}">${p.gross === null ? '—' : p.gross - p.hc}</span></span></div>
          <div class="grid">
            <div class="cell">グロス
              <input type="text" class="gross-input" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off"
                data-input="gross" data-id="${esc(p.id)}" value="${p.gross === null ? '' : p.gross}" aria-label="${esc(p.name)}のグロス"></div>
            ${stepHtml(p, 'nearPin', 'ニアピン')}
            ${stepHtml(p, 'driving', 'ドラコン')}
            ${stepHtml(p, 'birdie', 'バーディー')}
          </div>
        </div>`).join('')}
      <div class="bottom-bar"><div class="inner"><button class="btn primary" data-action="calc">結果を計算</button></div></div>`;
    return { title: 'スコア入力', html, after: refreshInput };
  }

  function refreshInput() {
    const players = getPlayers(state.current);
    const np = players.reduce((a, p) => a + p.nearPin, 0);
    const dr = players.reduce((a, p) => a + p.driving, 0);
    const c = document.getElementById('counters');
    if (c) c.innerHTML = countersHtml(players);
    const byId = new Map(players.map((p) => [p.id, p]));
    document.querySelectorAll('.step').forEach((el) => {
      const p = byId.get(el.dataset.id);
      if (!p) return;
      const key = el.dataset.key;
      const v = p[key];
      el.querySelector('output').textContent = v;
      const [minus, plus] = el.querySelectorAll('button');
      minus.disabled = v <= 0;
      plus.disabled = (key === 'nearPin' && np >= L.NEAR_PIN_MAX) || (key === 'driving' && dr >= L.DRIVING_MAX) || (key === 'birdie' && v >= L.BIRDIE_MAX);
    });
  }

  function showInputErrors(errors) {
    const el = document.getElementById('inputMsg');
    if (!el) return;
    el.innerHTML = errors.length ? `<div class="banner error">計算できません。次を確認してください。<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
    if (errors.length) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- 計算
  function computeCurrent() {
    const cur = state.current;
    const players = getPlayers(cur);
    const v = L.validate(players);
    if (v.errors.length) return { players, validation: v, result: null };
    return { players, validation: v, result: L.computeResults(players, state.settings, cur.tieOrders) };
  }

  // ---------------------------------------------------------------- 同点の決定
  let tieDraft = {};

  function visibleTies(result) {
    // ベスグロ → 優勝〜3位 → ブービー の順に決める（前の決定で後ろの候補が変わるため）
    for (const kind of ['gross', 'net', 'booby']) {
      const list = result.pendingTies.filter((t) => t.kind === kind);
      if (list.length) return list;
    }
    return [];
  }

  function viewTie() {
    if (!state.current) { location.replace('#/'); return; }
    const { result } = computeCurrent();
    if (!result) { location.replace('#/input'); return; }
    const ties = visibleTies(result);
    if (!ties.length) { location.replace('#/result'); return; }
    for (const t of ties) if (!tieDraft[t.key]) tieDraft[t.key] = t.members.map((m) => m.id);
    const nameOf = new Map(result.netTable.map((r) => [r.id, r.name]));
    const html = `
      <div class="banner info">スコアも HC も同じ人がいて、賞が決まりません。コンペのルール（じゃんけん等）で決めた順に、<b>上位の人が上</b>になるよう並べてください。</div>
      ${ties.map((t) => {
        const ids = tieDraft[t.key];
        const what = t.awards.map((a) => L.AWARD_LABELS[a]).join('・');
        const cond = t.kind === 'gross' ? `グロス ${t.gross}・HC ${t.hc}` : `NET ${t.net}・HC ${t.hc}`;
        return `<div class="card">
          <b>${esc(what)} の判定</b><div class="muted">${esc(cond)} で同じ${t.kind === 'booby' ? '（一番上の人がブービー賞）' : ''}</div>
          <ol class="tie-list">${ids.map((id, i) => `
            <li><span class="pos">${i + 1}</span><span class="name">${esc(nameOf.get(id) || id)}</span>
              <button type="button" data-action="tie-move" data-key="${esc(t.key)}" data-index="${i}" data-delta="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
              <button type="button" data-action="tie-move" data-key="${esc(t.key)}" data-index="${i}" data-delta="1" ${i === ids.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
            </li>`).join('')}</ol></div>`;
      }).join('')}
      <div class="bottom-bar"><div class="inner"><button class="btn primary" data-action="tie-commit">この順番で決定</button></div></div>`;
    return { title: '同点の決定', html };
  }

  // ---------------------------------------------------------------- 結果
  let resultTab = 'net';

  function nameMap(result) {
    return new Map(result.netTable.map((r) => [r.id, r]));
  }

  function awardRowsHtml(r) {
    const by = nameMap(r);
    const a = r.awards;
    const netDetail = (id) => { const p = by.get(id); return `NET ${p.net}（グロス ${p.gross} − HC ${p.hc}）`; };
    const one = (label, id, detail, major) => `
      <div class="award-row ${major ? 'major' : ''}"><span class="label">${label}</span>
        <span class="who">${id === null ? '<span class="muted">なし</span>' : `${esc(by.get(id).name)}<br><span class="detail">${esc(detail(id))}</span>`}</span></div>`;
    const many = (label, list) => `
      <div class="award-row"><span class="label">${label}</span>
        <span class="who">${list.length ? list.map(esc).join('、') : '<span class="muted">なし</span>'}</span></div>`;
    return [
      one('優勝', a.win, netDetail, true),
      one('2位', a.second, netDetail, true),
      one('3位', a.third, netDetail, true),
      one('ベストグロス', a.bestGross, (id) => `グロス ${by.get(id).gross}（HC ${by.get(id).hc}）`, true),
      one('ブービー賞', a.booby, netDetail, false),
      many('70台賞', a.seventies.map((id) => `${by.get(id).name}（${by.get(id).gross}）`)),
      many('バーディー賞', a.birdie.map((e) => `${by.get(e.id).name}×${e.count}`)),
      many('ニアピン', a.nearPin.map((e) => `${by.get(e.id).name}×${e.count}`)),
      many('ドラコン', a.driving.map((e) => `${by.get(e.id).name}×${e.count}`)),
    ].join('');
  }

  function hcCalcText(u, s) {
    let t = `${u.oldHc} − ${u.reduction}（${rateLabel(s.hcRatePercent[u.award])}）`;
    if (u.bonus) t += ` − ${u.bonus}（NET${s.winBonus.netBelow}未満）`;
    if (u.floored) t += '、下限0';
    return t;
  }

  function resultBodyHtml(r) {
    const s = r.settings;
    const tags = (list) => list.map((x) => `<span class="tag">${esc(x)}</span>`).join('');
    const netRows = r.netTable.map((p) => `
      <tr class="${p.isBestGross ? 'bg' : ''}"><td>${p.rank}</td><td class="l">${esc(p.name)}</td><td>${p.net}</td><td>${p.gross}</td><td>${p.hc}</td><td class="l">${tags(p.awards)}</td></tr>`).join('');
    const grossRows = r.grossTable.map((p) => `
      <tr><td>${p.rank}</td><td class="l">${esc(p.name)}</td><td>${p.gross}</td><td>${p.hc}</td><td>${p.net}</td><td class="l">${tags(p.awards)}</td></tr>`).join('');
    return `
      ${r.notes.map((n) => `<div class="banner warn">${esc(n)}</div>`).join('')}
      <h2>各賞</h2>
      <div class="card awards">${awardRowsHtml(r)}</div>

      <h2>獲得ポイント</h2>
      <div class="table-wrap"><table>
        <thead><tr><th class="l">氏名</th><th>合計</th><th class="l">内訳</th></tr></thead>
        <tbody>${r.points.map((p) => `
          <tr><td class="l">${esc(p.name)}</td><td><b>${fmtPt(p.total)}</b></td>
            <td class="l wrap">${p.items.length ? p.items.map((i) => `${esc(i.label)} ${fmtPt(i.points)}pt`).join('、') : '<span class="muted">—</span>'}</td></tr>`).join('')}
        </tbody></table></div>

      <h2>ハンディキャップ更新</h2>
      ${r.hcUpdates.length ? `<div class="table-wrap"><table>
        <thead><tr><th class="l">賞</th><th class="l">氏名</th><th>旧HC</th><th>新HC</th><th class="l">計算</th></tr></thead>
        <tbody>${r.hcUpdates.map((u) => `
          <tr><td class="l">${L.AWARD_LABELS[u.award]}</td><td class="l">${esc(u.name)}</td><td>${u.oldHc}</td><td><b>${u.newHc}</b></td>
            <td class="l wrap">${esc(hcCalcText(u, s))}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">なし</p>'}

      <h2>順位表</h2>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-action="result-tab" data-tab="net" aria-selected="${resultTab === 'net'}">NET順</button>
        <button type="button" role="tab" data-action="result-tab" data-tab="gross" aria-selected="${resultTab === 'gross'}">グロス順</button>
      </div>
      <div class="table-wrap"><table>
        ${resultTab === 'net'
          ? `<thead><tr><th>順位</th><th class="l">氏名</th><th>NET</th><th>グロス</th><th>HC</th><th class="l">賞</th></tr></thead><tbody>${netRows}</tbody>`
          : `<thead><tr><th>順位</th><th class="l">氏名</th><th>グロス</th><th>HC</th><th>NET</th><th class="l">賞</th></tr></thead><tbody>${grossRows}</tbody>`}
      </table></div>
      <p class="muted small">${resultTab === 'net' ? '色付きの行はベストグロス受賞者です（優勝〜3位・ブービーの判定からは除外）。' : ''}スコアも HC も同じ人は同順位で表示しています。</p>

      <h2>結果を共有</h2>
      <button class="btn" data-action="copy-text">結果をテキストでコピー</button>
      ${navigator.share ? '<button class="btn" data-action="share-text">LINE などに送る</button>' : ''}
      <button class="btn" data-action="save-image">結果を画像で保存</button>`;
  }

  function viewResult() {
    if (!state.current) { location.replace('#/'); return; }
    const { result } = computeCurrent();
    if (!result) { location.replace('#/input'); return; }
    if (result.pendingTies.length) { location.replace('#/tie'); return; }
    const hasTie = Object.keys(state.current.tieOrders).length > 0;
    const html = `
      <div class="banner info">まだ確定していません。内容を確認して、下の「確定」を押すと新しい HC が名簿に反映されます。</div>
      ${resultBodyHtml(result)}
      ${hasTie ? '<button class="btn" data-action="reset-ties">同点の順番を決め直す</button>' : ''}
      <button class="btn" data-action="nav" data-href="/input">入力に戻って直す</button>
      <div class="bottom-bar"><div class="inner"><button class="btn primary" data-action="confirm-result">確定して HC を名簿に反映</button></div></div>`;
    return { title: `結果 ${fmtDate(state.current.date)}`, html };
  }

  function viewLast() {
    const last = state.last;
    if (!last) { location.replace('#/'); return; }
    const html = `
      <div class="banner info">確定済みの結果です（${esc(fmtDate(last.date))}）。新しい HC は名簿に反映済みです。
        ${!state.lastBackupAt || state.lastBackupAt < last.confirmedAt ? '<br>HC が変わったので、<a href="#/backup">バックアップ</a>の書き出しをおすすめします。' : ''}</div>
      ${resultBodyHtml(last.result)}`;
    return { title: `前回の結果 ${fmtDate(last.date)}`, html };
  }

  function currentMeta() {
    if (route() === '/last' && state.last) return { name: state.last.competitionName, date: state.last.date, result: state.last.result };
    const { result } = computeCurrent();
    return { name: state.settings.competitionName, date: state.current.date, result };
  }

  // ---------------------------------------------------------------- 共有用テキスト・画像
  function buildResultText(meta) {
    const r = meta.result;
    const s = r.settings;
    const by = nameMap(r);
    const a = r.awards;
    const lines = [];
    const net = (id) => { const p = by.get(id); return `${p.name}（NET ${p.net}／グロス ${p.gross}／HC ${p.hc}）`; };
    const one = (label, id, f) => lines.push(`■${label}　${id === null ? 'なし' : f(id)}`);
    lines.push(`【${meta.name || 'ゴルフコンペ'} 結果】${fmtDate(meta.date)}`);
    lines.push('');
    one('優勝', a.win, net);
    one('2位', a.second, net);
    one('3位', a.third, net);
    one('ベストグロス', a.bestGross, (id) => `${by.get(id).name}（グロス ${by.get(id).gross}）`);
    one('ブービー賞', a.booby, net);
    const list = (label, arr) => lines.push(`■${label}　${arr.length ? arr.join('、') : 'なし'}`);
    list('70台賞', a.seventies.map((id) => `${by.get(id).name}（${by.get(id).gross}）`));
    list('バーディー賞', a.birdie.map((e) => `${by.get(e.id).name}×${e.count}`));
    list('ニアピン', a.nearPin.map((e) => `${by.get(e.id).name}×${e.count}`));
    list('ドラコン', a.driving.map((e) => `${by.get(e.id).name}×${e.count}`));
    lines.push('');
    lines.push('【獲得ポイント】');
    for (const p of r.points) {
      if (p.total > 0) lines.push(`${p.name}　${fmtPt(p.total)}pt（${p.items.map((i) => `${i.label} ${fmtPt(i.points)}pt`).join('、')}）`);
    }
    if (!r.points.some((p) => p.total > 0)) lines.push('なし');
    lines.push('');
    lines.push('【ハンディキャップ更新】');
    if (r.hcUpdates.length) for (const u of r.hcUpdates) lines.push(`${u.name}　${u.oldHc} → ${u.newHc}（${L.AWARD_LABELS[u.award]}）`);
    else lines.push('なし');
    lines.push('');
    lines.push('【NET順位】');
    for (const p of r.netTable) lines.push(`${p.rank}. ${p.name}　NET ${p.net}（${p.gross}−${p.hc}）${p.isBestGross ? '　※ベスグロ' : ''}`);
    return lines.join('\n');
  }

  function drawResultImage(text) {
    const W = 1080, PAD = 64, LH = 54;
    const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif';
    const src = text.split('\n');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const styleOf = (line) => (line.startsWith('【') ? { font: `bold 38px ${FONT}`, color: '#1b6b44' }
      : line.startsWith('■') ? { font: `bold 34px ${FONT}`, color: '#1c2420' }
      : { font: `34px ${FONT}`, color: '#1c2420' });
    // 本文の折り返し（1行目の見出しは別に描く）
    const bodyLines = [];
    src.slice(1).forEach((line) => {
      const st = styleOf(line);
      ctx.font = st.font;
      if (!line) { bodyLines.push({ text: '', st, gap: true }); return; }
      let buf = '';
      for (const ch of line) {
        if (ctx.measureText(buf + ch).width > W - PAD * 2) { bodyLines.push({ text: buf, st }); buf = '　' + ch; }
        else buf += ch;
      }
      bodyLines.push({ text: buf, st });
    });
    const HEADER = 140;
    canvas.width = W;
    canvas.height = HEADER + PAD / 2 + bodyLines.reduce((h, l) => h + (l.gap ? LH / 2 : LH), 0) + PAD;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, canvas.height);
    ctx.fillStyle = '#1b6b44';
    ctx.fillRect(0, 0, W, HEADER);
    ctx.textBaseline = 'middle';
    // 見出しは幅に収まるまで文字を小さくする
    let size = 44;
    do { ctx.font = `bold ${size}px ${FONT}`; size -= 2; } while (size > 20 && ctx.measureText(src[0]).width > W - PAD * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(src[0], PAD, HEADER / 2);
    let y = HEADER + PAD / 2;
    for (const l of bodyLines) {
      if (l.gap) { y += LH / 2; continue; }
      ctx.font = l.st.font; ctx.fillStyle = l.st.color;
      ctx.fillText(l.text, PAD, y + LH / 2);
      y += LH;
    }
    return canvas;
  }

  function dataUrlToFile(dataUrl, filename) {
    const [head, b64] = dataUrl.split(',');
    const mime = head.match(/data:([^;]+)/)[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  }

  function showImageOverlay(dataUrl, filename) {
    $overlay.innerHTML = `
      <img src="${dataUrl}" alt="結果の画像">
      <p>iPhone：画像を長押しして「"写真"に保存」</p>
      <a class="btn" href="${dataUrl}" download="${esc(filename)}">ダウンロード</a>
      <button type="button" class="btn" id="overlayClose">閉じる</button>`;
    $overlay.hidden = false;
    document.getElementById('overlayClose').addEventListener('click', () => { $overlay.hidden = true; $overlay.innerHTML = ''; });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function isAbort(e) {
    return e && e.name === 'AbortError';
  }

  // ---------------------------------------------------------------- 設定
  const POINT_FIELDS = [
    ['win', '優勝'], ['bestGross', 'ベストグロス'], ['second', '2位'], ['third', '3位'], ['seventies', '70台賞'],
    ['booby', 'ブービー賞'], ['birdie', 'バーディー（1本）'], ['nearPin', 'ニアピン（1本）'], ['driving', 'ドラコン（1本）'],
  ];

  function viewSettings() {
    const s = state.settings;
    const num = (name, value, mode) => `<input type="text" name="${name}" value="${value}" inputmode="${mode || 'numeric'}" autocomplete="off">`;
    const html = `
      <form data-form="settings" autocomplete="off" novalidate>
        <div id="settingsMsg"></div>
        <div class="card settings-group">
          <label class="field">コンペ名（結果の見出しに使います）<input type="text" name="competitionName" maxlength="30" value="${esc(s.competitionName)}"></label>
        </div>
        <h2>ポイント</h2>
        <div class="card settings-grid">
          ${POINT_FIELDS.map(([k, label]) => `<label class="field">${label}${num('pt_' + k, s.points[k], 'decimal')}</label>`).join('')}
        </div>
        <h2>ハンディキャップ更新</h2>
        <div class="card">
          <div class="settings-grid">
            <label class="field">優勝の減算率（％）${num('rate_win', s.hcRatePercent.win)}</label>
            <label class="field">2位の減算率（％）${num('rate_second', s.hcRatePercent.second)}</label>
            <label class="field">3位の減算率（％）${num('rate_third', s.hcRatePercent.third)}</label>
          </div>
          <p class="muted small">引く量は 現HC × 減算率 の小数点以下を四捨五入。新HCの下限は0。</p>
          <div class="settings-grid">
            <label class="field">優勝時、NET がこの値未満なら${num('bonus_netBelow', s.winBonus.netBelow)}</label>
            <label class="field">さらに引く量${num('bonus_minus', s.winBonus.minus)}</label>
          </div>
        </div>
        <h2>70台賞</h2>
        <div class="card"><label class="field">グロスがこの値以下なら受賞${num('seventiesMax', s.seventiesMax)}</label></div>
        <p class="muted small">ニアピンは最大${L.NEAR_PIN_MAX}本、ドラコンは最大${L.DRIVING_MAX}本で固定です。</p>
        <button type="button" class="btn danger" data-action="settings-reset">初期値に戻す</button>
        <div class="bottom-bar"><div class="inner"><button type="submit" class="btn primary">設定を保存</button></div></div>
      </form>`;
    return { title: 'ルール設定', html };
  }

  function readSettingsForm(form) {
    const errors = [];
    const s = L.cloneDefaults();
    const val = (n) => toHalfWidth(form.elements[n].value).trim();
    s.competitionName = form.elements.competitionName.value.trim() || L.DEFAULT_SETTINGS.competitionName;
    for (const [k, label] of POINT_FIELDS) {
      const t = val('pt_' + k);
      const v = Number(t);
      if (t === '' || !Number.isFinite(v) || v < 0 || v > 100) errors.push(`ポイント「${label}」は 0〜100 の数で入力してください。`);
      else s.points[k] = v;
    }
    const int = (name, label, min, max, set) => {
      const v = parseIntField(val(name), 3);
      if (v === null || v < min || v > max) errors.push(`「${label}」は ${min}〜${max} の整数で入力してください。`);
      else set(v);
    };
    int('rate_win', '優勝の減算率', 0, 100, (v) => { s.hcRatePercent.win = v; });
    int('rate_second', '2位の減算率', 0, 100, (v) => { s.hcRatePercent.second = v; });
    int('rate_third', '3位の減算率', 0, 100, (v) => { s.hcRatePercent.third = v; });
    int('bonus_netBelow', '優勝時の NET 条件', 1, 200, (v) => { s.winBonus.netBelow = v; });
    int('bonus_minus', 'さらに引く量', 0, 50, (v) => { s.winBonus.minus = v; });
    int('seventiesMax', '70台賞の基準', 1, 200, (v) => { s.seventiesMax = v; });
    return { settings: s, errors };
  }

  // ---------------------------------------------------------------- バックアップ
  function viewBackup() {
    const canShareFiles = !!(navigator.canShare && navigator.share && (() => {
      try { return navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }); } catch (e) { return false; }
    })());
    const html = `
      <div class="card">
        <p>名簿・ルール設定・入力中のコンペ・前回の結果を、1つのファイル（JSON）に書き出します。</p>
        <p class="muted">最後のバックアップ：${state.lastBackupAt ? esc(state.lastBackupAt.slice(0, 16).replace('T', ' ')) : 'まだありません'}</p>
        ${canShareFiles ? '<button class="btn primary" data-action="backup-share">書き出す（「ファイル」に保存・AirDrop など）</button>' : ''}
        <button class="btn ${canShareFiles ? '' : 'primary'}" data-action="backup-download">ダウンロードで書き出す</button>
      </div>
      <h2>復元</h2>
      <div class="card">
        <p>バックアップファイルを読み込んで元に戻します。<b>今のデータはすべて置き換わります。</b></p>
        <button class="btn" data-action="restore-open">バックアップファイルを選ぶ</button>
        <input type="file" id="restoreFile" accept=".json,application/json" hidden>
      </div>
      <p class="muted small">データはこの端末のブラウザ内にだけ保存されています。Safari は長い間使わないとデータを消すことがあるため、コンペのたびに書き出すと安心です。</p>`;
    return { title: 'バックアップ・復元', html };
  }

  function backupPayload() {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const data = { app: APP_ID, version: 1, exportedAt: now.toISOString(), data: state };
    return { json: JSON.stringify(data, null, 2), filename: `compe-backup-${stamp}.json` };
  }

  function markBackedUp() {
    state.lastBackupAt = new Date().toISOString();
    save();
    render();
  }

  function restoreFrom(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { toast('ファイルを読み込めませんでした（JSON ではありません）。'); return; }
    if (!obj || obj.app !== APP_ID || !obj.data || !Array.isArray(obj.data.members)) {
      toast('このツールのバックアップファイルではありません。');
      return;
    }
    const next = sanitizeState(obj.data);
    const msg = `バックアップ（${obj.exportedAt ? obj.exportedAt.slice(0, 10) : '日付不明'}・名簿${next.members.length}人）で、今のデータ（名簿${state.members.length}人）を置き換えます。よろしいですか？`;
    if (!confirm(msg)) return;
    state = next;
    selectDraft = null;
    tieDraft = {};
    save();
    toast('復元しました。');
    go('/');
  }

  // ---------------------------------------------------------------- 操作
  $app.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !$app.contains(el)) return;
    const act = el.dataset.action;

    switch (act) {
      case 'nav':
        go(el.dataset.href);
        break;

      case 'new-compe': {
        if (state.current && !confirm(`入力中のコンペ（${fmtDate(state.current.date)}）があります。破棄して新しく始めますか？\n（参加者を選んで「スコア入力へ」を押すまでは、入力中のコンペは残ります）`)) return;
        selectDraft = { date: today(), ids: new Set(), fresh: true };
        go('/select');
        break;
      }

      // 名簿
      case 'member-edit':
        editingId = el.dataset.id;
        render();
        break;
      case 'member-cancel':
        editingId = null;
        render();
        break;
      case 'member-delete': {
        const id = el.dataset.id;
        const mem = state.members.find((m) => m.id === id);
        if (!mem) return;
        const inCur = state.current && state.current.participantIds.includes(id);
        if (!confirm(`${mem.name} を名簿から削除しますか？${inCur ? '\n入力中のコンペの参加者からも外れます。' : ''}`)) return;
        state.members = state.members.filter((m) => m.id !== id);
        if (inCur) {
          state.current.participantIds = state.current.participantIds.filter((x) => x !== id);
          delete state.current.scores[id];
        }
        if (selectDraft) selectDraft.ids.delete(id);
        editingId = null;
        save();
        render();
        break;
      }

      // 参加者選択
      case 'select-all':
        state.members.forEach((m) => selectDraft.ids.add(m.id));
        render();
        break;
      case 'select-none':
        selectDraft.ids.clear();
        render();
        break;
      case 'select-commit': {
        const ids = state.members.filter((m) => selectDraft.ids.has(m.id)).map((m) => m.id);
        if (ids.length < 2) return;
        if (selectDraft.fresh || !state.current) {
          state.current = { date: selectDraft.date || today(), participantIds: ids, scores: {}, tieOrders: {} };
        } else {
          const cur = state.current;
          cur.date = selectDraft.date || cur.date;
          cur.participantIds = ids;
          for (const k of Object.keys(cur.scores)) if (!ids.includes(k)) delete cur.scores[k];
        }
        tieDraft = {};
        selectDraft = null;
        save();
        go('/input');
        break;
      }

      // スコア入力
      case 'step': {
        const box = el.closest('.step');
        const id = box.dataset.id;
        const key = box.dataset.key;
        const delta = Number(el.dataset.delta);
        const players = getPlayers(state.current);
        const total = players.reduce((a, p) => a + p[key], 0);
        const sc = scoreOf(id);
        const nextV = (sc[key] || 0) + delta;
        if (nextV < 0) return;
        if (delta > 0 && key === 'nearPin' && total >= L.NEAR_PIN_MAX) return;
        if (delta > 0 && key === 'driving' && total >= L.DRIVING_MAX) return;
        if (delta > 0 && key === 'birdie' && nextV > L.BIRDIE_MAX) return;
        sc[key] = nextV;
        save();
        refreshInput();
        break;
      }
      case 'calc': {
        const { validation } = computeCurrent();
        showInputErrors(validation.errors);
        if (validation.errors.length) return;
        if (validation.warnings.length && !confirm(`${validation.warnings.join('\n')}\n\nこのまま計算しますか？`)) return;
        go('/result');
        break;
      }

      // 同点
      case 'tie-move': {
        const ids = tieDraft[el.dataset.key];
        const i = Number(el.dataset.index);
        const j = i + Number(el.dataset.delta);
        if (!ids || j < 0 || j >= ids.length) return;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        render();
        break;
      }
      case 'tie-commit': {
        const { result } = computeCurrent();
        if (!result) return;
        for (const t of visibleTies(result)) state.current.tieOrders[t.key] = tieDraft[t.key].slice();
        tieDraft = {};
        save();
        go('/result');
        break;
      }
      case 'reset-ties':
        if (!confirm('同点の順番の指定をすべて取り消して、決め直しますか？')) return;
        state.current.tieOrders = {};
        tieDraft = {};
        save();
        go('/tie');
        break;

      // 結果
      case 'result-tab':
        resultTab = el.dataset.tab;
        render();
        break;
      case 'copy-text': {
        const ok = await copyText(buildResultText(currentMeta()));
        toast(ok ? 'コピーしました。LINE などに貼り付けてください。' : 'コピーできませんでした。');
        break;
      }
      case 'share-text':
        try { await navigator.share({ text: buildResultText(currentMeta()) }); } catch (e) { if (!isAbort(e)) toast('共有できませんでした。'); }
        break;
      case 'save-image': {
        const meta = currentMeta();
        const canvas = drawResultImage(buildResultText(meta));
        const dataUrl = canvas.toDataURL('image/png');
        const filename = `compe-result-${(meta.date || today()).replace(/-/g, '')}.png`;
        const file = dataUrlToFile(dataUrl, filename);
        if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file] }); return; } catch (e) { if (isAbort(e)) return; }
        }
        showImageOverlay(dataUrl, filename);
        break;
      }
      case 'confirm-result': {
        const { result } = computeCurrent();
        if (!result || result.pendingTies.length) { render(); return; }
        const changes = result.hcUpdates.map((u) => `・${u.name}：${u.oldHc} → ${u.newHc}`).join('\n') || '・なし';
        if (!confirm(`結果を確定します。\n名簿の HC を次のように更新します。\n${changes}\n\n確定後は入力内容を変更できません。よろしいですか？`)) return;
        for (const u of result.hcUpdates) {
          const m = state.members.find((x) => x.id === u.id);
          if (m) m.hc = u.newHc;
        }
        state.last = {
          date: state.current.date,
          competitionName: state.settings.competitionName,
          confirmedAt: new Date().toISOString(),
          result,
        };
        state.current = null;
        tieDraft = {};
        save();
        toast('確定しました。HC を名簿に反映しました。');
        go('/last');
        break;
      }

      // 設定
      case 'settings-reset':
        if (!confirm('ポイント・HC 更新・70台賞の設定を初期値に戻しますか？（コンペ名は残ります）')) return;
        state.settings = { ...L.cloneDefaults(), competitionName: state.settings.competitionName };
        save();
        toast('初期値に戻しました。');
        render();
        break;

      // バックアップ
      case 'backup-share': {
        const { json, filename } = backupPayload();
        const file = new File([json], filename, { type: 'application/json' });
        try {
          await navigator.share({ files: [file] });
          markBackedUp();
          toast('書き出しました。');
        } catch (e) {
          if (!isAbort(e)) toast('共有できませんでした。「ダウンロードで書き出す」を試してください。');
        }
        break;
      }
      case 'backup-download': {
        const { json, filename } = backupPayload();
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        markBackedUp();
        toast('書き出しました。');
        break;
      }
      case 'restore-open':
        document.getElementById('restoreFile').click();
        break;
      default:
        break;
    }
  });

  $app.addEventListener('input', (ev) => {
    const el = ev.target;
    const kind = el.dataset && el.dataset.input;
    if (kind === 'gross') {
      const digits = toHalfWidth(el.value).replace(/\D/g, '').slice(0, 3);
      if (digits !== el.value) el.value = digits;
      const v = digits === '' ? null : parseInt(digits, 10);
      scoreOf(el.dataset.id).gross = v === 0 ? null : v;
      el.classList.toggle('invalid', v === 0);
      const hc = (state.members.find((m) => m.id === el.dataset.id) || {}).hc;
      const netEl = document.getElementById('net-' + el.dataset.id);
      if (netEl) netEl.textContent = v ? v - hc : '—';
      save();
      const c = document.getElementById('counters');
      if (c) c.innerHTML = countersHtml(getPlayers(state.current));
    } else if (kind === 'sel-date') {
      selectDraft.date = el.value;
    }
  });

  $app.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset && el.dataset.input === 'sel') {
      if (el.checked) selectDraft.ids.add(el.dataset.id);
      else selectDraft.ids.delete(el.dataset.id);
      refreshSelectCount();
    } else if (el.id === 'restoreFile' && el.files && el.files[0]) {
      const reader = new FileReader();
      reader.onload = () => restoreFrom(String(reader.result));
      reader.onerror = () => toast('ファイルを読み込めませんでした。');
      reader.readAsText(el.files[0]);
      el.value = '';
    }
  });

  $app.addEventListener('submit', (ev) => {
    const form = ev.target;
    const kind = form.dataset.form;
    if (!kind) return;
    ev.preventDefault();
    if (kind === 'member-add') {
      const v = readMemberForm(form);
      if (!v) return;
      if (state.members.some((m) => m.name === v.name) && !confirm(`「${v.name}」はすでに名簿にいます。同じ名前でもう1人追加しますか？`)) return;
      state.members.push({ id: uid(), name: v.name, hc: v.hc });
      save();
      toast(`${v.name} を追加しました。`);
      render();
      const first = $app.querySelector('form[data-form="member-add"] input[name="name"]');
      if (first) first.focus();
    } else if (kind === 'member-edit') {
      const v = readMemberForm(form);
      if (!v) return;
      const m = state.members.find((x) => x.id === form.dataset.id);
      if (!m) return;
      m.name = v.name;
      m.hc = v.hc;
      editingId = null;
      save();
      toast('保存しました。');
      render();
    } else if (kind === 'settings') {
      const { settings, errors } = readSettingsForm(form);
      const msg = document.getElementById('settingsMsg');
      if (errors.length) {
        msg.innerHTML = `<div class="banner error"><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      msg.innerHTML = '';
      state.settings = settings;
      save();
      toast('設定を保存しました。');
    }
  });

  // ---------------------------------------------------------------- 起動
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  render();
})();
