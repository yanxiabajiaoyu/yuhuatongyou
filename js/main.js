/* ============================================================
 * 与画同游 · 主逻辑（v2.0）
 * 职责：闯关进度存储 / 序厅渲染与水墨转场 / 长卷系统接线 /
 *       展厅任务卡与盖章 / 触屏动画触发 / 环境音开关 /
 *       声音交互接线 / 扣子对话组件挂载
 * ============================================================ */

(function () {
  'use strict';

  /* ==================== 进度存储 ==================== */

  const STORAGE_KEY = 'yhty_progress_v1';

  /** 默认进度：三厅各三个任务 + 盖章状态 */
  function defaultProgress() {
    const blank = { find: false, interact: false, quiz: false, sealed: false };
    return {
      qianli: Object.assign({}, blank),
      fuchun: Object.assign({}, blank),
      moputao: Object.assign({}, blank),
    };
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultProgress();
      return Object.assign(defaultProgress(), JSON.parse(raw));
    } catch (e) {
      return defaultProgress();
    }
  }

  function saveProgress(progress) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (e) { /* 隐私模式等场景下静默失败，不影响当次体验 */ }
  }

  /** 某厅是否已解锁：第一厅恒解锁，其余需前一厅已盖章 */
  function isHallUnlocked(hallKey, progress) {
    const order = YHTY_CONFIG.unlockOrder;
    const idx = order.indexOf(hallKey);
    if (idx <= 0) return true;
    return !!progress[order[idx - 1]].sealed;
  }

  /* ==================== 通用工具 ==================== */

  /** 轻提示 */
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-show'), 2400);
  }

  /**
   * 水墨转场：点击处墨晕扩散满屏（0.6s）后跳转
   * x, y 为点击点视口坐标；--s 为墨晕放大倍数（60px 圆放大至覆盖对角线）
   */
  function inkTransition(x, y, href) {
    const overlay = document.createElement('div');
    overlay.className = 'ink-overlay';
    const diag = Math.hypot(window.innerWidth, window.innerHeight);
    overlay.style.setProperty('--x', x + 'px');
    overlay.style.setProperty('--y', y + 'px');
    overlay.style.setProperty('--s', Math.ceil(diag / 60) + 2);
    document.body.appendChild(overlay);
    /* 双 rAF 确保过渡生效 */
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('is-spread')));
    setTimeout(() => { location.href = href; }, 600);
  }

  /**
   * 让原画局部动起来：给原画图层加动画类，到时自动移除
   * （动效只作用于原画像素，不生成任何新元素）
   */
  function pulseLive(el, cls, ms) {
    if (!el) return;
    el._liveTimers = el._liveTimers || {};
    clearTimeout(el._liveTimers[cls]);
    el.classList.add(cls);
    el._liveTimers[cls] = setTimeout(() => el.classList.remove(cls), ms);
  }

  /* ============================================================
   * 序厅
   * ============================================================ */

  function initLobby() {
    const progress = loadProgress();
    const order = YHTY_CONFIG.unlockOrder;

    /* 各厅的前厅名（锁定提示文案用） */
    const prevName = { fuchun: '千里江山图', moputao: '富春山居图' };

    /* —— 展厅入口：解锁状态渲染 + 水墨转场 —— */
    document.querySelectorAll('.hall-card').forEach((card) => {
      const key = card.dataset.hall;
      const state = card.querySelector('.card-state');
      if (isHallUnlocked(key, progress)) {
        card.classList.remove('is-locked');
        state.textContent = progress[key].sealed ? '已完成 · 盖章通关' : '已解锁 · 点击进入';
        card.addEventListener('click', (e) => {
          e.preventDefault();
          inkTransition(e.clientX, e.clientY, card.getAttribute('href'));
        });
      } else {
        /* 锁定：整卡置灰不可点（CSS 已禁用指针事件），角印示锁 */
        card.classList.add('is-locked');
        card.removeAttribute('href');
        state.textContent = '完成「' + prevName[key] + '」任务后解锁';
      }
    });

    /* —— 闯关印章：完成点亮 —— */
    document.querySelectorAll('.seal-item').forEach((item) => {
      const key = item.dataset.seal;
      if (progress[key] && progress[key].sealed) {
        item.classList.add('is-done');
        const stamp = item.querySelector('.seal-stamp');
        stamp.classList.remove('is-dim');
        item.querySelector('.seal-name').textContent = '已完成';
      }
    });

    /* —— 全部通关彩蛋提示 —— */
    if (order.every((k) => progress[k].sealed)) {
      setTimeout(() => toast('三印齐点亮，你已与三幅名画同游！'), 2200);
    }

    /* —— 纯对话版直达 —— */
    const directBtn = document.getElementById('cozeDirectBtn');
    const shareUrl = (YHTY_CONFIG.coze.shareUrl || '').trim();
    if (shareUrl) {
      directBtn.href = shareUrl;
    } else {
      directBtn.addEventListener('click', (e) => {
        e.preventDefault();
        toast('智能体链接配置中，敬请期待');
      });
    }

    /* —— 重置进度（页脚小按钮） —— */
    document.getElementById('resetProgress').addEventListener('click', () => {
      if (confirm('确定要清空全部闯关进度，重新开始吗？')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      }
    });
  }

  /* ============================================================
   * 展厅
   * ============================================================ */

  function initHall() {
    const hallKey = document.body.dataset.hall;
    let progress = loadProgress();

    /* —— 解锁守卫：未解锁直接访问时请回序厅 —— */
    if (!isHallUnlocked(hallKey, progress)) {
      toast('本展厅尚未解锁，请先完成前厅任务');
      setTimeout(() => { location.href = 'index.html'; }, 1600);
      return;
    }

    /* —— 任务状态恢复 —— */
    const hallState = progress[hallKey];
    document.querySelectorAll('.task-item').forEach((item) => {
      const task = item.dataset.task;
      if (hallState[task]) item.classList.add('is-done');
    });
    if (hallState.sealed) {
      const sealArea = document.getElementById('hallSealArea');
      if (sealArea) sealArea.hidden = false;
      /* 通栏小圆印同步点亮 */
      const sealMini = document.getElementById('hallSealMini');
      if (sealMini) sealMini.classList.remove('is-dim');
    }

    /** 完成任务：更新存储与界面，三任务全成则盖章解锁 */
    function completeTask(taskKey) {
      if (hallState[taskKey]) return;   // 已完成过，不重复处理
      hallState[taskKey] = true;
      saveProgress(progress);

      const item = document.querySelector(`.task-item[data-task="${taskKey}"]`);
      if (item) item.classList.add('is-done');

      const doneCount = ['find', 'interact', 'quiz'].filter((k) => hallState[k]).length;
      if (doneCount === 3 && !hallState.sealed) {
        hallState.sealed = true;
        saveProgress(progress);
        stampHallSeal();
      } else {
        toast('任务完成！');
      }
    }

    /** 盖章：印章砸下动画 + 通栏小圆印点亮 + 解锁提示 */
    function stampHallSeal() {
      const sealArea = document.getElementById('hallSealArea');
      const seal = document.getElementById('hallSeal');
      if (!sealArea) return;
      sealArea.hidden = false;
      seal.classList.add('is-stamping');
      const sealMini = document.getElementById('hallSealMini');
      if (sealMini) sealMini.classList.remove('is-dim');
      /* 按闯关顺序提示解锁的下一厅（最后一厅提示全部通关） */
      const order = YHTY_CONFIG.unlockOrder;
      const nextKey = order[order.indexOf(hallKey) + 1];
      if (nextKey) {
        toast('印章已点亮，已解锁《' + YHTY_CONFIG.halls[nextKey].name + '》厅');
      } else {
        toast('三厅印章全部点亮，你已与三幅名画同游！');
      }
    }

    /* —— 「我已答对」按钮（信任机制） —— */
    document.querySelectorAll('[data-quiz-btn]').forEach((btn) => {
      btn.addEventListener('click', () => completeTask('quiz'));
    });

    /* —— 环境音开关（Web Audio 程序合成，见 audio.js） —— */
    initAmbient(hallKey);

    /* —— 各厅专属交互 —— */
    const hallInits = { qianli: initQianli, fuchun: initFuchun, moputao: initMoputao };
    const soundHandlers = {};   // 由厅初始化函数按需填写 onBlow / onClap
    if (hallInits[hallKey]) hallInits[hallKey](completeTask, soundHandlers);

    /* —— 声音互动 —— */
    initSoundInteraction(soundHandlers);

    /* —— 对话区（扣子组件 / 移动端抽屉） —— */
    initChat();
  }

  /* ==================== 环境音开关 ==================== */

  function initAmbient(hallKey) {
    const btn = document.getElementById('ambientToggle');
    const state = document.getElementById('ambientState');
    if (!btn) return;
    if (!window.YHTYAmbient) {
      btn.disabled = true;
      return;
    }
    btn.addEventListener('click', () => {
      const on = YHTYAmbient.toggle(hallKey);
      btn.classList.toggle('is-on', on);
      if (state) state.textContent = on ? '已开' : '已关';
    });
  }

  /* ==================== 千里江山图厅 ==================== */

  function initQianli(completeTask, soundHandlers) {

    /* —— 长卷系统：拖滚 / 视差 / 导览 / 缩略导航 / 赏析联动 —— */
    YHTYScroll.create({
      viewport: document.getElementById('hsViewport'),
      track: document.getElementById('hsTrack'),
      img: document.getElementById('hsImg'),
      layers: [],
      nav: document.getElementById('hsNav'),
      navBox: document.getElementById('hsNavBox'),
      tourBtn: document.getElementById('hsTourBtn'),
      panel: document.getElementById('hsPanel'),
      tourSeconds: 40,
      segments: [
        { name: '卷首 · 江岸初启', text: '长卷从右往左徐徐展开，如顺江而行。十八岁的王希孟，把千里山河收进一卷之中。' },
        { name: '层峦叠翠', text: '石青、石绿，都是矿石磨成的颜料。九百年过去，青山依旧如宝石般明亮。' },
        { name: '主峰凌云', text: '全卷最高的主峰群在此耸立，群峰朝揖，如同乐章的最强音。' },
        { name: '江天辽阔', text: '长桥卧波，渔村野市，数百个豆粒大的小人儿在打鱼、行旅——这是一个可居可游的世界。' },
      ],
    });

    /* —— 长卷瀑布热点：点中变对勾（任务「找一找」） —— */
    const hsHotspot = document.getElementById('hsHotspotWaterfall');
    hsHotspot.addEventListener('click', () => {
      hsHotspot.classList.add('is-found');
      toast('找到藏在山涧的瀑布了！');
      completeTask('find');
    });

    /* —— 互动区：水墨动画引擎自动分割并驱动画中元素 —— */
    const canvas = document.getElementById('inkCanvas');
    const engine = new InkAnimationEngine(canvas);
    engine.loadImage('assets/images/qianli/interact.jpg');
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const type = engine.handleClick(
        (e.clientX - rect.left) * canvas.width / rect.width,
        (e.clientY - rect.top) * canvas.height / rect.height
      );
      if (type) {
        completeTask('interact');
        toast('画中之物应声而动！');
      }
    });

    /* —— 拍手：画卷轻颤（声音回调） —— */
    soundHandlers.onClap = function () {
      engine.onClap();
      toast('画中之物应声而动！');
    };
  }

  /* ==================== 富春山居图厅 ==================== */

  function initFuchun(completeTask, soundHandlers) {

    /* —— 长卷系统 —— */
    YHTYScroll.create({
      viewport: document.getElementById('hsViewport'),
      track: document.getElementById('hsTrack'),
      img: document.getElementById('hsImg'),
      layers: [],
      nav: document.getElementById('hsNav'),
      navBox: document.getElementById('hsNavBox'),
      tourBtn: document.getElementById('hsTourBtn'),
      panel: document.getElementById('hsPanel'),
      tourSeconds: 40,
      segments: [
        { name: '起 · 烟波初起', text: '七十九岁的黄公望，为道友无用师画富春山水，断断续续画了三四年。' },
        { name: '承 · 峰峦浑厚', text: '山体用「披麻皴」画成——线条像披散的麻绳，绵长沙润，正是江南土山的质感。' },
        { name: '转 · 江天一色', text: '墨色最淡处即是江天。留白不是空无，是初秋江面上的天光云影。' },
        { name: '合 · 远山长去', text: '此画曾被火焚殉葬，断为两段：《剩山图》在杭州，《无用师卷》在台北。2011年曾隔海合璧展出。' },
      ],
    });

    /* —— 长卷渔船热点：点中变对勾（任务「找一找」） —— */
    const hsHotspotBoat = document.getElementById('hsHotspotBoat');
    hsHotspotBoat.addEventListener('click', () => {
      hsHotspotBoat.classList.add('is-found');
      toast('找到那叶扁舟了！');
      completeTask('find');
    });

    /* —— 互动区：水墨动画引擎自动分割并驱动画中元素 —— */
    const canvas = document.getElementById('inkCanvas');
    const engine = new InkAnimationEngine(canvas);
    engine.loadImage('assets/images/fuchun/interact.jpg');
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const type = engine.handleClick(
        (e.clientX - rect.left) * canvas.width / rect.width,
        (e.clientY - rect.top) * canvas.height / rect.height
      );
      if (type) {
        completeTask('interact');
        toast('画中之物应声而动！');
      }
    });

    /* —— 吹气：风拂画卷，整体轻动（声音回调） —— */
    soundHandlers.onBlow = function () {
      engine.onBlow();
      toast('风起水动，松枝轻摆');
    };
  }

  /* ==================== 墨葡萄厅 ==================== */

  function initMoputao(completeTask, soundHandlers) {

    /* —— 互动区：水墨动画引擎自动分割并驱动画中元素 —— */
    const canvas = document.getElementById('inkCanvas');
    const engine = new InkAnimationEngine(canvas);
    engine.loadImage('assets/images/moputao/full.jpg');
    let putaoClicks = 0;
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const type = engine.handleClick(
        (e.clientX - rect.left) * canvas.width / rect.width,
        (e.clientY - rect.top) * canvas.height / rect.height
      );
      if (type) {
        if (putaoClicks === 0) completeTask('find');
        else completeTask('interact');
        putaoClicks++;
        toast('画中之物应声而动！');
      }
    });

    /* —— 轻语/吹气：风拂画卷，整体轻动（声音回调） —— */
    soundHandlers.onBlow = function () {
      engine.onBlow();
      toast('藤叶随风轻摆');
    };

    /* —— 局部放大窗：点击打开灯箱，点击灯箱关闭 —— */
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxCap = document.getElementById('lightboxCap');
    document.querySelectorAll('.detail-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        lightboxImg.src = btn.dataset.full;
        lightboxImg.alt = btn.dataset.cap;
        lightboxCap.textContent = btn.dataset.cap;
        lightbox.classList.add('is-open');
      });
    });
    lightbox.addEventListener('click', () => lightbox.classList.remove('is-open'));
  }

  /* ==================== 声音交互（授权 → 检测 → 回调） ==================== */

  function initSoundInteraction(soundHandlers) {
    const card = document.getElementById('soundCard');
    const status = document.getElementById('soundStatus');
    const enableBtn = document.getElementById('soundEnableBtn');
    const modal = document.getElementById('micModal');
    const meter = document.getElementById('micMeter');
    const meterBar = document.getElementById('micMeterBar');

    /* 环境不支持（非HTTPS/localhost）时优雅降级 */
    if (!window.YHTYAudio || !YHTYAudio.isSupported()) {
      card.classList.add('is-disabled');
      status.textContent = '当前环境不支持麦克风（需 HTTPS 或 localhost 访问）';
      enableBtn.disabled = true;
      return;
    }

    /* 点击「开启麦克风」→ 先弹授权说明弹窗 */
    enableBtn.addEventListener('click', () => modal.classList.add('is-open'));

    /* 暂不开启：关闭弹窗，功能保持未开启状态 */
    document.getElementById('micDeny').addEventListener('click', () => {
      modal.classList.remove('is-open');
      status.textContent = '未开启（可随时点击按钮开启）';
    });

    /* 允许授权：请求麦克风 → 启动检测 */
    document.getElementById('micAllow').addEventListener('click', async () => {
      modal.classList.remove('is-open');
      status.textContent = '正在请求授权……';
      const ok = await YHTYAudio.request();
      if (!ok) {
        /* 拒绝授权 / 无设备：优雅降级 */
        card.classList.add('is-disabled');
        status.textContent = '麦克风不可用，声音互动已关闭（其余功能不受影响）';
        enableBtn.disabled = true;
        return;
      }
      status.textContent = '聆听中……发出声音试试';
      enableBtn.disabled = true;
      enableBtn.textContent = '已开启';
      meter.classList.add('is-on');

      YHTYAudio.start({
        onLevel(level) {
          meterBar.style.width = Math.min(100, Math.round(level * 300)) + '%';
        },
        onBlow() { soundHandlers.onBlow && soundHandlers.onBlow(); },
        onClap() { soundHandlers.onClap && soundHandlers.onClap(); },
      });
    });
  }

  /* ==================== 对话区（扣子 Web SDK） ==================== */

  function initChat() {
    /* 移动端抽屉开关 */
    const fab = document.getElementById('chatFab');
    const drawerClose = document.getElementById('chatDrawerClose');
    const drawerMask = document.getElementById('chatDrawerMask');
    fab.addEventListener('click', () => document.body.classList.add('chat-drawer-open'));
    drawerClose.addEventListener('click', () => document.body.classList.remove('chat-drawer-open'));
    drawerMask.addEventListener('click', () => document.body.classList.remove('chat-drawer-open'));

    /* 选择挂载容器：桌面内嵌 / 手机抽屉 */
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const mountEl = document.getElementById(isMobile ? 'chatMountMobile' : 'chatMountDesktop');

    const botId = (YHTY_CONFIG.coze.botId || '').trim();
    const token = (YHTY_CONFIG.coze.token || '').trim();
    const shareUrl = (YHTY_CONFIG.coze.shareUrl || '').trim();

    /* 加载失败/未配置时的兜底：占位提示 + 跳转对话按钮 */
    function renderFallback(titleText) {
      mountEl.innerHTML =
        '<div class="chat-placeholder">' +
        '  <div class="chat-icon">💬</div>' +
        '  <div>' + titleText + '</div>' +
        '  <div class="chat-note">也可点击按钮，直接打开 AI 讲解员对话页。</div>' +
        (shareUrl
          ? '  <a class="btn btn--solid" style="margin-top:8px;" href="' + shareUrl + '" target="_blank" rel="noopener">与 AI 讲解员对话</a>'
          : '') +
        '</div>';
    }

    /* token 未配置：用 iframe 嵌入扣子分享页（组件较重，加载需要数秒），
       并在下方附「直达」兜底链接，避免加载失败时出现空白 */
    if (!botId || !token) {
      if (shareUrl) {
        mountEl.innerHTML =
          '<div class="chat-embed">' +
          '  <iframe src="' + shareUrl + '" allow="microphone" title="AI讲解员"></iframe>' +
          '  <a class="chat-embed-link" href="' + shareUrl + '" target="_blank" rel="noopener">对话区未加载？点此直达 →</a>' +
          '</div>';
      } else {
        renderFallback('AI 讲解员已就绪（点击按钮开始对话）');
      }
      return;
    }

    /* 扣子已配置：动态加载官方 Web SDK 并挂载 */
    const script = document.createElement('script');
    script.src = YHTY_CONFIG.coze.sdkUrl;
    script.onload = () => {
      try {
        /* 对照扣子平台「Web SDK」发布渠道提供的参数调整以下调用 */
        new CozeWebSDK.WebChatClient({
          config: { bot_id: botId },
          auth: { type: 'token', token: token },
          componentProps: { title: 'AI讲解员' },
          el: mountEl,
        });
      } catch (err) {
        console.error('扣子组件挂载失败：', err);
        renderFallback('AI 讲解员加载失败，请稍后再试');
      }
    };
    script.onerror = () => renderFallback('AI 讲解员加载失败，请检查网络');
    document.head.appendChild(script);
  }

  /* ==================== 启动 ==================== */

  const page = document.body.dataset.page;
  if (page === 'lobby') initLobby();
  if (page === 'hall') initHall();
})();
