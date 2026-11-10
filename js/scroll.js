/* ============================================================
 * 与画同游 · 长卷系统（v2.0 新增）
 * 功能：横向拖滚长卷 / 多层视差 / 「随卷入画」自动导览 /
 *       全卷缩略导航条 / 侧栏竖排赏析面板段落联动
 * 观卷方向：从右往左（初始视口在卷首＝最右端，向左拖滚展卷）
 *
 * 【视差层素材替换说明】
 * 本系统已按层速度参数化实现视差机制（层越"远"移动越慢）。
 * 当前以主图（近景,速度1）+ CSS云雾层（远景,速度0.5）两层运行；
 * 抠图素材到位后，按命名规范（如 fuchun_yunwu_mid.png）放入
 * assets/images/<厅名>/layers/ 目录，在 HTML 的 .hs-layer-inner 中
 * 以 <img> 平铺并调整 data-speed 即可即插即用，无需改 JS。
 * ============================================================ */

(function () {
  'use strict';

  /**
   * 创建一套长卷系统
   * config = {
   *   viewport   滚动容器（overflow-x:auto 的元素）
   *   track      卷内容轨道（含绫边与画卷）
   *   img        画卷主图 <img>（用于监听加载完成后测量）
   *   layers     视差层数组：[{ el: 层内衬元素, speed: 速度0~1 }]
   *   nav        缩略导航条容器
   *   navBox     导航条上的视口位置框
   *   tourBtn    「随卷入画/停卷赏画」按钮
   *   panel      赏析面板容器（JS 在其中渲染段落）
   *   segments   赏析段落文案数组：[{ name, text }]（按卷首→卷尾顺序）
   *   tourSeconds 自动导览滚完全卷的时长（默认40秒）
   * }
   */
  function create(config) {
    const viewport = config.viewport;
    const track = config.track;
    const img = config.img;
    const layers = config.layers || [];
    const nav = config.nav || null;
    const navBox = config.navBox || null;
    const tourBtn = config.tourBtn || null;
    const panel = config.panel || null;
    const segments = config.segments || [];
    const tourSeconds = config.tourSeconds || 40;

    let vw = 0;          // 视口宽度
    let trackW = 0;      // 卷内容全宽（含绫边）
    let maxScroll = 0;   // 可滚动距离 = trackW - vw
    let currentSeg = -1; // 当前赏析段落序号
    let touring = false; // 是否正在自动导览
    let tourRaf = null;  // 导览动画帧句柄

    /* ---------- 测量与初始化 ---------- */

    function measure() {
      vw = viewport.clientWidth;
      trackW = track.scrollWidth;
      maxScroll = Math.max(0, trackW - vw);
      /* 视差层内衬宽度 = 视口宽 + 可滚距离×速度，
         保证滚到任意端点时层恰好对齐视口边缘、不露底 */
      layers.forEach(function (l) {
        l.el.style.width = (vw + maxScroll * l.speed) + 'px';
      });
      update();
    }

    /** 初始视口停在卷首（最右端） */
    function jumpToHead() {
      viewport.scrollLeft = maxScroll;
      update();
    }

    /* ---------- 每帧同步：视差 / 导航框 / 赏析联动 ---------- */

    function update() {
      const sl = viewport.scrollLeft;

      /* 视差：远层位移 = 滚动距离 × 速度（主图速度1，在文档流中自然跟随） */
      layers.forEach(function (l) {
        l.el.style.transform = 'translateX(' + (-sl * l.speed) + 'px)';
      });

      /* 缩略导航：视口位置框随滚动实时移动 */
      if (nav && navBox) {
        const navW = nav.clientWidth;
        const boxW = Math.max(24, navW * (vw / trackW));
        const x = maxScroll > 0 ? (sl / maxScroll) * (navW - boxW) : 0;
        navBox.style.width = boxW + 'px';
        navBox.style.transform = 'translateX(' + x + 'px)';
      }

      updateSegment();
    }

    /* ---------- 赏析面板段落联动 ---------- */

    /** 距卷首的阅读进度：0=卷首（最右端），1=卷尾（最左端） */
    function progressFromHead() {
      if (maxScroll <= 0) return 0;
      return 1 - viewport.scrollLeft / maxScroll;
    }

    function updateSegment() {
      if (!panel || !segments.length) return;
      /* 钳制进度与序号：防止重排瞬间 scrollLeft 超出 maxScroll 产生越界索引 */
      const p = Math.min(1, Math.max(0, progressFromHead()));
      const idx = Math.max(0, Math.min(segments.length - 1, Math.floor(p * segments.length)));
      if (idx === currentSeg) return;
      currentSeg = idx;
      /* 淡出 → 换文案 → 淡入（0.4s 过渡，见 CSS） */
      panel.classList.add('is-switching');
      setTimeout(function () {
        const seg = segments[idx];
        panel.querySelector('.hs-segment-name').textContent = seg.name;
        panel.querySelector('.hs-segment-text').textContent = seg.text;
        /* 段落指示点 */
        panel.querySelectorAll('.hs-segment-dot').forEach(function (dot, i) {
          dot.classList.toggle('is-on', i === idx);
        });
        panel.classList.remove('is-switching');
      }, currentSeg === -1 ? 0 : 200);
    }

    /** 渲染赏析面板骨架（段落指示点 + 文案容器） */
    function renderPanel() {
      if (!panel || !segments.length) return;
      let dotsHtml = '';
      segments.forEach(function (_, i) {
        dotsHtml += '<span class="hs-segment-dot' + (i === 0 ? ' is-on' : '') + '"></span>';
      });
      panel.innerHTML =
        '<div class="hs-segment">' +
        '  <div class="hs-segment-name">' + segments[0].name + '</div>' +
        '  <div class="hs-segment-text">' + segments[0].text + '</div>' +
        '</div>' +
        '<div class="hs-segment-dots">' + dotsHtml + '</div>';
      currentSeg = 0;
    }

    /* ---------- 「随卷入画」自动导览 ---------- */

    function startTour() {
      if (maxScroll <= 0 || touring) return;
      /* 若已停在卷尾（最左端），先跳回卷首再启程 */
      if (viewport.scrollLeft <= 1) viewport.scrollLeft = maxScroll;

      const from = viewport.scrollLeft;
      /* 全卷匀速40秒：从当前位置到卷尾的耗时按剩余比例折算，保证速度恒定 */
      const duration = tourSeconds * 1000 * (from / maxScroll);
      const t0 = performance.now();
      touring = true;
      if (tourBtn) {
        tourBtn.textContent = '停卷赏画';
        tourBtn.classList.add('is-touring');
      }

      function step(now) {
        if (!touring) return;
        const k = Math.min(1, (now - t0) / duration);
        viewport.scrollLeft = from * (1 - k);   // 匀速向左（向卷尾）
        if (k < 1) {
          tourRaf = requestAnimationFrame(step);
        } else {
          stopTour();
        }
      }
      tourRaf = requestAnimationFrame(step);
    }

    function stopTour() {
      if (!touring) return;
      touring = false;
      if (tourRaf) cancelAnimationFrame(tourRaf);
      tourRaf = null;
      if (tourBtn) {
        tourBtn.textContent = '随卷入画';
        tourBtn.classList.remove('is-touring');
      }
    }

    if (tourBtn) {
      tourBtn.addEventListener('click', function () {
        if (touring) stopTour(); else startTour();
      });
    }

    /* ---------- 拖滚交互（鼠标拖拽 / 触摸滑动 / 滚轮） ---------- */

    let dragging = false;
    let dragStartX = 0;
    let dragStartScroll = 0;
    let hasDraggedOnce = false;
    let dragMoved = 0;        // 本次拖拽的累计位移（px）
    let suppressClick = false; // 拖拽松手后拦截一次误触发的点击

    viewport.addEventListener('pointerdown', function (e) {
      stopTour();   // 任何手动操作立即接管，导览暂停
      suppressClick = false;   // 新手势开始，清掉上一次拖拽留下的拦截标记
      /* 热点自己处理点击：不启动拖拽、不做指针捕获，避免点击被视口吞掉 */
      if (e.target.closest('.hotspot')) return;
      dragging = true;
      dragMoved = 0;
      dragStartX = e.clientX;
      dragStartScroll = viewport.scrollLeft;
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add('is-dragging');
    });

    viewport.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dragMoved = Math.max(dragMoved, Math.abs(e.clientX - dragStartX));
      /* 向左拖（x减小）→ scrollLeft 减小 → 视口左移，长卷向左展开 */
      viewport.scrollLeft = dragStartScroll + (e.clientX - dragStartX);
      if (!hasDraggedOnce && dragMoved > 8) {
        hasDraggedOnce = true;
        viewport.classList.add('has-interacted');   // 隐藏拖滚提示
      }
    });

    function endDrag() {
      dragging = false;
      viewport.classList.remove('is-dragging');
      /* 拖拽超阈值后松手：若指针落在热点上会误触发 click，
         在捕获阶段拦截掉紧随其后的这一次点击 */
      if (dragMoved > 8) suppressClick = true;
    }
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    viewport.addEventListener('click', function (e) {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);

    /* 滚轮：纵向滚轮映射为横向滚动（向下滚＝向卷尾方向） */
    viewport.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      stopTour();
      viewport.scrollLeft -= e.deltaY;
      hasDraggedOnce = true;
      viewport.classList.add('has-interacted');
    }, { passive: false });

    viewport.addEventListener('scroll', update);

    /* ---------- 全卷缩略导航条（点击 / 拖动跳转） ---------- */

    if (nav) {
      let navDragging = false;

      function jumpByEvent(e) {
        const rect = nav.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        /* 让视口中心对齐点击位置 */
        viewport.scrollLeft = Math.min(maxScroll, Math.max(0, ratio * trackW - vw / 2));
      }

      nav.addEventListener('pointerdown', function (e) {
        stopTour();   // 跳转后若正在导览则暂停
        navDragging = true;
        nav.setPointerCapture(e.pointerId);
        jumpByEvent(e);
      });
      nav.addEventListener('pointermove', function (e) {
        if (navDragging) jumpByEvent(e);
      });
      nav.addEventListener('pointerup', function () { navDragging = false; });
      nav.addEventListener('pointercancel', function () { navDragging = false; });
    }

    /* ---------- 启动 ---------- */

    renderPanel();

    /* 图片加载完成后测量（缓存图可能已加载完成）；
       等首帧布局后再测量，确保拿到真实的卷内容宽度 */
    let readyDone = false;
    function ready() {
      if (readyDone) return;
      readyDone = true;
      requestAnimationFrame(function () {
        measure();
        jumpToHead();
        /* 兜底：加载初期布局偶有微调，稍后按当前进度再校准一次 */
        setTimeout(function () {
          const p = progressFromHead();
          measure();
          viewport.scrollLeft = (1 - p) * maxScroll;
          update();
        }, 200);
      });
    }
    if (img && !img.complete) {
      img.addEventListener('load', ready);
    } else {
      ready();
    }
    /* 页面全部资源就绪后再校准一次（保持相对位置） */
    window.addEventListener('load', function () {
      const p = progressFromHead();
      measure();
      viewport.scrollLeft = (1 - p) * maxScroll;
      update();
    });
    /* 视口尺寸变化（旋转屏幕、窗口缩放）后重新测量并保持相对位置 */
    window.addEventListener('resize', function () {
      const p = progressFromHead();
      measure();
      viewport.scrollLeft = (1 - p) * maxScroll;
      update();
    });

    return {
      stopTour: stopTour,
      /* 供外部（如热点点击）调用：跳转到卷上指定比例位置（0=卷首端，1=卷尾端） */
      scrollToRatio: function (ratio) {
        stopTour();
        viewport.scrollLeft = (1 - ratio) * maxScroll;
      },
    };
  }

  window.YHTYScroll = { create: create };
})();
