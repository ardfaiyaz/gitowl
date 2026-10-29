// Live GitHub write checks through gitowl's API. Run ONLY against a disposable repository you own:
//   GITOWL_GH_SANDBOX=owner/sandbox-repo node scripts/github-e2e.mjs
// It clones the sandbox, then creates/merges a PR, opens/closes an issue and publishes a release there.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import assert from 'node:assert/strict'
import { startServer, defaultExecutable } from './server.mjs'

const sandbox = process.env.GITOWL_GH_SANDBOX
if (!sandbox || !/^[\w.-]+\/[\w.-]+$/.test(sandbox)) {
  console.error('Set GITOWL_GH_SANDBOX=owner/repo to a disposable repository you own.')
  process.exit(2)
}
const workspace = resolve('work')
mkdirSync(workspace, { recursive: true })
const fixture = mkdtempSync(join(workspace, 'gh-e2e-'))
const stamp = Date.now().toString(36)
// XDG_CONFIG_HOME stays untouched: the GitHub CLI reads its sign-in from there.
const server = await startServer(defaultExecutable, fixture, { GIT_CEILING_DIRECTORIES: workspace, LOCALAPPDATA: fixture })
const done = []
try {
  let repo = null
  const call = async (op, data = {}) => {
    const response = await server.request({ op, repo, ...data })
    const value = await response.json()
    assert.equal(response.status, 200, `${op}: ${JSON.stringify(value)}`)
    done.push(op)
    return value
  }

  repo = (await call('open', { path: (await call('gh_clone', { name: sandbox, parent: fixture })).path })).path
  const status = await call('gh_status')
  assert.equal(status.signedIn, true)
  assert.equal(status.repo.nameWithOwner.toLowerCase(), sandbox.toLowerCase())
  const base = status.repo.defaultBranchRef.name

  // Pull request lifecycle: draft → ready → comment/review → close/reopen → local checkout → squash merge.
  const branch = `e2e/${stamp}`
  await call('create_branch', { branch })
  writeFileSync(join(repo, `e2e-${stamp}.txt`), `gitowl e2e ${stamp}\n`)
  await call('stage_all')
  await call('commit', { message: `E2E change ${stamp}`, fingerprint: (await call('status')).fingerprint })
  await call('publish', { remote: 'origin', branch })
  await call('gh_pr_create', { base, head: branch, title: `gitowl e2e ${stamp}`, body: 'Created by scripts/github-e2e.mjs', draft: true })
  // No search filter: GitHub's search index lags behind writes.
  const pr = (await call('gh_prs', { state: 'open' })).items.find(p => p.headRefName === branch)
  assert.ok(pr, 'created PR is listed')
  assert.equal(pr.isDraft, true)
  await call('gh_pr_ready', { number: pr.number })
  await call('gh_pr_comment', { number: pr.number, body: 'Comment from gitowl e2e' })
  await call('gh_pr_review', { number: pr.number, event: 'comment', body: 'Review comment from gitowl e2e' })
  await call('gh_pr_close', { number: pr.number })
  await call('gh_pr_reopen', { number: pr.number })
  await call('switch', { branch: base })
  await call('gh_pr_checkout', { number: pr.number })
  assert.equal((await call('status')).branch, branch)
  const detail = await call('gh_pr', { number: pr.number })
  assert.ok(detail.detail.comments.some(c => c.body.includes('Comment from gitowl e2e')))
  assert.match(detail.diff, /gitowl e2e/)
  await call('switch', { branch: base })
  await call('gh_pr_merge', { number: pr.number, method: 'squash', deleteBranch: true })
  assert.equal((await call('gh_pr', { number: pr.number })).detail.state, 'MERGED')

  // Issue lifecycle.
  await call('gh_issue_create', { title: `gitowl e2e issue ${stamp}`, body: 'Created by scripts/github-e2e.mjs' })
  const issue = (await call('gh_issues', { state: 'open' })).items.find(i => i.title.includes(stamp))
  assert.ok(issue, 'created issue is listed')
  await call('gh_issue_comment', { number: issue.number, body: 'Issue comment from gitowl e2e' })
  await call('gh_issue_close', { number: issue.number })
  await call('gh_issue_reopen', { number: issue.number })
  await call('gh_issue_close', { number: issue.number })
  assert.equal((await call('gh_issue', { number: issue.number })).detail.state, 'CLOSED')

  // Release with an asset from a pushed tag.
  await call('pull', { mode: 'ff' })
  const tag = `e2e-${stamp}`
  await call('tag', { tag, message: 'gitowl e2e release' })
  await call('tag_push', { remote: 'origin', tag })
  await call('gh_release_create', { tag, title: `gitowl e2e ${stamp}`, notes: 'Release notes from gitowl e2e', assets: `e2e-${stamp}.txt`, prerelease: true })
  assert.ok((await call('gh_releases')).items.some(r => r.tagName === tag))
  await call('gh_runs')

  console.log(`PASS: ${done.length} GitHub operations against ${sandbox} (PR #${pr.number}, issue #${issue.number}, release ${tag})`)
} finally {
  await server.stop()
  if (!resolve(fixture).startsWith(workspace + sep)) throw new Error('Invalid cleanup path')
  rmSync(fixture, { recursive: true, force: true })
}
