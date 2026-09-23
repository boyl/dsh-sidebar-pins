// dsh-sidebar-pins browser half.
//
// One plugin, one row model:
//   * the sidebar is split into a Codex-style "置顶 / 最近" pair of panes;
//   * every row — the pinned rows this plugin renders AND the stock rows it
//     leaves in place — carries its own `data-dsh-pins-id`, so one menu
//     implementation serves both. That is the difference from composing a
//     "pane" plugin with a "menu" plugin: the pane rows there belong to nobody,
//     so a fiber-scraping menu silently degrades to the native menu on exactly
//     the rows you pinned.
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-pins',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var name = 'dsh-sidebar-pins'
    var inject = ['sessions', 'workspaces']

    var PLUGIN_ID = 'dsh-sidebar-pins'
    var STORAGE_KEY = 'dsh-sidebar-pins.v1'
    var LEGACY_KEYS = ['dsh-codex-pins.v1', 'dsh-workspace-menu:v1']

    var SPLIT_ATTR = 'data-dsh-pins-split'
    var PANE_ATTR = 'data-dsh-pins-pane'
    var SECTION_ATTR = 'data-dsh-pins-section'
    var TREE_ATTR = 'data-dsh-pins-tree'
    var HIDDEN_ATTR = 'data-dsh-pins-hidden'
    var ID_ATTR = 'data-dsh-pins-id'
    var UNREAD_ATTR = 'data-dsh-pins-unread'
    var WSPIN_ATTR = 'data-dsh-pins-ws-pinned'

    var ROW_CLASS = 'dsh-pins-row'
    var ROWBTN_CLASS = 'dsh-pins-rowbtn'
    var MENU_CLASS = 'dsh-pins-menu'
    var MODAL_CLASS = 'dsh-pins-modal'
    var TOAST_CLASS = 'dsh-pins-toast'

    // Pin glyph: Material Icons `push_pin` (filled) — the exact glyph the
    // codex-pins plugin used, so the pin looks the same as the one it left
    // behind. Rendered at the native icon size (16px) to line up with the
    // stock ⋯ trigger next to it.
    var PIN_SVG =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>' +
      '</svg>'
    // ⋯ glyph: the geometry of the harness's own IconEllipsisOutline16, so a
    // pinned row's menu button is indistinguishable from a stock one.
    var DOTS_SVG =
      '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
      '<path d="M4.55146 8.00001C4.55146 8.63513 4.03659 9.15001 3.40146 9.15001C2.76634 9.15001 2.25146 8.63513 2.25146 8.00001C2.25146 7.36488 2.76634 6.85001 3.40146 6.85001C4.03659 6.85001 4.55146 7.36488 4.55146 8.00001Z" fill="currentColor"/>' +
      '<path d="M9.1476 8.00001C9.1476 8.63513 8.63273 9.15001 7.9976 9.15001C7.36248 9.15001 6.8476 8.63513 6.8476 8.00001C6.8476 7.36488 7.36248 6.85001 7.9976 6.85001C8.63273 6.85001 9.1476 7.36488 9.1476 8.00001Z" fill="currentColor"/>' +
      '<path d="M13.7486 8.00001C13.7486 8.63513 13.2338 9.15001 12.5986 9.15001C11.9635 9.15001 11.4486 8.63513 11.4486 8.00001C11.4486 7.36488 11.9635 6.85001 12.5986 6.85001C13.2338 6.85001 13.7486 7.36488 13.7486 8.00001Z" fill="currentColor"/>' +
      '</svg>'

    var STYLE_TEXT = [
      '[' + SPLIT_ATTR + ']{flex:1;min-height:0;display:flex;flex-direction:column;}',
      '[' + SPLIT_ATTR + '] [' + TREE_ATTR + ']{flex:none!important;overflow:visible!important;min-height:0!important;height:auto!important;}',
      '.dsh-pins-pane{min-height:0;display:flex;flex-direction:column;}',
      '.dsh-pins-pane[' + PANE_ATTR + '="pinned"]{flex:0 1 auto;max-height:46%;}',
      '.dsh-pins-pane[' + PANE_ATTR + '="recent"]{flex:1 1 0;}',
      '.dsh-pins-pane-body{flex:1;min-height:0;overflow:auto;}',
      '.dsh-pins-pane-body[hidden],.dsh-pins-list[hidden],.dsh-pins-empty[hidden]{display:none;}',
      '.dsh-pins-divider{flex:none;height:1px;margin:4px 8px 2px;background:var(--dsw-alias-divider,rgba(140,149,159,.18));}',
      '[' + SECTION_ATTR + ']{flex:none;user-select:none;}',
      '.dsh-pins-heading{display:flex;align-items:center;gap:6px;height:26px;padding:0 8px;color:var(--dsw-alias-label-secondary,#8b949e);font-size:12px;font-weight:600;letter-spacing:.02em;flex:none;}',
      '.dsh-pins-count{color:var(--dsw-alias-label-tertiary,#8b949e);font-weight:500;}',
      '.dsh-pins-empty{padding:2px 8px 10px;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;line-height:1.5;}',
      '.dsh-pins-list{display:flex;flex-direction:column;gap:1px;}',
      '.' + ROW_CLASS + '{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 6px 0 8px;border-radius:8px;color:var(--dsw-alias-label-primary,#e6edf3);cursor:pointer;font-size:13px;}',
      '.' + ROW_CLASS + ':hover,.' + ROW_CLASS + ':focus-visible{background:color-mix(in srgb, var(--dsw-alias-label-primary,#e6edf3) 8%, transparent);}',
      '.' + ROW_CLASS + '[aria-current="true"]{background:color-mix(in srgb, var(--dsw-alias-label-primary,#e6edf3) 12%, transparent);}',
      '.' + ROW_CLASS + '[' + UNREAD_ATTR + '="1"] .dsh-pins-title{font-weight:600;}',
      '.dsh-pins-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dsh-pins-time{flex:none;color:var(--dsw-alias-label-secondary,#8b949e);font-size:11px;}',
      '.dsh-pins-actions{flex:none;display:inline-flex;align-items:center;gap:2px;opacity:0;transition:opacity .12s;}',
      '.' + ROW_CLASS + ':hover .dsh-pins-actions,.' + ROW_CLASS + ':focus-within .dsh-pins-actions{opacity:1;}',
      '.' + ROWBTN_CLASS + '{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;color:var(--dsw-alias-label-tertiary,#8b949e);background:0 0;cursor:pointer;flex:none;}',
      '.' + ROWBTN_CLASS + ':hover,.' + ROWBTN_CLASS + ':focus-visible{color:var(--dsw-alias-label-primary,#e6edf3);}',
      '.' + ROWBTN_CLASS + '.is-pinned{color:var(--dsw-alias-brand,#3884ff);}',
      '[role="treeitem"][' + UNREAD_ATTR + '="1"],.' + ROW_CLASS + '[' + UNREAD_ATTR + '="1"]{box-shadow:inset 2px 0 0 var(--dsw-alias-warning,#f0a020);}',
      '[role="treeitem"][' + WSPIN_ATTR + '="1"]{box-shadow:inset 2px 0 0 var(--dsw-alias-brand,#3884ff);}',
      '.' + MENU_CLASS + '{position:fixed;z-index:2147483000;width:max-content;min-width:150px;max-width:260px;padding:4px;',
      'background:color-mix(in srgb, var(--dsw-alias-bg-layer-3,#1e1e24) 88%, transparent);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.28);',
      'font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--dsw-alias-label-primary,#e6edf3);user-select:none;}',
      '.' + MENU_CLASS + '-item{display:block;width:100%;box-sizing:border-box;text-align:left;padding:5px 9px;border:none;border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer;white-space:nowrap;}',
      '.' + MENU_CLASS + '-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(140,149,159,.14));}',
      '.' + MENU_CLASS + '-item:disabled{opacity:.45;cursor:default;}',
      '.' + MENU_CLASS + '-item-danger{color:var(--dsw-alias-danger,#f26d6d);}',
      '.' + MENU_CLASS + '-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-divider,rgba(140,149,159,.18));}',
      '.' + TOAST_CLASS + '{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483001;padding:8px 14px;',
      'background:var(--dsw-alias-bg-layer-3,#1e1e24);border:1px solid var(--dsw-alias-border-strong,#3a3a44);border-radius:8px;',
      'color:var(--dsw-alias-label-primary,#e6edf3);font:12px/1.4 system-ui,-apple-system,sans-serif;pointer-events:none;}',
      '.' + MODAL_CLASS + '-backdrop{position:fixed;inset:0;z-index:2147483002;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28);}',
      '.' + MODAL_CLASS + '{width:320px;max-width:92vw;padding:14px;border-radius:12px;background:var(--dsw-alias-bg-layer-3,#1e1e24);',
      'border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));box-shadow:0 18px 48px rgba(0,0,0,.32);color:var(--dsw-alias-label-primary,#e6edf3);font:13px/1.4 system-ui,-apple-system,sans-serif;}',
      '.' + MODAL_CLASS + ' h3{margin:0 0 10px;font-size:13px;font-weight:600;}',
      '.' + MODAL_CLASS + '-hint{margin:0 0 10px;color:var(--dsw-alias-label-secondary,#8b949e);font-size:12px;line-height:1.5;}',
      '.' + MODAL_CLASS + ' input{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-strong,#3a3a44);',
      'background:var(--dsw-alias-bg-layer-1,#16161a);color:inherit;font:inherit;outline:none;}',
      '.' + MODAL_CLASS + '-error{margin-top:6px;color:var(--dsw-alias-danger,#f26d6d);font-size:12px;display:none;}',
      '.' + MODAL_CLASS + '-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;}',
      '.' + MODAL_CLASS + '-footer button{padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-strong,#3a3a44);background:transparent;color:inherit;font:inherit;cursor:pointer;}',
      '.' + MODAL_CLASS + '-footer .' + MODAL_CLASS + '-ok{background:var(--dsw-alias-brand,#4d6bfe);border-color:transparent;color:#fff;}',
    ].join('')

    /* ---------------------------------------------------------------- store */

    function isId(value) {
      return typeof value === 'string' && value.length > 0
    }

    function union(a, b) {
      var out = a.slice()
      for (var i = 0; i < b.length; i++) if (out.indexOf(b[i]) === -1) out.push(b[i])
      return out
    }

    function toggleIn(list, id) {
      return list.indexOf(id) === -1 ? [id].concat(list) : list.filter(function (x) { return x !== id })
    }

    function safeStorage() {
      try {
        var s = window.localStorage
        s.getItem(STORAGE_KEY)
        return s
      } catch (e) {
        return null
      }
    }

    function normalize(raw) {
      var state = { v: 1, pinned: [], unread: [], pinnedWorkspaces: [] }
      if (!raw || typeof raw !== 'object') return state
      if (Array.isArray(raw.pinned)) state.pinned = raw.pinned.filter(isId)
      if (Array.isArray(raw.unread)) state.unread = raw.unread.filter(isId)
      if (Array.isArray(raw.pinnedWorkspaces)) state.pinnedWorkspaces = raw.pinnedWorkspaces.filter(isId)
      return state
    }

    /** One-time import from the plugins this one replaces, so pins are not lost. */
    function readLegacy(storage) {
      var merged = { v: 1, pinned: [], unread: [], pinnedWorkspaces: [] }
      if (!storage) return merged
      for (var i = 0; i < LEGACY_KEYS.length; i++) {
        var raw = null
        try {
          raw = storage.getItem(LEGACY_KEYS[i])
        } catch (e) {
          raw = null
        }
        if (!raw) continue
        var parsed = null
        try {
          parsed = JSON.parse(raw)
        } catch (e) {
          continue
        }
        if (!parsed || typeof parsed !== 'object') continue
        var pinned = parsed.pinned || parsed.pinnedSessions
        if (Array.isArray(pinned)) merged.pinned = union(merged.pinned, pinned.filter(isId))
        if (Array.isArray(parsed.unreadSessions)) merged.unread = union(merged.unread, parsed.unreadSessions.filter(isId))
        if (Array.isArray(parsed.pinnedWorkspaces)) merged.pinnedWorkspaces = union(merged.pinnedWorkspaces, parsed.pinnedWorkspaces.filter(isId))
      }
      return merged
    }

    function createStore(storage) {
      var state
      try {
        var raw = storage ? storage.getItem(STORAGE_KEY) : null
        state = raw ? normalize(JSON.parse(raw)) : readLegacy(storage)
      } catch (e) {
        state = normalize(null)
      }
      var listeners = new Set()
      var persist = function () {
        try {
          if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(state))
          return true
        } catch (e) {
          // quota or private mode: the in-memory state still works
          return false
        }
      }
      var emit = function () {
        listeners.forEach(function (fn) {
          try { fn() } catch (e) { /* one listener must not break the others */ }
        })
      }
      // The plugins this one replaced are uninstalled, so once our own state is
      // safely written their keys are dead data. Only drop them after a
      // successful write, so a failed import never destroys the last copy.
      if (persist()) {
        for (var i = 0; i < LEGACY_KEYS.length; i++) {
          try {
            if (storage) storage.removeItem(LEGACY_KEYS[i])
          } catch (e) { /* nothing to clean */ }
        }
      }
      return {
        get: function () { return state },
        subscribe: function (fn) {
          listeners.add(fn)
          return function () { listeners.delete(fn) }
        },
        isPinned: function (id) { return state.pinned.indexOf(id) !== -1 },
        togglePin: function (id) {
          state.pinned = toggleIn(state.pinned, id)
          persist(); emit()
          return state.pinned.indexOf(id) !== -1
        },
        isUnread: function (id) { return state.unread.indexOf(id) !== -1 },
        toggleUnread: function (id) {
          state.unread = toggleIn(state.unread, id)
          persist(); emit()
          return state.unread.indexOf(id) !== -1
        },
        markRead: function (id) {
          if (state.unread.indexOf(id) === -1) return false
          state.unread = state.unread.filter(function (x) { return x !== id })
          persist(); emit()
          return true
        },
        isWorkspacePinned: function (id) { return state.pinnedWorkspaces.indexOf(id) !== -1 },
        toggleWorkspacePin: function (id) {
          state.pinnedWorkspaces = toggleIn(state.pinnedWorkspaces, id)
          persist(); emit()
          return state.pinnedWorkspaces.indexOf(id) !== -1
        },
        prune: function (sessionIds, workspaceIds) {
          var known = {}
          for (var i = 0; i < sessionIds.length; i++) known[sessionIds[i]] = true
          var knownWs = {}
          for (var w = 0; w < workspaceIds.length; w++) knownWs[workspaceIds[w]] = true
          var nextPinned = state.pinned.filter(function (id) { return known[id] === true })
          var nextUnread = state.unread.filter(function (id) { return known[id] === true })
          var nextWs = state.pinnedWorkspaces.filter(function (id) { return knownWs[id] === true })
          if (nextPinned.length === state.pinned.length && nextUnread.length === state.unread.length && nextWs.length === state.pinnedWorkspaces.length) return false
          state.pinned = nextPinned
          state.unread = nextUnread
          state.pinnedWorkspaces = nextWs
          persist(); emit()
          return true
        },
      }
    }

    /* ------------------------------------------------------------- feedback */

    function removeEl(selector) {
      var nodes = document.querySelectorAll(selector)
      for (var i = 0; i < nodes.length; i++) nodes[i].remove()
    }

    function toast(message) {
      removeEl('.' + TOAST_CLASS)
      var el = document.createElement('div')
      el.className = TOAST_CLASS
      el.textContent = message
      document.body.appendChild(el)
      window.setTimeout(function () { el.remove() }, 1700)
    }

    function failure(prefix, error) {
      toast(prefix + '：' + (error && error.message ? error.message : String(error)))
    }

    function copyText(text) {
      return new Promise(function (resolve) {
        var fallback = function () {
          try {
            var ta = document.createElement('textarea')
            ta.value = text
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            document.body.appendChild(ta)
            ta.select()
            var ok = document.execCommand('copy')
            ta.remove()
            resolve(ok)
          } catch (e) {
            resolve(false)
          }
        }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { resolve(true) }, fallback)
            return
          }
        } catch (e) { /* fall through to the textarea path */ }
        fallback()
      })
    }

    function promptText(title, initial, description) {
      return new Promise(function (resolve) {
        removeEl('.' + MODAL_CLASS + '-backdrop')
        var backdrop = document.createElement('div')
        backdrop.className = MODAL_CLASS + '-backdrop'
        var box = document.createElement('div')
        box.className = MODAL_CLASS
        var heading = document.createElement('h3')
        heading.textContent = title
        box.appendChild(heading)
        if (description) {
          var hint = document.createElement('p')
          hint.className = MODAL_CLASS + '-hint'
          hint.textContent = description
          box.appendChild(hint)
        }
        var input = document.createElement('input')
        input.type = 'text'
        input.value = initial || ''
        input.spellcheck = false
        var error = document.createElement('div')
        error.className = MODAL_CLASS + '-error'
        var footer = document.createElement('div')
        footer.className = MODAL_CLASS + '-footer'
        var cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.textContent = '取消'
        var ok = document.createElement('button')
        ok.type = 'button'
        ok.className = MODAL_CLASS + '-ok'
        ok.textContent = '确定'
        var close = function (value) {
          backdrop.remove()
          resolve(value)
        }
        cancel.addEventListener('click', function () { close(null) })
        ok.addEventListener('click', function () {
          var value = input.value.trim()
          if (!value) {
            error.textContent = '名称不能为空'
            error.style.display = 'block'
            return
          }
          close(value)
        })
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') ok.click()
          if (event.key === 'Escape') close(null)
        })
        backdrop.addEventListener('mousedown', function (event) {
          if (event.target === backdrop) close(null)
        })
        footer.append(cancel, ok)
        box.append(input, error, footer)
        backdrop.appendChild(box)
        document.body.appendChild(backdrop)
        input.focus()
        input.select()
      })
    }

    /* ----------------------------------------------------------------- menu */

    function addMenuItem(menu, item, close) {
      if (item.separator) {
        var sep = document.createElement('div')
        sep.className = MENU_CLASS + '-sep'
        menu.appendChild(sep)
        return
      }
      var button = document.createElement('button')
      button.type = 'button'
      button.className = MENU_CLASS + '-item' + (item.danger ? ' ' + MENU_CLASS + '-item-danger' : '')
      button.textContent = item.label
      button.disabled = item.disabled === true
      button.setAttribute('role', 'menuitem')
      button.addEventListener('click', function (event) {
        event.stopPropagation()
        close()
        item.onClick()
      })
      menu.appendChild(button)
    }

    function removeMenus() {
      removeEl('.' + MENU_CLASS)
      // A second sidebar plugin may already have opened its own menu for this
      // same event; exactly one menu may survive.
      removeEl('.dsh-ws-menu')
    }

    function showMenu(x, y, items) {
      removeMenus()
      var menu = document.createElement('div')
      menu.className = MENU_CLASS
      menu.setAttribute('role', 'menu')
      var cleanup = function () {
        document.removeEventListener('mousedown', onMouseDown, true)
        document.removeEventListener('keydown', onKey, true)
        window.removeEventListener('blur', onMove)
        window.removeEventListener('resize', onMove)
      }
      var close = function () {
        removeMenus()
        cleanup()
      }
      var onMouseDown = function (event) {
        if (event.target instanceof Node && menu.contains(event.target)) return
        close()
      }
      var onKey = function (event) {
        if (event.key === 'Escape') close()
      }
      var onMove = function () { close() }
      for (var i = 0; i < items.length; i++) addMenuItem(menu, items[i], close)
      document.body.appendChild(menu)
      var rect = menu.getBoundingClientRect()
      var margin = 8
      var left = Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - rect.width - margin))
      var top = Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - rect.height - margin))
      menu.style.left = left + 'px'
      menu.style.top = top + 'px'
      document.addEventListener('mousedown', onMouseDown, true)
      document.addEventListener('keydown', onKey, true)
      window.addEventListener('blur', onMove)
      window.addEventListener('resize', onMove)
    }

    /* ------------------------------------------------------------ id lookup */

    /** Walk a stock row's React fiber chain for its session/workspace props. */
    function fiberInfo(el) {
      var keys = Object.keys(el)
      var fiberKey = null
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].indexOf('__reactFiber$') === 0) { fiberKey = keys[k]; break }
      }
      if (!fiberKey) return null
      var fiber = el[fiberKey]
      for (var i = 0; fiber && i < 40; i++) {
        var props = fiber.memoizedProps
        if (props) {
          var node = props.node
          if (node && node.id !== undefined && typeof node.updatedAt === 'number' && typeof node.blank === 'boolean') {
            return { kind: 'session', id: String(node.id) }
          }
          if (props.group !== undefined && props.group !== null) {
            var wsId = props.group.workspaceId
            if (wsId !== undefined && wsId !== null && wsId !== '') return { kind: 'workspace', id: String(wsId) }
          }
        }
        fiber = fiber.return
      }
      return null
    }

    function titleFromRow(row) {
      var titled = row.querySelector(':scope > [class*="title"]')
      if (titled) return (titled.textContent || '').trim()
      var nodes = row.querySelectorAll(':scope > span')
      for (var i = 0; i < nodes.length; i++) {
        if (/slot|time|rowActions|visuallyHidden|actions/i.test(nodes[i].className || '')) continue
        var text = (nodes[i].textContent || '').trim()
        if (text && nodes[i].children.length === 0 && text.length < 200) return text
      }
      return ''
    }

    function parseIdAttr(value) {
      if (!value) return null
      var at = value.indexOf(':')
      if (at <= 0) return null
      return { kind: value.slice(0, at), id: value.slice(at + 1) }
    }

    function encodeId(info) {
      return info.kind + ':' + info.id
    }

    /** Titles that identify exactly one session, for rows whose props we cannot read. */
    function uniqueTitles(list) {
      var map = {}
      var ids = (list && list.ids) || []
      for (var i = 0; i < ids.length; i++) {
        var summary = list.byId ? list.byId[ids[i]] : undefined
        if (!summary) continue
        var title = summary.displayTitle || summary.title
        if (!title) continue
        if (map[title] === undefined) map[title] = summary.id
        else if (map[title] !== summary.id) map[title] = null
      }
      return map
    }

    /**
     * Resolve one stock row to its subject. Our own attribute wins because we
     * wrote it; the fiber walk covers the first sighting; a unique title is the
     * last resort for a row whose component props changed shape.
     */
    function resolveRow(row, list) {
      var cached = parseIdAttr(row.getAttribute(ID_ATTR))
      if (cached) return cached
      var info = fiberInfo(row)
      if (!info && list) {
        var title = titleFromRow(row)
        if (title) {
          var id = uniqueTitles(list)[title]
          if (id) info = { kind: 'session', id: id }
        }
      }
      if (!info) return null
      row.setAttribute(ID_ATTR, encodeId(info))
      return info
    }

    /* ------------------------------------------------------------- sidebar */

    function findSessionTree(doc) {
      var trees = doc.querySelectorAll('[role="tree"]')
      for (var i = 0; i < trees.length; i++) {
        if (trees[i].closest('[' + SECTION_ATTR + ']')) continue
        if (trees[i].querySelector('[role="treeitem"][aria-selected]')) return trees[i]
      }
      for (var j = 0; j < trees.length; j++) {
        if (!trees[j].closest('[' + SECTION_ATTR + ']')) return trees[j]
      }
      return null
    }

    function setHidden(el, hide) {
      if (hide) {
        if (el.getAttribute(HIDDEN_ATTR) !== '1') el.setAttribute(HIDDEN_ATTR, '1')
        if (el.style.display !== 'none') el.style.display = 'none'
        return
      }
      if (el.getAttribute(HIDDEN_ATTR) === '1') el.removeAttribute(HIDDEN_ATTR)
      if (el.style.display === 'none') el.style.display = ''
    }

    function placeButton(row, btn) {
      var actions = row.querySelector(':scope > [class*="rowActions"]')
      if (actions) {
        if (btn.parentNode !== actions || actions.firstChild !== btn) actions.insertBefore(btn, actions.firstChild)
        return
      }
      if (btn.parentNode !== row) row.appendChild(btn)
    }

    function heading(label, withCount) {
      var el = document.createElement('div')
      el.className = 'dsh-pins-heading'
      var span = document.createElement('span')
      span.textContent = label
      el.appendChild(span)
      if (withCount) {
        var count = document.createElement('span')
        count.className = 'dsh-pins-count'
        el.appendChild(count)
      }
      return el
    }

    function ensureSplit(tree) {
      var treeBody = tree.parentElement
      if (!treeBody || !treeBody.parentElement) return null
      var existing = treeBody.closest('[' + SPLIT_ATTR + ']')
      if (existing) {
        return {
          pinList: existing.querySelector('.dsh-pins-list'),
          pinEmpty: existing.querySelector('.dsh-pins-empty'),
          pinCount: existing.querySelector('[' + PANE_ATTR + '="pinned"] .dsh-pins-count'),
        }
      }
      var root = treeBody.parentElement
      var split = document.createElement('div')
      split.setAttribute(SPLIT_ATTR, '')

      var pinPane = document.createElement('div')
      pinPane.className = 'dsh-pins-pane'
      pinPane.setAttribute(PANE_ATTR, 'pinned')
      var pinHead = heading('置顶', true)
      var pinBody = document.createElement('div')
      pinBody.className = 'dsh-pins-pane-body'
      var pinSection = document.createElement('div')
      pinSection.setAttribute(SECTION_ATTR, '')
      var pinList = document.createElement('div')
      pinList.className = 'dsh-pins-list'
      pinList.setAttribute('role', 'list')
      var pinEmpty = document.createElement('div')
      pinEmpty.className = 'dsh-pins-empty'
      pinEmpty.textContent = '把常用会话钉在这里：悬停会话行点图钉，或右键菜单里选「置顶」。'
      pinSection.append(pinList, pinEmpty)
      pinBody.appendChild(pinSection)
      pinPane.append(pinHead, pinBody)

      var divider = document.createElement('div')
      divider.className = 'dsh-pins-divider'
      divider.setAttribute('aria-hidden', 'true')

      var recentPane = document.createElement('div')
      recentPane.className = 'dsh-pins-pane'
      recentPane.setAttribute(PANE_ATTR, 'recent')
      var recentHead = heading('最近', false)
      var recentBody = document.createElement('div')
      recentBody.className = 'dsh-pins-pane-body'
      treeBody.setAttribute(TREE_ATTR, '')
      recentBody.appendChild(treeBody)
      recentPane.append(recentHead, recentBody)

      split.append(pinPane, divider, recentPane)
      root.appendChild(split)

      return {
        pinList: pinList,
        pinEmpty: pinEmpty,
        pinCount: pinHead.querySelector('.dsh-pins-count'),
      }
    }

    function unwrapSplit(doc) {
      var split = doc.querySelector('[' + SPLIT_ATTR + ']')
      if (!split) return
      var treeBody = split.querySelector('[' + TREE_ATTR + ']')
      if (treeBody && split.parentNode) {
        treeBody.removeAttribute(TREE_ATTR)
        split.parentNode.insertBefore(treeBody, split)
      }
      split.remove()
    }

    /* ------------------------------------------------------------- actions */

    function sessionTitle(list, id) {
      var summary = list && list.byId ? list.byId[id] : undefined
      if (!summary) return id
      return summary.displayTitle || summary.title || id
    }

    function deepLink(id) {
      var url = new URL(window.location.href)
      url.searchParams.set('session', id)
      return url.toString()
    }

    function refreshSessions(ctx) {
      try {
        if (ctx.sessions.refresh) ctx.sessions.refresh()
      } catch (e) { /* the projection push settles it */ }
    }

    function refreshWorkspaces(ctx) {
      try {
        if (ctx.workspaces.refresh) ctx.workspaces.refresh()
      } catch (e) { /* the projection push settles it */ }
    }

    /** Which file manager the shipped open-in-app catalog should launch here. */
    function fileManager() {
      var hint = String((navigator && navigator.userAgent) || '') + ' ' + String((navigator && navigator.platform) || '')
      if (/mac|darwin|iphone|ipad/i.test(hint)) return { app: 'finder', label: '在 Finder 中打开' }
      if (/win/i.test(hint)) return { app: 'explorer', label: '在资源管理器中打开' }
      return { app: 'filemanager', label: '在文件管理器中打开' }
    }

    /**
     * Reveal a directory through the harness's own open-in-app route: it already
     * owns the app catalog, the absolute-path check, and the request fence, so
     * this plugin ships no host code for it.
     */
    function revealInFileManager(path) {
      if (!path) return
      var target = fileManager()
      fetch('/open-in-app/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: target.app, path: path }),
      }).then(function (response) {
        if (!response.ok) toast('打开失败：HTTP ' + response.status)
      }).catch(function (error) {
        failure('打开失败', error)
      })
    }

    /**
     * Ask the host route to delete a workspace directory. The route takes the
     * workspace id — never a path — and re-checks the title we echo, so this
     * confirmation is a second lock on the same door, not the only one.
     */
    function deleteWorkspaceWithDisk(ctx, wsId, ws) {
      var title = (ws && ws.title) || ''
      promptText('删除工作区（含磁盘）', '', '这会永久删除磁盘上的目录及其中的文件，无法恢复。请输入工作区名称「' + title + '」以确认。').then(function (typed) {
        if (typed === null) return
        if (typed !== title) {
          toast('名称不匹配，已取消')
          return
        }
        fetch('/dsh-sidebar-pins/delete-workspace', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspaceId: wsId, confirm: typed }),
        }).then(function (response) {
          return response.json().catch(function () { return null }).then(function (payload) {
            if (!response.ok || !payload || payload.ok !== true) {
              var code = payload && (payload.message || payload.code)
              toast('删除失败：' + (code || ('HTTP ' + response.status)))
              return
            }
            toast(payload.removed === false ? '目录已不存在，已从列表中移除' : '工作区与磁盘目录已删除')
            refreshSessions(ctx)
            refreshWorkspaces(ctx)
          })
        }).catch(function (error) { failure('删除失败', error) })
      })
    }

    function renameSession(ctx, id, currentTitle) {
      promptText('重命名会话', currentTitle).then(function (next) {
        if (!next) return
        var binding = null
        try { binding = ctx.sessions.binding(id) } catch (e) { binding = null }
        var session = binding && binding.session
        if (!session) {
          toast('该会话尚未加载，先打开一次再重命名')
          return
        }
        Promise.resolve(session.rename(next)).then(function (result) {
          if (result && result.ok === false) {
            toast('重命名失败：' + ((result.error && result.error.message) || '未知错误'))
            return
          }
          toast('已重命名')
          refreshSessions(ctx)
        }).catch(function (error) { failure('重命名失败', error) })
      })
    }

    function sessionItems(ctx, store, list, id) {
      var pinned = store.isPinned(id)
      var unread = store.isUnread(id)
      var title = sessionTitle(list, id)
      var summary = list && list.byId ? list.byId[id] : undefined
      var cwd = summary && summary.cwd
      var reveal = fileManager()
      return [
        {
          label: pinned ? '取消置顶' : '置顶',
          // Pin state is legible from the row itself (blue pin, pane move,
          // count), so it needs no toast the way a failure does.
          onClick: function () { store.togglePin(id) },
        },
        { label: '重命名', onClick: function () { renameSession(ctx, id, title) } },
        {
          label: unread ? '标记为已读' : '标记为未读',
          onClick: function () {
            var now = store.toggleUnread(id)
            toast(now ? '已标记为未读' : '已标记为已读')
          },
        },
        { separator: true },
        {
          label: '归档会话',
          onClick: function () {
            Promise.resolve(ctx.workspaces.archiveSession(id))
              .then(function () { toast('已归档') })
              .catch(function (error) { failure('归档失败', error) })
          },
        },
        {
          label: '分叉会话',
          onClick: function () {
            Promise.resolve(ctx.sessions.fork({ sessionId: id, increaseTitle: true }))
              .then(function (childId) { if (childId) ctx.sessions.open(childId) })
              .catch(function (error) { failure('分叉失败', error) })
          },
        },
        { separator: true },
        {
          label: '复制会话链接',
          onClick: function () {
            copyText(deepLink(id)).then(function (ok) { toast(ok ? '链接已复制' : '复制失败') })
          },
        },
        {
          label: '复制会话标题',
          onClick: function () {
            copyText(title).then(function (ok) { toast(ok ? '标题已复制' : '复制失败') })
          },
        },
        {
          label: '在新窗口中打开',
          onClick: function () { window.open(deepLink(id), '_blank') },
        },
        {
          label: reveal.label,
          disabled: !cwd,
          onClick: function () { revealInFileManager(cwd) },
        },
      ]
    }

    function workspaceById(ctx, wsId) {
      var snapshot = ctx.workspaces.list.getSnapshot()
      var items = snapshot.items || []
      for (var i = 0; i < items.length; i++) {
        if (items[i].workspaceId === wsId) return items[i]
      }
      return null
    }

    function workspaceItems(ctx, store, wsId) {
      var ws = workspaceById(ctx, wsId)
      var pinned = store.isWorkspacePinned(wsId)
      var reveal = fileManager()
      return [
        {
          label: pinned ? '取消置顶' : '置顶',
          // Only failures speak: a successful pin shows in the row's accent bar
          // and in the workspace order, and unpinning keeps the current order.
          onClick: function () {
            var now = store.toggleWorkspacePin(wsId)
            if (!now) return
            var snapshot = ctx.workspaces.list.getSnapshot()
            var first = (snapshot.items || [])[0]
            if (first && first.workspaceId !== wsId && ctx.workspaces.insertBefore) {
              Promise.resolve(ctx.workspaces.insertBefore(wsId, first.workspaceId))
                .catch(function () { toast('置顶失败：工作区顺序未改变') })
            }
          },
        },
        {
          label: '重命名',
          onClick: function () {
            promptText('重命名工作区', (ws && ws.title) || '').then(function (next) {
              if (!next) return
              Promise.resolve(ctx.workspaces.rename(wsId, next))
                .then(function () { toast('已重命名') })
                .catch(function (error) { failure('重命名失败', error) })
            })
          },
        },
        {
          label: '新建会话',
          onClick: function () {
            try {
              ctx.workspaces.startSession(wsId)
            } catch (error) {
              failure('新建会话失败', error)
            }
          },
        },
        {
          label: '复制路径',
          disabled: !ws || !ws.path,
          onClick: function () {
            if (!ws || !ws.path) return
            copyText(ws.path).then(function (ok) { toast(ok ? '路径已复制' : '复制失败') })
          },
        },
        {
          label: reveal.label,
          disabled: !ws || !ws.path,
          onClick: function () { if (ws && ws.path) revealInFileManager(ws.path) },
        },
        { separator: true },
        {
          label: '从工作区列表中移除（保留磁盘）',
          danger: true,
          onClick: function () {
            if (!window.confirm('确定从工作区列表中移除该工作区吗？\n目录和会话记录会保留在磁盘上。')) return
            Promise.resolve(ctx.workspaces.delete(wsId))
              .then(function () { toast('已移除') })
              .catch(function (error) { failure('移除失败', error) })
          },
        },
        {
          label: '删除工作区（含磁盘）',
          danger: true,
          onClick: function () { deleteWorkspaceWithDisk(ctx, wsId, ws) },
        },
      ]
    }

    function openRowMenu(ctx, store, info, x, y) {
      var list = ctx.sessions.list.getSnapshot()
      var items = info.kind === 'workspace'
        ? workspaceItems(ctx, store, info.id)
        : sessionItems(ctx, store, list, info.id)
      if (items.length > 0) showMenu(x, y, items)
    }

    /* -------------------------------------------------------------- render */

    function formatTime(updatedAt) {
      if (typeof updatedAt !== 'number' || !isFinite(updatedAt) || updatedAt <= 0) return ''
      var minutes = Math.round((Date.now() - updatedAt) / 60000)
      if (minutes < 1) return '刚刚'
      if (minutes < 60) return minutes + ' 分钟'
      var hours = Math.round(minutes / 60)
      if (hours < 24) return hours + ' 小时'
      var days = Math.round(hours / 24)
      if (days < 30) return days + ' 天'
      return Math.round(days / 30) + ' 个月'
    }

    function setText(node, text) {
      if (node && node.textContent !== text) node.textContent = text
    }

    function setAttr(el, attr, value) {
      if (!el) return
      if (el.getAttribute(attr) !== value) el.setAttribute(attr, value)
    }

    function makeRowButton(svg, title, onClick, extraClass) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = ROWBTN_CLASS + (extraClass ? ' ' + extraClass : '')
      btn.innerHTML = svg
      btn.title = title
      btn.addEventListener('click', function (event) {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      })
      return btn
    }

    function renderPinnedRow(ctx, store, layout, list, id) {
      var row = layout.pinList.querySelector('.' + ROW_CLASS + '[' + ID_ATTR + '="session:' + id + '"]')
      if (!row) {
        row = document.createElement('div')
        row.className = ROW_CLASS
        row.setAttribute(ID_ATTR, encodeId({ kind: 'session', id: id }))
        row.setAttribute('role', 'listitem')
        row.tabIndex = 0
        var toggle = makeRowButton(PIN_SVG, '取消置顶', function () {
          store.togglePin(id)
        }, 'is-pinned')
        var title = document.createElement('span')
        title.className = 'dsh-pins-title'
        var time = document.createElement('span')
        time.className = 'dsh-pins-time'
        var actions = document.createElement('span')
        actions.className = 'dsh-pins-actions'
        actions.appendChild(makeRowButton(DOTS_SVG, '更多操作', function () {
          var rect = actions.getBoundingClientRect()
          openRowMenu(ctx, store, { kind: 'session', id: id }, rect.left, rect.bottom + 4)
        }))
        row.append(toggle, title, time, actions)
        row.addEventListener('click', function (event) {
          if (event.target instanceof Element && event.target.closest('.' + ROWBTN_CLASS)) return
          store.markRead(id)
          ctx.sessions.open(id)
        })
        row.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            ctx.sessions.open(id)
          }
        })
        row.addEventListener('contextmenu', function (event) {
          event.preventDefault()
          event.stopPropagation()
          openRowMenu(ctx, store, { kind: 'session', id: id }, event.clientX, event.clientY)
        })
        row.addEventListener('dblclick', function (event) {
          event.preventDefault()
          event.stopPropagation()
          openRowMenu(ctx, store, { kind: 'session', id: id }, event.clientX, event.clientY)
        })
        layout.pinList.appendChild(row)
      }
      var summary = list && list.byId ? list.byId[id] : undefined
      setText(row.querySelector('.dsh-pins-title'), summary ? (summary.displayTitle || summary.title || id) : id)
      setText(row.querySelector('.dsh-pins-time'), summary ? formatTime(summary.updatedAt) : '')
      setAttr(row, UNREAD_ATTR, store.isUnread(id) ? '1' : '0')
      if (list && list.current === id) {
        if (row.getAttribute('aria-current') !== 'true') row.setAttribute('aria-current', 'true')
      } else if (row.hasAttribute('aria-current')) {
        row.removeAttribute('aria-current')
      }
      return row
    }

    function renderPinnedRows(ctx, store, layout, list) {
      var pinned = store.get().pinned
      var existing = layout.pinList.querySelectorAll('.' + ROW_CLASS)
      for (var i = 0; i < existing.length; i++) {
        var info = parseIdAttr(existing[i].getAttribute(ID_ATTR))
        if (!info || pinned.indexOf(info.id) === -1) existing[i].remove()
      }
      for (var p = 0; p < pinned.length; p++) {
        var row = renderPinnedRow(ctx, store, layout, list, pinned[p])
        if (layout.pinList.children[p] !== row) layout.pinList.insertBefore(row, layout.pinList.children[p] || null)
      }
    }

    function paintStockRow(ctx, store, list, row) {
      var info = resolveRow(row, list)
      if (!info) return
      if (info.kind === 'workspace') {
        setAttr(row, WSPIN_ATTR, store.isWorkspacePinned(info.id) ? '1' : '0')
        return
      }
      var id = info.id
      setAttr(row, UNREAD_ATTR, store.isUnread(id) ? '1' : '0')
      var pinned = store.isPinned(id)
      setHidden(row, pinned)

      var pinBtn = row.querySelector('.' + ROWBTN_CLASS + '[data-role="pin"]')
      if (!pinBtn) {
        pinBtn = makeRowButton(PIN_SVG, '置顶', function () {
          var current = resolveRow(row, ctx.sessions.list.getSnapshot())
          if (!current || current.kind !== 'session') return
          store.togglePin(current.id)
        })
        pinBtn.setAttribute('data-role', 'pin')
      }
      pinBtn.classList.toggle('is-pinned', pinned)
      pinBtn.title = pinned ? '取消置顶' : '置顶'
      placeButton(row, pinBtn)

      // Earlier versions injected a second ⋯ here, next to the stock one the
      // row already owns. Drop any leftover; the stock trigger is intercepted
      // instead (see the click handler), so a row keeps exactly one ⋯.
      var leftover = row.querySelector('.' + ROWBTN_CLASS + '[data-role="more"]')
      if (leftover) leftover.remove()
    }

    /**
     * The stock ⋯ trigger inside a row's actions container. Session rows hold
     * exactly one; project rows hold it first and a ＋ new-session button
     * second, so "first icon button" is the menu trigger in both shapes.
     */
    function stockMenuTrigger(target) {
      var actions = target.closest ? target.closest('[class*="rowActions"]') : null
      if (!actions) return null
      var trigger = actions.querySelector('button[class*="iconButton"]')
      if (!trigger || !trigger.contains(target)) return null
      return trigger
    }

    function mountSidebar(ctx, store) {
      var scheduled = false
      var raf = 0

      var render = function () {
        scheduled = false
        var list = ctx.sessions.list.getSnapshot()
        var tree = findSessionTree(document)
        if (tree) {
          var layout = ensureSplit(tree)
          if (layout && layout.pinList) {
            if (list.phase === 'ready') {
              var wsSnapshot = ctx.workspaces.list.getSnapshot()
              var wsIds = (wsSnapshot.items || []).map(function (item) { return item.workspaceId })
              store.prune(list.ids || [], wsIds)
            }
            var pinned = store.get().pinned
            renderPinnedRows(ctx, store, layout, list)
            if (layout.pinCount) setText(layout.pinCount, pinned.length > 0 ? String(pinned.length) : '')
            if (layout.pinList.hidden !== (pinned.length === 0)) layout.pinList.hidden = pinned.length === 0
            if (layout.pinEmpty && layout.pinEmpty.hidden !== (pinned.length > 0)) layout.pinEmpty.hidden = pinned.length > 0
          }
        }
        var rows = document.querySelectorAll('[role="treeitem"]')
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].closest('[' + SECTION_ATTR + ']')) continue
          paintStockRow(ctx, store, list, rows[i])
        }
      }

      var schedule = function () {
        if (scheduled) return
        scheduled = true
        if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(render)
        else raf = window.setTimeout(render, 0)
      }

      var rowInfoOf = function (event) {
        var target = event.target instanceof Element ? event.target : null
        var row = target && target.closest ? target.closest('[role="treeitem"]') : null
        if (!row) return null
        return resolveRow(row, ctx.sessions.list.getSnapshot())
      }

      var onContextMenu = function (event) {
        var info = rowInfoOf(event)
        if (!info) return
        event.preventDefault()
        event.stopPropagation()
        openRowMenu(ctx, store, info, event.clientX, event.clientY)
      }
      var onDoubleClick = function (event) {
        var target = event.target instanceof Element ? event.target : null
        if (target && target.closest && target.closest('.' + ROWBTN_CLASS)) return
        var info = rowInfoOf(event)
        if (!info) return
        event.preventDefault()
        event.stopPropagation()
        openRowMenu(ctx, store, info, event.clientX, event.clientY)
      }
      var onClick = function (event) {
        var target = event.target instanceof Element ? event.target : null
        if (!target || !target.closest) return
        if (target.closest('.' + ROWBTN_CLASS) || target.closest('.' + MENU_CLASS) || target.closest('.' + MODAL_CLASS)) return
        // The stock ⋯ opens the stock menu, which is a strict subset of ours
        // (rename / fork / archive only, and nothing at all on a pinned row).
        // Claim the trigger so one button carries the whole feature set. A
        // capture listener on document runs before React's root listener, so
        // stopping the event here keeps the stock menu from opening too.
        var trigger = stockMenuTrigger(target)
        if (trigger) {
          var triggerInfo = rowInfoOf(event)
          if (triggerInfo) {
            event.preventDefault()
            event.stopPropagation()
            var rect = trigger.getBoundingClientRect()
            openRowMenu(ctx, store, triggerInfo, rect.left, rect.bottom + 4)
            return
          }
        }
        var info = rowInfoOf(event)
        if (info && info.kind === 'session') store.markRead(info.id)
      }

      document.addEventListener('contextmenu', onContextMenu, true)
      document.addEventListener('dblclick', onDoubleClick, true)
      document.addEventListener('click', onClick, true)
      var observer = new MutationObserver(schedule)
      // `style` is observed so a React re-render that drops the inline
      // display:none on a pinned row heals on the next frame; class churn from
      // the chat area is deliberately left out to keep streaming cheap.
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] })
      var unsubscribe = store.subscribe(schedule)
      schedule()

      return function () {
        document.removeEventListener('contextmenu', onContextMenu, true)
        document.removeEventListener('dblclick', onDoubleClick, true)
        document.removeEventListener('click', onClick, true)
        observer.disconnect()
        unsubscribe()
        if (raf) {
          if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
          else window.clearTimeout(raf)
        }
        removeMenus()
        removeEl('.' + MODAL_CLASS + '-backdrop')
        unwrapSplit(document)
      }
    }

    /* --------------------------------------------------------------- apply */

    function injectStyles() {
      var tag = document.querySelector('style[data-plugin="' + PLUGIN_ID + '"]')
      if (tag) return tag
      tag = document.createElement('style')
      tag.setAttribute('data-plugin', PLUGIN_ID)
      tag.textContent = STYLE_TEXT
      document.head.appendChild(tag)
      return tag
    }

    function apply(ctx) {
      var styleTag = injectStyles()
      var store = createStore(safeStorage())
      ctx.effect(function () {
        var disposeSidebar = mountSidebar(ctx, store)
        return function () {
          disposeSidebar()
          if (styleTag && styleTag.parentNode) styleTag.remove()
        }
      }, 'dsh-sidebar-pins: sidebar')
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = name
    return module.exports
  },
})
