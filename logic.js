/*
 * コンペ幹事サポートツール 計算ロジック
 * 画面に依存しない純粋な関数のみを置く（Node.js からテスト可能）。
 * 仕様：コンペ幹事サポートツール_要件メモ_v2.md
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.GolfLogic = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NEAR_PIN_MAX = 4;   // 1回のコンペのニアピン本数（固定）
  const DRIVING_MAX = 2;    // 1回のコンペのドラコン本数（固定）
  const BIRDIE_MAX = 18;
  const GROSS_WARN_MIN = 50;
  const GROSS_WARN_MAX = 200;
  const HC_MAX = 99;

  const DEFAULT_SETTINGS = Object.freeze({
    competitionName: 'ゴルフコンペ',
    points: {
      win: 4, bestGross: 4, second: 2, third: 1, seventies: 1, booby: 1,
      birdie: 0.5, nearPin: 0.5, driving: 0.5,
    },
    hcRatePercent: { win: 30, second: 20, third: 10 }, // 整数％（浮動小数点誤差を避ける）
    winBonus: { netBelow: 80, minus: 2 },
    seventiesMax: 79,
  });

  const AWARD_LABELS = {
    win: '優勝', second: '2位', third: '3位', booby: 'ブービー賞',
    bestGross: 'ベストグロス', seventies: '70台賞',
    birdie: 'バーディー賞', nearPin: 'ニアピン', driving: 'ドラコン',
  };

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }

  /** 保存データの設定を既定値で補完する */
  function normalizeSettings(s) {
    const d = cloneDefaults();
    if (!s || typeof s !== 'object') return d;
    const out = d;
    if (typeof s.competitionName === 'string') out.competitionName = s.competitionName;
    for (const k of Object.keys(d.points)) {
      if (s.points && isFiniteNumber(s.points[k])) out.points[k] = Number(s.points[k]);
    }
    for (const k of Object.keys(d.hcRatePercent)) {
      if (s.hcRatePercent && Number.isInteger(s.hcRatePercent[k])) out.hcRatePercent[k] = s.hcRatePercent[k];
    }
    if (s.winBonus) {
      if (Number.isInteger(s.winBonus.netBelow)) out.winBonus.netBelow = s.winBonus.netBelow;
      if (Number.isInteger(s.winBonus.minus)) out.winBonus.minus = s.winBonus.minus;
    }
    if (Number.isInteger(s.seventiesMax)) out.seventiesMax = s.seventiesMax;
    return out;
  }

  function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function isNonNegInt(v) {
    return Number.isInteger(v) && v >= 0;
  }

  /**
   * 引く量 = round(hc × percent / 100)（小数点以下四捨五入）を整数演算で求める。
   * hc, percent は 0 以上の整数。
   */
  function hcReduction(hc, percent) {
    return Math.floor((hc * percent + 50) / 100);
  }

  /**
   * 新ハンディキャップ。award は 'win' | 'second' | 'third'。
   * 優勝は当日 NET が netBelow 未満なら さらに minus を引く。下限 0。
   */
  function newHandicap(award, hc, net, settings) {
    const s = settings || DEFAULT_SETTINGS;
    const reduction = hcReduction(hc, s.hcRatePercent[award]);
    const bonus = award === 'win' && net < s.winBonus.netBelow ? s.winBonus.minus : 0;
    const raw = hc - reduction - bonus;
    return { reduction, bonus, newHc: Math.max(0, raw), floored: raw < 0 };
  }

  function roundPoints(v) {
    return Math.round(v * 100) / 100;
  }

  /**
   * 入力チェック。players: [{id,name,hc,gross,nearPin,driving,birdie}]
   * gross 未入力は null。errors があると計算できない。warnings は確認すれば続行可。
   */
  function validate(players) {
    const errors = [];
    const warnings = [];
    if (players.length < 2) errors.push('参加者は2人以上にしてください。');

    const ids = new Set();
    let nearPinTotal = 0;
    let drivingTotal = 0;
    for (const p of players) {
      const who = p.name || '(名前なし)';
      if (ids.has(p.id)) errors.push(`${who} が二重に登録されています。`);
      ids.add(p.id);

      if (!isNonNegInt(p.hc) || p.hc > HC_MAX) errors.push(`${who} の HC が正しくありません（0〜${HC_MAX} の整数）。`);

      if (p.gross === null || p.gross === undefined || p.gross === '') {
        errors.push(`${who} のグロスが未入力です。`);
      } else if (!Number.isInteger(p.gross) || p.gross <= 0) {
        errors.push(`${who} のグロスが正しくありません（正の整数）。`);
      } else if (p.gross < GROSS_WARN_MIN || p.gross > GROSS_WARN_MAX) {
        warnings.push(`${who} のグロス ${p.gross} は通常の範囲（${GROSS_WARN_MIN}〜${GROSS_WARN_MAX}）外です。`);
      }

      for (const [key, label] of [['nearPin', 'ニアピン'], ['driving', 'ドラコン'], ['birdie', 'バーディー']]) {
        if (!isNonNegInt(p[key])) errors.push(`${who} の${label}本数が正しくありません（0以上の整数）。`);
      }
      if (isNonNegInt(p.birdie) && p.birdie > BIRDIE_MAX) errors.push(`${who} のバーディー本数が${BIRDIE_MAX}を超えています。`);
      if (isNonNegInt(p.nearPin)) nearPinTotal += p.nearPin;
      if (isNonNegInt(p.driving)) drivingTotal += p.driving;
    }
    if (nearPinTotal > NEAR_PIN_MAX) errors.push(`ニアピンの合計が${nearPinTotal}本です（最大${NEAR_PIN_MAX}本）。`);
    if (drivingTotal > DRIVING_MAX) errors.push(`ドラコンの合計が${drivingTotal}本です（最大${DRIVING_MAX}本）。`);
    return { errors, warnings, nearPinTotal, drivingTotal };
  }

  /**
   * cmp で並べ、完全に同点（cmp===0）の組は tieOrders の指定順に並べる。
   * 指定がない組は名前順の仮の並びとし、resolved=false を返す。
   */
  function orderWithTies(rows, cmp, keyPrefix, tieOrders) {
    const sorted = rows.slice().sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name, 'ja') || String(a.id).localeCompare(String(b.id)));
    const groups = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i + 1;
      while (j < sorted.length && cmp(sorted[i], sorted[j]) === 0) j++;
      if (j - i > 1) {
        const members = sorted.slice(i, j);
        const ids = members.map((m) => String(m.id)).sort();
        const key = keyPrefix(members[0]) + '|' + ids.join(',');
        const saved = tieOrders && tieOrders[key];
        let resolved = false;
        if (Array.isArray(saved) && saved.length === ids.length && saved.map(String).slice().sort().join(',') === ids.join(',')) {
          const byId = new Map(members.map((m) => [String(m.id), m]));
          saved.forEach((id, k) => { sorted[i + k] = byId.get(String(id)); });
          resolved = true;
        }
        groups.push({ key, start: i, end: j - 1, resolved, members: sorted.slice(i, j) });
      }
      i = j;
    }
    return { ordered: sorted, groups };
  }

  const byGross = (a, b) => a.gross - b.gross || a.hc - b.hc;
  const byNet = (a, b) => a.net - b.net || a.hc - b.hc;

  /** 同順位を考慮した順位（自分より厳密に上位の人数 + 1） */
  function standardRanks(rows, cmp) {
    return rows.map((r) => 1 + rows.filter((o) => cmp(o, r) < 0).length);
  }

  /**
   * 幹事が順番を決めた同点の組は、その順番で上下を付ける比較関数にする。
   * 決めていない同点は 0（同順位）のまま。
   */
  function withResolvedOrder(cmp, groups) {
    const pos = new Map(); // id -> { key, index }
    for (const g of groups) {
      if (!g.resolved) continue;
      g.members.forEach((m, i) => pos.set(m.id, { key: g.key, index: i }));
    }
    return (a, b) => {
      const c = cmp(a, b);
      if (c) return c;
      const pa = pos.get(a.id);
      const pb = pos.get(b.id);
      return pa && pb && pa.key === pb.key ? pa.index - pb.index : 0;
    };
  }

  /**
   * 結果を計算する。
   * players: [{id,name,hc,gross,nearPin,driving,birdie}]（validate 済みであること）
   * tieOrders: { [tieKey]: [id,...] } 幹事が指定した同点の順番
   * 戻り値の pendingTies が空でなければ、幹事による順番の指定が必要（結果は仮）。
   */
  function computeResults(players, settings, tieOrders) {
    const s = normalizeSettings(settings);
    const rows = players.map((p) => ({ ...p, net: p.gross - p.hc }));
    const pendingTies = [];
    const awards = {
      bestGross: null, win: null, second: null, third: null, booby: null,
      seventies: [], birdie: [], nearPin: [], driving: [],
    };
    const notes = [];

    // 1. ベストグロス（グロス1位、同点は HC の低い人）
    const gross = orderWithTies(rows, byGross, (r) => `bg|g${r.gross}|h${r.hc}`, tieOrders);
    if (gross.ordered.length > 0) {
      const g0 = gross.groups.find((g) => g.start === 0);
      if (g0 && !g0.resolved) {
        pendingTies.push({ key: g0.key, kind: 'gross', awards: ['bestGross'], members: g0.members, gross: g0.members[0].gross, hc: g0.members[0].hc });
      }
      awards.bestGross = gross.ordered[0].id;
    }

    // 2. ベスグロ受賞者を除いた NET 順位で 優勝・2位・3位・ブービー
    const rest = rows.filter((r) => r.id !== awards.bestGross);
    const net = orderWithTies(rest, byNet, (r) => `net|n${r.net}|h${r.hc}`, tieOrders);
    const M = net.ordered.length;
    const positions = {}; // index -> award
    if (M >= 1) positions[0] = 'win';
    if (M >= 2) positions[1] = 'second';
    if (M >= 3) positions[2] = 'third';
    const boobyIndex = M - 2;
    if (boobyIndex >= 3) positions[boobyIndex] = 'booby';
    else if (M >= 2) notes.push('参加人数が少なく、ブービー賞が3位以内と重なるため、ブービー賞はありません。');

    for (const g of net.groups) {
      if (g.resolved) continue;
      const involved = [];
      for (let k = g.start; k <= g.end; k++) if (positions[k]) involved.push(positions[k]);
      if (involved.length) {
        pendingTies.push({ key: g.key, kind: 'net', awards: involved, members: g.members, net: g.members[0].net, hc: g.members[0].hc });
      }
    }
    for (const [idx, award] of Object.entries(positions)) awards[award] = net.ordered[idx].id;

    // 3. 全員が対象の賞
    for (const r of rows) {
      if (r.gross <= s.seventiesMax) awards.seventies.push(r.id);
      if (r.birdie > 0) awards.birdie.push({ id: r.id, count: r.birdie });
      if (r.nearPin > 0) awards.nearPin.push({ id: r.id, count: r.nearPin });
      if (r.driving > 0) awards.driving.push({ id: r.id, count: r.driving });
    }

    // ポイント
    const pointsById = new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, total: 0, items: [] }]));
    const add = (id, key, pts, count) => {
      const e = pointsById.get(id);
      e.items.push({ award: key, label: AWARD_LABELS[key] + (count ? `${count}本` : ''), count: count || 0, points: roundPoints(pts) });
      e.total = roundPoints(e.total + pts);
    };
    for (const key of ['win', 'bestGross', 'second', 'third', 'booby']) {
      if (awards[key] !== null) add(awards[key], key, s.points[key]);
    }
    for (const id of awards.seventies) add(id, 'seventies', s.points.seventies);
    for (const key of ['birdie', 'nearPin', 'driving']) {
      for (const e of awards[key]) add(e.id, key, s.points[key] * e.count, e.count);
    }

    // 新ハンディキャップ（優勝・2位・3位のみ）
    const byId = new Map(rows.map((r) => [r.id, r]));
    const hcUpdates = [];
    for (const key of ['win', 'second', 'third']) {
      const id = awards[key];
      if (id === null) continue;
      const r = byId.get(id);
      const h = newHandicap(key, r.hc, r.net, s);
      hcUpdates.push({ id, name: r.name, award: key, oldHc: r.hc, net: r.net, ...h });
    }

    // 順位表（表示用。完全同点は同順位）
    const awardOf = (id) => {
      const list = [];
      for (const key of ['win', 'second', 'third', 'booby', 'bestGross']) if (awards[key] === id) list.push(AWARD_LABELS[key]);
      if (awards.seventies.includes(id)) list.push(AWARD_LABELS.seventies);
      return list;
    };
    const netCmp = withResolvedOrder(byNet, net.groups);
    const netAll = rows.slice().sort((a, b) => netCmp(a, b) || a.name.localeCompare(b.name, 'ja'));
    const netRanks = standardRanks(netAll, netCmp);
    const netTable = netAll.map((r, i) => ({
      rank: netRanks[i], id: r.id, name: r.name, gross: r.gross, hc: r.hc, net: r.net,
      isBestGross: r.id === awards.bestGross, awards: awardOf(r.id),
    }));
    const grossCmp = withResolvedOrder(byGross, gross.groups);
    const grossAll = rows.slice().sort((a, b) => grossCmp(a, b) || a.name.localeCompare(b.name, 'ja'));
    const grossRanks = standardRanks(grossAll, grossCmp);
    const grossTable = grossAll.map((r, i) => ({
      rank: grossRanks[i], id: r.id, name: r.name, gross: r.gross, hc: r.hc, net: r.net, awards: awardOf(r.id),
    }));

    const points = rows
      .map((r) => pointsById.get(r.id))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ja'));

    return { awards, points, hcUpdates, netTable, grossTable, pendingTies, notes, settings: s };
  }

  return {
    NEAR_PIN_MAX, DRIVING_MAX, BIRDIE_MAX, HC_MAX, DEFAULT_SETTINGS, AWARD_LABELS,
    cloneDefaults, normalizeSettings, hcReduction, newHandicap, validate, computeResults,
  };
});
