/* ScanQC Web · 자동 분석 (데스크톱판 server.py analyze/qc 를 그대로 옮김)
   입력: 회색조 축소본(긴 변 1000px 이하) — 기울기(투영 프로파일), 용지 경계, 내용 영역, 자동 크롭 3종, 자동 검사 */
function ScanQCAnalyzeModule(root) {
  'use strict';

  function hist(a) { const h = new Float64Array(256); for (let i = 0; i < a.length; i++) h[a[i]]++; return h; }
  /* numpy.percentile(linear) 과 같은 값 (정수 화소) */
  function pct(h, n, q) {
    const pos = (n - 1) * q / 100, lo = Math.floor(pos), fr = pos - lo;
    const kth = k => { let c = 0; for (let v = 0; v < 256; v++) { c += h[v]; if (c > k) return v; } return 255; };
    const a = kth(lo); return fr ? a + (kth(Math.min(n - 1, lo + 1)) - a) * fr : a;
  }

  function paperBox(g, w, h) {
    const p = pct(hist(g), g.length, 92), thr = Math.max(80, p * 0.6);
    const rc = new Float64Array(h), cc = new Float64Array(w);
    for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) if (g[o + x] > thr) { rc[y]++; cc[x]++; } }
    let y0 = -1, y1 = -1, x0 = -1, x1 = -1;
    for (let y = 0; y < h; y++) if (rc[y] / w > 0.6) { if (y0 < 0) y0 = y; y1 = y; }
    for (let x = 0; x < w; x++) if (cc[x] / h > 0.6) { if (x0 < 0) x0 = x; x1 = x; }
    if (y0 < 0 || x0 < 0) return [[0, 0, w, h], p];
    return [[x0, y0, x1 + 1, y1 + 1], p];
  }
  function inkMask(g, p) { const t = Math.min(p - 45, p * 0.75), m = new Uint8Array(g.length); for (let i = 0; i < g.length; i++) m[i] = g[i] < t ? 1 : 0; return m; }
  function contentBox(m, w, box) {
    const [x0, y0, x1, y1] = box, sw = x1 - x0, sh = y1 - y0;
    if (sh < 4 || sw < 4) return null;
    const rs = new Float64Array(sh), cs = new Float64Array(sw);
    for (let y = 0; y < sh; y++) { const o = (y0 + y) * w + x0; for (let x = 0; x < sw; x++) if (m[o + x]) { rs[y]++; cs[x]++; } }
    const tr = Math.max(1, sw * 0.003), tc = Math.max(1, sh * 0.003);
    let a = -1, b = -1, c = -1, d = -1;
    for (let y = 0; y < sh; y++) if (rs[y] > tr) { if (a < 0) a = y; b = y; }
    for (let x = 0; x < sw; x++) if (cs[x] > tc) { if (c < 0) c = x; d = x; }
    if (a < 0 || c < 0) return null;
    return [x0 + c, y0 + a, x0 + d + 1, y0 + b + 1];
  }
  function inset(box, w, h, r = 0.012) {
    const [x0, y0, x1, y1] = box, ix = Math.floor(w * r), iy = Math.floor(h * r);
    return [x0 + ix, y0 + iy, Math.max(x0 + ix + 1, x1 - ix), Math.max(y0 + iy + 1, y1 - iy)];
  }
  function crop(a, w, box) {
    const [x0, y0, x1, y1] = box, sw = Math.max(0, x1 - x0), sh = Math.max(0, y1 - y0), o = new (a.constructor)(sw * sh);
    for (let y = 0; y < sh; y++) o.set(a.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + sw), y * sw);
    return o;
  }
  /* 면적 평균 축소 (Pillow 의 안티에일리어스 축소와 비슷) */
  function shrink(a, w, h, nw, nh) {
    const o = new Float32Array(nw * nh), sx = w / nw, sy = h / nh;
    for (let y = 0; y < nh; y++) {
      const ya = y * sy, yb = ya + sy;
      for (let x = 0; x < nw; x++) {
        const xa = x * sx, xb = xa + sx; let s = 0, n = 0;
        for (let yy = Math.floor(ya); yy < Math.min(h, Math.ceil(yb)); yy++) {
          const wy = Math.min(yb, yy + 1) - Math.max(ya, yy);
          for (let xx = Math.floor(xa); xx < Math.min(w, Math.ceil(xb)); xx++) { const wx = Math.min(xb, xx + 1) - Math.max(xa, xx), k = wx * wy; s += a[yy * w + xx] * k; n += k; }
        }
        o[y * nw + x] = n ? s / n : 0;
      }
    }
    return o;
  }
  /* Pillow Image.rotate(angle) 과 같은 방향(반시계) · 쌍선형 · 중심 기준 */
  function rotate(a, w, h, deg, expand, fill, round) {
    const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    let W = w, H = h;
    if (expand) { const ac = Math.abs(c), as = Math.abs(s); W = Math.ceil(w * ac + h * as - 1e-6); H = Math.ceil(w * as + h * ac - 1e-6); }
    const o = round ? new Uint8Array(W * H) : new Float32Array(W * H), cx = w / 2, cy = h / 2, CX = W / 2, CY = H / 2;
    for (let y = 0; y < H; y++) {
      const dy = y + 0.5 - CY;
      for (let x = 0; x < W; x++) {
        const dx = x + 0.5 - CX, sx = dx * c - dy * s + cx - 0.5, sy = dx * s + dy * c + cy - 0.5;
        const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
        let v;
        if (x0 < -1 || y0 < -1 || x0 >= w || y0 >= h) v = fill;
        else {
          const g = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h) ? fill : a[yy * w + xx];
          v = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
        }
        o[y * W + x] = round ? Math.round(v) : v;
      }
    }
    return { a: o, w: W, h: H };
  }
  /* 투영 프로파일 방식. 반환: [시계방향 보정 각도(도), 신뢰도] */
  function estimateSkew(m, w, h) {
    let sum = 0; for (let i = 0; i < m.length; i++) sum += m[i];
    if (h < 20 || w < 20 || sum < 200) return [0, 0];
    let img = new Float32Array(m.length); for (let i = 0; i < m.length; i++) img[i] = m[i] * 255;
    const sc = 700 / Math.max(h, w); let W = w, H = h;
    if (sc < 1) { const nw = Math.max(8, Math.floor(w * sc)), nh = Math.max(8, Math.floor(h * sc)); img = shrink(img, w, h, nw, nh); W = nw; H = nh; }
    const score = a => {
      const r = a ? rotate(img, W, H, a, false, 0, false).a : img;
      let prev = 0, s = 0;
      for (let y = 0; y < H; y++) { let rs = 0; const o = y * W; for (let x = 0; x < W; x++) rs += r[o + x]; if (y) { const d = rs - prev; s += d * d; } prev = rs; }
      return s;
    };
    const base = score(0); let best = 0, bs = base;
    for (let i = 0; i <= 40; i++) { const a = -5 + i * 0.25, s = score(a); if (s > bs) { best = a; bs = s; } }
    const c = best;
    for (let i = 0; i <= 10; i++) { const a = c - 0.25 + i * 0.05, s = score(a); if (s > bs) { best = a; bs = s; } }
    const conf = base > 0 ? (bs - base) / base : 0;
    return [Math.round(-best * 100) / 100 || 0, Math.round(conf * 10000) / 10000];
  }
  const frac = (b, w, h) => [b[0] / w, b[1] / h, (b[2] - b[0]) / w, (b[3] - b[1]) / h];
  function mean(a, w, h, x0, y0, x1, y1) { let s = 0, n = 0; for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) { s += a[y * w + x]; n++; } return n ? s / n : 0; }

  /* g: Uint8Array(w*h) 회색조 축소본 · meta: 원본 메타(w,h,dpi) · cfg: auto_mode, margin_mm */
  function analyze(g, w, h, meta, cfg) {
    cfg = cfg || {};
    const [pb, p] = paperBox(g, w, h), mask = inkMask(g, p), inner = inset(pb, w, h);
    const cb = contentBox(mask, w, inner), sub = crop(mask, w, inner), sw = inner[2] - inner[0], sh = inner[3] - inner[1];
    let ink = 0; for (let i = 0; i < sub.length; i++) ink += sub[i]; ink = sub.length ? ink / sub.length : 0;
    const [skew, conf] = estimateSkew(sub, sw, sh);
    const band = Math.max(2, Math.floor(Math.min(h, w) * 0.006));
    const S = { l: [1, 0, band + 1, h], r: [w - band - 1, 0, w - 1, h], t: [0, 1, w, band + 1], b: [0, h - band - 1, w, h - 1] };
    const dark = {}, touch = {};
    for (const k in S) { const [x0, y0, x1, y1] = S[k]; dark[k] = mean(g, w, h, x0, y0, x1, y1) < 100; }
    for (const k in S) { const [x0, y0, x1, y1] = S[k]; touch[k] = !dark[k] && mean(mask, w, h, x0, y0, x1, y1) > 0.02; }
    const H0 = hist(g);
    const res = { skew, skew_conf: conf, paper: frac(pb, w, h), content: cb ? frac(cb, w, h) : null, ink: Math.round(ink * 1e5) / 1e5,
      levels: [Math.round(pct(H0, g.length, 0.5)), Math.round(pct(H0, g.length, 99.5))], dark, touch };

    // 자동 보정안: 기울기 보정 후 다시 측정 (분수 좌표 = 회전된 이미지 기준)
    const tilt = (Math.abs(skew) >= 0.05 && conf > 0.01) ? skew : 0;
    const edge = []; for (let x = 0; x < w; x++) edge.push(g[x], g[(h - 1) * w + x]); for (let y = 0; y < h; y++) edge.push(g[y * w], g[y * w + w - 1]);
    edge.sort((a, b) => a - b); const n2 = edge.length, bg = n2 % 2 ? edge[(n2 - 1) / 2] : Math.floor((edge[n2 / 2 - 1] + edge[n2 / 2]) / 2);
    const R = tilt ? rotate(g, w, h, -tilt, true, bg, true) : { a: g, w, h }, a = R.a, W = R.w, H = R.h;
    const [qb, p2] = paperBox(a, W, H);
    const cb2 = contentBox(inkMask(a, p2), W, inset(qb, W, H));
    const fullPaper = (qb[2] - qb[0]) > W * 0.995 && (qb[3] - qb[1]) > H * 0.995;
    const px = Math.max(1, Math.floor(W * 0.003)), py = Math.max(1, Math.floor(H * 0.003));
    const qbi = fullPaper ? qb : [qb[0] + px, qb[1] + py, qb[2] - px, qb[3] - py];
    let cropPaper = frac(qbi, W, H);
    if (fullPaper) cropPaper = tilt ? [(W - w) / 2 / W, (H - h) / 2 / H, w / W, h / H] : null;
    const dpi = ((meta.dpi || [300])[0]) || 300;
    const m = (+(cfg.margin_mm ?? 10)) / 25.4 * dpi * (w / Math.max(1, meta.w));
    let cropContent = null;
    if (cb2) {
      const lim = fullPaper ? [-1e6, -1e6, 1e6, 1e6] : qbi;
      const x0 = Math.max(cb2[0] - m, lim[0]), y0 = Math.max(cb2[1] - m, lim[1]), x1 = Math.min(cb2[2] + m, lim[2]), y1 = Math.min(cb2[3] + m, lim[3]);
      cropContent = [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H];
    }
    const baseR = cropPaper ? [cropPaper[0] * W, cropPaper[1] * H, (cropPaper[0] + cropPaper[2]) * W, (cropPaper[1] + cropPaper[3]) * H] : [0, 0, W, H];
    let cropBalance = null;
    if (cb2 && cb2[0] >= baseR[0] && cb2[2] <= baseR[2]) {
      const mm = Math.min(cb2[0] - baseR[0], baseR[2] - cb2[2]);
      cropBalance = [(cb2[0] - mm) / W, baseR[1] / H, (cb2[2] - cb2[0] + 2 * mm) / W, (baseR[3] - baseR[1]) / H];
    }
    res.auto = { tilt: Math.round(tilt * 100) / 100, crop_paper: cropPaper, crop_balance: cropBalance, crop_content: cropContent };

    const mode = cfg.auto_mode || 'balance';
    const chosen = { paper: cropPaper, balance: cropBalance || cropPaper, content: cropContent || cropPaper }[mode] || cropPaper;
    const r = chosen ? [chosen[0] * W, chosen[1] * H, (chosen[0] + chosen[2]) * W, (chosen[1] + chosen[3]) * H] : [0, 0, W, H];
    const aq = [], add = (code, level, msg, fix = null) => aq.push({ code, level, msg, fix });
    if (ink < 0.0006) add('blank', 'info', '빈 페이지 의심');
    else {
      if (Math.abs(tilt) >= 2) add('bigtilt', 'warn', `기울기 ${tilt > 0 ? '+' : ''}${tilt.toFixed(1)}° 보정됨 · 회전 확인`);
      if (cb2) {
        const tx = W * 0.004, ty = H * 0.004;
        const sides = [['좌', cb2[0] - r[0] < tx], ['우', r[2] - cb2[2] < tx], ['상', cb2[1] - r[1] < ty], ['하', r[3] - cb2[3] < ty]].filter(s => s[1]).map(s => s[0]);
        if (sides.length) add('touch', 'error', `내용이 가장자리에 닿음 (${sides.join('·')}) · 잘림 확인`, mode !== 'paper' ? 'mode_paper' : 'crop');
      }
      const rx0 = Math.floor(Math.max(0, r[0])), ry0 = Math.floor(Math.max(0, r[1])), rx1 = Math.floor(Math.min(W, r[2])), ry1 = Math.floor(Math.min(H, r[3]));
      if (rx1 - rx0 > 20 && ry1 - ry0 > 20) {
        const b2 = Math.max(2, Math.floor(Math.min(rx1 - rx0, ry1 - ry0) * 0.006));
        const dk = [['좌', [rx0 + 1, ry0, rx0 + b2 + 1, ry1]], ['우', [rx1 - b2 - 1, ry0, rx1 - 1, ry1]], ['상', [rx0, ry0 + 1, rx1, ry0 + b2 + 1]], ['하', [rx0, ry1 - b2 - 1, rx1, ry1 - 1]]]
          .filter(([, q]) => mean(a, W, H, q[0], q[1], q[2], q[3]) < 100).map(s => s[0]);
        if (dk.length) add('dark', 'warn', `검은 테두리 남음 (${dk.join('·')})`, 'crop');
      }
      if (fullPaper && Object.values(dark).some(Boolean)) add('nopaper', 'warn', '용지 경계를 찾지 못함 · 크롭 확인', 'crop');
      if (W > H * 1.05) add('landscape', 'info', '가로 문서 · 방향 확인');
    }
    res.auto.qc = aq;
    if (cb) { const mm = (cb[0] + (w - cb[2])) / 2; res.balance = [(cb[0] - mm) / w, 0, (cb[2] - cb[0] + 2 * mm) / w, 1]; }
    return res;
  }

  const SIDE = { l: '좌', r: '우', t: '상', b: '하' };
  function qc(hp, orig, cfg) {
    cfg = cfg || {}; const Wn = [], add = (code, level, msg, fix = null) => Wn.push({ code, level, msg, fix });
    if (!hp) { add('missing', 'warn', '보정본(HP) 파일 없음 · 원본 기준으로 표시 중', 'orig_auto'); return Wn; }
    const an = hp.an, m = hp.meta;
    if (Math.abs(an.skew) >= +(cfg.skew_warn ?? 0.3) && an.skew_conf > 0.02) add('skew', 'warn', `기울기 ${an.skew > 0 ? '+' : ''}${an.skew.toFixed(2)}° 감지`, 'tilt');
    const dk = Object.keys(an.dark).filter(k => an.dark[k]).map(k => SIDE[k]);
    if (dk.length) add('dark', 'warn', `검은 테두리 남음 (${dk.join('·')})`, 'paper');
    const tc = Object.keys(an.touch).filter(k => an.touch[k]).map(k => SIDE[k]);
    if (tc.length) add('touch', 'error', `내용이 가장자리에 닿음 (${tc.join('·')}) · 잘림 의심`, 'orig_auto');
    const c = an.content;
    if (c) { const lm = c[0], rm = 1 - c[0] - c[2], mx = Math.max(lm, rm);
      if (mx > 0.02 && Math.abs(lm - rm) > 0.03 && Math.min(lm, rm) / mx < 0.6) add('margin', 'info', `좌우 여백 불균형 L ${(lm * 100).toFixed(1)}% / R ${(rm * 100).toFixed(1)}%`, 'balance'); }
    if (orig) {
      const om = orig.meta;
      if ((m.w > m.h) !== (om.w > om.h)) add('orient', 'warn', '가로·세로 방향이 원본과 다름 · 회전 확인');
      else {
        const ratio = (m.w * m.h) / Math.max(1, om.w * om.h);
        if (ratio < 0.75) { if (cfg.auto_mode === 'content') add('small', 'info', `원본 대비 면적 ${Math.round(ratio * 100)}% (내용+여백 모드)`); else add('small', 'error', `원본 대비 면적 ${Math.round(ratio * 100)}% · 크롭 과다 의심`, 'orig_auto'); }
        else if (ratio > 1.03) add('big', 'info', `원본보다 큼 (${Math.round(ratio * 100)}%)`);
      }
      if (m.dpi && om.dpi && Math.abs(m.dpi[0] - om.dpi[0]) > 1) add('dpi', 'info', `DPI 다름 · HP ${Math.round(m.dpi[0])} / 원본 ${Math.round(om.dpi[0])}`);
      if (m.mode !== om.mode) add('mode', 'info', `색상 모드 다름 · HP ${m.mode} / 원본 ${om.mode}`);
    }
    if (an.ink < 0.0006) add('blank', 'info', '빈 페이지 의심');
    return Wn;
  }

  const Analyze = { analyze, qc, rotate, paperBox, estimateSkew };
  if (typeof module === 'object' && module.exports) module.exports = Analyze; else root.Analyze = Analyze;
}
ScanQCAnalyzeModule(typeof self !== 'undefined' ? self : globalThis);
