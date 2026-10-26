// 小程序里「我的战绩」「我的」调用的云函数（AI-CONTEXT.md §17「Evo 战绩」）。
// 调用者是微信用户（OPENID，微信自动带上），只能看、改自己绑定的电脑的数据。
// 统计在 stats.js（纯函数）；这里只回数字和代号，中英文由小程序的 evo/utils/view.js 拼。
//
// event.action：
// - status：绑定了没有（「战绩」页决定默认显示哪一栏）
// - bind：{ code } 扫码绑定，把绑定码对应的电脑绑到这个微信
// - me：绑定的电脑、游戏账号
// - unbind：{ device, delete_data } 解绑一台电脑，delete_data 为 true 时同时删掉它传上来的数据
// - overview：{ account, range } 我的战绩（段位、RP 走势、统计数字、最近对局、传奇表现）
// - matches：{ account, mode, review, page } 全部对局（每页 20 局）
// - match：{ id } 单局详情（含队友）
// 回 { ok: true, ... } 或 { ok: false, error }：error 是代号（bad_code / used / expired / not_yours / not_found /
// no_identity / bad_request / server），小程序按语言显示对应的话
const cloud = require('wx-server-sdk')
const S = require('./stats')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const PER_PAGE = 20

// ---------- 读数据：集合还没建（还没有电脑传过数据）当作没有 ----------

function missingCollection(err) {
  return err && (err.errCode === -502005 || /collection.*not.*exist/i.test(String(err.message || err.errMsg)))
}

async function safe(fn, empty) {
  try {
    return await fn()
  } catch (err) {
    if (missingCollection(err)) return empty
    throw err
  }
}

async function getAll(query) {
  const out = []
  for (let skip = 0; skip < 20000; skip += 1000) {
    const res = await query.skip(skip).limit(1000).get()
    out.push(...res.data)
    if (res.data.length < 1000) break
  }
  return out
}

async function myDevices(openid) {
  return safe(() => getAll(db.collection('evo_devices').where({ openid })), [])
}

async function myAccounts(uids) {
  if (!uids.length) return { accounts: [], bounds: [] }
  return S.mergeAccounts(await safe(() => getAll(db.collection('evo_accounts').where({ uid: _.in(uids) })), []))
}

async function myRows(name, uids, timeKey) {
  if (!uids.length) return []
  const rows = await safe(() => getAll(db.collection(name).where({ uid: _.in(uids) })), [])
  return rows.sort(S.byTime(timeKey))
}

async function loadAll(openid, account) {
  const devices = await myDevices(openid)
  const uids = devices.map((d) => d._id)
  const [rows, lobby, acc] = await Promise.all([
    myRows('evo_matches', uids, 'ended_at'), myRows('evo_lobby', uids, 'read_at'), myAccounts(uids),
  ])
  const view = S.accountView(acc.accounts, rows, account)
  return {
    devices, view, bounds: acc.bounds, now: S.localNow(S.deviceTz(devices)),
    rows: S.onlyAccount(rows, view.filter), lobby: S.onlyAccount(lobby, view.filter),
  }
}

// ---------- 各个 action ----------

async function status(openid) {
  return { ok: true, bound: (await myDevices(openid)).length > 0 }
}

async function bind(openid, event) {
  const code = typeof event.code === 'string' ? event.code.trim().toUpperCase() : ''
  if (!/^[A-Z0-9]{6,16}$/.test(code)) return { ok: false, error: 'bad_code' }
  let doc = null
  try {
    doc = (await db.collection('evo_bind_codes').doc(code).get()).data
  } catch (err) {
    doc = null
  }
  if (!doc) return { ok: false, error: 'bad_code' }
  if (doc.used) return { ok: false, error: 'used' }
  if (Date.now() > doc.expires_at) return { ok: false, error: 'expired' }
  await db.collection('evo_bind_codes').doc(code).update({ data: { used: true, used_at: Date.now() } })
  await db.collection('evo_devices').doc(doc.uid).update({ data: { openid, bound_at: Date.now() } })
  return { ok: true }
}

