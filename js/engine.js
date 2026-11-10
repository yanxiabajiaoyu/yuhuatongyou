/* =========================================================
 * 水墨动画引擎 InkAnimationEngine（轻量版）
 * 核心铁律：只在原图基础上叠加轻微动效，不拆图层、不抠背景、不移动题字印章
 * 策略：完整绘制原图 → 整体极轻微呼吸 → 点击/声音触发脉冲
 * ========================================================= */

class InkAnimationEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.original = null;   // 原图 Image
    this.rafId = null;
    this.startTime = 0;
    this.running = false;
    this.pulse = 0;         // 点击/声音触发的脉冲强度 0~1
    this.wind = 0;          // 吹气累积的风力强度 0~1
  }

  /* ---------- 加载图像 ---------- */
  async loadImage(source) {
    this.stop();
    const img = new Image();
    /* 本引擎只绘制、不读取像素，无需跨域声明；
       加了 crossOrigin 反而会让 file:// 或部分本地预览环境下图片被拦截、画布空白 */
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

  /* ---------- 按容器尺寸设置画布 ---------- */
  _process() {
    const img = this.original;
    const canvas = this.canvas;
    const parent = canvas.parentElement;
    const maxW = (parent && parent.clientWidth) || 1600;
    const maxH = (parent && parent.clientHeight) || 560;
    let w = img.width, h = img.height;
    const scale = Math.min(maxW / w, maxH / h, 1);
    w = Math.round(w * scale); h = Math.round(h * scale);
    canvas.width = w; canvas.height = h;
    this.start();
  }

  /* ---------- 渲染循环 ---------- */
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

    // 整体极轻微呼吸（±0.3%，几乎不可察觉但赋予生气）
    const breath = 1 + Math.sin(t * 0.8) * 0.003;
    // 点击脉冲
    const pulseScale = 1 + this.pulse * 0.02;
    // 吹气带来的轻微横向漂移（模拟风拂画卷）
    const driftX = Math.sin(t * 0.5) * this.wind * 4;
    const driftY = Math.cos(t * 0.4) * this.wind * 2;

    const scale = breath * pulseScale;

    ctx.save();
    ctx.translate(w / 2 + driftX, h / 2 + driftY);
    ctx.scale(scale, scale);
    // 完整绘制原图（宣纸色、题字、印章全部保留，不做任何抠除）
    ctx.drawImage(this.original, -w / 2, -h / 2, w, h);
    ctx.restore();

    // 脉冲与风力自然衰减
    if (this.pulse > 0) this.pulse = Math.max(0, this.pulse - 0.03);
    if (this.wind > 0) this.wind = Math.max(0, this.wind - 0.008);
  }

  /* ---------- 点击交互：触发脉冲 ---------- */
  handleClick(px, py) {
    this.pulse = 1;
    return "painting";
  }

  /* ---------- 声音交互：吹气加强风力，拍手触发脉冲 ---------- */
  onBlow() {
    this.wind = Math.min(1, this.wind + 0.6);
    this.pulse = Math.max(this.pulse, 0.5);
  }
  onClap() {
    this.pulse = 1;
  }
}
