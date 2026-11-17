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
  const GROSS_MAX = 999;    // グロスの上限（保存データ・前回の結果の検査と同じ 1〜999。要件メモ 4章）
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

  /** 設定値の許容範囲（設定画面・復元ファイル・保存データで共通） */
  const SETTING_RANGES = {
    points: [0, 100],
    hcRatePercent: [0, 100],
    netBelow: [1, 200],
    minus: [0, 50],
    seventiesMax: [1, 200],
    competitionNameMax: 30,
  };

  /** 保存データの設定を既定値で補完する（範囲外・型違いの値は既定値にする） */
  function normalizeSettings(s) {
    const d = cloneDefaults();
    if (!s || typeof s !== 'object') return d;
    const out = d;
    const R = SETTING_RANGES;
    const intIn = (v, [min, max]) => Number.isInteger(v) && v >= min && v <= max;
    if (typeof s.competitionName === 'string' && s.competitionName.trim()) {
      out.competitionName = s.competitionName.trim().slice(0, R.competitionNameMax);
    }
    for (const k of Object.keys(d.points)) {
      const v = s.points && s.points[k];
      if (isFiniteNumber(v) && v >= R.points[0] && v <= R.points[1] && hasAtMost2Decimals(v)) out.points[k] = v;
    }
    for (const k of Object.keys(d.hcRatePercent)) {
      if (s.hcRatePercent && intIn(s.hcRatePercent[k], R.hcRatePercent)) out.hcRatePercent[k] = s.hcRatePercent[k];
    }
    if (s.winBonus && typeof s.winBonus === 'object') {
      if (intIn(s.winBonus.netBelow, R.netBelow)) out.winBonus.netBelow = s.winBonus.netBelow;
      if (intIn(s.winBonus.minus, R.minus)) out.winBonus.minus = s.winBonus.minus;
    }
    if (intIn(s.seventiesMax, R.seventiesMax)) out.seventiesMax = s.seventiesMax;
    return out;
  }

  function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  /** ポイントは小数2桁まで（3桁以上だと合計と内訳の和がずれるため） */
  function hasAtMost2Decimals(v) {
    return Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
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
   * gross 未入力は null（不正な入力は null 以外の値で渡す）。errors があると計算できない。warnings は確認すれば続行可。
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
      } else if (!Number.isInteger(p.gross) || p.gross <= 0 || p.gross > GROSS_MAX) {
        // 1000 以上、マイナス・小数・文字などの不正な入力はエラー（未入力として黙って扱わない）
        errors.push(`${who} のグロスが正しくありません（1〜${GROSS_MAX} の整数）。`);
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
   * 表示用の比較関数：(スコア, HC, 幹事が決めた組内の順番) の辞書式比較。
   * 組に入っていない人の順番は 0 とする。同じ (スコア, HC) の組は1つしかないので推移的になる。
   * 組内の順番を使うのは、今回の賞の判定で実際に使った同点指定（applied）だけ。
   * 賞に関係しない同点は、指定が残っていても同順位にする（要件メモ 10章【2026-11-17】Ver1.2）。
   */
  function withResolvedOrder(cmp, groups, applied) {
    const index = new Map(); // id -> 組内の順番
    for (const g of groups) {
      if (!g.resolved || !applied.has(g.key)) continue;
      g.members.forEach((m, i) => index.set(m.id, i));
    }
    return (a, b) => cmp(a, b) || (index.get(a.id) || 0) - (index.get(b.id) || 0);
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
    const appliedTies = []; // 今回の判定で実際に使った同点指定のキー
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
      if (g0 && g0.resolved) appliedTies.push(g0.key);
      awards.bestGross = gross.ordered[0].id;
    }

    // ベスグロの同点（3人以上）で並べた順番は、残った人たちの NET 同点にもそのまま使う（二度聞かない）。
    // グロスも HC も同じ人たちは NET も同じなので、残りの NET 同点の組はちょうどこの人たちになる。
    let netTieOrders = tieOrders || {};
    const gTop = gross.groups.find((g) => g.start === 0);
    if (gTop && gTop.resolved && gTop.members.length >= 3) {
      const restIds = gTop.members.slice(1).map((m) => String(m.id));
      const r1 = gTop.members[1];
      netTieOrders = { ...netTieOrders, [`net|n${r1.net}|h${r1.hc}|` + restIds.slice().sort().join(',')]: restIds };
    }

    // 2. ベスグロ受賞者を除いた NET 順位で 優勝・2位・3位・ブービー
    const rest = rows.filter((r) => r.id !== awards.bestGross);
    const net = orderWithTies(rest, byNet, (r) => `net|n${r.net}|h${r.hc}`, netTieOrders);
    const M = net.ordered.length;
    const positions = {}; // index -> award（優勝・2位・3位）
    if (M >= 1) positions[0] = 'win';
    if (M >= 2) positions[1] = 'second';
    if (M >= 3) positions[2] = 'third';

    for (const g of net.groups) {
      const involved = [];
      for (let k = g.start; k <= g.end; k++) if (positions[k]) involved.push(positions[k]);
      if (!involved.length) continue;
      if (g.resolved) appliedTies.push(g.key);
      else pendingTies.push({ key: g.key, kind: 'net', awards: involved, members: g.members, net: g.members[0].net, hc: g.members[0].hc });
    }
    for (const [idx, award] of Object.entries(positions)) awards[award] = net.ordered[idx].id;

    // ブービー賞：最下位から2番目。そこが NET 同点なら、同点者のうち HC の最も低い人が受賞（要件 3-4）。
    const boobyIndex = M - 2;
    if (boobyIndex >= 3) {
      const boobyNet = net.ordered[boobyIndex].net;
      const top3 = new Set([awards.win, awards.second, awards.third]);
      const sameNet = net.ordered.filter((r) => r.net === boobyNet && !top3.has(r.id));
      const minHc = Math.min(...sameNet.map((r) => r.hc));
      const lowest = sameNet.filter((r) => r.hc === minHc)
        .sort((a, b) => a.name.localeCompare(b.name, 'ja') || String(a.id).localeCompare(String(b.id)));
      // 同じ (NET, HC) の人たちの順番を優勝〜3位の判定ですでに決めていれば、その順番を使う（二度聞かない）
      const lowestIds = new Set(lowest.map((r) => r.id));
      const decided = net.groups.find((g) => g.resolved && lowest.every((r) => g.members.some((m) => m.id === r.id)));
      if (lowest.length === 1) {
        awards.booby = lowest[0].id;
      } else if (decided) {
        awards.booby = decided.members.find((m) => lowestIds.has(m.id)).id;
        if (!appliedTies.includes(decided.key)) appliedTies.push(decided.key);
      } else {
        // NET も HC も同じ → 幹事が決める（一番上に並べた人がブービー賞）
        const ids = lowest.map((r) => String(r.id)).sort();
        const key = `booby|n${boobyNet}|h${minHc}|` + ids.join(',');
        const saved = tieOrders && tieOrders[key];
        if (Array.isArray(saved) && saved.length === ids.length && saved.map(String).slice().sort().join(',') === ids.join(',')) {
          awards.booby = lowest.find((r) => String(r.id) === String(saved[0])).id;
          appliedTies.push(key);
        } else {
          // ベスグロや優勝〜3位の同点が未決定なら、それを決めた後に改めて判定する（決め方次第で不要になるため）
          if (!pendingTies.length) pendingTies.push({ key, kind: 'booby', awards: ['booby'], members: lowest, net: boobyNet, hc: minHc });
          awards.booby = lowest[0].id;
        }
      }
    } else if (M >= 1) {
      notes.push('参加人数が少なく、ブービー賞が3位以内と重なるため、ブービー賞はありません。');
    }

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

    // 順位表（表示用。完全同点は同順位。賞の判定で幹事が決めた同点だけ、その順で別の順位）
    const awardOf = (id) => {
      const list = [];
      for (const key of ['win', 'second', 'third', 'booby', 'bestGross']) if (awards[key] === id) list.push(AWARD_LABELS[key]);
      if (awards.seventies.includes(id)) list.push(AWARD_LABELS.seventies);
      return list;
    };
    const applied = new Set(appliedTies);
    const netCmp = withResolvedOrder(byNet, net.groups, applied);
    const netAll = rows.slice().sort((a, b) => netCmp(a, b) || a.name.localeCompare(b.name, 'ja'));
    const netRanks = standardRanks(netAll, netCmp);
    const netTable = netAll.map((r, i) => ({
      rank: netRanks[i], id: r.id, name: r.name, gross: r.gross, hc: r.hc, net: r.net,
      isBestGross: r.id === awards.bestGross, awards: awardOf(r.id),
    }));
    const grossCmp = withResolvedOrder(byGross, gross.groups, applied);
    const grossAll = rows.slice().sort((a, b) => grossCmp(a, b) || a.name.localeCompare(b.name, 'ja'));
    const grossRanks = standardRanks(grossAll, grossCmp);
    const grossTable = grossAll.map((r, i) => ({
      rank: grossRanks[i], id: r.id, name: r.name, gross: r.gross, hc: r.hc, net: r.net, awards: awardOf(r.id),
    }));

    const points = rows
      .map((r) => pointsById.get(r.id))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ja'));

    return { awards, points, hcUpdates, netTable, grossTable, pendingTies, appliedTies, notes, settings: s };
  }

  /** HC が更新される賞 */
  const HC_AWARDS = ['win', 'second', 'third'];

  /**
   * 入力内容を持たない（古い形式の）前回の結果から、入力内容を復元する（要件メモ 10章【2026-11-17】）。
   * グロス・当日 HC は順位表から、バーディー・ニアピン・ドラコンの本数は各賞の欄から取る。
   * 同点の指定順は結果に残っていないため復元しない（必要なら同点の画面で聞き直す）。
   * 戻り値：{ participantIds, scores: {id:{gross,nearPin,driving,birdie}}, tieOrders: {}, hc: {id:当日HC} }
   */
  function inputFromResult(result) {
    const scores = new Map();
    const hc = new Map();
    for (const r of result.netTable) {
      scores.set(r.id, { gross: r.gross, nearPin: 0, driving: 0, birdie: 0 });
      hc.set(r.id, r.hc);
    }
    for (const key of ['birdie', 'nearPin', 'driving']) {
      for (const e of result.awards[key] || []) if (scores.has(e.id)) scores.get(e.id)[key] = e.count;
    }
    // 参加者の id が "__proto__" などでも普通のキーとして扱えるよう、Object.fromEntries で作る
    return {
      participantIds: result.netTable.map((r) => r.id),
      scores: Object.fromEntries(scores),
      tieOrders: {},
      hc: Object.fromEntries(hc),
    };
  }

  /**
   * 前回の結果を修正して再確定するときに、名簿の HC をどう付け直すかを決める（要件メモ 10章【2026-11-17】）。
   * - prevUpdates：前回の結果の HC 更新（oldHc＝当日 HC、newHc＝前回の確定で名簿に入れた HC）
   * - nextUpdates：修正後の結果の HC 更新（当日 HC から計算したもの）
   * - members：名簿 [{id,name,hc}]（hc は名簿の今の HC）
   * 戻り値：[{ id, name, from, to, kind, award, prevAward, expected, manual }]
   * - from＝名簿の今の HC、to＝再確定後の HC（差分は名簿の今の HC を基準に示す）
   * - kind 'update'：修正後の優勝〜3位。当日 HC から計算した新 HC にする
   * - kind 'revert'：前回は優勝〜3位だったが、修正後は外れた人。当日 HC（前回の oldHc）に戻す
   * - expected：前回の確定のあと名簿にあるはずの HC（前回の優勝〜3位は前回の newHc、それ以外は当日 HC）
   * - manual：名簿の今の HC が expected と違う（前回の確定のあと手で変えられていた）。再確定では上書きする
   * 名簿にいない人（削除された人）は含めない。並びは修正後の優勝・2位・3位、続いて外れた人。
   */
  function planReconfirmHc(prevUpdates, nextUpdates, members) {
    const byId = new Map(members.map((m) => [m.id, m]));
    const prevById = new Map(prevUpdates.map((u) => [u.id, u]));
    const changes = [];
    const done = new Set();
    const push = (id, to, kind, award, prevAward, expected) => {
      const m = byId.get(id);
      if (!m || done.has(id)) return;
      done.add(id);
      changes.push({ id, name: m.name, from: m.hc, to, kind, award, prevAward, expected, manual: m.hc !== expected });
    };
    for (const u of nextUpdates) {
      const p = prevById.get(u.id);
      push(u.id, u.newHc, 'update', u.award, p ? p.award : null, p ? p.newHc : u.oldHc);
    }
    for (const p of prevUpdates) {
      if (nextUpdates.some((u) => u.id === p.id)) continue;
      push(p.id, p.oldHc, 'revert', null, p.award, p.newHc);
    }
    return changes;
  }

  return {
    NEAR_PIN_MAX, DRIVING_MAX, BIRDIE_MAX, GROSS_MAX, HC_MAX, DEFAULT_SETTINGS, AWARD_LABELS, SETTING_RANGES, HC_AWARDS,
    cloneDefaults, normalizeSettings, hcReduction, newHandicap, validate, computeResults,
    inputFromResult, planReconfirmHc,
  };
});
