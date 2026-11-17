/* حاسبة الإنارة — منطق الحساب (طريقة اللومن)
 * Pure functions, no DOM. Works in the browser (window.LightCalc) and Node (module.exports).
 */
(function (root) {
  'use strict';

  // Typical design illuminance values (lux). Editable defaults, not a cited standard.
  var ROOM_PRESETS = {
    living: 150, bedroom: 100, kitchen: 300, office: 500,
    bathroom: 200, corridor: 100, shop: 500, classroom: 300
  };

  var DEFAULTS = {
    lux: 150,          // required average illuminance on the working plane
    efficacy: 100,     // lm per W (typical for modern LED fixtures)
    workPlane: 0.75,   // m, working plane height above floor
    mf: 0.8,           // maintenance factor
    uf: null           // null = estimate from room index
  };

  var LIMITS = {
    watts: [0.5, 2000], length: [0.5, 200], width: [0.5, 200], height: [2, 20],
    lux: [10, 3000], efficacy: [10, 250], lumens: [10, 200000],
    workPlane: [0, 2], mf: [0.3, 1], uf: [0.1, 1]
  };

  // Room index K = L*W / (Hm * (L + W)), Hm = mounting height above the working plane.
  function roomIndex(L, W, Hm) { return (L * W) / (Hm * (L + W)); }

  // Simplified utilization factor from room index, for medium wall/ceiling reflectances
  // and general-purpose fixtures. An approximation: replace with the fixture's UF table when known.
  var UF_STEPS = [
    [0.75, 0.40], [1.0, 0.45], [1.25, 0.50], [1.5, 0.55],
    [2.0, 0.60], [2.5, 0.65], [3.0, 0.68], [Infinity, 0.70]
  ];
  function estimateUF(K) {
    for (var i = 0; i < UF_STEPS.length; i++) if (K < UF_STEPS[i][0]) return UF_STEPS[i][1];
    return 0.70;
  }

  function num(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === 'number') return v;
    var s = String(v).trim()
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/[٫,]/g, '.');
    if (s === '' || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return NaN;
    return parseFloat(s);
  }

  /**
   * input: { watts, length, width, height, lux?, efficacy?, lumensPerFixture?, useLumens?,
   *          workPlane?, mf?, uf? }
   * returns { ok:true, ...results } or { ok:false, errors:{ field: code } }
   * error codes: 'required' | 'nan' | 'range' | 'height_low'
   */
  function calculate(input) {
    var errors = {};
    var v = {};
    function take(key, required, fallback) {
      var raw = input[key];
      var empty = raw === undefined || raw === null || String(raw).trim() === '';
      if (empty) {
        if (required) { errors[key] = 'required'; return; }
        v[key] = fallback; return;
      }
      var n = num(raw);
      if (isNaN(n)) { errors[key] = 'nan'; return; }
      var lim = LIMITS[key];
      if (lim && (n < lim[0] || n > lim[1])) { errors[key] = 'range'; return; }
      v[key] = n;
    }
    var useLumens = !!input.useLumens;
    if (useLumens) take('lumens', true); else take('watts', true);
    if (useLumens) take('watts', false, null);
    take('length', true); take('width', true); take('height', true);
    take('lux', false, DEFAULTS.lux);
    take('efficacy', false, DEFAULTS.efficacy);
    take('workPlane', false, DEFAULTS.workPlane);
    take('mf', false, DEFAULTS.mf);
    take('uf', false, DEFAULTS.uf);

    if (!errors.height && !errors.workPlane && v.height !== undefined &&
        v.height - v.workPlane < 0.3) errors.height = 'height_low';
    if (Object.keys(errors).length) return { ok: false, errors: errors };

    var area = v.length * v.width;
    var hm = v.height - v.workPlane;
    var K = roomIndex(v.length, v.width, hm);
    var ufAuto = v.uf === null;
    var uf = ufAuto ? estimateUF(K) : v.uf;

    var lumensPerFixture = useLumens ? v.lumens : v.watts * v.efficacy;
    var requiredLumens = (v.lux * area) / (uf * v.mf);      // lamp lumens to install
    var count = Math.max(1, Math.ceil(requiredLumens / lumensPerFixture - 1e-9));
    var installedLumens = count * lumensPerFixture;
    var achievedLux = (installedLumens * uf * v.mf) / area;
    var totalWatts = v.watts ? count * v.watts : null;

    return {
      ok: true,
      length: v.length, width: v.width, height: v.height, workPlane: v.workPlane,
      area: area, roomIndex: K, mountingHeight: hm, uf: uf, ufAuto: ufAuto, mf: v.mf,
      lux: v.lux, efficacy: useLumens ? null : v.efficacy,
      lumensPerFixture: lumensPerFixture,
      requiredLumens: requiredLumens,
      count: count,
      installedLumens: installedLumens,
      achievedLux: achievedLux,
      totalWatts: totalWatts,
      wattsPerM2: totalWatts === null ? null : totalWatts / area
    };
  }

  /**
   * Even ceiling grid for `count` fixtures in an L (x) × W (y) room.
   * Each fixture sits at the centre of an equal cell, so the wall gap is half the spacing.
   * Chooses rows × cols to keep spacing in both directions as equal as possible while
   * adding as few extra fixtures as possible (a regular grid may need rows*cols > count).
   */
  function layout(count, L, W) {
    var best = null;
    for (var r = 1; r <= count; r++) {
      var c = Math.ceil(count / r);
      var sx = L / c, sy = W / r;
      var ratio = Math.max(sx, sy) / Math.min(sx, sy);
      var extra = r * c - count;
      var score = extra / count * 4 + (ratio - 1);
      if (!best || score < best.score - 1e-9) best = { rows: r, cols: c, sx: sx, sy: sy, ratio: ratio, extra: extra, score: score };
    }
    var pts = [];
    for (var i = 0; i < best.rows; i++)
      for (var j = 0; j < best.cols; j++)
        pts.push({ x: (j + 0.5) * best.sx, y: (i + 0.5) * best.sy });
    return {
      rows: best.rows, cols: best.cols, total: best.rows * best.cols, extra: best.extra,
      spacingX: best.sx, spacingY: best.sy, edgeX: best.sx / 2, edgeY: best.sy / 2,
      ratio: best.ratio, points: pts
    };
  }

  function gridPoints(rows, cols, L, W, stagger) {
    var pts = [], sx = L / cols, sy = W / rows;
    for (var i = 0; i < rows; i++) {
      var odd = stagger && i % 2 === 1 && cols > 1;
      var n = odd ? cols - 1 : cols;
      for (var j = 0; j < n; j++) pts.push({ x: (j + (odd ? 1 : 0.5)) * sx, y: (i + 0.5) * sy });
    }
    return pts;
  }

  // Points evenly spaced along a rectangle inset `inset` metres from the walls.
  function perimeterPoints(n, L, W, inset) {
    var w = L - 2 * inset, h = W - 2 * inset;
    if (w <= 0 || h <= 0) return null;
    var per = 2 * (w + h), step = per / n, pts = [];
    for (var k = 0; k < n; k++) {
      var d = (k + 0.5) * step, x, y;
      if (d < w) { x = inset + d; y = inset; }
      else if (d < w + h) { x = inset + w; y = inset + (d - w); }
      else if (d < 2 * w + h) { x = inset + w - (d - w - h); y = inset + h; }
      else { x = inset; y = inset + h - (d - 2 * w - h); }
      pts.push({ x: x, y: y });
    }
    return pts;
  }

  /**
   * kind: 'auto' | 'grid' | 'stagger' | 'perimeter' | 'free'
   * o: { count, rows, cols, n, inset, free:[{fx,fy}] (fractions of L and W) }
   */
  function arrange(kind, L, W, o) {
    o = o || {};
    var res;
    if (kind === 'grid' || kind === 'stagger') {
      var rows = Math.max(1, Math.round(o.rows || 1)), cols = Math.max(1, Math.round(o.cols || 1));
      res = { rows: rows, cols: cols, spacingX: L / cols, spacingY: W / rows, edgeX: L / cols / 2, edgeY: W / rows / 2,
              points: gridPoints(rows, cols, L, W, kind === 'stagger') };
    } else if (kind === 'perimeter') {
      var n = Math.max(1, Math.round(o.n || o.count || 1));
      var inset = Math.min(Math.max(o.inset || 0, 0.05), Math.min(L, W) / 2 - 0.05);
      var pts = perimeterPoints(n, L, W, inset);
      res = { inset: inset, points: pts || [{ x: L / 2, y: W / 2 }] };
    } else if (kind === 'free' && o.free && o.free.length) {
      res = { points: o.free.map(function (p) {
        return { x: Math.min(Math.max(p.fx, 0), 1) * L, y: Math.min(Math.max(p.fy, 0), 1) * W };
      }) };
    } else {
      res = o.exact ? layoutExact(Math.max(1, Math.round(o.count || 1)), L, W) : layout(o.count || 1, L, W);
      kind = 'auto';
    }
    res.kind = kind;
    res.total = res.points.length;
    return res;
  }

  // Generic spacing checks for any set of points.
  function metrics(points, L, W) {
    var minWall = Infinity, nn = [];
    points.forEach(function (p, i) {
      minWall = Math.min(minWall, p.x, L - p.x, p.y, W - p.y);
      var best = Infinity;
      points.forEach(function (q, j) { if (i !== j) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y)); });
      if (best < Infinity) nn.push(best);
    });
    return {
      minWall: minWall,
      minSpacing: nn.length ? Math.min.apply(null, nn) : null,
      maxSpacing: nn.length ? Math.max.apply(null, nn) : null
    };
  }

  // ---------- Furniture (illustration only) ----------
  // Each type: footprint w × d (m). Parts are boxes in local coords: front edge at y=0, back (against a wall) at y=d.
  // [x0, y0, x1, y1, z0, z1, colourKey]; negative/fractional helpers resolved by partsFor().
  function legs(w, d, h, c) { var t = 0.05; return [[0,0,t,t,0,h,c],[w-t,0,w,t,0,h,c],[0,d-t,t,d,0,h,c],[w-t,d-t,w,d,0,h,c]]; }
  var FURN = {
    sofa:      { w: 2.0, d: 0.9, parts: function (w, d) { return [[0,0,w,d,0,0.45,'fabric'],[0,d-0.22,w,d,0.45,0.85,'fabric'],[0,0,0.18,d,0.45,0.62,'fabric'],[w-0.18,0,w,d,0.45,0.62,'fabric']]; } },
    armchair:  { w: 0.85, d: 0.85, parts: function (w, d) { return [[0,0,w,d,0,0.45,'fabric'],[0,d-0.2,w,d,0.45,0.85,'fabric'],[0,0,0.15,d,0.45,0.62,'fabric'],[w-0.15,0,w,d,0.45,0.62,'fabric']]; } },
    coffeeTable:{ w: 1.1, d: 0.6, parts: function (w, d) { return legs(w, d, 0.38, 'wood').concat([[0,0,w,d,0.38,0.44,'wood']]); } },
    tvUnit:    { w: 1.6, d: 0.45, parts: function (w, d) { return [[0,0,w,d,0,0.5,'woodLight'],[0.2,d-0.08,w-0.2,d-0.03,0.6,1.25,'screen']]; } },
    rug:       { w: 2.4, d: 1.7, flat: true, parts: function (w, d) { return [[0,0,w,d,0,0.01,'rug']]; } },
    plant:     { w: 0.45, d: 0.45, parts: function (w, d) { return [[0.08,0.08,w-0.08,d-0.08,0,0.4,'pot'],[0,0,w,d,0.4,1.1,'green']]; } },
    bed:       { w: 1.6, d: 2.05, parts: function (w, d) { return [[0,0,w,d-0.05,0,0.3,'wood'],[0.03,0,w-0.03,d-0.08,0.3,0.55,'white'],[0.03,0,w-0.03,d*0.6,0.3,0.57,'blanket'],[0.1,d-0.5,w-0.1,d-0.12,0.55,0.66,'white'],[0,d-0.06,w,d,0,1.1,'wood']]; } },
    nightstand:{ w: 0.5, d: 0.42, parts: function (w, d) { return [[0,0,w,d,0,0.55,'wood']]; } },
    wardrobe:  { w: 1.8, d: 0.6, parts: function (w, d) { return [[0,0,w,d,0,2.2,'woodLight']]; } },
    dresser:   { w: 1.2, d: 0.5, parts: function (w, d) { return [[0,0,w,d,0,0.8,'wood']]; } },
    counter:   { w: 2.4, d: 0.62, parts: function (w, d) { return [[0,0,w,d,0,0.86,'white'],[0,0,w,d,0.86,0.9,'dark'],[0,d-0.35,w,d,1.45,2.15,'white']]; } },
    fridge:    { w: 0.7, d: 0.7, parts: function (w, d) { return [[0,0,w,d,0,1.85,'grey']]; } },
    table:     { w: 1.4, d: 0.85, parts: function (w, d) { return legs(w, d, 0.71, 'wood').concat([[0,0,w,d,0.71,0.75,'wood']]); } },
    chair:     { w: 0.45, d: 0.5, parts: function (w, d) { return legs(w, 0.45, 0.42, 'dark').concat([[0,0,w,0.45,0.42,0.47,'dark'],[0,d-0.05,w,d,0.42,0.9,'dark']]); } },
    desk:      { w: 1.4, d: 0.7, parts: function (w, d) { return [[0,0,0.04,d,0,0.71,'woodLight'],[w-0.04,0,w,d,0,0.71,'woodLight'],[0,0,w,d,0.71,0.75,'woodLight']]; } },
    studentDesk:{ w: 1.2, d: 0.5, parts: function (w, d) { return [[0,0,0.04,d,0,0.71,'woodLight'],[w-0.04,0,w,d,0,0.71,'woodLight'],[0,0,w,d,0.71,0.75,'woodLight']]; } },
    cabinet:   { w: 0.9, d: 0.45, parts: function (w, d) { return [[0,0,w,d,0,1.9,'grey']]; } },
    tub:       { w: 1.7, d: 0.75, parts: function (w, d) { return [[0,0,w,d,0,0.55,'white']]; } },
    vanity:    { w: 0.9, d: 0.5, parts: function (w, d) { return [[0,0,w,d,0,0.82,'wood'],[0,0,w,d,0.82,0.86,'white'],[0.1,d-0.03,w-0.1,d,1.1,1.9,'mirror']]; } },
    toilet:    { w: 0.4, d: 0.68, parts: function (w, d) { return [[0,0,w,d-0.2,0,0.42,'white'],[0.02,d-0.2,w-0.02,d,0,0.8,'white']]; } },
    console:   { w: 1.0, d: 0.35, parts: function (w, d) { return [[0,0,w,d,0,0.8,'wood']]; } },
    shelf:     { w: 1.0, d: 0.4, parts: function (w, d) { return [[0,0,w,d,0,2.0,'woodLight']]; } },
    shopCounter:{ w: 1.6, d: 0.6, parts: function (w, d) { return [[0,0,w,d,0,1.0,'dark']]; } },
    board:     { w: 2.4, d: 0.05, parts: function (w, d) { return [[0,0,w,d,0.9,2.1,'board']]; } }
  };

  // size after rotation (rot: 0 back→+y, 1 back→-x, 2 back→-y, 3 back→+x)
  function pieceSize(p) {
    var f = FURN[p.type], w = p.w || f.w, d = p.d || f.d;
    return p.rot % 2 ? { w: d, d: w } : { w: w, d: d };
  }
  // World-space boxes {x0,y0,x1,y1,z0,z1,c} of a placed piece (x, y = centre, metres)
  function pieceBoxes(p) {
    var f = FURN[p.type], w = p.w || f.w, d = p.d || f.d, out = [];
    f.parts(w, d).forEach(function (q) {
      var corners = [[q[0], q[1]], [q[2], q[3]]].map(function (c) {
        var lx = c[0] - w / 2, ly = c[1] - d / 2, x, y;
        switch (p.rot % 4) { case 1: x = -ly; y = lx; break; case 2: x = -lx; y = -ly; break; case 3: x = ly; y = -lx; break; default: x = lx; y = ly; }
        return [x + p.x, y + p.y];
      });
      out.push({ x0: Math.min(corners[0][0], corners[1][0]), x1: Math.max(corners[0][0], corners[1][0]),
                 y0: Math.min(corners[0][1], corners[1][1]), y1: Math.max(corners[0][1], corners[1][1]), z0: q[4], z1: q[5], c: q[6] });
    });
    return out;
  }
  function clampPiece(p, L, W) {
    var s = pieceSize(p);
    p.x = Math.min(Math.max(p.x, s.w / 2), L - s.w / 2);
    p.y = Math.min(Math.max(p.y, s.d / 2), W - s.d / 2);
    return p;
  }

  // Default furniture for a room type. Pieces that do not fit, or overlap earlier ones, are left out.
  function furnitureLayout(set, L, W) {
    var want = [], g = 0.05; // wall gap
    function at(type, x, y, rot, size) { var p = { type: type, x: x, y: y, rot: rot || 0 }; if (size) { p.w = size.w; p.d = size.d; } want.push(p); }
    function backY(t) { return W - FURN[t].d / 2 - g; }
    var cx = L / 2, cy = W / 2;
    switch (set) {
      case 'bedroom':
        at('bed', cx, backY('bed'));
        at('nightstand', cx - 0.8 - 0.3, backY('nightstand')); at('nightstand', cx + 0.8 + 0.3, backY('nightstand'));
        at('wardrobe', FURN.wardrobe.d / 2 + g, Math.max(cy - 0.6, FURN.wardrobe.w / 2 + g), 1);
        at('dresser', L - FURN.dresser.d / 2 - g, cy - 0.4, 3);
        at('rug', cx, W - 2.05 - 0.5, 0, { w: Math.min(2.0, L * 0.45), d: 0.9 });
        break;
      case 'kitchen':
        var cw = Math.max(1.2, Math.min(L - 0.9 - 0.2, 3.6));
        at('counter', g + cw / 2, backY('counter'), 0, { w: cw, d: 0.62 });
        at('fridge', g + cw + 0.1 + 0.35, backY('fridge'));
        at('table', cx, cy - 0.3); at('chair', cx - 0.35, cy - 0.3 - 0.7, 2); at('chair', cx + 0.35, cy - 0.3 - 0.7, 2);
        at('chair', cx - 0.35, cy - 0.3 + 0.7, 0); at('chair', cx + 0.35, cy - 0.3 + 0.7, 0);
        break;
      case 'office':
        var n = Math.max(1, Math.min(6, Math.floor(L * W / 8))), cols = Math.min(n, Math.max(1, Math.floor((L - 1.2) / 1.7))), rows = Math.ceil(n / cols);
        for (var i = 0; i < n; i++) {
          var r = Math.floor(i / cols), c = i % cols, x = (L - 1.0) * (c + 0.5) / cols + 0.1, y = W - 1.0 - r * 1.8;
          at('desk', x, y); at('chair', x, y - 0.6, 2);
        }
        at('cabinet', L - FURN.cabinet.d / 2 - g, W - 0.6, 3);
        break;
      case 'bathroom':
        at('tub', FURN.tub.w / 2 + g, backY('tub'));
        at('vanity', L - FURN.vanity.d / 2 - g, cy, 3);
        at('toilet', FURN.toilet.d / 2 + g, Math.max(0.6, cy - 0.9), 1);
        break;
      case 'corridor':
        at('console', FURN.console.d / 2 + g, cy, 1);
        at('plant', 0.3, W - 0.3); at('plant', L - 0.3, W - 0.3);
        break;
      case 'shop':
        at('shopCounter', cx, backY('shopCounter'));
        for (var s1 = 0.6; s1 + 0.5 < W - 0.8; s1 += 1.1) { at('shelf', FURN.shelf.d / 2 + g, s1 + 0.5, 1); at('shelf', L - FURN.shelf.d / 2 - g, s1 + 0.5, 3); }
        break;
      case 'classroom':
        at('board', cx, W - 0.03 - g);
        at('desk', cx, W - 1.1, 2);
        var dc = Math.max(1, Math.floor((L - 0.6) / 1.5)), dr = Math.max(1, Math.floor((W - 2.2) / 1.25));
        for (var a = 0; a < dr; a++) for (var b = 0; b < dc; b++) {
          var xx = (L - 0.4) * (b + 0.5) / dc + 0.2, yy = W - 2.2 - a * 1.25;
          at('studentDesk', xx, yy); at('chair', xx, yy - 0.55, 2);
        }
        break;
      default: // living
        at('rug', cx, cy + 0.2, 0, { w: Math.min(2.4, L * 0.55), d: Math.min(1.7, W * 0.45) });
        at('sofa', cx, backY('sofa'));
        at('coffeeTable', cx, W - 0.9 - g - 0.45 - 0.3);
        at('armchair', Math.min(L - 0.5, cx + 1.45), W - 0.9 - g - 0.45 - 0.3, 3);
        at('tvUnit', FURN.tvUnit.d / 2 + g, W - 0.9 - g - 0.75, 1);
        at('plant', L - 0.3, W - 0.3);
    }
    var placed = [];
    want.forEach(function (p) {
      var s = pieceSize(p);
      if (s.w > L - 2 * g + 1e-9 || s.d > W - 2 * g + 1e-9) return;
      clampPiece(p, L, W);
      if (!FURN[p.type].flat) {
        var hit = placed.some(function (q) {
          if (FURN[q.type].flat) return false;
          var t = pieceSize(q);
          return Math.abs(p.x - q.x) < (s.w + t.w) / 2 - 1e-6 && Math.abs(p.y - q.y) < (s.d + t.d) / 2 - 1e-6;
        });
        if (hit) return;
      }
      placed.push(p);
    });
    return placed;
  }

  // Diameter of the light spot a fixture with beam angle `deg` makes at distance h (metres).
  function spotDiameter(h, deg) { return 2 * Math.max(h, 0) * Math.tan(Math.min(Math.max(deg, 1), 179) * Math.PI / 360); }
  // Do the light spots cover the area between the fixtures at the working plane?
  // Samples the box spanned by the fixtures and finds the point farthest from its nearest fixture.
  function beamCoverage(points, L, W, h, deg) {
    var dia = spotDiameter(h, deg), r = dia / 2;
    if (points.length < 2) return { dia: dia, maxDist: null, gaps: false };
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    points.forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    var n = 40, worst = 0;
    for (var i = 0; i <= n; i++) for (var j = 0; j <= n; j++) {
      var x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * j / n, best = Infinity;
      for (var k = 0; k < points.length; k++) best = Math.min(best, Math.hypot(points[k].x - x, points[k].y - y));
      worst = Math.max(worst, best);
    }
    return { dia: dia, maxDist: worst, gaps: worst > r + 1e-9 };
  }

  // Grid with exactly n fixtures: full rows of `cols`, the last row centred with the same spacing.
  function layoutExact(n, L, W) {
    var best = null;
    for (var r = 1; r <= n; r++) {
      var c = Math.ceil(n / r);
      if ((r - 1) * c >= n) continue; // would leave an empty row
      var sx = L / c, sy = W / r, ratio = Math.max(sx, sy) / Math.min(sx, sy);
      var score = ratio + (r * c - n) / c; // prefer even spacing, then a fuller last row
      if (!best || score < best.score - 1e-9) best = { rows: r, cols: c, sx: sx, sy: sy, ratio: ratio, score: score };
    }
    var pts = [], left = n;
    for (var i = 0; i < best.rows; i++) {
      var k = Math.min(best.cols, left), off = (best.cols - k) / 2;
      for (var j = 0; j < k; j++) pts.push({ x: (j + off + 0.5) * best.sx, y: (i + 0.5) * best.sy });
      left -= k;
    }
    return { rows: best.rows, cols: best.cols, total: n, extra: 0, partial: n % best.cols !== 0,
             spacingX: best.sx, spacingY: best.sy, edgeX: best.sx / 2, edgeY: best.sy / 2, ratio: best.ratio, points: pts };
  }

  // ---------- Doors and windows on the walls ----------
  // wall: 'front' (y=0), 'back' (y=W), 'left' (x=0), 'right' (x=L); p = centre along the wall as a fraction.
  function wallLen(wall, L, W) { return wall === 'left' || wall === 'right' ? W : L; }
  function clampOpening(o, L, W, Hw) {
    var len = wallLen(o.wall, L, W), q = Object.assign({}, o);
    q.w = Math.min(Math.max(q.w, 0.3), len - 0.1);
    if (q.type === 'door') { q.sill = 0; q.h = Math.min(Math.max(q.h, 1.5), Hw - 0.05); }
    else { q.h = Math.min(Math.max(q.h, 0.3), Hw - 0.1); q.sill = Math.min(Math.max(q.sill, 0), Hw - q.h - 0.05); }
    var c = Math.min(Math.max(q.p * len, q.w / 2 + 0.05), len - q.w / 2 - 0.05);
    q.p = c / len;
    return q;
  }
  function openingSpan(o, L, W) { // ends of the opening on its wall, in room metres
    var len = wallLen(o.wall, L, W), a = o.p * len - o.w / 2, b = o.p * len + o.w / 2;
    if (o.wall === 'front') return { x0: a, y0: 0, x1: b, y1: 0 };
    if (o.wall === 'back') return { x0: a, y0: W, x1: b, y1: W };
    if (o.wall === 'left') return { x0: 0, y0: a, x1: 0, y1: b };
    return { x0: L, y0: a, x1: L, y1: b };
  }
  function nearestWall(x, y, L, W) {
    var d = [['front', y], ['back', W - y], ['left', x], ['right', L - x]].sort(function (a, b) { return a[1] - b[1]; })[0][0];
    return { wall: d, p: d === 'left' || d === 'right' ? y / W : x / L };
  }

  // ---------- Direct illuminance on the working plane (point-by-point) ----------
  // Beam profile: full intensity inside 85% of the half-angle, smooth fall-off to zero at 115%.
  function beamProfile(theta, half) {
    if (half == null) return 1; // isotropic source
    var a = half * 0.85, b = Math.min(half * 1.15, Math.PI / 2);
    if (theta <= a) return 1;
    if (theta >= b) return 0;
    return 0.5 + 0.5 * Math.cos(Math.PI * (theta - a) / (b - a));
  }
  // Peak intensity (cd) so the profile carries exactly `lm` lumens.
  function peakCandela(lm, half) {
    if (half == null) return lm / (4 * Math.PI);
    var n = 400, sum = 0, top = Math.min(half * 1.15, Math.PI / 2);
    for (var i = 0; i < n; i++) { var t = (i + 0.5) * top / n; sum += beamProfile(t, half) * 2 * Math.PI * Math.sin(t) * top / n; }
    return lm / sum;
  }
  /**
   * sources: [{x, y, z, lm, half (radians, null = all directions, downward-facing spots otherwise)}]
   * returns { nx, ny, lux: Float32Array (row-major, y rows), min, max, avg, u0 }
   */
  function illuminanceGrid(sources, L, W, hPlane, nx, ny, mf) {
    mf = mf == null ? 1 : mf;
    var srcs = sources.map(function (s) { return { x: s.x, y: s.y, z: s.z, half: s.half, I0: peakCandela(s.lm, s.half) }; });
    var lux = new Float32Array(nx * ny), min = Infinity, max = 0, sum = 0;
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var x = (i + 0.5) * L / nx, y = (j + 0.5) * W / ny, e = 0;
      for (var k = 0; k < srcs.length; k++) {
        var s = srcs[k], dz = s.z - hPlane; if (dz <= 0) continue;
        var dx = x - s.x, dy = y - s.y, d2 = dx * dx + dy * dy + dz * dz, d = Math.sqrt(d2), cos = dz / d;
        e += s.I0 * beamProfile(Math.acos(cos), s.half) * cos / d2;
      }
      e *= mf; lux[j * nx + i] = e; sum += e; if (e < min) min = e; if (e > max) max = e;
    }
    var avg = sum / (nx * ny);
    return { nx: nx, ny: ny, lux: lux, min: min, max: max, avg: avg, u0: avg > 0 ? min / avg : 0 };
  }

  var api = { calculate: calculate, layout: layout, arrange: arrange, metrics: metrics, roomIndex: roomIndex, estimateUF: estimateUF,
              parseNumber: num, illuminanceGrid: illuminanceGrid, peakCandela: peakCandela, beamProfile: beamProfile, layoutExact: layoutExact, clampOpening: clampOpening, openingSpan: openingSpan, nearestWall: nearestWall, wallLen: wallLen, spotDiameter: spotDiameter, beamCoverage: beamCoverage, FURN: FURN, furnitureLayout: furnitureLayout, pieceBoxes: pieceBoxes, pieceSize: pieceSize, clampPiece: clampPiece, ROOM_PRESETS: ROOM_PRESETS, DEFAULTS: DEFAULTS, LIMITS: LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LightCalc = api;
})(this);
