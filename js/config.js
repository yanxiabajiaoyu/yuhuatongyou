/* ============================================================
 * 与画同游 · 配置中心
 * 所有需要后续替换/填写的配置都集中在本文件，改这里即可，不用动其他代码。
 * ============================================================ */

const YHTY_CONFIG = {

  /* ---------- 扣子智能体配置（待你在扣子平台发布后填写） ---------- */
  coze: {
    // 「纯对话版直达」按钮跳转的扣子智能体分享链接
    shareUrl: 'https://www.coze.cn/store/agent/7706197320907948047?bot_id=true',

    // 扣子 Web SDK 配置（三个展厅共用一个智能体，填写一次即可）
    // 前提：扣子平台 → 发布 → 已开通「Web SDK」渠道，否则组件无法加载
    botId: '7706197320907948047',   // 智能体 bot_id
    // Web SDK 鉴权 token：扣子要求 token 类型鉴权。
    // 获取方式：扣子开放平台 → 授权 → 生成访问令牌（个人访问令牌 PAT 可直接填入测试）。
    // 注意：token 会暴露在前端代码中，正式部署建议使用扣子提供的短期令牌方案。
    // 若 token 为空，对话区自动降级为 iframe 内嵌分享链接，并附「直达」兜底链接。
    token: '',
    // Web SDK 脚本地址（扣子官方 CDN，一般无需修改）
    sdkUrl: 'https://lf-cdn.coze.cn/obj/unpkg/flow-platform/chat-app-sdk/1.2.0-beta.6/libs/cn/index.js',
  },

  /* ---------- 三幅画档案信息（展示区标注用） ---------- */
  halls: {
    qianli: {
      key: 'qianli',
      name: '千里江山图',
      author: '王希孟',
      dynasty: '北宋',
      collection: '故宫博物院藏',
      // 占位图阶段：图像来源标注为占位说明；正式素材替换后改为真实来源（如「故宫名画记」）
      source: '占位示意图 · 正式图像待替换（拟来源：故宫名画记，公有领域）',
      page: 'hall-qianli.html',
    },
    fuchun: {
      key: 'fuchun',
      name: '富春山居图',
      author: '黄公望',
      dynasty: '元',
      collection: '《剩山图》浙江省博物馆藏 · 《无用师卷》台北故宫博物院藏',
      source: '占位示意图 · 正式图像待替换（拟来源：公开渠道，公有领域）',
      page: 'hall-fuchun.html',
    },
    moputao: {
      key: 'moputao',
      name: '墨葡萄图',
      author: '徐渭',
      dynasty: '明',
      collection: '故宫博物院藏',
      source: '占位示意图 · 正式图像待替换（拟来源：公开渠道，公有领域）',
      page: 'hall-moputao.html',
    },
  },

  /* ---------- 闯关顺序（严格按此顺序解锁） ---------- */
  unlockOrder: ['qianli', 'fuchun', 'moputao'],
};
