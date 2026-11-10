/* =========================================================
 * 水墨动画引擎 InkAnimationEngine（完整版 · 自由创作页使用）
 * 核心铁律：只移动作者画过的元素，绝不凭空生成画中不存在的元素
 * 流程：预处理(去白底) → 连通域分割 → 元素分类 → 运动模板 → 合成渲染
 * ========================================================= */

class InkAnimationEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.components = [];   // 分割出的图层
    this.original = null;   // 原图 Image
    this.rafId = null;
    this.startTime = 0;
    this.running = false;
    this.micOn = false;
    this.audioCtx = null;
    this.analyser = null;
    this.micStream = null;
    this.blowAccum = 0;
  }

  /* ---------- 加载图像 ---------- */
  async loadImage(source) {
    this.stop();
    this.components = [];
    const img = new Image();
    /* 需要读取像素做分割，http(s) 下声明跨域保证画布不被污染；
       file:// 下声明反而会让图片加载失败，故仅在 http(s) 下启用 */
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      img.crossOrigin = 'anonymous';
    }
    return new Promise((resolve, reject) => {
      img.onload = () => {
        this.original = img;
        this._process();
        resolve();
      };
      img.onerror = reject;
      if (source instanceof File) {
        img.src = URL.createObjectURL(source);
      } else {
        img.src = source;
      }
    });
  }

  /* ---------- 预处理 + 分割 + 分类 ---------- */
  _process() {
    const img = this.original;
    const canvas = this.canvas;
    const parent = canvas.parentElement;
    // 以容器高度为基准缩放；超长手卷最多 4000px 宽，超出部分由外层横向滚动查看
    const maxH = (parent && parent.clientHeight) || 560;
    let w = img.width, h = img.height;
    let scale = Math.min(maxH / h, 1);
    const MAX_W = 4000;
    if (w * scale > MAX_W) scale = MAX_W / w;
    w = Math.round(w * scale); h = Math.round(h * scale);
    canvas.width = w; canvas.height = h;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // ① 预处理：计算灰度直方图，用Otsu大津法自适应求阈值
    //    （古画背景非纯白——泛黄宣纸、青绿绢本，固定阈值会导致整图糊成一块）
    const hist = new Array(256).fill(0);
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const l = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      lum[i] = l;
      hist[(l + 0.5) | 0]++;
    }
    let otsuT = this._otsu(hist, w * h);
    // 兜底：若Otsu阈值过高（接近全白），限制在合理范围
    otsuT = Math.max(60, Math.min(otsuT, 220));

    // 墨色蒙版：低于阈值的为墨
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      mask[i] = lum[i] < otsuT ? 1 : 0;
    }

    // ② 连通域分割（4-邻域 flood fill）
    const visited = new Uint8Array(w * h);
    const blobs = [];
    const stack = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (mask[idx] && !visited[idx]) {
          // flood fill
          stack.length = 0;
          stack.push(idx);
          visited[idx] = 1;
          const pixels = [];
          let minX = x, maxX = x, minY = y, maxY = y, sumX = 0, sumY = 0;
          while (stack.length) {
            const p = stack.pop();
            const px = p % w, py = (p / w) | 0;
            pixels.push(p);
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
            sumX += px; sumY += py;
            // 4 neighbors
            if (px > 0) { const n = p - 1; if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); } }
            if (px < w - 1) { const n = p + 1; if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); } }
            if (py > 0) { const n = p - w; if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); } }
            if (py < h - 1) { const n = p + w; if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); } }
          }
          const area = pixels.length;
          if (area < 30) continue; // 去噪
          const bw = maxX - minX + 1, bh = maxY - minY + 1;
          blobs.push({
            pixels, minX, minY, maxX, maxY, w: bw, h: bh, area,
            cx: sumX / area, cy: sumY / area,
            density: area / (bw * bh)
          });
        }
      }
    }

    // ③ 分类
    blobs.forEach(b => b.type = this._classify(b, w, h));

    // ④ 为每个图层建独立 offscreen canvas（只含该图层像素）
    this.components = blobs.map(b => {
      const off = document.createElement("canvas");
      off.width = b.w; off.height = b.h;
      const octx = off.getContext("2d");
      const offData = octx.createImageData(b.w, b.h);
      const od = offData.data;
      for (const p of b.pixels) {
        const px = p % w, py = (p / w) | 0;
        const ox = px - b.minX, oy = py - b.minY;
        const oi = (oy * b.w + ox) * 4;
        const di = p * 4;
        od[oi] = data[di]; od[oi + 1] = data[di + 1];
        od[oi + 2] = data[di + 2]; od[oi + 3] = 255;
      }
      octx.putImageData(offData, 0, 0);
      return {
        ...b,
        canvas: off,
        baseX: b.minX, baseY: b.minY,
        opacity: 1,
        burst: 0, // 点击触发的爆发动画进度 0~1
      };
    });

    this.start();
  }

  /* ---------- Otsu大津法：自适应求二值化阈值 ---------- */
  _otsu(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, max = -1, threshold = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += i * hist[i];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) { max = between; threshold = i; }
    }
    return threshold;
  }

  /* ---------- 元素分类（位置 + 形状启发式，v2优化版） ---------- */
  _classify(b, imgW, imgH) {
    const relY = b.cy / imgH;
    const aspect = b.w / Math.max(b.h, 1);
    const tall = b.h / Math.max(b.w, 1);
    const relArea = b.area / (imgW * imgH);

    // 鸟：小而紧凑（任何位置）
    if (relArea < 0.008 && b.density > 0.55 && b.w < imgW * 0.12) return "bird";
    // 建筑：近矩形、中低密度、中等面积
    if (relArea > 0.003 && relArea < 0.05 && b.density > 0.5 && aspect > 0.6 && aspect < 2) return "building";
    // 人物：偏竖向、中等面积
    if (relArea > 0.002 && relArea < 0.03 && tall > 1.2 && b.density > 0.35) return "person";
    // 树木：高瘦竖向
    if (tall > 2 && relArea < 0.02 && b.density > 0.25) return "tree";
    // 花/叶：小、低密度
    if (relArea < 0.012 && b.density < 0.45) return "flower";
    // 水：横向长条、中下部
    if (aspect > 2.8 && relY > 0.3) return "water";
    // 云/雾：上部、宽形、低密度
    if (relY < 0.5 && b.density < 0.32 && aspect > 1.1) return "cloud";
    // 山：底部大块
    if (relY > 0.6 && relArea > 0.008) return "mountain";
    // 兜底
    if (relY < 0.5) return "cloud";
    return "mountain";
  }

  /* ---------- 运动模板渲染循环 ---------- */
  start() {
    if (this.running) return;
    this.running = true;
    this.startTime = performance.now();
    const loop = () => {
      if (!this.running) return;
      this._render();
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }
  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  _render() {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    const t = (performance.now() - this.startTime) / 1000;
    ctx.clearRect(0, 0, w, h);

    for (const c of this.components) {
      let x = c.baseX, y = c.baseY, opacity = c.opacity, scale = 1, rot = 0;

      switch (c.type) {
        case "cloud":
          x += Math.sin(t * 0.2 + c.cx * 0.01) * 8;
          opacity = 0.55 + Math.sin(t * 0.5 + c.cy) * 0.25;
          if (c.burst > 0) { opacity *= 1 - c.burst; c.burst = Math.max(0, c.burst - 0.015); }
          break;
        case "water":
          x += Math.sin(t * 0.6 + c.cy * 0.02) * 3;
          y += Math.sin(t * 1.2 + c.cx) * 1.5;
          break;
        case "bird":
          // 原地轻振翅，不脱离原画位置（只动作者画过的鸟）
          x += Math.sin(t * 1.6 + c.cx * 0.02) * 2.5;
          y += Math.sin(t * 5 + c.cx * 0.03) * 1.2;
          scale = 1 + Math.sin(t * 7 + c.cx) * 0.06;
          if (c.burst > 0) {
            x += Math.sin(c.burst * Math.PI) * 26;
            y -= Math.sin(c.burst * Math.PI) * 18;
            c.burst = Math.max(0, c.burst - 0.02);
          }
          break;
        case "flower":
          // 花果枝叶随风轻摆，不做飘落循环
          x += Math.sin(t * 1.4 + c.cy * 0.02) * 1.8;
          y += Math.sin(t * 1.9 + c.cx * 0.02) * 1.2;
          rot = Math.sin(t * 1.7 + c.cx * 0.02) * 0.05;
          if (c.burst > 0) {
            rot += Math.sin(c.burst * Math.PI) * 0.12;
            c.burst = Math.max(0, c.burst - 0.015);
          }
          break;
        case "person":
          scale = 1 + Math.sin(t * 1.5 + c.cx) * 0.015; // 呼吸
          break;
        case "tree":
          rot = Math.sin(t * 1.2 + c.cy * 0.05) * 0.03; // 随风轻摇
          break;
        case "mountain":
        case "building":
        default:
          break;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
      ctx.translate(x + c.w / 2, y + c.h / 2);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.drawImage(c.canvas, -c.w / 2, -c.h / 2);
      ctx.restore();
    }
  }

  /* ---------- 点击交互 ---------- */
  handleClick(px, py) {
    // 找到点击位置所属的图层，触发爆发动画
    for (const c of this.components) {
      if (px >= c.baseX && px <= c.baseX + c.w &&
          py >= c.baseY && py <= c.baseY + c.h) {
        c.burst = 1;
        return c.type;
      }
    }
    return null;
  }

  /* ---------- 麦克风声音交互 ---------- */
  async enableMic() {
    if (this.micOn) return true;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.audioCtx.createMediaStreamSource(this.micStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      this.micOn = true;
      this._micLoop();
      return true;
    } catch (e) {
      console.warn("麦克风不可用：", e.message);
      return false;
    }
  }
  disableMic() {
    this.micOn = false;
    if (this.micStream) this.micStream.getTracks().forEach(t => t.stop());
    if (this.audioCtx) this.audioCtx.close();
  }
  _micLoop() {
    if (!this.micOn) return;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    // 拍手：瞬时高分贝尖峰
    if (rms > 0.25) {
      const bird = this.components.find(c => c.type === "bird");
      if (bird) bird.burst = 1;
    }
    // 吹气：持续中低音量
    if (rms > 0.06 && rms < 0.22) {
      this.blowAccum += 1;
      if (this.blowAccum > 10) {
        this.components.filter(c => c.type === "cloud").forEach(c => c.burst = 1);
        this.blowAccum = 0;
      }
    } else {
      this.blowAccum = 0;
    }
    requestAnimationFrame(() => this._micLoop());
  }
}
