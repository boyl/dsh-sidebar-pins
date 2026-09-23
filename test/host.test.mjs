// Host-route test for dsh-sidebar-pins.
//
// Drives the registered `/dsh-sidebar-pins/delete-workspace` handler with fake
// requests against a fake registry, and checks every guard before the happy
// path actually removes a real temporary directory.
//
// SAFETY: this file drives a route that deletes directories. Two rails apply,
// because an earlier revision of this test pointed the handler at the
// developer's real working tree (`~/works`) and the guard let it through:
//   1. `internals.remove` is replaced by a spy whose real implementation
//      refuses any path outside `tmpdir()`.
//   2. every refusal case asserts the spy was never called.
// A new case must never call the handler with a path it does not own.
//
//   node test/host.test.mjs
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { apply as applyHost, inject, internals, name } from '../host.js'

const removeCalls = []
const realRemove = internals.remove
internals.remove = async (target) => {
  const resolved = resolve(String(target))
  if (!resolved.startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('TEST SAFETY RAIL: refused to remove a path outside tmpdir: ' + resolved)
  }
  removeCalls.push(resolved)
  return realRemove(target)
}

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

/** A request the handler can iterate; `null` body means an empty stream. */
function makeRequest(body, method = 'POST') {
  const payload = body === null ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    headers: {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of payload) yield chunk
    },
  }
}

function makeResponse() {
  const headers = {}
  return {
    statusCode: 0,
    body: '',
    setHeader(key, value) { headers[key.toLowerCase()] = value },
    end(chunk) { if (chunk !== undefined) this.body = String(chunk) },
    json() { return this.body === '' ? null : JSON.parse(this.body) },
    headers,
  }
}

async function callRoute(route, options) {
  const res = makeResponse()
  await route.handler(options.request, res)
  return res
}

