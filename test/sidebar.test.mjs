// DOM-level test for dsh-sidebar-pins.
//
// It builds a fake stock sidebar (a `role="tree"` with session rows carrying
// React-fiber-shaped props), applies the plugin against a stub context, and
// drives the real handlers: pin from a stock row, reopen the menu on the
// plugin-owned pinned row, mark unread, unpin, dispose.
//
//   node test/sidebar.test.mjs
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log('  ok   ' + label)
    return
  }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' -> ' + detail))
}

function section(title) {
  console.log('\n# ' + title)
}

/* --------------------------------------------------------------- fixtures */

const TITLE_A = '简历结合生成五道面试题'
const TITLE_B = '拉取 codex-skills 技能仓库'

// The stock row owns a ⋯ trigger inside its actions container (session rows
// hold exactly one; project rows hold it first and ＋ second); the plugin is
// expected to claim that trigger instead of injecting a second ⋯.
const STOCK_MENU_BUTTON = '<button type="button" class="iconButton" aria-label="会话操作"><svg class="dotsIcon"></svg></button>'
const STOCK_PLUS_BUTTON = '<button type="button" class="iconButton" aria-label="新建会话"><svg class="plusIcon"></svg></button>'

function buildDom() {
  return new JSDOM(
    '<!doctype html><html><head></head><body>' +
      '<div class="sidebarRoot">' +
      '<div class="treeBodyWrapper">' +
      '<div role="tree" class="tree">' +
      '<div class="groupSection">' +
      '<div role="treeitem" class="groupRow" aria-selected="false"><span class="title">vino</span>' +
      '<span class="rowActions">' + STOCK_MENU_BUTTON + STOCK_PLUS_BUTTON + '</span></div>' +
      '<div role="treeitem" class="sessionRow" aria-selected="true">' +
      '<span class="title">' + TITLE_A + '</span><span class="rowTime">8 分钟</span>' +
      '<span class="rowActions">' + STOCK_MENU_BUTTON + '</span>' +
      '</div>' +
      '<div role="treeitem" class="sessionRow" aria-selected="false">' +
      '<span class="title">' + TITLE_B + '</span><span class="rowTime">45 分钟</span>' +
      '<span class="rowActions">' + STOCK_MENU_BUTTON + '</span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</body></html>',
    { url: 'http://127.0.0.1:43120/', pretendToBeVisual: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' },
  )
}

/** Attach a minimal React-fiber chain: the props live one hop above the node. */
function attachFiber(el, props) {
  el['__reactFiber$test1'] = { memoizedProps: {}, return: { memoizedProps: props, return: null } }
}

function installGlobals(dom) {
  const w = dom.window
  globalThis.window = w
  globalThis.document = w.document
  // Node exposes `navigator` as a getter-only global, so define over it.
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true, writable: true })
  globalThis.Node = w.Node
  globalThis.Element = w.Element
  globalThis.HTMLElement = w.HTMLElement
  globalThis.MouseEvent = w.MouseEvent
  globalThis.MutationObserver = w.MutationObserver
  globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w)
  globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w)
}

function makeContext() {
  const now = Date.now()
  const list = {
    phase: 'ready',
    ids: ['session-A', 'session-B'],
    current: 'session-A',
    byId: {
      'session-A': { id: 'session-A', title: TITLE_A, displayTitle: TITLE_A, updatedAt: now - 8 * 60000, blank: false, cwd: '/Users/dev/projects/demo' },
      'session-B': { id: 'session-B', title: TITLE_B, displayTitle: TITLE_B, updatedAt: now - 45 * 60000, blank: false, cwd: '/Users/dev/projects/demo' },
    },
  }
  const workspaceList = {
    items: [
      { workspaceId: 'ws-1', path: '/Users/dev/projects/demo', title: 'vino', sessionIds: ['session-A', 'session-B'], createdAt: new Date(now - 3600000).toISOString(), updatedAt: new Date(now).toISOString() },
    ],
    archivedSessionIds: [],
  }
  const calls = []
  const disposers = []
  const ctx = {
    sessions: {
      list: { getSnapshot: () => list },
      open: (id) => calls.push(['open', id]),
      fork: async () => 'session-child',
      refresh: () => calls.push(['refresh']),
      binding: () => ({ session: { rename: async (title) => ({ ok: true, value: { title, seq: 1 } }) } }),
    },
    workspaces: {
      list: { getSnapshot: () => workspaceList },
      archiveSession: async (id) => calls.push(['archive', id]),
      insertBefore: async (a, b) => calls.push(['insertBefore', a, b]),
      rename: async (id, title) => calls.push(['renameWorkspace', id, title]),
      delete: async (id) => calls.push(['deleteWorkspace', id]),
      startSession: (id) => calls.push(['startSession', id]),
    },
    effect: (fn) => { disposers.push(fn()) },
  }
  return { ctx, calls, disposers, list }
}

