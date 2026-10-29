use crate::git::{self, Result, run};
use serde_json::{Value, json};
use std::{path::Path, process::Command};

// GitHub access goes through the GitHub CLI, which owns sign-in and stores tokens in the OS keyring.
fn gh(path: &Path, args: &[&str]) -> Result<String> {
    let mut command = Command::new("gh");
    command
        .current_dir(path)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("GH_PAGER", "")
        .env("NO_COLOR", "1");
    git::execute(command).map_err(|e| {
        if e.starts_with("Cannot run gh") {
            "GitHub CLI is not installed. Install it from https://cli.github.com, then run `gh auth login` in a terminal.".into()
        } else {
            e
        }
    })
}
/// Runs gh with `input` on stdin, so secret values never appear in the process list or argv.
fn gh_input(path: &Path, args: &[&str], input: &str) -> Result<String> {
    use std::io::Write;
    let mut command = Command::new("gh");
    command
        .current_dir(path)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| format!("Cannot run gh: {e}"))?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_owned())
    }
}
/// Actions secret and variable names: letters, digits and underscores, not starting with a digit or GITHUB_.
fn config_name(v: &Value) -> Result<&str> {
    let name = text(v, "name");
    let ok = !name.is_empty()
        && name.len() <= 100
        && !name.starts_with(|c: char| c.is_ascii_digit())
        && !name.to_ascii_uppercase().starts_with("GITHUB_")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok {
        Ok(name)
    } else {
        Err(
            "Use letters, digits and underscores; names can't start with a digit or GITHUB_."
                .into(),
        )
    }
}
fn gh_json(path: &Path, args: &[&str]) -> Result<Value> {
    serde_json::from_str(&gh(path, args)?).map_err(|e| format!("Unexpected GitHub CLI output: {e}"))
}

type SettingsRequest = (&'static str, &'static str, Option<&'static str>);

// Only these read-only endpoints are available to the settings viewer. Projections
// deliberately exclude webhook configurations, key material and other unused fields.
fn repository_settings_requests(section: &str) -> Result<&'static [SettingsRequest]> {
    match section {
        "general" | "secrets" | "more" => Ok(&[]),
        "access" => Ok(&[
            (
                "collaborators",
                "repos/{owner}/{repo}/collaborators?per_page=100",
                Some(""),
            ),
            ("teams", "repos/{owner}/{repo}/teams?per_page=100", Some("")),
        ]),
        "branches" => Ok(&[
            (
                "branches",
                "repos/{owner}/{repo}/branches?per_page=100",
                Some(""),
            ),
            (
                "rulesets",
                "repos/{owner}/{repo}/rulesets?per_page=100",
                Some(""),
            ),
        ]),
        "actions" => Ok(&[
            ("actions", "repos/{owner}/{repo}/actions/permissions", None),
            (
                "workflow",
                "repos/{owner}/{repo}/actions/permissions/workflow",
                None,
            ),
            (
                "runners",
                "repos/{owner}/{repo}/actions/runners?per_page=100",
                Some("runners"),
            ),
        ]),
        "environments" => Ok(&[(
            "environments",
            "repos/{owner}/{repo}/environments?per_page=100",
            Some("environments"),
        )]),
        "security" => Ok(&[(
            "reporting",
            "repos/{owner}/{repo}/private-vulnerability-reporting",
            None,
        )]),
        "webhooks" => Ok(&[(
            "webhooks",
            "repos/{owner}/{repo}/hooks?per_page=100",
            Some(""),
        )]),
        "keys" => Ok(&[("keys", "repos/{owner}/{repo}/keys?per_page=100", Some(""))]),
        "pages" => Ok(&[("pages", "repos/{owner}/{repo}/pages", None)]),
        _ => Err("Choose a repository settings section.".into()),
    }
}

fn settings_list(key: &str, field: &str, pages: Value) -> Result<Value> {
    let fields: &[&str] = match key {
        "collaborators" => &["id", "login", "role_name", "permissions"],
        "teams" => &["id", "name", "slug", "permission"],
        "branches" => &["name", "protected"],
        "rulesets" => &[
            "id",
            "name",
            "target",
            "enforcement",
            "source",
            "source_type",
        ],
        "runners" => &["id", "name", "os", "status", "busy"],
        "environments" => &["id", "name", "protection_rules", "deployment_branch_policy"],
        "webhooks" => &["id", "name", "active", "events"],
        "keys" => &[
            "id",
            "title",
            "read_only",
            "verified",
            "created_at",
            "enabled",
        ],
        _ => return Err("Unknown settings list.".into()),
    };
    let invalid = || "GitHub returned an unexpected settings list.".to_owned();
    let mut result = Vec::new();
    for page in pages.as_array().ok_or_else(invalid)? {
        let list = if field.is_empty() { page } else { &page[field] };
        for item in list.as_array().ok_or_else(invalid)? {
            let item = item.as_object().ok_or_else(invalid)?;
            let projected = fields
                .iter()
                .filter_map(|key| {
                    item.get(*key)
                        .map(|value| ((*key).to_owned(), value.clone()))
                })
                .collect::<serde_json::Map<_, _>>();
            result.push(Value::Object(projected));
        }
    }
    Ok(Value::Array(result))
}

