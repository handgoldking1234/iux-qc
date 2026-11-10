/* ScanQC Web · 이미지 읽기/쓰기 (브라우저 안에서 처리 — 파일이 서버로 가지 않음)
   읽기: TIFF(UTIF.js) · JPEG/PNG/BMP(브라우저 내장)   쓰기: TIFF(LZW·G4·Deflate·PackBits·무압축) · PNG · BMP · JPEG
   원본의 DPI·색상 모드·압축 방식을 그대로 유지해서 저장한다. */
(function (root) {
  'use strict';
  const UT = root.UTIF || (typeof require === 'function' ? require('utif') : null);
  /* TIFF 압축 풀기를 뒤쪽 작업 스레드 2개에서 (화면이 멈추지 않고, 원본·보정본을 동시에) · 안 되면 화면 스레드에서 */
  const VENDOR = (() => { try { const s = typeof document !== 'undefined' && document.currentScript && document.currentScript.src; return s ? new URL('../vendor/', s).href : ''; } catch (e) { return ''; } })();
  const SELF_SRC = (() => { try { return (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || ''; } catch (e) { return ''; } })();
  let TW = null, twid = 0, EW = null, WURL = ''; const twcb = new Map();
  function tiffWorkers() {
    if (TW !== null) return TW;
    TW = false;
    try {
      if (!VENDOR || typeof Worker !== 'function' || /^file:/.test(VENDOR)) return TW;
      const src = `importScripts(${JSON.stringify(VENDOR + 'pako.min.js')},${JSON.stringify(VENDOR + 'UTIF.js')}${SELF_SRC ? ',' + JSON.stringify(SELF_SRC) : ''});
function edges(d,W,H){const D=Math.max(1,Math.min(260,Math.floor(Math.min(W,H)/4)));
const strip=(x0,y0,w,h,hz,rev)=>{const n=hz?h:w,len=hz?w:h,a=new Uint8Array(n*len);for(let k=0;k<n;k++){const q=rev?n-1-k:k;for(let t=0;t<len;t++){const i=(hz?(y0+q)*W+x0+t:(y0+t)*W+x0+q)*4;a[k*len+t]=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000+.5}}return{D:n,len,a}};
return{t:strip(0,0,W,D,true,false),b:strip(0,H-D,W,D,true,true),l:strip(0,0,D,H,false,false),r:strip(W-D,0,D,H,false,true)}}
function boxDown(d,W,H,f){const w=Math.floor(W/f),h=Math.floor(H/f),o=new Uint8ClampedArray(w*h*4),inv=1/(f*f),R=new Float32Array(w),G=new Float32Array(w),B=new Float32Array(w);
for(let y=0;y<h;y++){R.fill(0);G.fill(0);B.fill(0);for(let yy=0;yy<f;yy++){let i=(y*f+yy)*W*4;for(let x=0;x<w;x++){let r=0,g=0,b=0;for(let xx=0;xx<f;xx++,i+=4){r+=d[i];g+=d[i+1];b+=d[i+2]}R[x]+=r;G[x]+=g;B[x]+=b}}
let j=y*w*4;for(let x=0;x<w;x++,j+=4){o[j]=R[x]*inv;o[j+1]=G[x]*inv;o[j+2]=B[x]*inv;o[j+3]=255}}return{w,h,data:o}}
onmessage=e=>{const {id,buf,opt,enc}=e.data;
if(enc){Codec.encode(enc.rgba,enc.w,enc.h,enc.ref,enc.name).then(b=>postMessage({id,bytes:b.buffer,off:b.byteOffset,len:b.length},[b.buffer]),err=>postMessage({id,err:String(err&&err.message||err)}));return}
try{const ifds=UTIF.decode(buf),ifd=ifds.find(d=>d.t256)||ifds[0];if(!ifd)throw new Error('TIFF 이미지를 읽을 수 없습니다');
const tags={};for(const k in ifd)if(k[0]==='t')tags[k]=ifd[k];if(ifd.t259&&ifd.t259[0]===7){postMessage({id,jpeg:true,tags});return}
UTIF.decodeImage(buf,ifd,ifds);const rgba=UTIF.toRGBA8(ifd),W=ifd.width,H=ifd.height;
if(opt){const f=Math.max(1,Math.floor(Math.max(W,H)/opt.prevMax)),pv=f>=2?boxDown(rgba,W,H,f):null,ed=edges(rgba,W,H),tr=[];if(pv)tr.push(pv.data.buffer);
const full=(opt.keep||!pv)?{buf:rgba.buffer,off:rgba.byteOffset,len:rgba.length}:null;if(full)tr.push(rgba.buffer);
postMessage({id,tags,w:W,h:H,prev:pv?{w:pv.w,h:pv.h,data:pv.data}:null,edges:ed,full},tr);return}
postMessage({id,tags,w:W,h:H,rgba:rgba.buffer,off:rgba.byteOffset,len:rgba.length},[rgba.buffer])}
catch(err){postMessage({id,err:String(err&&err.message||err)})}}`;
      const url = WURL = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const fail = () => { TW = false; for (const [k, c] of twcb) { twcb.delete(k); c(null); } };
      const nw = Math.max(2, Math.min(6, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1));  // 코어 수에 맞춰 작업 스레드
      TW = Array.from({ length: nw }, () => { const w = new Worker(url); w.n = 0; w.onmessage = e => { w.n--; const c = twcb.get(e.data.id); if (c) { twcb.delete(e.data.id); c(e.data); } }; w.onerror = fail; return w; });
    } catch (e) { TW = false; }
    return TW;
  }
  function tiffInWorker(buf, opt) {
    const ws = tiffWorkers(); if (!ws) return Promise.resolve(null);
    const w = ws.reduce((a, b) => b.n < a.n ? b : a), id = ++twid; w.n++;
    return new Promise(res => { twcb.set(id, res); try { w.postMessage({ id, buf, opt: opt || null }); } catch (e) { twcb.delete(id); w.n--; res(null); } });
  }

  const EXTS = ['.tif', '.tiff', '.jpg', '.jpeg', '.png', '.bmp'];
  const FMT = { '.tif': 'TIFF', '.tiff': 'TIFF', '.jpg': 'JPEG', '.jpeg': 'JPEG', '.png': 'PNG', '.bmp': 'BMP' };
  const extOf = n => { const m = /\.[^.]+$/.exec(n || ''); return m ? m[0].toLowerCase() : ''; };
  const CMP = { 1: 'raw', 2: 'tiff_ccitt', 3: 'group3', 4: 'group4', 5: 'tiff_lzw', 6: 'tiff_jpeg', 7: 'jpeg', 8: 'tiff_adobe_deflate', 32946: 'tiff_deflate', 32773: 'packbits' };

  /* ---------------------------------------------------------------- 메타 정보 */
  function tiffMeta(ifd) {
    const g = (t, d) => (ifd['t' + t] ? ifd['t' + t][0] : d);
    const bps = g(258, 1), spp = g(277, (ifd.t258 || [1]).length), ph = g(262, spp >= 3 ? 2 : 1);
    let mode = 'RGB';
    if (ph === 0 || ph === 1) mode = bps === 1 ? '1' : bps === 16 ? 'I;16' : spp === 2 ? 'LA' : 'L';
    else if (ph === 2) mode = spp >= 4 ? 'RGBA' : 'RGB';
    else if (ph === 3) mode = 'P';
    else if (ph === 5) mode = 'CMYK';
    let dpi = null;
    if (ifd.t282) {
      const u = g(296, 2), f = u === 3 ? 2.54 : 1, x = ifd.t282[0] * f, y = (ifd.t283 ? ifd.t283[0] : ifd.t282[0]) * f;
      if (u !== 1 && x > 0) dpi = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    }
    return { w: g(256, 0), h: g(257, 0), mode, dpi, format: 'TIFF', compression: CMP[g(259, 1)] || 'raw' };
  }
  function jpegMeta(b) {
    let i = 2, dpi = null, mode = 'RGB', w = 0, h = 0;
    while (i + 4 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const m = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
      if (m === 0xE0 && b[i + 4] === 0x4A && b[i + 5] === 0x46) { // JFIF
        const u = b[i + 11], x = (b[i + 12] << 8) | b[i + 13], y = (b[i + 14] << 8) | b[i + 15];
        if (u === 1 && x > 1) dpi = [x, y]; else if (u === 2 && x > 1) dpi = [Math.round(x * 2.54), Math.round(y * 2.54)];
      }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        h = (b[i + 5] << 8) | b[i + 6]; w = (b[i + 7] << 8) | b[i + 8];
        const nc = b[i + 9]; mode = nc === 1 ? 'L' : nc === 4 ? 'CMYK' : 'RGB'; break;
      }
      if (m === 0xDA) break;
      i += 2 + len;
    }
    return { w, h, mode, dpi, format: 'JPEG', compression: null };
  }
  function pngMeta(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const w = dv.getUint32(16), h = dv.getUint32(20), bd = b[24], ct = b[25];
    const mode = ct === 0 ? (bd === 1 ? '1' : bd === 16 ? 'I;16' : 'L') : ct === 2 ? 'RGB' : ct === 3 ? 'P' : ct === 4 ? 'LA' : 'RGBA';
    let dpi = null, i = 8;
    while (i + 12 <= b.length) {
      const len = dv.getUint32(i), t = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      if (t === 'pHYs' && b[i + 16] === 1) dpi = [Math.round(dv.getUint32(i + 8) * 0.0254), Math.round(dv.getUint32(i + 12) * 0.0254)];
      if (t === 'IDAT' || t === 'IEND') break;
      i += 12 + len;
    }
    return { w, h, mode, dpi, format: 'PNG', compression: null };
  }
  function bmpMeta(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const w = dv.getInt32(18, true), h = Math.abs(dv.getInt32(22, true)), bc = dv.getUint16(28, true), xp = dv.getInt32(38, true), yp = dv.getInt32(42, true);
    return { w, h, mode: bc === 1 ? '1' : bc === 8 ? 'L' : 'RGB', dpi: xp > 0 ? [Math.round(xp * 0.0254), Math.round(yp * 0.0254)] : null, format: 'BMP', compression: null };
  }

  /* JPEG 압축 TIFF: 조각(strip/tile)마다 공통 표(JPEGTables)를 붙여 브라우저 JPEG 디코더로 풀기 */
  async function jpegTiff(b, ifd, meta) {
    const w = meta.w, h = meta.h, tiled = !!ifd.t322;
    const offs = tiled ? ifd.t324 : ifd.t273, cnts = tiled ? ifd.t325 : ifd.t279;
    const tw = tiled ? ifd.t322[0] : w, th = tiled ? ifd.t323[0] : (ifd.t278 ? ifd.t278[0] : h), across = Math.ceil(w / tw);
    const tbl = ifd.t347 ? new Uint8Array(ifd.t347) : null;
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    for (let i = 0; i < offs.length; i++) {
      const part = b.subarray(offs[i], offs[i] + cnts[i]);
      const jp = tbl && tbl.length > 4 ? concat([tbl.subarray(0, tbl.length - 2), part.subarray(2)]) : part;
      const bm = await createImageBitmap(new Blob([jp], { type: 'image/jpeg' }));
      ctx.drawImage(bm, (i % across) * tw, Math.floor(i / across) * th); bm.close && bm.close();
    }
    return ctx.getImageData(0, 0, w, h).data;
  }

  /* ---------------------------------------------------------------- 읽기 */
  /* 결과: {meta, rgba(Uint8ClampedArray, w*h*4) | bitmap(ImageBitmap)} */
  /* opt {prevMax, keep}: 작업 스레드에서 미리보기(정수배 평균 축소)·가장자리 띠까지 만들어 옴 → prev·edges, keep 이면 원래 크기 rgba 도 */
  async function decode(buf, name, opt) {
    const b = new Uint8Array(buf), ext = extOf(name);
    const isTiff = (b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4D && b[1] === 0x4D);
    if (isTiff) {
      const r = await tiffInWorker(buf, opt);
      if (r && r.err) throw new Error(r.err);
      if (r && opt && !r.jpeg) { const meta = tiffMeta(r.tags); meta.w = r.w; meta.h = r.h; meta.bytes = b.length;
        return { meta, prev: r.prev, edges: r.edges, rgba: r.full ? new Uint8ClampedArray(r.full.buf, r.full.off, r.full.len) : null }; }
      if (r && !r.jpeg) { const meta = tiffMeta(r.tags); meta.w = r.w; meta.h = r.h; meta.bytes = b.length; return { meta, rgba: new Uint8ClampedArray(r.rgba, r.off, r.len) }; }
      if (r && r.jpeg && typeof createImageBitmap === 'function') { const meta = tiffMeta(r.tags); meta.bytes = b.length; return { meta, rgba: await jpegTiff(b, r.tags, meta) }; }
      const ifds = UT.decode(buf);
      const ifd = ifds.find(d => d.t256) || ifds[0];
      if (!ifd) throw new Error('TIFF 이미지를 읽을 수 없습니다');
      const meta = tiffMeta(ifd);
      meta.bytes = b.length;
      if (ifd.t259 && ifd.t259[0] === 7 && typeof createImageBitmap === 'function') return { meta, rgba: await jpegTiff(b, ifd, meta) };
      UT.decodeImage(buf, ifd, ifds);
      const rgba = UT.toRGBA8(ifd);
      meta.w = ifd.width; meta.h = ifd.height; meta.bytes = b.length;
      return { meta, rgba: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length) };
    }
    let meta;
    if (b[0] === 0xFF && b[1] === 0xD8) meta = jpegMeta(b);
    else if (b[0] === 0x89 && b[1] === 0x50) meta = pngMeta(b);
    else if (b[0] === 0x42 && b[1] === 0x4D) meta = bmpMeta(b);
    else throw new Error('지원하지 않는 형식입니다 · ' + (ext || name));
    meta.bytes = b.length;
    const bitmap = await createImageBitmap(new Blob([b]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    meta.w = bitmap.width; meta.h = bitmap.height;
    return { meta, bitmap };
  }

  /* ---------------------------------------------------------------- 색상 모드 변환 (Pillow 와 같은 공식) */
  /* rgba(Uint8ClampedArray) → 저장할 모드의 픽셀: '1'=Uint8(0/1, 1=검정) · 'L'=Uint8 · 'RGB'=Uint8 x3 */
  function toMode(rgba, w, h, mode) {
    const n = w * h;
    if (mode === '1' || mode === 'L' || mode === 'LA' || mode === 'I;16') {
      const out = new Uint8Array(n);
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const L = (rgba[j] * 19595 + rgba[j + 1] * 38470 + rgba[j + 2] * 7471 + 0x8000) >> 16;
        out[i] = mode === '1' ? (L >= 128 ? 0 : 1) : L;
      }
      return { mode: mode === '1' ? '1' : 'L', px: out };
    }
    const out = new Uint8Array(n * 3);
    for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) { out[k] = rgba[j]; out[k + 1] = rgba[j + 1]; out[k + 2] = rgba[j + 2]; }
    return { mode: 'RGB', px: out };
  }

  /* ---------------------------------------------------------------- 압축: LZW (TIFF 방식, early change) */
  function lzw(src) {
    const out = new Uint8Array(Math.ceil(src.length * 1.6) + 64); let o = 0, acc = 0, nb = 0;  // 최악(바이트당 12비트)에도 넉넉한 크기를 미리 잡음
    const put = (code, width) => { acc = (acc << width) | code; nb += width; while (nb >= 8) { nb -= 8; out[o++] = (acc >>> nb) & 255; } acc &= (1 << nb) - 1; };
    const child = new Int32Array(4096 * 256), used = new Int32Array(4096); let nused = 0;
    let width = 9, next = 258;
    put(256, width);
    if (!src.length) { put(257, width); if (nb) out[o++] = (acc << (8 - nb)) & 255; return out.slice(0, o); }
    let w = src[0];
    for (let i = 1; i < src.length; i++) {
      const c = src[i], key = (w << 8) | c, hit = child[key];
      if (hit) { w = hit - 1; continue; }
      put(w, width);
      child[key] = next + 1; used[nused++] = key; next++;
      if (next === 4094) {
        put(256, width);
        for (let j = 0; j < nused; j++) child[used[j]] = 0;
        nused = 0; next = 258; width = 9;
      } else if (next > (1 << width) - 1 && width < 12) width++;
      w = c;
    }
    put(w, width); next++;
    if (next === 4094) { put(256, width); width = 9; }
    else if (next > (1 << width) - 1 && width < 12) width++;
    put(257, width);
    if (nb) out[o++] = (acc << (8 - nb)) & 255;
    return out.slice(0, o);
  }

  /* PackBits (행 단위) */
  function packbits(src, rowBytes) {
    const out = [];
    for (let r = 0; r < src.length; r += rowBytes) {
      const end = Math.min(src.length, r + rowBytes); let i = r;
      while (i < end) {
        let j = i + 1;
        while (j < end && j - i < 128 && src[j] === src[i]) j++;
        if (j - i >= 2) { out.push((257 - (j - i)) & 255, src[i]); i = j; continue; }
        j = i;
        while (j < end && j - i < 128 && !(j + 1 < end && src[j] === src[j + 1])) j++;
        out.push(j - i - 1); for (let k = i; k < j; k++) out.push(src[k]); i = j;
      }
    }
    return new Uint8Array(out);
  }

  async function zlib(src) {
    const cs = new CompressionStream('deflate');
    const blob = await new Response(new Blob([src]).stream().pipeThrough(cs)).arrayBuffer();
    return new Uint8Array(blob);
  }

  /* ---------------------------------------------------------------- 압축: CCITT Group 4 (T.6) */
  const WT = ['00110101', '000111', '0111', '1000', '1011', '1100', '1110', '1111', '10011', '10100', '00111', '01000', '001000', '000011', '110100', '110101', '101010', '101011', '0100111', '0001100', '0001000', '0010111', '0000011', '0000100', '0101000', '0101011', '0010011', '0100100', '0011000', '00000010', '00000011', '00011010', '00011011', '00010010', '00010011', '00010100', '00010101', '00010110', '00010111', '00101000', '00101001', '00101010', '00101011', '00101100', '00101101', '00000100', '00000101', '00001010', '00001011', '01010010', '01010011', '01010100', '01010101', '00100100', '00100101', '01011000', '01011001', '01011010', '01011011', '01001010', '01001011', '00110010', '00110011', '00110100'];
  const WM = ['11011', '10010', '010111', '0110111', '00110110', '00110111', '01100100', '01100101', '01101000', '01100111', '011001100', '011001101', '011010010', '011010011', '011010100', '011010101', '011010110', '011010111', '011011000', '011011001', '011011010', '011011011', '010011000', '010011001', '010011010', '011000', '010011011'];
  const BT = ['0000110111', '010', '11', '10', '011', '0011', '0010', '00011', '000101', '000100', '0000100', '0000101', '0000111', '00000100', '00000111', '000011000', '0000010111', '0000011000', '0000001000', '00001100111', '00001101000', '00001101100', '00000110111', '00000101000', '00000010111', '00000011000', '000011001010', '000011001011', '000011001100', '000011001101', '000001101000', '000001101001', '000001101010', '000001101011', '000011010010', '000011010011', '000011010100', '000011010101', '000011010110', '000011010111', '000001101100', '000001101101', '000011011010', '000011011011', '000001010100', '000001010101', '000001010110', '000001010111', '000001100100', '000001100101', '000001010010', '000001010011', '000000100100', '000000110111', '000000111000', '000000100111', '000000101000', '000001011000', '000001011001', '000000101011', '000000101100', '000001011010', '000001100110', '000001100111'];
  const BM = ['0000001111', '000011001000', '000011001001', '000001011011', '000000110011', '000000110100', '000000110101', '0000001101100', '0000001101101', '0000001001010', '0000001001011', '0000001001100', '0000001001101', '0000001110010', '0000001110011', '0000001110100', '0000001110101', '0000001110110', '0000001110111', '0000001010010', '0000001010011', '0000001010100', '0000001010101', '0000001011010', '0000001011011', '0000001100100', '0000001100101'];
  const XM = ['00000001000', '00000001100', '00000001101', '000000010010', '000000010011', '000000010100', '000000010101', '000000010110', '000000010111', '000000011100', '000000011101', '000000011110', '000000011111'];
  const V = { 0: '1', 1: '011', 2: '000011', 3: '0000011', '-1': '010', '-2': '000010', '-3': '0000010' };
  const C = s => [parseInt(s, 2), s.length];
  const WTc = WT.map(C), WMc = WM.map(C), BTc = BT.map(C), BMc = BM.map(C), XMc = XM.map(C), Vc = {};
  for (const k in V) Vc[k] = C(V[k]);
  const PASS = C('0001'), HORZ = C('001'), EOL = C('000000000001');

  /* pix: Uint8Array w*h, 1=검정 */
  function g4(pix, w, h) {
    const out = []; let acc = 0, nb = 0;
    const put = ([code, len]) => { for (let i = len - 1; i >= 0; i--) { acc = (acc << 1) | ((code >> i) & 1); if (++nb === 8) { out.push(acc); acc = 0; nb = 0; } } };
    const run = (n, black) => {
      const T = black ? BTc : WTc, M = black ? BMc : WMc;
      while (n >= 2560) { put(XMc[12]); n -= 2560; }
      if (n >= 64) { const m = n >> 6; put(m <= 27 ? M[m - 1] : XMc[m - 28]); n -= m << 6; }
      put(T[n]);
    };
    let ref = new Uint8Array(w);  // 첫 기준선은 모두 흰색
    // 줄에서 a 보다 오른쪽(시작이면 0 포함) 첫 변화점 — color 가 주어지면 그 색으로 바뀌는 점
    const nextChange = (line, a, color) => {
      for (let p = a < 0 ? 0 : a + 1; p < w; p++) {
        const prev = p === 0 ? 0 : line[p - 1];
        if (line[p] !== prev && (color === undefined || line[p] === color)) return p;
      }
      return w;
    };
    for (let y = 0; y < h; y++) {
      const cur = pix.subarray(y * w, y * w + w);
      let a0 = -1, col = 0;
      while (a0 < w) {
        const a1 = nextChange(cur, a0);
        const b1 = nextChange(ref, a0, col ? 0 : 1);
        const b2 = b1 < w ? nextChange(ref, b1) : w;
        if (b2 < a1) { put(PASS); a0 = b2; continue; }
        const d = a1 - b1;
        if (Math.abs(d) <= 3) { put(Vc[d]); a0 = a1; col ^= 1; continue; }
        const a2 = a1 < w ? nextChange(cur, a1) : w;
        put(HORZ); run(a1 - (a0 < 0 ? 0 : a0), col === 1); run(a2 - a1, col === 0);
        a0 = a2;
      }
      ref = cur;
    }
    put(EOL); put(EOL);
    if (nb) out.push(acc << (8 - nb));
    return new Uint8Array(out);
  }

  /* ---------------------------------------------------------------- TIFF 쓰기 */
  async function encodeTiff(w, h, mode, px, dpi, compression) {
    let comp = compression || 'tiff_lzw';
    if ((comp === 'group4' || comp === 'group3' || comp === 'tiff_ccitt')) comp = mode === '1' ? 'group4' : 'tiff_lzw';
    if (!['raw', 'tiff_lzw', 'tiff_adobe_deflate', 'tiff_deflate', 'packbits', 'group4'].includes(comp)) comp = 'tiff_lzw';
    const spp = mode === 'RGB' ? 3 : 1, bits = mode === '1' ? 1 : 8;
    const rowBytes = mode === '1' ? Math.ceil(w / 8) : w * spp;
    const code = { raw: 1, tiff_lzw: 5, tiff_adobe_deflate: 8, tiff_deflate: 8, packbits: 32773, group4: 4 }[comp];
    // 화소 → 행 단위 바이트
    let rows;
    if (mode === '1') {
      rows = new Uint8Array(rowBytes * h);
      // G4 는 WhiteIsZero(1=검정), 나머지는 BlackIsZero(1=흰색)
      const inv = comp !== 'group4';
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = inv ? 1 - px[y * w + x] : px[y * w + x];
        if (v) rows[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    } else rows = px;
    const rps = comp === 'group4' ? h : Math.max(1, Math.min(h, Math.floor(262144 / Math.max(1, rowBytes))));
    const strips = [];
    for (let y = 0; y < h; y += rps) {
      const n = Math.min(rps, h - y), part = rows.subarray(y * rowBytes, (y + n) * rowBytes);
      if (comp === 'group4') strips.push(g4(px.subarray(y * w, (y + n) * w), w, n));
      else if (comp === 'tiff_lzw') strips.push(lzw(part));
      else if (comp === 'packbits') strips.push(packbits(part, rowBytes));
      else if (code === 8) strips.push(await zlib(part));
      else strips.push(part.slice());
    }
    const photometric = mode === 'RGB' ? 2 : (comp === 'group4' ? 0 : 1);
    const d = dpi && dpi[0] > 0 ? dpi : null;
    const sw = 'ScanQC Web\0';
    const tags = [
      [254, 4, [0]], [256, 4, [w]], [257, 4, [h]], [258, 3, spp === 3 ? [8, 8, 8] : [bits]], [259, 3, [code]], [262, 3, [photometric]],
      [273, 4, strips.map(() => 0)], [277, 3, [spp]], [278, 4, [rps]], [279, 4, strips.map(s => s.length)],
    ];
    if (d) tags.push([282, 5, [d[0]]], [283, 5, [d[1]]]);
    tags.push([284, 3, [1]]);
    if (comp === 'group4') tags.push([293, 4, [0]]);
    if (d) tags.push([296, 3, [2]]);
    tags.push([305, 2, sw]);
    const dataLen = strips.reduce((a, s) => a + s.length + (s.length & 1), 0);
    const ifdOff = 8 + dataLen, ifdLen = 2 + tags.length * 12 + 4;
    // 4바이트에 안 들어가는 값은 IFD 뒤에
    const SZ = { 2: 1, 3: 2, 4: 4, 5: 8 };
    let extra = ifdOff + ifdLen; const extraOff = {};
    for (const t of tags) { const len = SZ[t[1]] * t[2].length; if (len > 4) { extraOff[t[0]] = extra; extra += len + (len & 1); } }
    const buf = new Uint8Array(extra), dv = new DataView(buf.buffer);
    buf[0] = buf[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
    let p = 8; const offs = [];
    for (const s of strips) { offs.push(p); buf.set(s, p); p += s.length + (s.length & 1); }
    tags.find(t => t[0] === 273)[2] = offs;
    dv.setUint16(ifdOff, tags.length, true);
    tags.forEach((t, i) => {
      const [tag, type, vals] = t, o = ifdOff + 2 + i * 12, len = SZ[type] * vals.length;
      dv.setUint16(o, tag, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, vals.length, true);
      const at = len > 4 ? extraOff[tag] : o + 8;
      if (len > 4) dv.setUint32(o + 8, at, true);
      for (let j = 0; j < vals.length; j++) {
        if (type === 2) buf[at + j] = vals.charCodeAt(j);
        else if (type === 3) dv.setUint16(at + j * 2, vals[j], true);
        else if (type === 4) dv.setUint32(at + j * 4, vals[j], true);
        else if (type === 5) { const v = vals[j], den = Number.isInteger(v) ? 1 : 100; dv.setUint32(at + j * 8, Math.round(v * den), true); dv.setUint32(at + j * 8 + 4, den, true); }
      }
    });
    dv.setUint32(ifdOff + ifdLen - 4, 0, true);
    return buf;
  }

  /* ---------------------------------------------------------------- PNG · BMP · JPEG */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function chunk(type, data) {
    const o = new Uint8Array(12 + data.length), dv = new DataView(o.buffer);
    dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) o[4 + i] = type.charCodeAt(i);
    o.set(data, 8); dv.setUint32(8 + data.length, crc32(o.subarray(4, 8 + data.length))); return o;
  }
  async function encodePng(w, h, mode, px, dpi) {
    const bd = mode === '1' ? 1 : 8, ct = mode === 'RGB' ? 2 : 0, rb = mode === '1' ? Math.ceil(w / 8) : w * (mode === 'RGB' ? 3 : 1);
    const raw = new Uint8Array((rb + 1) * h);
    for (let y = 0; y < h; y++) {
      const o = y * (rb + 1) + 1;
      if (mode === '1') { for (let x = 0; x < w; x++) if (!px[y * w + x]) raw[o + (x >> 3)] |= 0x80 >> (x & 7); }
      else raw.set(px.subarray(y * rb, y * rb + rb), o);
    }
    const ih = new Uint8Array(13), dv = new DataView(ih.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = bd; ih[9] = ct;
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih)];
    if (dpi && dpi[0] > 0) { const p = new Uint8Array(9), pv = new DataView(p.buffer); pv.setUint32(0, Math.round(dpi[0] / 0.0254)); pv.setUint32(4, Math.round(dpi[1] / 0.0254)); p[8] = 1; parts.push(chunk('pHYs', p)); }
    parts.push(chunk('IDAT', await zlib(raw)), chunk('IEND', new Uint8Array(0)));
    return concat(parts);
  }
  function encodeBmp(w, h, mode, px, dpi) {
    const gray = mode !== 'RGB', bc = gray ? 8 : 24, rb = Math.ceil(w * bc / 32) * 4, pal = gray ? 1024 : 0, off = 54 + pal;
    const buf = new Uint8Array(off + rb * h), dv = new DataView(buf.buffer);
    buf[0] = 0x42; buf[1] = 0x4D; dv.setUint32(2, buf.length, true); dv.setUint32(10, off, true);
    dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, bc, true);
    dv.setUint32(34, rb * h, true); const ppm = dpi && dpi[0] > 0 ? Math.round(dpi[0] / 0.0254) : 0; dv.setInt32(38, ppm, true); dv.setInt32(42, ppm, true);
    if (gray) { dv.setUint32(46, 256, true); for (let i = 0; i < 256; i++) { buf[54 + i * 4] = buf[55 + i * 4] = buf[56 + i * 4] = i; } }
    for (let y = 0; y < h; y++) {
      const o = off + (h - 1 - y) * rb;
      if (gray) for (let x = 0; x < w; x++) { const v = px[y * w + x]; buf[o + x] = mode === '1' ? (v ? 0 : 255) : v; }
      else for (let x = 0; x < w; x++) { const s = (y * w + x) * 3; buf[o + x * 3] = px[s + 2]; buf[o + x * 3 + 1] = px[s + 1]; buf[o + x * 3 + 2] = px[s]; }
    }
    return buf;
  }
  /* JPEG: 브라우저 인코더(품질 100)로 만든 뒤 JFIF 의 DPI 만 원본 값으로 바꿈 */
  function setJpegDpi(b, dpi) {
    if (!dpi || !(dpi[0] > 0)) return b;
    if (b[2] === 0xFF && b[3] === 0xE0 && b[6] === 0x4A && b[7] === 0x46) {
      const o = b.slice(); o[13] = 1; o[14] = dpi[0] >> 8; o[15] = dpi[0] & 255; o[16] = dpi[1] >> 8; o[17] = dpi[1] & 255; return o;
    }
    const app0 = new Uint8Array([0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 1, dpi[0] >> 8, dpi[0] & 255, dpi[1] >> 8, dpi[1] & 255, 0, 0]);
    return concat([b.subarray(0, 2), app0, b.subarray(2)]);
  }
  function concat(parts) { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }

  /* 저장: rgba → 대상 파일 형식/모드/DPI/압축 그대로 (ref = 기준 메타) */
  async function encode(rgba, w, h, ref, name, canvas) {
    const ext = extOf(name), fmt = FMT[ext] || 'TIFF';
    let mode = ref.mode || 'RGB';
    if (mode === 'P' || mode === 'RGBA' || mode === 'CMYK') mode = 'RGB';
    const dpi = ref.dpi ? ref.dpi.map(v => Math.round(v)) : null;
    if (fmt === 'JPEG') {
      if (!canvas) throw new Error('JPEG 저장에는 캔버스가 필요합니다');
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 1));
      return setJpegDpi(new Uint8Array(await blob.arrayBuffer()), dpi);
    }
    const t = toMode(rgba, w, h, mode);
    if (fmt === 'PNG') return encodePng(w, h, t.mode, t.px, dpi);
    if (fmt === 'BMP') return encodeBmp(w, h, t.mode, t.px, dpi);
    return encodeTiff(w, h, t.mode, t.px, dpi, ref.format === 'TIFF' ? ref.compression : 'tiff_lzw');
  }

  /* 저장할 때 압축(LZW 등)을 작업 스레드에서 — 화면이 멈추지 않게. 안 되면 null → 화면 스레드에서 */
  function encodeInWorker(rgba, w, h, ref, name) {
    if (!tiffWorkers() || !WURL || !SELF_SRC) return Promise.resolve(null);
    try {
      if (!EW) { EW = new Worker(WURL); EW.onmessage = e => { const c = twcb.get(e.data.id); if (c) { twcb.delete(e.data.id); c(e.data); } }; EW.onerror = () => { EW = null; for (const [k, c] of twcb) if (c.enc) { twcb.delete(k); c(null); } }; }
      const id = ++twid, r = { mode: ref.mode, dpi: ref.dpi, format: ref.format, compression: ref.compression };
      return new Promise(res => { const cb = d => res(!d || d.err ? (d && d.err ? Promise.reject(new Error(d.err)) : null) : new Uint8Array(d.bytes, d.off, d.len)); cb.enc = true; twcb.set(id, cb); EW.postMessage({ id, enc: { rgba, w, h, ref: r, name } }, [rgba.buffer]); });
    } catch (e) { return Promise.resolve(null); }
  }
  const lanes = () => { const w = tiffWorkers(); return w ? Math.max(1, Math.floor(w.length / 2)) : 1; };  // 동시에 미리 풀 수 있는 장 수
  const Codec = { EXTS, FMT, extOf, decode, lanes, encodeInWorker, toMode, encode, encodeTiff, encodePng, encodeBmp, setJpegDpi, lzw, g4, packbits, tiffMeta, jpegMeta, pngMeta, bmpMeta };
  if (typeof module === 'object' && module.exports) module.exports = Codec; else root.Codec = Codec;
})(typeof self !== 'undefined' ? self : globalThis);
