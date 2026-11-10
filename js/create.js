/* =========================================================
 * 自由创作页：上传水墨画 → 本地分离笔墨 → 生成动态画面
 * 不依赖后端，图片不离开浏览器
 * ========================================================= */

(function () {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const pickBtn = document.getElementById('pickBtn');
  const sampleBtn = document.getElementById('sampleBtn');
  const stageWrap = document.getElementById('stageWrap');
  const canvas = document.getElementById('createCanvas');
  const stageHint = document.getElementById('stageHint');
  const micBtn = document.getElementById('micBtn');
  const reselectBtn = document.getElementById('reselectBtn');
  const toastEl = document.getElementById('toast');

  if (!dropZone || !canvas) return;

  const engine = new InkAnimationEngine(canvas);
  let toastTimer = null;

  const TYPE_NAMES = {
    cloud: '云气',
    water: '水纹',
    bird: '飞鸟',
    flower: '花叶',
    tree: '枝叶',
    person: '人物',
    building: '屋舍',
    mountain: '山石'
  };

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), 2200);
  }

  function showUpload() {
    engine.stop();
    engine.disableMic();
    micBtn.textContent = '🎤 声音互动';
    stageWrap.hidden = true;
    dropZone.hidden = false;
    fileInput.value = '';
  }

  async function runEngine(source) {
    dropZone.hidden = true;
    stageWrap.hidden = false;
    stageHint.hidden = false;
    stageHint.textContent = '正在分离笔墨…';

    try {
      await engine.loadImage(source);
      const count = engine.components.length;
      if (count > 0) {
        stageHint.textContent = '已识别 ' + count + ' 个笔墨元素 · 点击试试';
        setTimeout(() => { stageHint.hidden = true; }, 3200);
      } else {
        stageHint.hidden = false;
        stageHint.textContent = '未识别到可动元素，试试墨色更清晰的画';
      }
    } catch (err) {
      console.warn('图片加载失败：', err);
      stageHint.textContent = '图片加载失败，请换一张 JPG / PNG';
      setTimeout(showUpload, 1600);
    }
  }

  async function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) {
      toast('请选择 JPG / PNG / WEBP 图片');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast('图片超过 20MB，请先压缩后再上传');
      return;
    }
    await runEngine(file);
  }

  /* ---------- 选择与拖拽上传 ---------- */
  pickBtn.addEventListener('click', e => {
    e.stopPropagation();
    fileInput.click();
  });
  dropZone.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', e => {
    loadFile(e.target.files && e.target.files[0]);
  });
  sampleBtn.addEventListener('click', e => {
    e.stopPropagation();
    runEngine('assets/images/fuchun/display.jpg');
  });

  ['dragenter', 'dragover'].forEach(type => {
    dropZone.addEventListener(type, e => {
      e.preventDefault();
      dropZone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(type => {
    dropZone.addEventListener(type, e => {
      e.preventDefault();
      dropZone.classList.remove('is-dragover');
    });
  });
  dropZone.addEventListener('drop', e => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  /* ---------- 点击画中元素 ---------- */
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (e.clientX - rect.left) * (canvas.width / rect.width);
    const py = (e.clientY - rect.top) * (canvas.height / rect.height);
    const type = engine.handleClick(px, py);
    if (type) {
      const name = TYPE_NAMES[type] || '笔墨';
      toast(name + '应声而动');
    } else {
      toast('这里没有墨色，换个位置试试');
    }
  });

  /* ---------- 声音互动 ---------- */
  micBtn.addEventListener('click', async () => {
    if (engine.micOn) {
      engine.disableMic();
      micBtn.textContent = '🎤 声音互动';
      return;
    }
    const ok = await engine.enableMic();
    if (ok) {
      micBtn.textContent = '🔇 关闭声音';
      toast('对麦克风吹气或拍手试试');
    } else {
      toast('无法使用麦克风，可在浏览器设置中开启');
    }
  });

  reselectBtn.addEventListener('click', showUpload);

  /* 离开页面时释放麦克风 */
  window.addEventListener('beforeunload', () => engine.disableMic());
})();