async function main() {
  section('plugin contract')
  check('host name matches the bundle row', name === 'dsh-sidebar-pins', name)
  check(
    'host injects the fence, the server, and the registry',
    JSON.stringify(inject) === '["webServer","connection","workspaceRegistry"]',
    JSON.stringify(inject),
  )

  let route = null
  const archived = []
  const deleted = []
  let rejection
  let registry = []
  const ctx = {
    webServer: { register: (value) => { route = value; return () => {} } },
    connection: { requestRejection: () => rejection },
    workspaceRegistry: {
      list: () => registry,
      archiveSession: async (id) => { archived.push(id) },
      delete: async (id) => { deleted.push(id) },
    },
    effect: (fn) => { fn() },
  }
  applyHost(ctx)
  check('the delete route is registered', route !== null && route.path === '/dsh-sidebar-pins/delete-workspace', route && route.path)

  section('route lease')
  let registrations = 0
  const countingCtx = {
    ...ctx,
    webServer: { register: (value) => { registrations += 1; route = value; return () => {} } },
  }
  applyHost(countingCtx)
  applyHost(countingCtx)
  check('a second instance of the same server reuses the route', registrations === 1, registrations)

  const root = await mkdtemp(join(tmpdir(), 'dsh-pins-host-'))
  const workspacePath = join(root, 'workspace')
  await mkdir(join(workspacePath, 'nested'), { recursive: true })
  const entity = { id: 'ws-1', path: workspacePath, title: 'vino', sessionIds: ['session-A', 'session-B'] }
  registry = [entity]

  section('guards')
  rejection = 403
  let res = await callRoute(route, { request: makeRequest({ workspaceId: 'ws-1', confirm: 'vino' }) })
  check('an untrusted request is rejected by the fence', res.statusCode === 403, res.statusCode)
  rejection = undefined

  res = await callRoute(route, { request: makeRequest({ workspaceId: 'ws-1', confirm: 'vino' }, 'GET') })
  check('a non-POST method is refused', res.statusCode === 405, res.statusCode)

  res = await callRoute(route, { request: makeRequest(null) })
  check('an empty body is refused', res.statusCode === 400, res.statusCode)

  res = await callRoute(route, { request: makeRequest({ workspaceId: 'ws-9', confirm: 'vino' }) })
  check('an unknown workspace id is refused', res.statusCode === 404 && res.json().code === 'unknown-workspace', res.statusCode)

  res = await callRoute(route, { request: makeRequest({ workspaceId: 'ws-1', confirm: 'wrong' }) })
  check('a mismatched confirmation title is refused', res.statusCode === 400 && res.json().code === 'confirm-mismatch', res.statusCode)
  check('the directory survived every refusal', (await stat(workspacePath)).isDirectory())

  registry = [{ id: 'ws-2', path: homedir(), title: 'home', sessionIds: [] }]
  res = await callRoute(route, { request: makeRequest({ workspaceId: 'ws-2', confirm: 'home' }) })
  check('a workspace pointing at the home directory is refused', res.statusCode === 400 && res.json().code === 'forbidden-path', res.statusCode)

  registry = [{ id: 'ws-3', path: '/', title: 'root', sessionIds: [] }]
  res = await callRoute(route, { request: makeRequest({ workspaceId: 'ws-3', confirm: 'root' }) })
  check('a workspace pointing at the volume root is refused', res.statusCode === 400 && res.json().code === 'forbidden-path', res.statusCode)

  // `dirname(homedir())` is a real ancestor (`/Users` on macOS): the guard must
  // refuse it. If the guard ever regresses, the safety rail turns the removal
  // into a caught error instead of a disaster.
  registry = [{ id: 'ws-4', path: dirname(homedir()), title: 'ancestor', sessionIds: [] }]
  res = await callRoute(route, { request: makeRequest({ workspaceId: 'ws-4', confirm: 'ancestor' }) })
  check('a workspace that is an ancestor of the home directory is refused', res.statusCode === 400 && res.json().code === 'forbidden-path', res.statusCode)

  // This used to be the case that deleted a developer's working tree: the path
  // was a *child* of home, so the guard let it through, and the test then drove
  // the real remover. Every refusal now also asserts that no removal was even
  // attempted, and the seam below refuses to touch anything outside tmpdir.
  check('no removal was attempted for any refusal', removeCalls.length === 0, JSON.stringify(removeCalls))

  section('a target that contains another workspace')
  const outer = join(root, 'outer')
  const inner = join(outer, 'inner')
  await mkdir(inner, { recursive: true })
  registry = [
    { id: 'ws-outer', path: outer, title: 'outer', sessionIds: [] },
    { id: 'ws-inner', path: inner, title: 'inner', sessionIds: ['session-A'] },
  ]
  res = await callRoute(route, { request: makeRequest({ workspaceId: 'ws-outer', confirm: 'outer' }) })
  check('deleting a directory that holds another workspace is refused', res.statusCode === 400 && res.json().code === 'contains-workspace', res.statusCode)
  check('the outer tree survived', (await stat(join(inner, '..'))).isDirectory())
  check('still no removal was attempted', removeCalls.length === 0, JSON.stringify(removeCalls))

  section('delete')
  registry = [entity]
  archived.length = 0
  deleted.length = 0
  removeCalls.length = 0
  res = await callRoute(route, { request: makeRequest({ workspaceId: 'ws-1', confirm: 'vino' }) })
  const payload = res.json()
  check('a confirmed delete succeeds', res.statusCode === 200 && payload && payload.ok === true, res.statusCode)
  check('the response reports the removal', payload && payload.removed === true, JSON.stringify(payload))
  let gone = false
  try {
    await stat(workspacePath)
  } catch {
    gone = true
  }
  check('the directory tree is actually gone', gone)
  check('the removal went through the seam exactly once', removeCalls.length === 1 && removeCalls[0] === workspacePath, JSON.stringify(removeCalls))
  check('its sessions were archived', JSON.stringify(archived) === '["session-A","session-B"]', JSON.stringify(archived))
  check('the registration was dropped', JSON.stringify(deleted) === '["ws-1"]', JSON.stringify(deleted))

  section('stale registration')
  archived.length = 0
  deleted.length = 0
  removeCalls.length = 0
  registry = [{ id: 'ws-5', path: join(root, 'already-gone'), title: 'gone', sessionIds: [] }]
  res = await callRoute(route, { request: makeRequest({ workspaceId: 'ws-5', confirm: 'gone' }) })
  check('a missing directory still settles the registration', res.statusCode === 200 && res.json().removed === false, JSON.stringify(res.json()))
  check('a missing directory never reaches the remover', removeCalls.length === 0, JSON.stringify(removeCalls))
  check('the registration is dropped even when the directory was missing', JSON.stringify(deleted) === '["ws-5"]', JSON.stringify(deleted))

  await rm(root, { recursive: true, force: true })
  console.log('\n' + (failures === 0 ? 'ALL PASS' : failures + ' CHECK(S) FAILED'))
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
