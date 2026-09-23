/**
 * Host half of dsh-sidebar-pins.
 *
 * One route: `POST /dsh-sidebar-pins/delete-workspace`. The client half owns
 * every other menu action through the shipped client services, so nothing else
 * needs the host.
 *
 * Why this is a route at all: the renderer is a browser context with no
 * filesystem or process access, so removing a directory can only happen here.
 * Why the request carries a workspace id instead of a path: a path from the
 * browser would make this route an `rm -rf <anything>` primitive. The id is
 * resolved against the host's own registry, so the set of deletable
 * directories is exactly the set the user registered as workspaces, and the
 * caller must additionally echo the workspace title it believes it is
 * deleting.
 */
import { rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, sep } from 'node:path'

export const name = 'dsh-sidebar-pins'

export const inject = ['webServer', 'connection', 'workspaceRegistry']

const DELETE_ROUTE = '/dsh-sidebar-pins/delete-workspace'
/** Request bodies here are two short strings; anything larger is hostile. */
const MAX_BODY_BYTES = 8 * 1024

/**
 * Route ownership shared by every plugin instance bound to the same server.
 * A live patch reload (this plugin is installed as a linked bundle) can apply
 * the same host half twice, and the server rejects a duplicate exact route.
 */
const routeLeases = new WeakMap()

/**
 * Filesystem seams. Destructive behaviour is reachable only through this
 * object so a test can substitute a spy and prove that a refusal happened
 * *before* any removal — a test must never drive the real remover with a path
 * it does not own. (This plugin shipped a test that did exactly that and
 * deleted a developer's working tree; the seam exists so it cannot recur.)
 */
export const internals = {
  remove: (target) => rm(target, { recursive: true, force: true }),
  isDirectory: async (target) => {
    try {
      return (await stat(target)).isDirectory()
    } catch {
      return false
    }
  },
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** Read a bounded JSON body; malformed or oversized input resolves to null. */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(buffer)
  }
  if (size === 0) return null
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Directories this route must never remove, whatever the registry says: the
 * volume root, the home directory, the DSH home, the host process's working
 * directory, and the Windows system root. Being an *ancestor* of one of those
 * counts too — a workspace registered as `~/works` still owns `~/works/repo`.
 */
function forbiddenTargets() {
  return [
    homedir(),
    process.cwd(),
    process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    process.env.SystemRoot ?? '',
  ].filter((value) => value !== '')
}

function isForbiddenPath(target) {
  const normalized = normalize(target)
  if (!isAbsolute(normalized)) return true
  if (normalized === sep || /^[a-zA-Z]:[\\/]?$/.test(normalized)) return true
  for (const item of forbiddenTargets()) {
    const guard = normalize(item)
    if (normalized === guard || guard.startsWith(normalized + sep)) return true
  }
  return false
}

/**
 * A target that *contains* another registered workspace is refused even when it
 * looks like a legitimate workspace itself: deleting `~/works` also destroys
 * `~/works/repo/vino`, which the user registered separately.
 */
function containsAnotherWorkspace(target, workspaces, selfId) {
  return workspaces.some((entry) => {
    if (entry === undefined || entry.id === selfId || typeof entry.path !== 'string') return false
    const other = normalize(entry.path)
    return other !== target && other.startsWith(target + sep)
  })
}

export function apply(ctx) {
  ctx.effect(() => acquireRoute(ctx), 'dsh-sidebar-pins: delete workspace route')
}

/** Register the route once per server; extra instances only raise the refcount. */
function acquireRoute(ctx) {
  const existing = routeLeases.get(ctx.webServer)
  if (existing !== undefined) {
    existing.references += 1
    return () => {
      existing.references -= 1
      if (existing.references === 0) {
        routeLeases.delete(ctx.webServer)
        existing.dispose()
      }
    }
  }
  const dispose = ctx.webServer.register({
    kind: 'exact',
    path: DELETE_ROUTE,
    handler: handleDeleteWorkspace(ctx),
  })
  const lease = { references: 1, dispose }
  routeLeases.set(ctx.webServer, lease)
  return () => {
    lease.references -= 1
    if (lease.references === 0) {
      routeLeases.delete(ctx.webServer)
      dispose()
    }
  }
}

function handleDeleteWorkspace(ctx) {
  return async (req, res) => {
    // Host/Origin fence plus browser authentication, exactly as the shipped
    // routes apply it: loopback alone is not a credential.
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) {
      res.statusCode = rejection
      res.end()
      return
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'method-not-allowed' })
      return
    }
    const body = await readJsonBody(req)
    if (body === null || typeof body.workspaceId !== 'string' || typeof body.confirm !== 'string') {
      sendJson(res, 400, { ok: false, code: 'bad-request' })
      return
    }
    const workspace = ctx.workspaceRegistry.list().find((entry) => entry.id === body.workspaceId)
    if (workspace === undefined) {
      sendJson(res, 404, { ok: false, code: 'unknown-workspace' })
      return
    }
    if (body.confirm !== workspace.title) {
      sendJson(res, 400, { ok: false, code: 'confirm-mismatch' })
      return
    }
    const target = normalize(workspace.path)
    if (isForbiddenPath(target)) {
      sendJson(res, 400, { ok: false, code: 'forbidden-path', message: 'refusing to delete a system or home directory' })
      return
    }
    if (containsAnotherWorkspace(target, ctx.workspaceRegistry.list(), workspace.id)) {
      sendJson(res, 400, { ok: false, code: 'contains-workspace', message: 'refusing to delete a directory that contains another workspace' })
      return
    }

    const existed = await internals.isDirectory(target)
    if (existed) {
      try {
        await internals.remove(target)
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          code: 'delete-failed',
          message: error instanceof Error ? error.message : String(error),
        })
        return
      }
    }

    // The directory is gone; settle the registry so no row points at it.
    // Archive first: an archived session stays readable while leaving the
    // sidebar, which beats leaving rows attached to a deleted directory.
    const sessionIds = Array.isArray(workspace.sessionIds) ? [...workspace.sessionIds] : []
    let archived = 0
    for (const sessionId of sessionIds) {
      try {
        await ctx.workspaceRegistry.archiveSession(sessionId)
        archived += 1
      } catch {
        // A session the registry no longer knows about needs no archiving.
      }
    }
    let unregistered = true
    try {
      await ctx.workspaceRegistry.delete(workspace.id)
    } catch {
      unregistered = false
    }
    sendJson(res, 200, { ok: true, removed: existed, archived, unregistered })
  }
}