/** Label text of every menu item in a scope (icons and hints are separate spans). */
function labelsOf(scope) {
  return Array.from(scope.querySelectorAll('.dsh-pins-menu-label')).map((n) => n.textContent)
}

/** Find the menu button whose label span reads exactly `text`. */
function itemByLabel(scope, text) {
  return Array.from(scope.querySelectorAll('.dsh-pins-menu-item')).find((b) => {
    const label = b.querySelector('.dsh-pins-menu-label')
    return label !== null && label.textContent === text
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const dom = buildDom()
  installGlobals(dom)
  const doc = dom.window.document

  const fetches = []
  globalThis.fetch = async (url, init) => {
    fetches.push({ url: String(url), body: init && init.body ? JSON.parse(String(init.body)) : null })
    return { ok: true, status: 200, json: async () => ({ ok: true, removed: true, archived: 1, unregistered: true }) }
  }

  const rows = doc.querySelectorAll('[role="treeitem"][class*="sessionRow"]')
  attachFiber(rows[0], { node: { id: 'session-A', updatedAt: Date.now() - 8 * 60000, blank: false, title: TITLE_A } })
  attachFiber(rows[1], { node: { id: 'session-B', updatedAt: Date.now() - 45 * 60000, blank: false, title: TITLE_B } })
  attachFiber(doc.querySelector('[class*="groupRow"]'), { group: { workspaceId: 'ws-1', label: 'vino' } })

  let definition = null
  const originalWindow = globalThis.window
  originalWindow.__ModuleLoader__ = { load: (value) => { definition = value } }
  new Function(SOURCE)()
  check('module registers under its plugin id', definition && definition.id === 'dsh-sidebar-pins', definition && definition.id)
  const plugin = definition.factory(() => { throw new Error('the plugin must not require other modules') })
  check('plugin name matches the bundle row', plugin.name === 'dsh-sidebar-pins', plugin.name)
  check('plugin injects sessions + workspaces', JSON.stringify(plugin.inject) === '["sessions","workspaces"]', JSON.stringify(plugin.inject))

  const { ctx, calls, disposers } = makeContext()
  plugin.apply(ctx)
  await sleep(60)

  section('layout')
  const split = doc.querySelector('[data-dsh-pins-split]')
  check('sidebar is split into panes', split !== null)
  const pinnedPane = doc.querySelector('[data-dsh-pins-pane="pinned"]')
  const recentPane = doc.querySelector('[data-dsh-pins-pane="recent"]')
  check('pinned pane exists', pinnedPane !== null)
  check('recent pane exists', recentPane !== null)
  check('pinned pane heading reads 置顶', pinnedPane.querySelector('.dsh-pins-heading span').textContent === '置顶')
  check('recent pane heading reads 最近', recentPane.querySelector('.dsh-pins-heading span').textContent === '最近')
  check('stock tree moved into the recent pane', recentPane.contains(doc.querySelector('[role="tree"]')))
  check('empty pinned pane shows its hint', !pinnedPane.querySelector('.dsh-pins-empty').hidden)

  section('stock rows')
  const rowA = rows[0]
  const rowB = rows[1]
  const pinA = rowA.querySelector('.dsh-pins-rowbtn[data-role="pin"]')
  const pinB = rowB.querySelector('.dsh-pins-rowbtn[data-role="pin"]')
  check('row A got a pin button', pinA !== null)
  check('row B got a pin button', pinB !== null)
  check('row A keeps the stock ⋯ as its only menu button', rowA.querySelectorAll('button[class*="iconButton"]').length === 1)
  const pinMarkup = pinA.innerHTML
  check('the pin is the Material push_pin glyph at the native 16px size',
    pinMarkup.indexOf('viewBox="0 0 24 24"') !== -1 && pinMarkup.indexOf('M16 9V4h1c.55 0') !== -1 && pinMarkup.indexOf('width="16"') !== -1,
    pinMarkup.slice(0, 96))
  const pluginCss = doc.querySelector('style[data-plugin="dsh-sidebar-pins"]').textContent
  check('the pin button adopts the native icon metrics',
    pluginCss.indexOf('.dsh-pins-rowbtn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;') !== -1)
  check('the pin button hovers to the primary label colour like the stock trigger',
    pluginCss.indexOf('.dsh-pins-rowbtn:hover,.dsh-pins-rowbtn:focus-visible{color:var(--dsw-alias-label-primary') !== -1)
  check('a pinned pin is coloured with the brand alias', pluginCss.indexOf('.dsh-pins-rowbtn.is-pinned{color:var(--dsw-alias-brand') !== -1)
  check('row A is attributed by our own attribute', rowA.getAttribute('data-dsh-pins-id') === 'session:session-A', rowA.getAttribute('data-dsh-pins-id'))
  check('the workspace row is attributed too', doc.querySelector('[class*="groupRow"]').getAttribute('data-dsh-pins-id') === 'workspace:ws-1')

  section('one ⋯ per stock row')
  const nativeTrigger = rowA.querySelector('[class*="rowActions"] button[class*="iconButton"]')
  check('the stock row still owns exactly one ⋯ trigger', rowA.querySelectorAll('button[class*="iconButton"]').length === 1)
  check('the plugin injects no second ⋯', rowA.querySelector('.dsh-pins-rowbtn[data-role="more"]') === null)
  check('the plugin pin sits before the stock trigger', rowA.querySelector('[class*="rowActions"]').firstChild.getAttribute('data-role') === 'pin')
  let stockHandlerRuns = 0
  nativeTrigger.addEventListener('click', () => { stockHandlerRuns += 1 })
  nativeTrigger.querySelector('svg').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(20)
  const claimedMenu = doc.querySelector('.dsh-pins-menu')
  const claimedLabels = claimedMenu ? labelsOf(claimedMenu) : []
  check('clicking the stock ⋯ opens our menu', claimedMenu !== null)
  const codexOrder = ['重命名', '置顶', '标记为未读', '归档', '复制', '分叉', '在新窗口中打开', '在 Finder 中打开']
  check('the claimed menu is the full feature set in Codex order', JSON.stringify(claimedLabels) === JSON.stringify(codexOrder), JSON.stringify(claimedLabels))
  check('the stock handler never runs for a claimed trigger', stockHandlerRuns === 0, stockHandlerRuns)
  doc.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))

  const wsPlus = doc.querySelector('[class*="groupRow"]').querySelectorAll('button[class*="iconButton"]')[1]
  let plusRuns = 0
  wsPlus.addEventListener('click', () => { plusRuns += 1 })
  wsPlus.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(20)
  check('the workspace ＋ button is left to the app', plusRuns === 1 && doc.querySelector('.dsh-pins-menu') === null, plusRuns)

  section('pin from a stock row')
  pinB.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(60)
  const pinList = pinnedPane.querySelector('.dsh-pins-list')
  const pinnedRows = pinList.querySelectorAll('.dsh-pins-row')
  check('pinned pane holds exactly one row', pinnedRows.length === 1, pinnedRows.length)
  check('pinned row is the clicked session (closure captured the right id)', pinnedRows[0] && pinnedRows[0].getAttribute('data-dsh-pins-id') === 'session:session-B', pinnedRows[0] && pinnedRows[0].getAttribute('data-dsh-pins-id'))
  check('pinned row shows the session title', pinnedRows[0] && pinnedRows[0].querySelector('.dsh-pins-title').textContent === TITLE_B, pinnedRows[0] && pinnedRows[0].querySelector('.dsh-pins-title').textContent)
  check('official row for the pinned session is hidden', rowB.style.display === 'none', rowB.style.display)
  check('other official row stays visible', rowA.style.display !== 'none')
  check('pinned pane count shows 1', pinnedPane.querySelector('.dsh-pins-count').textContent === '1')
  const pinnedDots = pinnedRows[0] ? pinnedRows[0].querySelector('.dsh-pins-rowbtn[data-role="more"], .dsh-pins-actions .dsh-pins-rowbtn') : null
  check('the pinned row ⋯ reuses the native ellipsis geometry', pinnedDots !== null && pinnedDots.innerHTML.indexOf('M4.55146 8.00001') !== -1)
  const pinnedToggle = pinnedRows[0] ? pinnedRows[0].querySelector('.dsh-pins-rowbtn.is-pinned') : null
  check('the pinned row toggle carries the pin glyph and the pinned colour class',
    pinnedToggle !== null && pinnedToggle.innerHTML.indexOf('M16 9V4h1c.55 0') !== -1 && pinnedToggle.classList.contains('is-pinned'))
  check('stored pin id is the raw session id', JSON.parse(dom.window.localStorage.getItem('dsh-sidebar-pins.v1')).pinned[0] === 'session-B')

  section('menu on the plugin-owned pinned row')
  const pinnedRow = pinnedRows[0]
  pinnedRow.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
  await sleep(20)
  const menu = doc.querySelector('.dsh-pins-menu')
  check('right-click on a pinned row opens our menu', menu !== null)
  const labels = menu ? labelsOf(menu) : []
  const expected = ['重命名', '取消置顶', '标记为未读', '归档', '复制', '分叉', '在新窗口中打开', '在 Finder 中打开']
  check('menu carries the full session feature set in Codex order', JSON.stringify(labels) === JSON.stringify(expected), JSON.stringify(labels))

  section('menu actions')
  const unreadItem = itemByLabel(menu, '标记为未读')
  unreadItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(60)
  check('unread state lands on the pinned row', pinnedRow.getAttribute('data-dsh-pins-unread') === '1', pinnedRow.getAttribute('data-dsh-pins-unread'))
  check('unread state lands on the hidden stock row', rowB.getAttribute('data-dsh-pins-unread') === '1', rowB.getAttribute('data-dsh-pins-unread'))

  pinnedRow.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
  await sleep(20)
  const reopen = doc.querySelector('.dsh-pins-menu')
  const archiveItem = itemByLabel(reopen, '归档')
  archiveItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(20)
  check('归档 calls the workspace service', JSON.stringify(calls).includes('["archive","session-B"]'), JSON.stringify(calls))

  section('unpin from the pinned row')
  pinnedRow.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
  await sleep(20)
  const menu2 = doc.querySelector('.dsh-pins-menu')
  const unpin = itemByLabel(menu2, '取消置顶')
  unpin.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(60)
  check('pinned pane is empty again', pinnedPane.querySelectorAll('.dsh-pins-row').length === 0)
  check('official row is visible again', rowB.style.display !== 'none', rowB.style.display)
  check('stored pin list is empty', JSON.parse(dom.window.localStorage.getItem('dsh-sidebar-pins.v1')).pinned.length === 0)
  check('empty hint is back', !pinnedPane.querySelector('.dsh-pins-empty').hidden)

  section('self-heal when React replaces a row')
  const recreated = doc.createElement('div')
  recreated.setAttribute('role', 'treeitem')
  recreated.className = 'sessionRow'
  recreated.setAttribute('aria-selected', 'false')
  const recreatedTitle = doc.createElement('span')
  recreatedTitle.className = 'title'
  recreatedTitle.textContent = TITLE_B
  const recreatedActions = doc.createElement('span')
  recreatedActions.className = 'rowActions'
  recreated.append(recreatedTitle, recreatedActions)
  attachFiber(recreated, { node: { id: 'session-B', updatedAt: Date.now() - 45 * 60000, blank: false, title: TITLE_B } })
  rowB.replaceWith(recreated)
  await sleep(60)
  check('a React-replaced row is re-attributed', recreated.getAttribute('data-dsh-pins-id') === 'session:session-B', recreated.getAttribute('data-dsh-pins-id'))
  const recreatedPin = recreated.querySelector('.dsh-pins-rowbtn[data-role="pin"]')
  check('a React-replaced row gets its buttons back', recreatedPin !== null)
  recreatedPin.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(60)
  check('pinning from the replaced row hides it', recreated.style.display === 'none', recreated.style.display)
  check('pinned pane shows the session again', pinnedPane.querySelectorAll('.dsh-pins-row').length === 1)

  section('reveal in the file manager')
  rowA.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }))
  await sleep(20)
  const revealMenu = doc.querySelector('.dsh-pins-menu')
  const revealItem = itemByLabel(revealMenu, '在 Finder 中打开')
  check('the session menu offers a file-manager item (macOS label)', revealItem !== undefined)
  check('the file-manager item is enabled when the session has a cwd', revealItem && revealItem.disabled === false)
  revealItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(20)
  const revealCall = fetches[fetches.length - 1]
  check('it calls the shipped open-in-app route', revealCall && revealCall.url === '/open-in-app/open', revealCall && revealCall.url)
  check('it asks for finder on macOS with the session cwd', revealCall && revealCall.body && revealCall.body.app === 'finder' && revealCall.body.path === '/Users/dev/projects/demo', JSON.stringify(revealCall && revealCall.body))

  section('delete workspace with disk')
  const wsRow = doc.querySelector('[class*="groupRow"]')
  wsRow.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))
  await sleep(20)
  const wsMenu = doc.querySelector('.dsh-pins-menu')
  const wsLabels = labelsOf(wsMenu)
  check('the workspace menu offers the destructive item', wsLabels.indexOf('删除工作区（含磁盘）') !== -1, JSON.stringify(wsLabels))
  const deleteItem = itemByLabel(wsMenu, '删除工作区（含磁盘）')
  deleteItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(20)
  const modal = doc.querySelector('.dsh-pins-modal')
  check('a typed confirmation modal opens', modal !== null)
  check('the modal spells out the consequence', modal && modal.querySelector('.dsh-pins-modal-hint') !== null && modal.querySelector('.dsh-pins-modal-hint').textContent.indexOf('无法恢复') !== -1)

  const before = fetches.length
  const input = modal.querySelector('input')
  input.value = 'wrong-name'
  modal.querySelector('.dsh-pins-modal-ok').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(30)
  check('a wrong title never reaches the host route', fetches.length === before, fetches.length - before)

  wsRow.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))
  await sleep(20)
  const deleteItem2 = itemByLabel(doc.querySelector('.dsh-pins-menu'), '删除工作区（含磁盘）')
  deleteItem2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(20)
  const modal2 = doc.querySelector('.dsh-pins-modal')
  modal2.querySelector('input').value = 'vino'
  modal2.querySelector('.dsh-pins-modal-ok').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(40)
  const deleteCall = fetches[fetches.length - 1]
  check('the matching title posts to the plugin host route', deleteCall && deleteCall.url === '/dsh-sidebar-pins/delete-workspace', deleteCall && deleteCall.url)
  check('the route receives an id, never a path', deleteCall && deleteCall.body && deleteCall.body.workspaceId === 'ws-1' && deleteCall.body.confirm === 'vino' && deleteCall.body.path === undefined, JSON.stringify(deleteCall && deleteCall.body))

  section('pin feedback stays silent')
  // Clear the previous section's toast (1.7s lifetime) so a stale node cannot
  // masquerade as pin feedback.
  doc.querySelectorAll('.dsh-pins-toast').forEach((el) => el.remove())
  const pinA2 = rowA.querySelector('.dsh-pins-rowbtn[data-role="pin"]')
  pinA2.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(40)
  check('pinning a session shows no toast', doc.querySelector('.dsh-pins-toast') === null)
  check('pinning a session still moved it into the pinned pane', pinnedPane.querySelectorAll('.dsh-pins-row[data-dsh-pins-id="session:session-A"]').length === 1)
  const toggleA = pinnedPane.querySelector('.dsh-pins-row[data-dsh-pins-id="session:session-A"] .dsh-pins-rowbtn.is-pinned')
  toggleA.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(40)
  check('unpinning from the pinned pane shows no toast', doc.querySelector('.dsh-pins-toast') === null)
  check('unpinning still restored the stock row', rowA.style.display !== 'none')

  const wsRowForPin = doc.querySelector('[class*="groupRow"]')
  wsRowForPin.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))
  await sleep(20)
  const wsPinItem = itemByLabel(doc.querySelector('.dsh-pins-menu'), '置顶')
  wsPinItem.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(40)
  check('pinning a workspace shows no toast', doc.querySelector('.dsh-pins-toast') === null)
  check('pinning a workspace still marks its row', wsRowForPin.getAttribute('data-dsh-pins-ws-pinned') === '1', wsRowForPin.getAttribute('data-dsh-pins-ws-pinned'))

  section('menu structure: icons, hints, submenus')
  rowA.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }))
  await sleep(20)
  const structured = doc.querySelector('.dsh-pins-menu')
  const topItems = Array.from(structured.querySelectorAll(':scope > .dsh-pins-menu-item'))
  check('every top-level item carries an icon', topItems.every((b) => b.querySelector('.dsh-pins-menu-icon svg') !== null))
  const hintOf = (text) => { const b = itemByLabel(structured, text); const s = b && b.querySelector('.dsh-pins-menu-shortcut'); return s ? s.textContent : '' }
  check('rename shows the macOS hint ⌥⌘R', hintOf('重命名') === '⌥⌘R', hintOf('重命名'))
  check('pin shows ⌥⌘P', hintOf('置顶') === '⌥⌘P', hintOf('置顶'))
  check('unread shows ⇧⌘U', hintOf('标记为未读') === '⇧⌘U', hintOf('标记为未读'))
  check('archive shows ⇧⌘A', hintOf('归档') === '⇧⌘A', hintOf('归档'))
  const copyParent = itemByLabel(structured, '复制')
  const forkParent = itemByLabel(structured, '分叉')
  check('copy is a parent row with a chevron', copyParent.querySelector('.dsh-pins-menu-chevron') !== null)
  copyParent.dispatchEvent(new dom.window.MouseEvent('mouseenter'))
  await sleep(20)
  check('hovering copy opens its submenu', labelsOf(copyParent.querySelector('.dsh-pins-menu')).join('|') === '复制会话链接|复制会话标题|复制会话 ID', labelsOf(copyParent.querySelector('.dsh-pins-menu')).join('|'))
  forkParent.dispatchEvent(new dom.window.MouseEvent('mouseenter'))
  await sleep(20)
  check('opening another submenu closes the first', copyParent.querySelector('.dsh-pins-menu') === null)
  check('the fork submenu offers both variants', labelsOf(forkParent.querySelector('.dsh-pins-menu')).join('|') === '分叉会话（标题加序号）|分叉会话（保持标题）', labelsOf(forkParent.querySelector('.dsh-pins-menu')).join('|'))
  check('a parent row never fires an action itself', structured.querySelectorAll('.dsh-pins-toast').length === 0)
  doc.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))

  section('keyboard shortcuts (bound to the current session)')
  const shortcut = (key, mods) => new dom.window.KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, mods))
  rowA.dispatchEvent(shortcut('p', { metaKey: true, altKey: true }))
  await sleep(40)
  check('⌥⌘P pins the current session', pinnedPane.querySelectorAll('.dsh-pins-row[data-dsh-pins-id="session:session-A"]').length === 1)
  check('⌥⌘P stays silent', doc.querySelector('.dsh-pins-toast') === null)
  rowA.dispatchEvent(shortcut('p', { metaKey: true, altKey: true }))
  await sleep(40)
  check('⌥⌘P toggles back off', pinnedPane.querySelectorAll('.dsh-pins-row[data-dsh-pins-id="session:session-A"]').length === 0)
  rowA.dispatchEvent(shortcut('u', { metaKey: true, shiftKey: true }))
  await sleep(40)
  check('⇧⌘U marks the current session unread', rowA.getAttribute('data-dsh-pins-unread') === '1')
  rowA.dispatchEvent(shortcut('u', { metaKey: true, shiftKey: true }))
  await sleep(40)
  rowA.dispatchEvent(shortcut('r', { metaKey: true, altKey: true }))
  await sleep(40)
  check('⌥⌘R opens the rename dialog', doc.querySelector('.dsh-pins-modal') !== null)
  doc.querySelector('.dsh-pins-modal input').value = '新名字'
  doc.querySelector('.dsh-pins-modal-ok').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
  await sleep(40)
  const archivesBefore = calls.filter((c) => c[0] === 'archive').length
  rowA.dispatchEvent(shortcut('a', { metaKey: true, shiftKey: true }))
  await sleep(40)
  check('⇧⌘A archives the current session', calls.filter((c) => c[0] === 'archive').length === archivesBefore + 1)
  const typing = doc.createElement('input')
  doc.body.appendChild(typing)
  const pinnedBefore = pinnedPane.querySelectorAll('.dsh-pins-row').length
  typing.dispatchEvent(shortcut('p', { metaKey: true, altKey: true }))
  await sleep(30)
  check('shortcuts stay quiet while typing in an input',
    pinnedPane.querySelectorAll('.dsh-pins-row').length === pinnedBefore
      && pinnedPane.querySelectorAll('.dsh-pins-row[data-dsh-pins-id="session:session-A"]').length === 0)
  typing.remove()

  section('dispose')
  while (disposers.length > 0) disposers.pop()()
  await sleep(20)
  check('split is removed on dispose', doc.querySelector('[data-dsh-pins-split]') === null)
  check('stock tree is back in its original parent', doc.querySelector('.treeBodyWrapper').contains(doc.querySelector('[role="tree"]')))
  check('plugin style is removed', doc.querySelector('style[data-plugin="dsh-sidebar-pins"]') === null)

  section('legacy import (fresh page)')
  const dom2 = buildDom()
  installGlobals(dom2)
  const doc2 = dom2.window.document
  const rows2 = doc2.querySelectorAll('[role="treeitem"][class*="sessionRow"]')
  attachFiber(rows2[0], { node: { id: 'session-A', updatedAt: Date.now() - 8 * 60000, blank: false, title: TITLE_A } })
  attachFiber(rows2[1], { node: { id: 'session-B', updatedAt: Date.now() - 45 * 60000, blank: false, title: TITLE_B } })
  dom2.window.localStorage.setItem('dsh-codex-pins.v1', JSON.stringify({ v: 1, pinned: ['session-A'] }))
  dom2.window.localStorage.setItem('dsh-workspace-menu:v1', JSON.stringify({ pinnedSessions: ['session-B'], unreadSessions: ['session-A'] }))
  let definition2 = null
  dom2.window.__ModuleLoader__ = { load: (value) => { definition2 = value } }
  new Function(SOURCE)()
  const plugin2 = definition2.factory(() => { throw new Error('no requires') })
  const second = makeContext()
  plugin2.apply(second.ctx)
  await sleep(60)
  const imported = JSON.parse(dom2.window.localStorage.getItem('dsh-sidebar-pins.v1'))
  check('codex-pins pins are imported', imported.pinned.indexOf('session-A') !== -1, JSON.stringify(imported))
  check('workspace-menu pins are imported too', imported.pinned.indexOf('session-B') !== -1, JSON.stringify(imported))
  check('unread marks are imported', imported.unread.indexOf('session-A') !== -1, JSON.stringify(imported))
  check('imported pins render in the pinned pane', doc2.querySelectorAll('.dsh-pins-row').length === 2, doc2.querySelectorAll('.dsh-pins-row').length)
  check('the replaced plugins’ keys are cleaned up', dom2.window.localStorage.getItem('dsh-codex-pins.v1') === null && dom2.window.localStorage.getItem('dsh-workspace-menu:v1') === null)
  check('our own key survived that cleanup', dom2.window.localStorage.getItem('dsh-sidebar-pins.v1') !== null)
  while (second.disposers.length > 0) second.disposers.pop()()

  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' CHECK(S) FAILED'))
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
