/**
 * Evo 战绩几个页面之间共用的状态，**只在内存里**（不写本地存储，见 tests/static.test.mjs 的存储白名单）。
 * 模块在同一个小程序实例里是单例，切 tab、进出子页面都不会丢；重启小程序回到默认。
 *
 * - account：选中的游戏账号（有 2 个以上账号时）；null = 云函数默认挑最近玩过的那个，"all" = 全部账号
 * - dirty：绑定、解绑之后设成 true，各页面回到前台时重新读
 */
module.exports = {
  account: null,
  dirty: false
};