fn repository_settings(
    section: &str,
    mut fetch: impl FnMut(&[&str]) -> Result<Value>,
) -> Result<Value> {
    let requests = repository_settings_requests(section)?;
    let repository = fetch(&["api", "repos/{owner}/{repo}"])?;
    let mut values = serde_json::Map::new();
    let mut errors = serde_json::Map::new();
    for &(key, endpoint, list_field) in requests {
        let mut args = vec!["api", endpoint];
        if list_field.is_some() {
            args.extend(["--paginate", "--slurp"]);
        }
        let result = fetch(&args).and_then(|value| match list_field {
            Some(field) => settings_list(key, field, value),
            None => Ok(value),
        });
        match result {
            Ok(value) => {
                values.insert(key.into(), value);
            }
            Err(error) => {
                errors.insert(key.into(), json!(error));
            }
        }
    }
    Ok(json!({"repository":repository,"values":values,"errors":errors}))
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn number(v: &Value) -> Result<String> {
    let n = v["number"]
        .as_u64()
        .map(|n| n.to_string())
        .unwrap_or_else(|| text(v, "number").to_owned());
    if n.is_empty() || n.len() > 12 || !n.chars().all(|c| c.is_ascii_digit()) {
        return Err("Choose a valid number.".into());
    }
    Ok(n)
}
fn branch(path: &Path, name: &str) -> Result<()> {
    if name.starts_with('-') {
        return Err("Invalid branch name.".into());
    }
    run(path, &["check-ref-format", "--branch", name]).map(|_| ())
}
fn state(v: &Value) -> Result<&str> {
    match text(v, "state") {
        "" => Ok("open"),
        s @ ("open" | "closed" | "merged" | "all") => Ok(s),
        _ => Err("Choose open, closed, merged or all.".into()),
    }
}
fn required<'a>(v: &'a Value, key: &str, label: &str) -> Result<&'a str> {
    let value = text(v, key);
    if value.trim().is_empty() {
        return Err(format!("Enter a {label}."));
    }
    Ok(value)
}
// GraphQL node ids look like PRRT_kwDOAbc123; anything else came from a stale or forged request.
fn node_id<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    let id = text(v, key);
    if id.is_empty()
        || id.len() > 100
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Reload the pull request and try again.".into());
    }
    Ok(id)
}
/// The replacement text of the first ```suggestion block in a review comment ("" deletes the lines).
fn suggestion(body: &str) -> Option<String> {
    let rest = &body[body.find("```suggestion")?..];
    let rest = &rest[rest.find('\n')? + 1..];
    Some(rest[..rest.find("```")?].replace('\r', ""))
}
/// Replaces 1-based lines start..=end with `replacement`, keeping the file's line endings.
fn replace_lines(content: &str, start: usize, end: usize, replacement: &str) -> Result<String> {
    let lines: Vec<&str> = content.split_inclusive('\n').collect();
    if start == 0 || start > end || end > lines.len() {
        return Err(
            "This suggestion no longer fits the file. Reload the pull request and try again."
                .into(),
        );
    }
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut out = lines[..start - 1].concat();
    for line in replacement.lines() {
        out.push_str(line);
        out.push_str(newline);
    }
    // A last line without a newline stays without one.
    if end == lines.len() && !content.ends_with('\n') && !replacement.is_empty() {
        out.truncate(out.len() - newline.len());
    }
    out.push_str(&lines[end..].concat());
    Ok(out)
}
fn encode_path(file: &str) -> String {
    file.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"/._-~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
fn done(message: impl Into<String>, output: String) -> Result<Value> {
    Ok(json!({"message": message.into(), "output": output.trim()}))
}

const PR_LIST: &str =
    "number,title,author,headRefName,baseRefName,state,isDraft,url,reviewDecision,updatedAt,labels";
const PR_VIEW: &str = "number,title,body,author,state,isDraft,url,headRefName,baseRefName,headRefOid,reviewDecision,statusCheckRollup,files,additions,deletions,commits,comments,reviews,mergeable,mergeStateStatus,autoMergeRequest,assignees,milestone,reviewRequests,latestReviews,labels,createdAt";
// Review threads, with their resolved state, only exist in the GraphQL API.
const THREADS: &str = "query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved isOutdated path line startLine diffSide comments(first:50){nodes{id body createdAt author{login}}}}}}}}";
const SUGGESTION_SOURCE: &str = "query($id:ID!){node(id:$id){... on PullRequestReviewComment{body path line startLine outdated pullRequest{headRefName headRefOid headRepository{name} headRepositoryOwner{login}}}}}";
const ISSUE_LIST: &str = "number,title,author,state,url,labels,comments,updatedAt";
const ISSUE_VIEW: &str =
    "number,title,body,author,state,url,labels,comments,assignees,milestone,isPinned,createdAt";
const RUN_LIST: &str =
    "databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,createdAt,url";

/// Whether a workflow can be started by hand, and its declared `workflow_dispatch` inputs.
/// shortcut: a line-based reader for the common block style of workflow YAML, not full YAML; flow-style input maps are skipped.
fn dispatch_inputs(yaml: &str) -> (bool, Vec<Value>) {
    let indent = |l: &str| l.len() - l.trim_start().len();
    let clean = |v: &str| v.trim().trim_matches(['"', '\'']).to_owned();
    let lines: Vec<&str> = yaml
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
        .collect();
    // `on: workflow_dispatch` or `on: [push, workflow_dispatch]` have no inputs.
    let inline = lines.iter().any(|l| {
        let t = l.trim();
        (t.starts_with("on:") || t.starts_with("\"on\":") || t.starts_with("'on':"))
            && t.contains("workflow_dispatch")
    });
    let Some(start) = lines
        .iter()
        .position(|l| l.trim().trim_end_matches(':') == "workflow_dispatch")
    else {
        return (inline, vec![]);
    };
    let base = indent(lines[start]);
    let mut inputs: Vec<Value> = Vec::new();
    let (mut in_inputs, mut input_indent, mut options) = (false, usize::MAX, false);
    for line in &lines[start + 1..] {
        let level = indent(line);
        if level <= base {
            break;
        }
        let t = line.trim();
        if t == "inputs:" {
            in_inputs = true;
            continue;
        }
        if !in_inputs {
            continue;
        }
        if t.ends_with(':') && !t.contains(' ') && level <= input_indent {
            input_indent = level;
            options = false;
            inputs.push(json!({"name": t.trim_end_matches(':'), "description": "", "required": false, "default": "", "type": "string", "options": []}));
        } else if let Some(current) = inputs.last_mut() {
            if let Some(item) = t.strip_prefix("- ").filter(|_| options) {
                current["options"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!(clean(item)));
            } else if let Some((key, value)) = t.split_once(':') {
                options = key == "options";
                match key {
                    "description" | "default" | "type" => current[key] = json!(clean(value)),
                    "required" => current["required"] = json!(clean(value) == "true"),
                    // Inline list: options: [a, b, c]
                    "options" if value.trim().starts_with('[') => {
                        let list = value.trim().trim_start_matches('[').trim_end_matches(']');
                        current["options"] = json!(
                            list.split(',')
                                .map(clean)
                                .filter(|o| !o.is_empty())
                                .collect::<Vec<_>>()
                        );
                    }
                    _ => {}
                }
            }
        }
    }
    (true, inputs)
}

/// A .gitignore or license template from GitHub, for new repositories.
pub fn template(kind: &str, name: &str) -> Result<String> {
    if name.is_empty()
        || name.len() > 40
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-.+".contains(c))
    {
        return Err("Choose a template from the list.".into());
    }
    let kind = if kind == "license" {
        "license"
    } else {
        "gitignore"
    };
    gh(Path::new("."), &["repo", kind, "view", name])
}

/// Operations that do not need an open repository.
pub fn account(op: &str, request: &Value) -> Option<Result<Value>> {
    let home = Path::new(".");
    Some(match op {
        "gh_repos" => gh_json(
            home,
            &[
                "repo",
                "list",
                "--limit",
                "200",
                "--json",
                "nameWithOwner,description,url,isPrivate,updatedAt,primaryLanguage",
            ],
        )
        .map(|repos| json!({ "repos": repos })),
        "gh_clone" => (|| {
            let name = required(request, "name", "repository")?;
            if name.starts_with('-')
                || name.split('/').count() != 2
                || name.contains(char::is_whitespace)
            {
                return Err("Choose a repository as owner/name.".into());
            }
            let parent = std::fs::canonicalize(required(request, "parent", "destination folder")?)
                .map_err(|e| e.to_string())?;
            let destination = parent.join(name.split('/').nth(1).unwrap());
            if destination.exists() {
                return Err(format!(
                    "{} already exists. Open it instead.",
                    git::display(&destination)
                ));
            }
            // The destination is absolute, so it can never be read as an option.
            gh(
                &parent,
                &["repo", "clone", name, &git::display(&destination)],
            )?;
            Ok(json!({"path": git::display(&destination), "message": format!("Cloned {name}.")}))
        })(),
        "update_check" => update_check(
            home,
            env!("CARGO_PKG_REPOSITORY"),
            env!("CARGO_PKG_VERSION"),
        ),
        _ => return None,
    })
}

fn version_parts(version: &str) -> Vec<u64> {
    version
        .trim_start_matches('v')
        .split(['.', '-', '+'])
        .map_while(|part| part.parse().ok())
        .collect()
}

/// Asked for explicitly from Settings: compares this build with the latest published gitowl release.
fn update_check(home: &Path, repository: &str, current: &str) -> Result<Value> {
    let slug = repository
        .trim_end_matches(".git")
        .strip_prefix("https://github.com/")
        .filter(|s| s.split('/').count() == 2)
        .ok_or("Update checks are not configured for this build: set `repository` in Cargo.toml to the GitHub repository that publishes gitowl releases.")?;
    let latest = gh_json(home, &["api", &format!("repos/{slug}/releases/latest")])?;
    let tag = latest["tag_name"].as_str().unwrap_or_default();
    Ok(json!({
        "current": current,
        "latest": tag,
        "url": latest["html_url"],
        "newer": version_parts(tag) > version_parts(current),
    }))
}

pub fn execute(path: &Path, op: &str, request: &Value) -> Result<Value> {
    let r = request;
    match op {
        "gh_status" => {
            let auth = gh(path, &["auth", "status", "--hostname", "github.com"]);
            let signed_in = auth.is_ok();
            let repo = if signed_in {
                gh_json(path, &["repo", "view", "--json", "nameWithOwner,url,description,defaultBranchRef,visibility,stargazerCount,forkCount,viewerPermission,isFork"])
                    .unwrap_or_else(|e| json!({ "error": e }))
            } else {
                Value::Null
            };
            let detail = auth.unwrap_or_else(|e| e);
            Ok(json!({"signedIn": signed_in, "detail": detail.trim(), "repo": repo}))
        }
        "gh_logout" => done(
            "Signed out of GitHub CLI.",
            gh(path, &["auth", "logout", "--hostname", "github.com"])?,
        ),
        "gh_browse" => {
            let mut args = vec!["browse".to_owned()];
            if !text(r, "number").is_empty() || r["number"].is_u64() {
                args.push(number(r)?);
            }
            // A file (optionally at a line), a commit, or a branch; gh builds the github.com URL.
            let file = text(r, "path");
            if !file.is_empty() {
                git::validate_file(file)?;
                let line = r["line"]
                    .as_u64()
                    .filter(|l| *l > 0)
                    .map(|l| format!(":{l}"))
                    .unwrap_or_default();
                args.push(format!("{file}{line}"));
            }
            let commit = text(r, "commit");
            if !commit.is_empty() {
                if !(4..=64).contains(&commit.len())
                    || !commit.chars().all(|c| c.is_ascii_hexdigit())
                {
                    return Err("Choose a commit first.".into());
                }
                // A positional SHA opens /commit/<sha>; --commit selects the file tree at that SHA.
                args.push(if file.is_empty() {
                    commit.to_owned()
                } else {
                    format!("--commit={commit}")
                });
            }
            let branch = text(r, "branch");
            if !branch.is_empty() {
                git::run(path, &["check-ref-format", "--branch", branch])?;
                args.push(format!("--branch={branch}"));
            }
            gh(path, &args.iter().map(String::as_str).collect::<Vec<_>>())?;
            Ok(json!({"message": "Opened GitHub in your browser."}))
        }
        "gh_prs" => {
            let mut args = vec![
                "pr",
                "list",
                "--limit",
                "100",
                "--state",
                state(r)?,
                "--json",
                PR_LIST,
            ];
            let search = format!("--search={}", text(r, "search"));
            if !text(r, "search").is_empty() {
                args.push(&search);
            }
            Ok(json!({ "items": gh_json(path, &args)? }))
        }
        "gh_pr" => {
            let n = number(r)?;
            let detail = gh_json(path, &["pr", "view", &n, "--json", PR_VIEW])?;
            let diff = gh(path, &["pr", "diff", &n]).unwrap_or_else(|e| e);
            let threads = gh_json(
                path,
                &[
                    "api",
                    "graphql",
                    "-F",
                    "owner={owner}",
                    "-F",
                    "repo={repo}",
                    "-F",
                    &format!("n={n}"),
                    "-f",
                    &format!("query={THREADS}"),
                    "--jq",
                    ".data.repository.pullRequest.reviewThreads.nodes",
                ],
            )
            .unwrap_or(json!([]));
            let behind = if detail["mergeStateStatus"] == "BEHIND" {
                let compare = format!(
                    "repos/{{owner}}/{{repo}}/compare/{}...{}",
                    text(&detail, "baseRefName"),
                    text(&detail, "headRefOid")
                );
                gh(path, &["api", &compare, "--jq", ".behind_by"])
                    .ok()
                    .and_then(|v| v.trim().parse::<u64>().ok())
            } else {
                None
            };
            Ok(json!({ "detail": detail, "diff": diff, "threads": threads, "behindBy": behind }))
        }
        "gh_pr_edit" | "gh_issue_edit" => {
            let n = number(r)?;
            let kind = if op == "gh_pr_edit" { "pr" } else { "issue" };
            let mut args = vec![kind.to_owned(), "edit".to_owned(), n.clone()];
            for (key, flag) in [
                ("title", "--title"),
                ("addReviewers", "--add-reviewer"),
                ("removeReviewers", "--remove-reviewer"),
                ("addAssignees", "--add-assignee"),
                ("removeAssignees", "--remove-assignee"),
                ("addLabels", "--add-label"),
                ("removeLabels", "--remove-label"),
                ("milestone", "--milestone"),
            ] {
                let value = text(r, key).trim();
                if value.contains(['\r', '\n']) {
                    return Err("Keep each field on one line.".into());
                }
                // flag=value, so a name starting with "-" is never read as an option.
                if !value.is_empty() {
                    args.push(format!("{flag}={value}"));
                }
            }
            if r["removeMilestone"].as_bool() == Some(true) {
                args.push("--remove-milestone".to_owned());
            }
            if args.len() == 3 {
                return Err("Change at least one field.".into());
            }
            done(
                format!("Updated pull request #{n}."),
                gh(path, &args.iter().map(String::as_str).collect::<Vec<_>>())?,
            )
        }
        "gh_pr_auto" => {
            let n = number(r)?;
            if r["enable"].as_bool() == Some(false) {
                return done(
                    "Turned off auto-merge.",
                    gh(path, &["pr", "merge", &n, "--disable-auto"])?,
                );
            }
            let method = match text(r, "method") {
                "merge" => "--merge",
                "rebase" => "--rebase",
                _ => "--squash",
            };
            done(
                "Auto-merge is on: GitHub merges once checks pass and reviews are approved.",
                gh(path, &["pr", "merge", &n, "--auto", method])?,
            )
        }
        "gh_branch_protected" => {
            let branch = text(r, "branch");
            git::run(path, &["check-ref-format", "--branch", branch])?;
            // Reading a branch's "protected" flag needs only read access, unlike its protection rules.
            let protected = gh(
                path,
                &[
                    "api",
                    &format!("repos/{{owner}}/{{repo}}/branches/{branch}"),
                    "--jq",
                    ".protected",
                ],
            )
            .map(|v| v.trim() == "true")
            .unwrap_or(false);
            Ok(json!({ "protected": protected }))
        }
        "gh_keys" => {
            // Each list needs its own token scope; a missing scope shows as null, not a failure.
            let count = |endpoint: &str| {
                gh_json(path, &["api", endpoint])
                    .ok()
                    .and_then(|v| v.as_array().map(Vec::len))
            };
            Ok(json!({
                "ssh": count("user/keys"),
                "signing": count("user/ssh_signing_keys"),
                "gpg": count("user/gpg_keys"),
            }))
        }
        "gh_secrets" => {
            let secrets = gh_json(path, &["secret", "list", "--json", "name,updatedAt"])?;
            let variables = gh_json(
                path,
                &["variable", "list", "--json", "name,value,updatedAt"],
            )
            .unwrap_or(json!([]));
            Ok(json!({ "secrets": secrets, "variables": variables }))
        }
        "gh_secret_set" => {
            let name = config_name(r)?;
            let value = text(r, "value");
            if value.is_empty() {
                return Err("Enter the secret's value.".into());
            }
            done(
                format!("Saved secret {name}. Its value can't be read back."),
                gh_input(path, &["secret", "set", name], value)?,
            )
        }
        "gh_variable_set" => {
            let name = config_name(r)?;
            let value = text(r, "value");
            done(
                format!("Saved variable {name}."),
                gh_input(path, &["variable", "set", name], value)?,
            )
        }
        "gh_secret_delete" | "gh_variable_delete" => {
            let name = config_name(r)?;
            let kind = if op == "gh_secret_delete" {
                "secret"
            } else {
                "variable"
            };
            done(
                format!("Deleted {kind} {name}."),
                gh(path, &[kind, "delete", name])?,
            )
        }
        "gh_repository_settings" => {
            repository_settings(text(r, "section"), |args| gh_json(path, args))
        }
        "gh_repo_info" => {
            let info = gh_json(
                path,
                &[
                    "repo",
                    "view",
                    "--json",
                    "nameWithOwner,description,repositoryTopics,visibility,isArchived,isFork,parent,viewerPermission",
                ],
            )?;
            let rulesets =
                gh_json(path, &["api", "repos/{owner}/{repo}/rulesets"]).unwrap_or(json!([]));
            Ok(json!({ "info": info, "rulesets": rulesets }))
        }
        "gh_repo_edit" => {
            let mut args = vec!["repo".to_owned(), "edit".to_owned()];
            let description = text(r, "description");
            if r.get("description").is_some() {
                if description.contains(['\r', '\n']) {
                    return Err("Keep the description on one line.".into());
                }
                args.push(format!("--description={description}"));
            }
            for (key, flag) in [
                ("addTopic", "--add-topic"),
                ("removeTopic", "--remove-topic"),
            ] {
                let topic = text(r, key).trim().to_ascii_lowercase();
                if topic.is_empty() {
                    continue;
                }
                if topic.len() > 50
                    || !topic.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                    || topic.starts_with('-')
                {
                    return Err("Topics use lowercase letters, digits and hyphens.".into());
                }
                args.push(format!("{flag}={topic}"));
            }
            if args.len() == 2 {
                return Err("Change at least one field.".into());
            }
            done(
                "Updated the repository.",
                gh(path, &args.iter().map(String::as_str).collect::<Vec<_>>())?,
            )
        }
        "gh_repo_visibility" => {
            let visibility = match text(r, "visibility") {
                v @ ("public" | "private" | "internal") => v,
                _ => return Err("Choose public, private or internal.".into()),
            };
            done(
                format!("The repository is now {visibility}."),
                gh(
                    path,
                    &[
                        "repo",
                        "edit",
                        &format!("--visibility={visibility}"),
                        "--accept-visibility-change-consequences",
                    ],
                )?,
            )
        }
        "gh_repo_archive" => done(
            "Archived the repository. It is now read-only.",
            gh(path, &["repo", "archive", "--yes"])?,
        ),
        "gh_repo_delete" => {
            let confirm = text(r, "confirm");
            if confirm.is_empty() {
                return Err("Type the repository's full name to confirm.".into());
            }
            // Re-read the real name here; the typed text must match it exactly.
            let name =
                gh_json(path, &["repo", "view", "--json", "nameWithOwner"])?["nameWithOwner"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned();
            if confirm != name {
                return Err(format!("Type {name} exactly to delete it."));
            }
            done(
                format!("Deleted {name} on GitHub. Your local copy is unchanged."),
                gh(path, &["repo", "delete", &name, "--yes"])?,
            )
        }
        "gh_label_create" => {
            let name = text(r, "name").trim();
            let color = text(r, "color").trim_start_matches('#');
            if name.is_empty() || name.len() > 50 || name.contains(['\r', '\n']) {
                return Err("Enter a label name up to 50 characters.".into());
            }
            if color.len() != 6 || !color.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err("Choose a colour.".into());
            }
            let mut args = vec![
                "label".to_owned(),
                "create".to_owned(),
                "--color".to_owned(),
                color.to_owned(),
            ];
            let description = text(r, "description").trim();
            if !description.is_empty() {
                args.extend(["--description".to_owned(), description.to_owned()]);
            }
            // `--` so a name starting with "-" is the label, not an option.
            args.extend(["--".to_owned(), name.to_owned()]);
            done(
                format!("Created label {name}."),
                gh(path, &args.iter().map(String::as_str).collect::<Vec<_>>())?,
            )
        }
        "gh_label_delete" => {
            let name = text(r, "name");
            if name.is_empty() {
                return Err("Choose a label.".into());
            }
            done(
                format!("Deleted label {name}."),
                gh(path, &["label", "delete", "--yes", "--", name])?,
            )
        }
        "gh_browse_settings" => {
            gh(path, &["browse", "--settings"])?;
            Ok(json!({"message": "Opened the repository settings on GitHub."}))
        }
        "gh_pr_options" => {
            let labels = gh_json(
                path,
                &["label", "list", "--limit", "200", "--json", "name,color"],
            )?;
            let people = gh_json(
                path,
                &[
                    "api",
                    "repos/{owner}/{repo}/assignees?per_page=100",
                    "--jq",
                    "[.[].login]",
                ],
            )?;
            let milestones = gh_json(
                path,
                &[
                    "api",
                    "repos/{owner}/{repo}/milestones?state=open&per_page=100",
                    "--jq",
                    "[.[].title]",
                ],
            )?;
            Ok(json!({ "labels": labels, "people": people, "milestones": milestones }))
        }
        "gh_pr_thread_reply" => {
            let id = node_id(r, "thread")?;
            let body = required(r, "body", "reply")?;
            done(
                "Replied to the conversation.",
                gh(
                    path,
                    &[
                        "api",
                        "graphql",
                        "-f",
                        &format!("id={id}"),
                        "-f",
                        &format!("body={body}"),
                        "-f",
                        "query=mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}",
                    ],
                )?,
            )
        }
        "gh_pr_thread_resolve" => {
            let id = node_id(r, "thread")?;
            let resolve = r["resolve"].as_bool() != Some(false);
            let mutation = if resolve {
                "resolveReviewThread"
            } else {
                "unresolveReviewThread"
            };
            let query = format!(
                "query=mutation($id:ID!){{{mutation}(input:{{threadId:$id}}){{thread{{id}}}}}}"
            );
            done(
                if resolve {
                    "Resolved the conversation."
                } else {
                    "Reopened the conversation."
                },
                gh(
                    path,
                    &["api", "graphql", "-f", &format!("id={id}"), "-f", &query],
                )?,
            )
        }
        "gh_pr_apply_suggestion" => {
            let id = node_id(r, "comment")?;
            let c = gh_json(
                path,
                &[
                    "api",
                    "graphql",
                    "-f",
                    &format!("id={id}"),
                    "-f",
                    &format!("query={SUGGESTION_SOURCE}"),
                    "--jq",
                    ".data.node",
                ],
            )?;
            if c["outdated"].as_bool() != Some(false) || !c["line"].is_u64() {
                return Err(
                    "This suggestion is outdated: those lines changed after it was written.".into(),
                );
            }
            let replacement =
                suggestion(text(&c, "body")).ok_or("This comment has no suggested change.")?;
            let file = text(&c, "path");
            git::validate_file(file)?;
            let end = c["line"].as_u64().unwrap_or(0) as usize;
            let start = c["startLine"].as_u64().map_or(end, |s| s as usize);
            let pr = &c["pullRequest"];
            let (owner, name) = (
                text(&pr["headRepositoryOwner"], "login"),
                text(&pr["headRepository"], "name"),
            );
            let (head, branch) = (text(pr, "headRefOid"), text(pr, "headRefName"));
            let safe = |v: &str| {
                !v.is_empty()
                    && v.chars()
                        .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
            };
            if !safe(owner) || !safe(name) || head.len() != 40 || branch.is_empty() {
                return Err(
                    "GitHub returned an unexpected head repository for this pull request.".into(),
                );
            }
            let endpoint = format!("repos/{owner}/{name}/contents/{}", encode_path(file));
            let at_head = format!("{endpoint}?ref={head}");
            let content = gh(
                path,
                &[
                    "api",
                    "-H",
                    "Accept: application/vnd.github.raw+json",
                    &at_head,
                ],
            )?;
            let blob = gh(path, &["api", &at_head, "--jq", ".sha"])?;
            let updated = replace_lines(&content, start, end, &replacement)?;
            let body = json!({
                "message": format!("Apply suggestion to {file}"),
                "content": git::base64(updated.as_bytes()),
                "sha": blob.trim(),
                "branch": branch,
            });
            // The new file goes through --input: a long base64 argument can pass Windows' command-line limit.
            let input = std::env::temp_dir().join(format!(
                "gitowl-suggestion-{:016x}.json",
                rand::random::<u64>()
            ));
            std::fs::write(&input, body.to_string()).map_err(|e| e.to_string())?;
            let result = gh(
                path,
                &[
                    "api",
                    "-X",
                    "PUT",
                    &endpoint,
                    "--input",
                    &input.to_string_lossy(),
                ],
            );
            let _ = std::fs::remove_file(&input);
            // The blob sha makes this conditional: GitHub refuses it if the file changed on the branch since.
            result.map_err(|e| {
                if e.contains("409") || e.contains("does not match") {
                    "The branch changed after this suggestion. Reload the pull request and try again.".to_owned()
                } else {
                    e
                }
            })?;
            Ok(json!({ "message": format!("Committed the suggestion to {branch}.") }))
        }
        "gh_pr_update_branch" => {
            let n = number(r)?;
            done(
                "Brought the branch up to date with its base.",
                gh(path, &["pr", "update-branch", &n])?,
            )
        }
        "gh_pr_draft" => {
            let n = number(r)?;
            done(
                format!("Converted #{n} to a draft."),
                gh(path, &["pr", "ready", &n, "--undo"])?,
            )
        }
        "gh_pr_line_comment" => {
            let n = number(r)?;
            let file = text(r, "path");
            git::validate_file(file)?;
            let line = r["line"]
                .as_u64()
                .filter(|l| *l > 0)
                .ok_or("Choose a line.")?;
            let side = match text(r, "side") {
                "LEFT" => "LEFT",
                _ => "RIGHT",
            };
            let commit = text(r, "commit");
            if commit.len() != 40 || !commit.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err("Reload the pull request and try again.".into());
            }
            let body = required(r, "body", "comment")?;
            let endpoint = format!("repos/{{owner}}/{{repo}}/pulls/{n}/comments");
            let fields = [
                format!("body={body}"),
                format!("commit_id={commit}"),
                format!("path={file}"),
                format!("side={side}"),
            ];
            let line_field = format!("line={line}");
            let mut args = vec!["api", "-X", "POST", &endpoint];
            for field in &fields {
                args.extend(["-f", field.as_str()]);
            }
            args.extend(["-F", &line_field]);
            done(format!("Commented on {file}:{line}."), gh(path, &args)?)
        }
        "gh_pr_create" => {
            let base = required(r, "base", "base branch")?;
            let head = required(r, "head", "head branch")?;
            branch(path, base)?;
            branch(path, head)?;
            let title = format!("--title={}", required(r, "title", "title")?);
            let body = format!("--body={}", text(r, "body"));
            let base = format!("--base={base}");
            let head = format!("--head={head}");
            let mut args = vec!["pr", "create", &base, &head, &title, &body];
            if r["draft"].as_bool() == Some(true) {
                args.push("--draft");
            }
            done("Opened the pull request.", gh(path, &args)?)
        }
        "gh_pr_review" => {
            let n = number(r)?;
            let flag = match text(r, "event") {
                "approve" => "--approve",
                "request-changes" => "--request-changes",
                "comment" => "--comment",
                _ => return Err("Choose approve, request changes or comment.".into()),
            };
            let body = format!("--body={}", text(r, "body"));
            if flag != "--approve" && text(r, "body").trim().is_empty() {
                return Err("Write a review comment.".into());
            }
            done(
                "Submitted your review.",
                gh(path, &["pr", "review", &n, flag, &body])?,
            )
        }
        "gh_pr_comment" | "gh_issue_comment" => {
            let n = number(r)?;
            let kind = if op == "gh_pr_comment" { "pr" } else { "issue" };
            let body = format!("--body={}", required(r, "body", "comment")?);
            done(
                "Posted your comment.",
                gh(path, &[kind, "comment", &n, &body])?,
            )
        }
        "gh_pr_merge" => {
            let n = number(r)?;
            let method = match text(r, "method") {
                "merge" => "--merge",
                "squash" => "--squash",
                "rebase" => "--rebase",
                _ => return Err("Choose merge, squash or rebase.".into()),
            };
            let mut args = vec!["pr", "merge", &n, method];
            if r["deleteBranch"].as_bool() == Some(true) {
                args.push("--delete-branch");
            }
            done(
                "Merged the pull request on GitHub. Fetch or pull to update local branches.",
                gh(path, &args)?,
            )
        }
        "gh_pr_close" | "gh_pr_reopen" | "gh_pr_ready" | "gh_issue_close" | "gh_issue_reopen" => {
            let n = number(r)?;
            let (kind, action) = op.trim_start_matches("gh_").split_once('_').unwrap();
            done(
                format!("Updated {kind} #{n}."),
                gh(path, &[kind, action, &n])?,
            )
        }
        "gh_pr_checkout" => {
            let n = number(r)?;
            if git::status(path)?["files"]
                .as_array()
                .is_some_and(|f| !f.is_empty())
            {
                return Err(
                    "Commit, stash or discard working changes before checking out a pull request."
                        .into(),
                );
            }
            done(
                format!("Checked out pull request #{n} locally."),
                gh(path, &["pr", "checkout", &n])?,
            )
        }
        "gh_issues" => {
            let mut args = vec![
                "issue",
                "list",
                "--limit",
                "100",
                "--state",
                state(r)?,
                "--json",
                ISSUE_LIST,
            ];
            let search = format!("--search={}", text(r, "search"));
            if !text(r, "search").is_empty() {
                args.push(&search);
            }
            Ok(json!({ "items": gh_json(path, &args)? }))
        }
        "gh_issue" => {
            let n = number(r)?;
            let detail = gh_json(path, &["issue", "view", &n, "--json", ISSUE_VIEW])?;
            // gh's JSON fields leave out the lock state; the REST issue has it.
            let locked = gh(
                path,
                &[
                    "api",
                    &format!("repos/{{owner}}/{{repo}}/issues/{n}"),
                    "--jq",
                    ".locked",
                ],
            )
            .map(|v| v.trim() == "true")
            .unwrap_or(false);
            Ok(json!({ "detail": detail, "locked": locked }))
        }
        "gh_issue_pin" | "gh_issue_unpin" | "gh_issue_lock" | "gh_issue_unlock" => {
            let n = number(r)?;
            let verb = op.trim_start_matches("gh_issue_");
            let state = match verb {
                "pin" => "pinned",
                "unpin" => "unpinned",
                "lock" => "locked",
                _ => "unlocked",
            };
            done(
                format!("Issue #{n} is {state}."),
                gh(path, &["issue", verb, &n])?,
            )
        }
        "gh_issue_transfer" => {
            let n = number(r)?;
            let target = text(r, "target").trim();
            let valid = |s: &str| {
                !s.is_empty()
                    && s.chars()
                        .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
            };
            match target.split_once('/') {
                Some((owner, name)) if valid(owner) && valid(name) => {}
                _ => return Err("Enter the destination as owner/repository.".into()),
            }
            done(
                format!("Transferred issue #{n} to {target}."),
                gh(path, &["issue", "transfer", &n, target])?,
            )
        }
        "gh_issue_delete" => {
            let n = number(r)?;
            if text(r, "confirm") != n {
                return Err(format!("Type {n} to confirm deleting the issue."));
            }
            done(
                format!("Deleted issue #{n}."),
                gh(path, &["issue", "delete", &n, "--yes"])?,
            )
        }
        "gh_security" => {
            // Each alert API needs its own permission; a missing one shows as null instead of failing the card.
            let alerts =
                |endpoint: &str, jq: &str| gh_json(path, &["api", endpoint, "--jq", jq]).ok();
            Ok(json!({
                "dependabot": alerts(
                    "repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=50",
                    "[.[] | {severity: .security_advisory.severity, package: .dependency.package.name, summary: .security_advisory.summary, url: .html_url}]",
                ),
                "code": alerts(
                    "repos/{owner}/{repo}/code-scanning/alerts?state=open&per_page=50",
                    "[.[] | {severity: (.rule.security_severity_level // .rule.severity), package: .rule.id, summary: .rule.description, url: .html_url}]",
                ),
            }))
        }
        "gh_readme_image" => {
            // README images arrive as data URLs: the app's CSP blocks remote images, and this keeps private repos working.
            let file = text(r, "path")
                .trim_start_matches("./")
                .trim_start_matches('/');
            git::validate_file(file)?;
            let mime = match file
                .rsplit('.')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str()
            {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "gif" => "image/gif",
                "webp" => "image/webp",
                "svg" => "image/svg+xml",
                _ => return Err("Not an image.".into()),
            };
            let safe = |v: &str| {
                v.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
            };
            let (owner, name) = (text(r, "owner"), text(r, "name"));
            let repo = if owner.is_empty() {
                "{owner}/{repo}".to_owned()
            } else if safe(owner) && safe(name) && !name.is_empty() {
                format!("{owner}/{name}")
            } else {
                return Err("Unexpected image repository.".into());
            };
            let reference = text(r, "ref");
            if reference.contains("..")
                || !reference
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._/-".contains(c))
            {
                return Err("Unexpected image branch.".into());
            }
            let query = if reference.is_empty() {
                String::new()
            } else {
                format!("?ref={reference}")
            };
            // The contents API returns small files (up to 1 MB) base64-encoded already.
            let content = gh(
                path,
                &[
                    "api",
                    &format!("repos/{repo}/contents/{}{query}", encode_path(file)),
                    "--jq",
                    ".content",
                ],
            )?;
            let data: String = content.chars().filter(|c| !c.is_whitespace()).collect();
            if data.is_empty() || data == "null" {
                return Err("Image is too large or missing.".into());
            }
            Ok(json!({ "url": format!("data:{mime};base64,{data}") }))
        }
        "gh_readme" => {
            let text = gh(
                path,
                &[
                    "api",
                    "-H",
                    "Accept: application/vnd.github.raw+json",
                    "repos/{owner}/{repo}/readme",
                ],
            )
            .unwrap_or_default();
            // shortcut: very long READMEs are cut at 200 KB; open on GitHub for the rest.
            let cut: String = text.chars().take(200_000).collect();
            Ok(json!({ "text": cut }))
        }
        "gh_orgs" => {
            let orgs = gh_json(path, &["api", "user/orgs", "--jq", "[.[].login]"])?;
            let list: Vec<Value> = orgs
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|o| o.as_str())
                .map(|login| {
                    let count = gh(
                        path,
                        &[
                            "api",
                            &format!("orgs/{login}"),
                            "--jq",
                            ".public_repos + (.total_private_repos // 0)",
                        ],
                    )
                    .ok()
                    .and_then(|v| v.trim().parse::<u64>().ok());
                    json!({ "login": login, "repos": count })
                })
                .collect();
            Ok(json!({ "orgs": list }))
        }
        "gh_search" => {
            let query = text(r, "query").trim();
            if query.is_empty() || query.len() > 256 || query.contains(['\r', '\n']) {
                return Err("Type what to search for.".into());
            }
            let repo =
                gh_json(path, &["repo", "view", "--json", "nameWithOwner"])?["nameWithOwner"]
                    .as_str()
                    .unwrap_or("")
                    .to_owned();
            // Scoped to this repository first; with no hits there, the same query runs across GitHub.
            let search = |scope: Option<&str>| -> Value {
                let run = |kind: &str, fields: &str| {
                    let mut args = vec!["search", kind, "--limit", "5", "--json", fields];
                    if let Some(repo) = scope {
                        args.extend(["--repo", repo]);
                    }
                    args.extend(["--", query]);
                    gh_json(path, &args).unwrap_or(json!([]))
                };
                json!({
                    "prs": run("prs", "number,title,state,url,repository"),
                    "issues": run("issues", "number,title,state,url,repository"),
                    "code": if scope.is_some() { run("code", "path,url,repository") } else { json!([]) },
                })
            };
            let local = search(Some(&repo));
            let empty = ["prs", "issues", "code"]
                .iter()
                .all(|k| local[*k].as_array().is_none_or(Vec::is_empty));
            Ok(if empty {
                json!({ "scope": "github", "results": search(None) })
            } else {
                json!({ "scope": repo, "results": local })
            })
        }
        "gh_issue_create" => {
            let title = format!("--title={}", required(r, "title", "title")?);
            let body = format!("--body={}", text(r, "body"));
            done(
                "Opened the issue.",
                gh(path, &["issue", "create", &title, &body])?,
            )
        }
        "gh_for_you" => {
            const FIELDS: &str = "number,title,repository,url,updatedAt";
            let search = |kind: &str, args: &[&str]| -> Result<Vec<Value>> {
                let mut all = vec!["search"];
                all.extend_from_slice(args);
                all.extend_from_slice(&["--state", "open", "--limit", "10", "--json", FIELDS]);
                Ok(gh_json(path, &all)?
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|mut item| {
                        item["kind"] = json!(kind);
                        item
                    })
                    .collect())
            };
            let mut items = search("review", &["prs", "--review-requested=@me"])?;
            items.extend(search(
                "changes",
                &["prs", "--author=@me", "--review=changes_requested"],
            )?);
            items.extend(search("issue", &["issues", "--assignee=@me"])?);
            // A failed latest run on the current branch also needs you.
            let current = run(path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
            if let Ok(runs) = gh_json(
                path,
                &[
                    "run",
                    "list",
                    "--branch",
                    current.trim(),
                    "--limit",
                    "1",
                    "--json",
                    RUN_LIST,
                ],
            ) && let Some(latest) = runs.as_array().and_then(|r| r.first())
                && text(latest, "conclusion") == "failure"
            {
                items.push(json!({"kind": "ci", "title": format!("{} failed on {}", text(latest, "workflowName"), current.trim()), "url": latest["url"], "updatedAt": latest["createdAt"]}));
            }
            Ok(json!({ "items": items }))
        }
        "gh_inbox" => {
            let endpoint = if r["all"].as_bool().unwrap_or(false) {
                "notifications?all=true"
            } else {
                "notifications"
            };
            let items: Vec<Value> = gh_json(path, &["api", endpoint])?
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|n| {
                    // Notification subjects point at the API; turn them into pages people can open.
                    let url = n["subject"]["url"].as_str().map(|u| {
                        u.replace("https://api.github.com/repos/", "https://github.com/")
                            .replace("/pulls/", "/pull/")
                    });
                    json!({
                        "id": n["id"], "unread": n["unread"], "reason": n["reason"],
                        "title": n["subject"]["title"], "type": n["subject"]["type"],
                        "repo": n["repository"]["full_name"], "updatedAt": n["updated_at"],
                        "url": url.unwrap_or_else(|| text(&n["repository"], "html_url").to_owned()),
                    })
                })
                .collect();
            Ok(json!({ "items": items }))
        }
        "gh_inbox_done" => {
            let id = text(r, "id");
            if id.is_empty() || id.len() > 20 || !id.chars().all(|c| c.is_ascii_digit()) {
                return Err("Choose a notification.".into());
            }
            done(
                "Marked as done.",
                gh(
                    path,
                    &[
                        "api",
                        "-X",
                        "DELETE",
                        &format!("notifications/threads/{id}"),
                    ],
                )?,
            )
        }
        "gh_issue_develop" => {
            let n = number(r)?;
            done(
                format!("Created and checked out a branch for issue #{n}."),
                gh(path, &["issue", "develop", &n, "--checkout"])?,
            )
        }
        "gh_owners" => {
            let mut owners = vec![
                gh(path, &["api", "user", "--jq", ".login"])?
                    .trim()
                    .to_owned(),
            ];
            if let Ok(orgs) = gh(path, &["org", "list", "--limit", "50"]) {
                owners.extend(
                    orgs.lines()
                        .map(str::trim)
                        .filter(|o| !o.is_empty())
                        .map(str::to_owned),
                );
            }
            Ok(json!({ "owners": owners }))
        }
        "gh_publish" => {
            let valid = |s: &str| {
                !s.is_empty()
                    && s.len() <= 100
                    && !s.starts_with(['.', '-'])
                    && s.chars()
                        .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
            };
            let (owner, name) = (text(r, "owner"), text(r, "name"));
            if !valid(owner) || !valid(name) {
                return Err(
                    "Use letters, numbers, dashes, dots or underscores for the owner and name."
                        .into(),
                );
            }
            let description = text(r, "description");
            if description.contains(['\r', '\n']) {
                return Err("Keep the description on one line.".into());
            }
            let full = format!("{owner}/{name}");
            let visibility = if r["public"].as_bool().unwrap_or(false) {
                "--public"
            } else {
                "--private"
            };
            let mut args = vec![
                "repo", "create", &full, visibility, "--source", ".", "--remote", "origin",
                "--push",
            ];
            if !description.is_empty() {
                args.extend(["--description", description]);
            }
            done(format!("Published to github.com/{full}."), gh(path, &args)?)
        }
        "gh_fork" => done(
            "Forked. origin now points to your fork, and the original repository is upstream.",
            gh(path, &["repo", "fork", "--remote"])?,
        ),
        "gh_sync" => {
            let info = gh_json(path, &["repo", "view", "--json", "nameWithOwner,isFork"])?;
            if !info["isFork"].as_bool().unwrap_or(false) {
                return Err("This repository isn't a fork.".into());
            }
            // Without --force, gh refuses when the fork has commits the parent doesn't, so nothing is overwritten.
            let out = gh(path, &["repo", "sync", text(&info, "nameWithOwner")])?;
            let _ = run(path, &["fetch", "origin"]);
            done("Synced your fork with its parent.", out)
        }
        "gh_runs" => Ok(
            json!({ "items": gh_json(path, &["run", "list", "--limit", "50", "--json", RUN_LIST])? }),
        ),
        "gh_run" => {
            let n = number(r)?;
            // {owner}/{repo} is filled in by gh from the current repository.
            let artifacts = gh(
                path,
                &[
                    "api",
                    &format!("repos/{{owner}}/{{repo}}/actions/runs/{n}/artifacts"),
                    "--jq",
                    ".total_count",
                ],
            )
            .ok()
            .and_then(|c| c.trim().parse::<u64>().ok())
            .unwrap_or(0);
            Ok(
                json!({ "detail": gh_json(path, &["run", "view", &n, "--json", "databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,url,jobs"])?, "artifacts": artifacts }),
            )
        }
        "gh_run_log" => {
            let run_id = number(r)?;
            let job = number(&json!({"number": r["job"]}))?;
            let mut log = gh(path, &["run", "view", &run_id, "--log", "--job", &job])?;
            // shortcut: very long logs keep their last 2 MB; stream or page them if people need the start.
            const LIMIT: usize = 2 << 20;
            if log.len() > LIMIT {
                let cut = log.len() - LIMIT;
                let start = (cut..log.len())
                    .find(|&i| log.is_char_boundary(i))
                    .unwrap_or(cut);
                log = format!("… earlier lines omitted …\n{}", &log[start..]);
            }
            Ok(json!({ "log": log }))
        }
        "gh_run_download" => {
            let n = number(r)?;
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            let dir = crate::service::downloads().join(format!("{name}-run-{n}"));
            let dir_text = git::display(&dir);
            gh(path, &["run", "download", &n, "--dir", &dir_text])?;
            Ok(json!({ "message": format!("Saved the artifacts to {dir_text}.") }))
        }
        "gh_workflows" => {
            let list = gh_json(
                path,
                &["workflow", "list", "--all", "--json", "id,name,path,state"],
            )?;
            Ok(json!({ "items": list }))
        }
        "gh_workflow_inputs" => {
            let id = number(r)?;
            let yaml = gh(path, &["workflow", "view", &id, "--yaml"])?;
            let (dispatchable, inputs) = dispatch_inputs(&yaml);
            Ok(json!({ "dispatchable": dispatchable, "inputs": inputs }))
        }
        "gh_workflow_run" => {
            let id = number(r)?;
            let reference = text(r, "ref");
            branch(path, reference)?;
            let mut fields = Vec::new();
            for (key, value) in r["inputs"].as_object().into_iter().flatten() {
                if key.is_empty()
                    || !key
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
                {
                    return Err(format!("Invalid input name: {key}"));
                }
                fields.push(format!("{key}={}", value.as_str().unwrap_or_default()));
            }
            let mut args = vec!["workflow", "run", &id, "--ref", reference];
            for field in &fields {
                args.extend(["-f", field]);
            }
            done(
                "Started the workflow. It appears in the list in a few seconds.",
                gh(path, &args)?,
            )
        }
        "gh_run_rerun" => done(
            "Re-running failed jobs.",
            gh(path, &["run", "rerun", &number(r)?, "--failed"])?,
        ),
        "gh_run_cancel" => done(
            "Cancelled the workflow run.",
            gh(path, &["run", "cancel", &number(r)?])?,
        ),
        "gh_releases" => Ok(
            json!({ "items": gh_json(path, &["release", "list", "--limit", "50", "--json", "tagName,name,isDraft,isPrerelease,isLatest,publishedAt"])? }),
        ),
        "gh_release_create" => {
            let tag = required(r, "tag", "tag")?;
            if tag.starts_with('-') {
                return Err("Invalid tag name.".into());
            }
            run(path, &["check-ref-format", &format!("refs/tags/{tag}")])?;
            let title = format!("--title={}", text(r, "title"));
            let notes = format!("--notes={}", text(r, "notes"));
            // --verify-tag: the tag must already be pushed, so nothing is created implicitly.
            let mut args: Vec<String> = ["release", "create", tag, "--verify-tag", &title, &notes]
                .map(str::to_owned)
                .to_vec();
            if r["draft"].as_bool() == Some(true) {
                args.push("--draft".into());
            }
            if r["prerelease"].as_bool() == Some(true) {
                args.push("--prerelease".into());
            }
            for asset in text(r, "assets")
                .lines()
                .map(str::trim)
                .filter(|a| !a.is_empty())
            {
                git::validate_file(asset)?;
                let file = std::fs::canonicalize(path.join(asset))
                    .map_err(|_| format!("Asset not found: {asset}"))?;
                if !file.starts_with(path) || !file.is_file() || asset.contains('#') {
                    return Err(format!(
                        "Assets must be files inside this repository without '#': {asset}"
                    ));
                }
                args.push(git::display(&file));
            }
            done(
                "Published the release on GitHub.",
                gh(path, &args.iter().map(String::as_str).collect::<Vec<_>>())?,
            )
        }
        _ => Err("Unknown operation.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_settings_keeps_permission_errors_separate_from_empty_lists() {
        let mut calls = Vec::new();
        let snapshot = repository_settings("actions", |args| {
            calls.push(args.iter().map(|value| (*value).to_owned()).collect::<Vec<_>>());
            match args[1] {
                "repos/{owner}/{repo}" => Ok(json!({"full_name":"example/project"})),
                "repos/{owner}/{repo}/actions/permissions" => Err("Requires admin access (HTTP 403)".into()),
                "repos/{owner}/{repo}/actions/permissions/workflow" => Ok(json!({"default_workflow_permissions":"read","can_approve_pull_request_reviews":false})),
                "repos/{owner}/{repo}/actions/runners?per_page=100" => Ok(json!([{"runners":[]}])),
                _ => panic!("Unexpected request"),
            }
        }).unwrap();
        assert_eq!(snapshot["repository"]["full_name"], "example/project");
        assert_eq!(
            snapshot["values"]["workflow"]["can_approve_pull_request_reviews"],
            false
        );
        assert_eq!(snapshot["values"]["runners"], json!([]));
        assert!(snapshot["values"].get("actions").is_none());
        assert_eq!(
            snapshot["errors"]["actions"],
            "Requires admin access (HTTP 403)"
        );
        assert_eq!(calls.len(), 4);
        let runners = calls.last().unwrap();
        assert!(runners.iter().any(|arg| arg == "--paginate"));
        assert!(runners.iter().any(|arg| arg == "--slurp"));
    }

    #[test]
    fn repository_settings_rejects_unknown_sections_before_contacting_github() {
        for section in [
            "",
            "../hooks",
            "general?method=DELETE",
            "actions/permissions",
            "--help",
        ] {
            let result =
                repository_settings(section, |_| panic!("Invalid sections must not run gh"));
            assert!(
                result
                    .unwrap_err()
                    .contains("Choose a repository settings section")
            );
        }
        let unavailable = repository_settings("general", |_| Err("Sign in to GitHub CLI".into()));
        assert_eq!(unavailable.unwrap_err(), "Sign in to GitHub CLI");
    }

    #[test]
    fn repository_settings_only_reads_allowlisted_endpoints() {
        for section in [
            "general",
            "access",
            "branches",
            "actions",
            "environments",
            "secrets",
            "security",
            "webhooks",
            "keys",
            "pages",
            "more",
        ] {
            repository_settings(section, |args| {
                assert_eq!(args[0], "api");
                assert!(args[1].starts_with("repos/{owner}/{repo}"));
                assert!(
                    !args
                        .iter()
                        .any(|arg| ["--method", "-X", "-f", "-F", "--input"].contains(arg))
                );
                assert!(
                    !args.contains(&"--jq"),
                    "--slurp cannot be combined with --jq"
                );
                Ok(json!({}))
            })
            .unwrap();
        }
    }

    #[test]
    fn settings_lists_merge_pages_and_strip_unneeded_sensitive_fields() {
        let hooks = settings_list("webhooks", "", json!([
            [{"id":1,"name":"web","active":true,"events":["push"],"config":{"secret":"hidden","url":"https://example.invalid?token=hidden"}}],
            [{"id":2,"name":"web","active":false,"events":["issues"]}]
        ])).unwrap();
        assert_eq!(hooks.as_array().unwrap().len(), 2);
        assert_eq!(hooks[0]["active"], true);
        assert!(hooks[0].get("config").is_none());
        assert!(!hooks.to_string().contains("hidden"));
        let keys = settings_list(
            "keys",
            "",
            json!([[{"id":1,"title":"deploy","read_only":true,"key":"unused key material"}]]),
        )
        .unwrap();
        assert!(keys[0].get("key").is_none());
        let runners = settings_list(
            "runners",
            "runners",
            json!([
                {"total_count":2,"runners":[{"id":1,"name":"one","status":"online"}]},
                {"total_count":2,"runners":[{"id":2,"name":"two","status":"offline"}]}
            ]),
        )
        .unwrap();
        assert_eq!(runners.as_array().unwrap().len(), 2);
        assert!(settings_list("runners", "runners", json!([{}])).is_err());
    }

    #[test]
    fn reads_workflow_dispatch_inputs() {
        let yaml = "name: Release\non:\n  push:\n    tags: ['v*']\n  workflow_dispatch:\n    inputs:\n      version:\n        description: \"Version to release\"\n        required: true\n      draft:\n        type: choice\n        default: 'true'\n        options:\n          - 'true'\n          - 'false'\njobs:\n  build:\n    runs-on: ubuntu-latest\n";
        let (ok, inputs) = dispatch_inputs(yaml);
        assert!(ok);
        assert_eq!(inputs.len(), 2);
        assert_eq!(inputs[0]["name"], "version");
        assert_eq!(inputs[0]["required"], true);
        assert_eq!(inputs[0]["description"], "Version to release");
        assert_eq!(inputs[1]["options"], json!(["true", "false"]));
        assert_eq!(inputs[1]["default"], "true");
        assert_eq!(
            dispatch_inputs("on: [push, workflow_dispatch]\njobs: {}\n"),
            (true, vec![])
        );
        assert!(!dispatch_inputs("on:\n  push:\njobs:\n  a:\n    steps: []\n").0);
        let inline = "on:\n  schedule:\n    - cron: '*/5 * * * *'\n  workflow_dispatch:\n    inputs:\n      job:\n        description: 'Job to run now'\n        required: true\n        type: choice\n        options: [notification-outbox, 'kyc-reconcile', sla-alerts]\n\npermissions:\n  contents: read\n";
        assert_eq!(
            dispatch_inputs(inline).1[0]["options"],
            json!(["notification-outbox", "kyc-reconcile", "sla-alerts"])
        );
    }

    #[test]
    fn validates_numbers_states_and_assets() {
        assert_eq!(number(&json!({"number": 12})).unwrap(), "12");
        assert!(number(&json!({"number": "1; rm"})).is_err());
        assert!(number(&json!({})).is_err());
        assert_eq!(state(&json!({})).unwrap(), "open");
        assert!(state(&json!({"state": "--web"})).is_err());
        assert!(version_parts("v0.10.0") > version_parts("0.9.3"));
        assert!(version_parts("v1.0.0-rc.1") == version_parts("1.0.0"));
        assert!(
            update_check(Path::new("."), "", "0.1.0")
                .unwrap_err()
                .contains("not configured")
        );
        let dir = tempfile::tempdir().unwrap();
        let p = std::fs::canonicalize(dir.path()).unwrap();
        run(&p, &["init"]).unwrap();
        let bad = execute(
            &p,
            "gh_release_create",
            &json!({"tag": "v1", "assets": "../secret.txt"}),
        );
        assert!(bad.unwrap_err().contains("inside this repository"));
        let sha = "a".repeat(40);
        for bad in [
            json!({"number": 1, "path": "../secret", "line": 3, "commit": sha, "body": "x"}),
            json!({"number": 1, "path": "src/a.rs", "line": 0, "commit": sha, "body": "x"}),
            json!({"number": 1, "path": "src/a.rs", "line": 3, "commit": "HEAD", "body": "x"}),
            json!({"number": 1, "path": "src/a.rs", "line": 3, "commit": sha, "body": " "}),
        ] {
            assert!(execute(&p, "gh_pr_line_comment", &bad).is_err(), "{bad}");
        }
        assert!(
            execute(&p, "gh_pr_edit", &json!({"number": 1}))
                .unwrap_err()
                .contains("at least one")
        );
        assert!(execute(&p, "gh_pr_edit", &json!({"number": 1, "title": "a\nb"})).is_err());
        for op in [
            "gh_pr_thread_reply",
            "gh_pr_thread_resolve",
            "gh_pr_apply_suggestion",
        ] {
            let bad = execute(
                &p,
                op,
                &json!({"thread": "x/../y", "comment": "a b", "body": "hi"}),
            );
            assert!(bad.unwrap_err().contains("Reload"), "{op}");
        }
        assert_eq!(
            suggestion("Use this:\r\n```suggestion\r\nlet a = 1;\r\n```\r\n").unwrap(),
            "let a = 1;\n"
        );
        assert_eq!(suggestion("```suggestion\n```").unwrap(), "");
        assert!(suggestion("no block").is_none());
        assert_eq!(
            replace_lines("a\nb\nc\n", 2, 2, "B\n").unwrap(),
            "a\nB\nc\n"
        );
        assert_eq!(
            replace_lines("a\r\nb\r\nc", 2, 3, "x\ny\nz\n").unwrap(),
            "a\r\nx\r\ny\r\nz"
        );
        assert_eq!(replace_lines("a\nb\n", 1, 1, "").unwrap(), "b\n");
        assert!(
            replace_lines("a\n", 1, 2, "x").is_err() && replace_lines("a\n", 0, 1, "x").is_err()
        );
        for (plain, encoded) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(git::base64(plain.as_bytes()), encoded);
        }
        assert_eq!(encode_path("src/a b/ü.rs"), "src/a%20b/%C3%BC.rs");
        assert!(
            execute(
                &p,
                "gh_issue_transfer",
                &json!({"number": 1, "target": "nope"})
            )
            .unwrap_err()
            .contains("owner/repository")
        );
        assert!(execute(&p, "gh_readme_image", &json!({"path": "../x.png"})).is_err());
        assert!(
            execute(&p, "gh_readme_image", &json!({"path": "a.exe"}))
                .unwrap_err()
                .contains("Not an image")
        );
        assert!(
            execute(
                &p,
                "gh_readme_image",
                &json!({"path": "a.png", "ref": "../main"})
            )
            .is_err()
        );
        assert!(
            execute(
                &p,
                "gh_readme_image",
                &json!({"path": "a.png", "owner": "a/b", "name": "c"})
            )
            .is_err()
        );
        assert!(execute(&p, "gh_browse", &json!({"path": "../etc/passwd"})).is_err());
        assert!(execute(&p, "gh_browse", &json!({"commit": "HEAD"})).is_err());
        assert!(
            execute(
                &p,
                "gh_issue_transfer",
                &json!({"number": 1, "target": "a/b c"})
            )
            .is_err()
        );
        assert!(
            execute(
                &p,
                "gh_issue_delete",
                &json!({"number": 12, "confirm": "1"})
            )
            .unwrap_err()
            .contains("Type 12")
        );
        assert!(execute(&p, "gh_search", &json!({"query": "  "})).is_err());
        for bad in ["", "1ABC", "GITHUB_TOKEN", "github_x", "A-B", "A B"] {
            assert!(config_name(&json!({ "name": bad })).is_err(), "{bad}");
        }
        assert_eq!(
            config_name(&json!({ "name": "CARGO_REGISTRY_TOKEN" })).unwrap(),
            "CARGO_REGISTRY_TOKEN"
        );
        assert!(
            execute(
                &p,
                "gh_secret_set",
                &json!({"name": "OK_NAME", "value": ""})
            )
            .unwrap_err()
            .contains("value")
        );
        assert!(
            execute(&p, "gh_repo_delete", &json!({"confirm": ""}))
                .unwrap_err()
                .contains("Type")
        );
        assert!(execute(&p, "gh_repo_visibility", &json!({"visibility": "secret"})).is_err());
        assert!(execute(&p, "gh_repo_edit", &json!({"addTopic": "Bad Topic!"})).is_err());
        assert!(
            execute(&p, "gh_repo_edit", &json!({}))
                .unwrap_err()
                .contains("at least one")
        );
        assert!(
            execute(
                &p,
                "gh_label_create",
                &json!({"name": "bug", "color": "zz"})
            )
            .is_err()
        );
        let bad_id = execute(&p, "gh_inbox_done", &json!({"id": "1/../../user"}));
        assert!(bad_id.unwrap_err().contains("Choose a notification"));
        assert!(
            execute(
                &p,
                "gh_pr_create",
                &json!({"base": "--x", "head": "a", "title": "t"})
            )
            .is_err()
        );
    }
}