async function me(openid) {
  const devices = await myDevices(openid)
  const uids = devices.map((d) => d._id)
  const counts = await Promise.all(uids.map((uid) => safe(() => db.collection('evo_matches').where({ uid }).count(), { total: 0 })))
  const { accounts } = await myAccounts(uids)
  const tz = S.deviceTz(devices)
  return {
    ok: true,
    devices: devices.sort((a, b) => (a.bound_at || 0) - (b.bound_at || 0)).map((d) => ({
      id: d._id,
      bound_at: S.stampText(d.bound_at, tz),
      last_upload_at: d.last_upload_at ? S.stampText(new Date(d.last_upload_at).getTime(), tz) : null,
      app_version: d.app_version || null,
      matches: (counts[uids.indexOf(d._id)] || {}).total || 0,
    })),
    accounts: accounts.map((a) => ({ name: a.name, names: a.keys.size })),
  }
}

async function unbind(openid, event) {
  const uid = typeof event.device === 'string' ? event.device : ''
  const devices = await myDevices(openid)
  if (!devices.some((d) => d._id === uid)) return { ok: false, error: 'not_yours' }
  await db.collection('evo_devices').doc(uid).update({ data: { openid: null, unbound_at: Date.now() } })
  if (event.delete_data === true) {
    for (const name of ['evo_matches', 'evo_lobby']) await safe(() => db.collection(name).where({ uid }).remove(), null)
    await db.collection('evo_accounts').doc(uid).remove().catch(() => null)
  }
  return { ok: true, deleted: event.delete_data === true }
}

async function overview(openid, event) {
  const { devices, view, bounds, now, rows, lobby } = await loadAll(openid, event.account)
  const range = event.range === 'all' ? 'all' : '30'
  const inRange = range === '30' ? rows.slice(-30) : rows
  const since = S.dayStartText(now)
  const today = rows.filter((r) => (r.ended_at || '') >= since)
  return {
    ok: true,
    bound: devices.length > 0,
    accounts: S.publicAccounts(view),
    account: view.current,
    range,
    today: now.date,
    yesterday: now.yesterday,
    total: rows.length,
    rank: S.rankCard(rows, lobby),
    chart: S.rpChart(inRange, lobby, bounds),
    range_rp: S.rpSum(inRange),
    today_rp: S.rpSum(today),
    today_games: today.length,
    stats: S.groupNumbers(inRange),
    recent: rows.slice(-5).reverse().map(S.rowData),
    legends: S.legendBars(inRange),
    review_count: rows.filter((r) => r.needs_review).length,
  }
}

async function matches(openid, event) {
  const { devices, view, now, rows } = await loadAll(openid, event.account)
  let list = rows.slice().reverse()
  const mode = S.MODES.includes(event.mode) ? event.mode : null
  if (mode) list = list.filter((r) => r.mode === mode)
  if (event.review === true) list = list.filter((r) => r.needs_review)
  const page = Math.max(1, Number.isInteger(event.page) ? event.page : 1)
  return {
    ok: true,
    bound: devices.length > 0,
    accounts: S.publicAccounts(view),
    account: view.current,
    mode,
    review: event.review === true,
    review_count: rows.filter((r) => r.needs_review).length,
    today: now.date,
    yesterday: now.yesterday,
    total: list.length,
    page,
    pages: Math.max(1, Math.ceil(list.length / PER_PAGE)),
    rows: list.slice((page - 1) * PER_PAGE, page * PER_PAGE).map(S.rowData),
  }
}

async function match(openid, event) {
  const id = typeof event.id === 'string' ? event.id : ''
  const devices = await myDevices(openid)
  if (!devices.some((d) => d._id === id.split(':')[0])) return { ok: false, error: 'not_found' }
  let row = null
  try {
    row = (await db.collection('evo_matches').doc(id).get()).data
  } catch (err) {
    row = null
  }
  if (!row) return { ok: false, error: 'not_found' }
  const now = S.localNow(S.deviceTz(devices))
  return { ok: true, match: S.detailData(row), today: now.date, yesterday: now.yesterday }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, error: 'no_identity' }
  try {
    switch (event && event.action) {
      case 'status': return await status(OPENID)
      case 'bind': return await bind(OPENID, event)
      case 'me': return await me(OPENID)
      case 'unbind': return await unbind(OPENID, event)
      case 'overview': return await overview(OPENID, event)
      case 'matches': return await matches(OPENID, event)
      case 'match': return await match(OPENID, event)
      default: return { ok: false, error: 'bad_request' }
    }
  } catch (err) {
    console.error(err)
    return { ok: false, error: 'server' }
  }
}
