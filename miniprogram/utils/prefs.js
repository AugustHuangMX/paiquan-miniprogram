/**
 * 界面偏好：语言 / 主题 / 展示哪些模式 / 置顶哪个模式。
 *
 * **2026-10 起改为写本地存储**（之前是纯内存，重启就丢 —— 对一个"设置"功能来说体验太差）。
 *
 * 存的东西**只有界面偏好，不含任何个人信息**：
 * 没有 openid、没有查询记录、没有任何能定位到具体某个人的东西。
 * 项目原本"不使用本地存储"的承诺相应收窄为「**不保存用户数据**」，
 * tests/static.test.mjs 里那条测试也照着这个口径重写了。
 *
 * 共用一条 storage key，四个偏好放一个对象里 —— 少一条 key 少一次读写。
 */
var KEY = "ui_prefs";
var MEM = null;

/** 读出全部偏好（进程内缓存，避免每次 get 都碰一次存储） */
function all() {
  if (MEM) return MEM;
  var v = null;
  try {
    v = wx.getStorageSync(KEY);
  } catch (e) {
    v = null;   // 存储不可用（测试环境 / 存储被清）也要能用，退回默认值
  }
  MEM = (v && typeof v === "object" && !Array.isArray(v)) ? v : {};
  return MEM;
}

/**
 * @param {string} k 偏好名
 * @param {*} dflt 读不到时返回它
 */
function get(k, dflt) {
  var v = all()[k];
  return (v === undefined || v === null) ? dflt : v;
}

function set(k, v) {
  var o = all();
  o[k] = v;
  try {
    wx.setStorageSync(KEY, o);
  } catch (e) {
    // 存不下也不影响本次会话，只是下次进来回到默认
  }
  return v;
}

/** 清掉全部偏好（目前只有测试用） */
function clear() {
  MEM = {};
  try { wx.removeStorageSync(KEY); } catch (e) { /* 忽略 */ }
}

module.exports = { KEY: KEY, get: get, set: set, clear: clear };
