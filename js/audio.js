/* ============================================================
 * 与画同游 · 声音检测（Web Audio API）
 * 功能：麦克风音量检测 —— 吹气（持续音量）/ 拍手（瞬时尖峰）
 * 隐私：仅本地实时检测音量特征，不录音、不上传、不存储。
 * ============================================================ */

(function () {
  'use strict';

  const YHTYAudio = {
    stream: null,        // 麦克风媒体流
    audioCtx: null,      // 音频上下文
    analyser: null,      // 分析节点
    dataArray: null,     // 时域数据缓存
    rafId: null,         // 检测循环句柄
    _prevLevel: 0,       // 上一帧音量（算突增量用）
    _lastClapAt: 0,      // 上次拍手触发时间（防抖）
    _blowStartAt: 0,     // 持续音量开始时间
    _blowTriggered: false,

    /* 当前环境是否支持麦克风（需 localhost 或 HTTPS） */
    isSupported() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },

    /* 请求麦克风授权。返回 Promise<boolean>：true=已授权并就绪 */
    async request() {
      if (!this.isSupported()) return false;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        // 用户拒绝 / 设备无麦克风 / 非安全上下文
        return false;
      }
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);
      this.dataArray = new Uint8Array(this.analyser.fftSize);
      return true;
    },

    /* 读取当前帧音量（RMS，约0~1） */
    getLevel() {
      this.analyser.getByteTimeDomainData(this.dataArray);
      let sum = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        const v = (this.dataArray[i] - 128) / 128;
        sum += v * v;
      }
      return Math.sqrt(sum / this.dataArray.length);
    },

    /**
     * 开始检测
     * handlers:
     *   onLevel(level)  每帧音量（驱动音量条）
     *   onBlow()        检测到持续音量（吹气 / 轻语）
     *   onClap()        检测到瞬时尖峰（拍手）
     */
    start(handlers) {
      handlers = handlers || {};
      const CLAP_LEVEL = 0.2;    // 拍手音量门槛
      const CLAP_RISE = 0.1;     // 拍手突增量门槛（与上一帧相比）
      const CLAP_GAP_MS = 1500;  // 拍手防抖间隔
      const BLOW_LEVEL = 0.07;   // 吹气音量门槛
      const BLOW_MIN_MS = 350;   // 持续时长门槛

      const loop = () => {
        const level = this.getLevel();
        const now = performance.now();
        const rise = level - this._prevLevel;
        this._prevLevel = level;

        handlers.onLevel && handlers.onLevel(level);

        /* —— 拍手：瞬时尖峰（突增 + 超门槛 + 防抖） —— */
        if (level > CLAP_LEVEL && rise > CLAP_RISE && now - this._lastClapAt > CLAP_GAP_MS) {
          this._lastClapAt = now;
          this._blowStartAt = 0;          // 尖峰不计入持续音量，避免误判吹气
          handlers.onClap && handlers.onClap();
        }
        /* —— 吹气/轻语：持续中等音量 —— */
        else if (level > BLOW_LEVEL && level <= CLAP_LEVEL) {
          if (!this._blowStartAt) this._blowStartAt = now;
          if (!this._blowTriggered && now - this._blowStartAt > BLOW_MIN_MS) {
            this._blowTriggered = true;
            handlers.onBlow && handlers.onBlow();
          }
        }
        /* —— 安静：重置，允许下一次吹气 —— */
        else if (level <= BLOW_LEVEL) {
          this._blowStartAt = 0;
          this._blowTriggered = false;
        }

        this.rafId = requestAnimationFrame(loop);
      };
      loop();
    },

    /* 停止检测并释放麦克风 */
    stop() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      if (this.audioCtx) {
        this.audioCtx.close();
        this.audioCtx = null;
      }
    },
  };

  window.YHTYAudio = YHTYAudio;

  /* ============================================================
   * YHTYAmbient · 环境音模块（v2.0 新增，决策11）
   * 每厅一段环境音循环，默认关闭，由用户点击「听声」开关触发。
   *
   * 【素材替换说明】
   * 当前无 mp3 素材，采用 Web Audio 程序合成（无音频文件请求）：
   *   风/江声＝粉噪＋低通滤波＋慢增益起伏；鸟鸣＝随机短滑音；
   *   蝉鸣＝高频载波＋脉冲调幅；细雨＝宽带粉噪。
   * 免版权音效素材到位后，可改为 HTMLAudioElement 循环播放
   * assets/audio/<厅>_ambient.mp3（音量≤40%），对外接口不变：
   *   YHTYAmbient.toggle(厅名) → 返回 true=已开启 / false=已关闭
   * ============================================================ */
  const YHTYAmbient = {
    ctx: null,          // 音频上下文
    master: null,       // 总音量（≤0.4）
    _nodes: [],         // 运行中的节点（停止时统一释放）
    _timers: [],        // 鸟鸣等定时器
    _chirpTimer: null,  // 鸟鸣调度
    current: null,      // 当前播放的厅名（null=关闭）

    /* 三厅参数化配方（决策11内容建议，古琴以风＋江声意境替代） */
    presets: {
      qianli:   { wind: 0.50, water: 0.30, birds: true,  rain: 0,    cicadas: false }, // 风声＋鸟鸣＋水声
      fuchun:   { wind: 0.32, water: 0.55, birds: false, rain: 0,    cicadas: false }, // 江声＋风
      moputao:  { wind: 0,    water: 0,    birds: false, rain: 0.45, cicadas: true  }, // 细雨＋蝉鸣
    },

    /** 生成 2 秒粉噪缓冲（循环播放，近似自然界 1/f 噪声） */
    _makePinkNoise(ctx) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.0990460;
        b1 = 0.96300 * b1 + white * 0.2965164;
        b2 = 0.57000 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.08;
      }
      return buf;
    },

    /**
     * 铺一层「滤波噪声＋缓慢起伏」的持续声（风 / 江 / 雨共用骨架）
     * cutoff：低通截止频率；level：基准音量；lfoHz：起伏速度
     */
    _addNoiseLayer(ctx, noiseBuf, cutoff, level, lfoHz) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const gain = ctx.createGain();
      gain.gain.value = level;
      /* 慢 LFO 让音量像风一样忽大忽小 */
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = level * 0.45;
      lfo.connect(lfoGain).connect(gain.gain);
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      lfo.start();
      this._nodes.push(src, lfo);
    },

    /** 随机鸟鸣：每隔 2.5~7 秒一声短滑音（2.2k→3.4k→2.6k Hz） */
    _startBirds(ctx) {
      const self = this;
      function chirp() {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const t = ctx.currentTime;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2200 + Math.random() * 500, t);
        osc.frequency.exponentialRampToValueAtTime(3400, t + 0.08);
        osc.frequency.exponentialRampToValueAtTime(2600, t + 0.16);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.05, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        osc.connect(gain).connect(self.master);
        osc.start(t);
        osc.stop(t + 0.22);
        /* 有时连叫两声 */
        if (Math.random() < 0.4) {
          const t2 = t + 0.28;
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(2400, t2);
          osc2.frequency.exponentialRampToValueAtTime(3100, t2 + 0.1);
          gain2.gain.setValueAtTime(0, t2);
          gain2.gain.linearRampToValueAtTime(0.04, t2 + 0.03);
          gain2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.16);
          osc2.connect(gain2).connect(self.master);
          osc2.start(t2);
          osc2.stop(t2 + 0.18);
        }
        self._chirpTimer = setTimeout(chirp, 2500 + Math.random() * 4500);
      }
      chirp();
    },

    /** 蝉鸣：4.5kHz 载波 + 30Hz 脉冲调幅（夏日午后感） */
    _startCicadas(ctx) {
      const carrier = ctx.createOscillator();
      carrier.type = 'triangle';
      carrier.frequency.value = 4500;
      const am = ctx.createGain();
      am.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 30;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.012;
      lfo.connect(lfoGain).connect(am.gain);
      /* 整体缓慢强弱起伏，像一阵一阵的蝉声 */
      const slow = ctx.createOscillator();
      slow.frequency.value = 0.09;
      const slowGain = ctx.createGain();
      slowGain.gain.value = 0.006;
      slow.connect(slowGain).connect(am.gain);
      carrier.connect(am).connect(this.master);
      carrier.start();
      lfo.start();
      slow.start();
      this._nodes.push(carrier, lfo, slow);
    },

    /** 切换指定厅的环境音。返回 true=已开启，false=已关闭 */
    toggle(name) {
      if (this.current === name) {
        this.stop();
        return false;
      }
      this.stop();
      this.start(name);
      return true;
    },

    start(name) {
      const preset = this.presets[name];
      if (!preset) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.4;   // 规格：音量≤40%
      this.master.connect(ctx.destination);

      const noiseBuf = this._makePinkNoise(ctx);
      if (preset.wind)  this._addNoiseLayer(ctx, noiseBuf, 380,  preset.wind * 0.10, 0.07);  // 风
      if (preset.water) this._addNoiseLayer(ctx, noiseBuf, 210,  preset.water * 0.12, 0.13); // 江声（更低沉、起伏稍快）
      if (preset.rain)  this._addNoiseLayer(ctx, noiseBuf, 2600, preset.rain * 0.05, 0.5);   // 细雨（高频沙沙）
      if (preset.birds) this._startBirds(ctx);
      if (preset.cicadas) this._startCicadas(ctx);

      this.current = name;
    },

    stop() {
      if (this._chirpTimer) { clearTimeout(this._chirpTimer); this._chirpTimer = null; }
      this._timers.forEach(clearTimeout);
      this._timers = [];
      this._nodes.forEach(function (n) { try { n.stop(); } catch (e) {} });
      this._nodes = [];
      if (this.ctx) { this.ctx.close(); this.ctx = null; }
      this.master = null;
      this.current = null;
    },
  };

  window.YHTYAmbient = YHTYAmbient;
})();
