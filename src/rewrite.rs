use crate::git::{self, Result, run, run_env};
use serde_json::{Value, json};
use std::path::Path;

struct Commit {
    id: String,
    tree: String,
    parents: Vec<String>,
    author: [String; 3],
    committer: [String; 3],
    message: String,
}

fn read(path: &Path, id: &str) -> Result<Commit> {
    let raw = run(
        path,
        &[
            "show",
            "-s",
            "--date=raw",
            "--format=%H%x00%T%x00%P%x00%an%x00%ae%x00%ad%x00%cn%x00%ce%x00%cd%x00%B",
            id,
        ],
    )?;
    let f: Vec<_> = raw.splitn(10, '\0').collect();
    if f.len() != 10 {
        return Err("Cannot read commit details.".into());
    }
    let s = |i: usize| f[i].to_owned();
    Ok(Commit {
        id: s(0),
        tree: s(1),
        parents: f[2].split_whitespace().map(str::to_owned).collect(),
        author: [s(3), s(4), s(5)],
        committer: [s(6), s(7), s(8)],
        message: f[9].trim_end().to_owned(),
    })
}

fn resolve(path: &Path, id: &str) -> Result<String> {
    if id.len() < 4 || id.len() > 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Choose a valid commit.".into());
    }
    Ok(run(
        path,
        &["rev-parse", "--verify", &format!("{id}^{{commit}}")],
    )?
    .trim()
    .to_owned())
}

/// Commits from `target` to HEAD (oldest first), plus reasons a rewrite is unsafe.
pub fn preview(path: &Path, id: &str) -> Result<Value> {
    let target = resolve(path, id)?;
    let head = run(path, &["rev-parse", "HEAD"])?.trim().to_owned();
    let branch = run(path, &["symbolic-ref", "--quiet", "HEAD"]).unwrap_or_default();
    let mut blocked = Vec::new();
    if branch.trim().is_empty() {
        blocked.push("Switch to a local branch before rewriting history.".to_owned());
    }
    if run(path, &["merge-base", "--is-ancestor", &target, "HEAD"]).is_err() {
        return Err("That commit is not part of the current branch.".into());
    }
    let mut ids = vec![target.clone()];
    ids.extend(
        run(
            path,
            &[
                "rev-list",
                "--reverse",
                "--topo-order",
                "--ancestry-path",
                &format!("{target}..HEAD"),
            ],
        )?
        .lines()
        .map(str::to_owned),
    );
    let commits = ids
        .iter()
        .map(|i| read(path, i))
        .collect::<Result<Vec<_>>>()?;
    let remote = run(
        path,
        &[
            "for-each-ref",
            "--contains",
            &target,
            "--format=%(refname:short)",
            "refs/remotes/",
        ],
    )?;
    if !remote.trim().is_empty() {
        blocked.push(format!(
            "These commits are in fetched remote branches ({}). Rewrite only commits you have not pushed: others may have built on these, and replacing them needs a force push.",
            remote.lines().collect::<Vec<_>>().join(", ")
        ));
    }
    if !run(path, &["tag", "--contains", &target])?
        .trim()
        .is_empty()
    {
        blocked.push("A tag points into this range. Delete or move the tag first.".into());
    }
    if git::status(path)?["merging"].as_bool() == Some(true)
        || git::status(path)?["rebasing"].as_bool() == Some(true)
    {
        blocked.push("Finish or abort the current merge or rebase first.".into());
    }
    let others: Vec<_> = run(
        path,
        &[
            "for-each-ref",
            "--contains",
            &target,
            "--format=%(refname)",
            "refs/heads/",
        ],
    )?
    .lines()
    .filter(|b| *b != branch.trim())
    .map(|b| b.trim_start_matches("refs/heads/").to_owned())
    .collect();
    let first = &commits[0];
    Ok(json!({
        "head": head, "branch": branch.trim(), "target": target,
        "message": first.message,
        "authorName": first.author[0], "authorEmail": first.author[1],
        "committerName": first.committer[0], "committerEmail": first.committer[1],
        "commits": commits.iter().map(|c| json!({"id": c.id, "message": c.message.lines().next().unwrap_or_default()})).collect::<Vec<_>>(),
        "otherBranches": others,
        "merges": commits.iter().any(|c| c.parents.len() > 1),
        "clean": run(path, &["status", "--porcelain=v1", "--untracked-files=all"])?.trim().is_empty(),
        "blocked": blocked,
    }))
}

fn eligible(path: &Path, request: &Value) -> Result<Value> {
    let text = |k: &str| request[k].as_str().unwrap_or("");
    let current = preview(path, text("target"))?;
    if current["head"] != text("head") || current["branch"] != text("branch") {
        return Err("The branch changed. Close this editor and review a fresh preview.".into());
    }
    let blocked: Vec<_> = current["blocked"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    if !blocked.is_empty() {
        return Err(blocked.join("\n"));
    }
    Ok(current)
}

/// Runs the commit-msg hook on a message file and returns the message the hook leaves.
fn hook_message(path: &Path, message: &str) -> Result<String> {
    let file = git::git_path(path, "GITOWL_EDITMSG");
    std::fs::write(&file, format!("{}\n", message.trim_end())).map_err(|e| e.to_string())?;
    let result = run(
        path,
        &[
            "hook",
            "run",
            "--ignore-missing",
            "commit-msg",
            "--",
            &git::display(&file),
        ],
    );
    let message = std::fs::read_to_string(&file).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&file);
    result.map_err(|e| format!("The commit-msg hook rejected the message.\n{e}"))?;
    let message = message?;
    if message.trim().is_empty() {
        return Err("The commit-msg hook left an empty message.".into());
    }
    Ok(message.trim_end().to_owned())
}

/// Tells the post-rewrite hook which commits were replaced, as `git rebase` does.
fn post_rewrite(path: &Path, rewritten: &[(String, String)]) {
    let file = git::git_path(path, "GITOWL_REWRITTEN");
    let list: String = rewritten
        .iter()
        .map(|(old, new)| format!("{old} {new}\n"))
        .collect();
    if std::fs::write(&file, list).is_ok() {
        let stdin = format!("--to-stdin={}", git::display(&file));
        // The rewrite already succeeded; a failing post-rewrite hook cannot undo it.
        let _ = run(
            path,
            &[
                "hook",
                "run",
                "--ignore-missing",
                &stdin,
                "post-rewrite",
                "--",
                "rebase",
            ],
        );
        let _ = std::fs::remove_file(&file);
    }
}

fn identity(name: &str, email: &str) -> Result<()> {
    if [name, email]
        .iter()
        .any(|v| v.trim().is_empty() || v.contains(['\r', '\n', '\0', '<', '>']))
    {
        return Err("Enter names and emails without line breaks or angle brackets.".into());
    }
    Ok(())
}

fn recovery(path: &Path, head: &str) -> Result<String> {
    let reference = format!("refs/gitowl/recovery/{head}/{:016x}", rand::random::<u64>());
    run(path, &["update-ref", &reference, head, ""])?;
    Ok(reference)
}

fn commit_tree(
    path: &Path,
    c: &Commit,
    parents: &[String],
    message: &str,
    author: [&str; 3],
    committer: [&str; 3],
) -> Result<String> {
    let mut args = vec!["commit-tree", c.tree.as_str()];
    for parent in parents {
        args.extend(["-p", parent.as_str()]);
    }
    args.extend(["-m", message]);
    // commit-tree does not read commit.gpgSign, so honor it explicitly.
    if run(path, &["config", "--bool", "commit.gpgsign"]).is_ok_and(|v| v.trim() == "true") {
        args.push("-S");
    }
    let env = [
        ("GIT_AUTHOR_NAME", author[0]),
        ("GIT_AUTHOR_EMAIL", author[1]),
        ("GIT_AUTHOR_DATE", author[2]),
        ("GIT_COMMITTER_NAME", committer[0]),
        ("GIT_COMMITTER_EMAIL", committer[1]),
        ("GIT_COMMITTER_DATE", committer[2]),
    ];
    Ok(run_env(path, &args, &env)?.trim().to_owned())
}

/// Rewrites one commit's message, author and committer; later commits keep their content and metadata.
pub fn edit(path: &Path, request: &Value) -> Result<Value> {
    let text = |k: &str| request[k].as_str().unwrap_or("");
    let current = eligible(path, request)?;
    let message = text("message");
    if message.trim().is_empty() || message.contains('\0') {
        return Err("Enter a non-empty commit message.".into());
    }
    identity(text("authorName"), text("authorEmail"))?;
    identity(text("committerName"), text("committerEmail"))?;
    let head = current["head"].as_str().unwrap();
    let branch = current["branch"].as_str().unwrap();
    let ids: Vec<_> = current["commits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap().to_owned())
        .collect();
    // The repository's commit-msg hook checks (and may adjust) the new message, as `git commit` would.
    let message = hook_message(path, message)?;
    let reference = recovery(path, head)?;
    // Commits come oldest first in topological order, so every rewritten parent is mapped before its children.
    let mut rewritten: Vec<(String, String)> = Vec::new();
    for (i, id) in ids.iter().enumerate() {
        let c = read(path, id)?;
        let a = &c.author;
        let m = &c.committer;
        let parents: Vec<String> = c
            .parents
            .iter()
            .map(|p| {
                rewritten
                    .iter()
                    .find(|(old, _)| old == p)
                    .map_or_else(|| p.clone(), |(_, new)| new.clone())
            })
            .collect();
        let new = if i == 0 {
            commit_tree(
                path,
                &c,
                &parents,
                &message,
                [text("authorName"), text("authorEmail"), &a[2]],
                [text("committerName"), text("committerEmail"), &m[2]],
            )?
        } else {
            commit_tree(
                path,
                &c,
                &parents,
                &c.message,
                [&a[0], &a[1], &a[2]],
                [&m[0], &m[1], &m[2]],
            )?
        };
        rewritten.push((c.id.clone(), new));
    }
    let new_head = rewritten
        .iter()
        .find(|(old, _)| old == head)
        .map(|(_, new)| new.clone())
        .ok_or("Could not rewrite the branch tip.")?;
    run(
        path,
        &[
            "update-ref",
            "-m",
            "gitowl: rewrite commit metadata",
            branch,
            &new_head,
            head,
        ],
    )?;
    post_rewrite(path, &rewritten);
    Ok(
        json!({"head": new_head, "branch": branch, "recovery": reference, "previous": head,
        "message": format!("Rewrote {} commit(s). The previous history is kept as a recovery point.", ids.len())}),
    )
}

/// Returns the branch to a recovery point when it has exactly the same files (a metadata-only rewrite).
pub fn restore(path: &Path, request: &Value) -> Result<Value> {
    let text = |k: &str| request[k].as_str().unwrap_or("");
    let reference = text("recovery");
    crate::commit_edit::check_recovery(path, reference)?;
    let head = text("head");
    let tree = |r: &str| run(path, &["rev-parse", "--verify", &format!("{r}^{{tree}}")]);
    if tree(head)? != tree(reference)? {
        return Err(
            "Files differ from this recovery point. Create a branch from it instead.".into(),
        );
    }
    let old = run(
        path,
        &["rev-parse", "--verify", &format!("{reference}^{{commit}}")],
    )?;
    run(
        path,
        &[
            "update-ref",
            "-m",
            "gitowl: restore recovery point",
            text("branch"),
            old.trim(),
            head,
        ],
    )?;
    Ok(json!({"message": "Restored the previous history. Working files are unchanged."}))
}

/// Runs an interactive rebase with a plan chosen in the interface (reorder, squash, fixup, drop).
pub fn plan(path: &Path, request: &Value) -> Result<Value> {
    let current = eligible(path, request)?;
    if current["merges"] == true {
        return Err("Merge commits are in this range. Rebase plans need a range without merges; use Edit commit to change messages or authors.".into());
    }
    if current["clean"] != true {
        return Err("Commit, stash or discard working changes before rebasing.".into());
    }
    let expected: Vec<_> = current["commits"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["id"].as_str().unwrap().to_owned())
        .collect();
    let steps = request["steps"]
        .as_array()
        .ok_or("Choose an action for each commit.")?;
    let mut seen: Vec<String> = Vec::new();
    let mut todo = String::new();
    for step in steps {
        let id = step["id"].as_str().unwrap_or("");
        let action = step["action"].as_str().unwrap_or("");
        if !expected.iter().any(|e| e == id) || seen.iter().any(|s| s == id) {
            return Err(
                "The plan does not match the commits on this branch. Refresh the preview.".into(),
            );
        }
        if !matches!(action, "pick" | "squash" | "fixup" | "drop") {
            return Err("Choose pick, squash, fixup or drop.".into());
        }
        let kept = todo.lines().any(|l| !l.starts_with("drop"));
        if matches!(action, "squash" | "fixup") && !kept {
            return Err("The first kept commit cannot be squashed into an earlier one.".into());
        }
        seen.push(id.to_owned());
        todo.push_str(&format!("{action} {id}\n"));
    }
    if seen.len() != expected.len() || !todo.lines().any(|l| !l.starts_with("drop")) {
        return Err("Keep at least one commit and include every commit in the plan.".into());
    }
    let head = current["head"].as_str().unwrap();
    let reference = recovery(path, head)?;
    let file = git::git_path(path, "gitowl-rebase-todo");
    std::fs::write(&file, todo).map_err(|e| e.to_string())?;
    let quoted = format!(
        "'{}'",
        git::display(&file)
            .replace('\\', "/")
            .replace('\'', r"'\''")
    );
    // Git runs the sequence editor through its shell: copy our plan over its todo file.
    let editor = format!("cat {quoted} >");
    let target = &expected[0];
    let parent = read(path, target)?.parents.first().cloned();
    let mut args = vec!["rebase", "-i"];
    match &parent {
        Some(p) => args.push(p),
        None => args.push("--root"),
    }
    let result = run_env(path, &args, &[("GIT_SEQUENCE_EDITOR", &editor)]);
    let _ = std::fs::remove_file(&file);
    result.map_err(|e| {
        format!(
            "The rebase stopped. Resolve and continue, or abort. Recovery point: {reference}\n{e}"
        )
    })?;
    Ok(
        json!({"recovery": reference, "message": "Rebase plan applied. The previous history is kept as a recovery point."}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Vec<String>) {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        run(p, &["init", "-b", "main"]).unwrap();
        for (k, v) in [
            ("user.name", "gitowl Test"),
            ("user.email", "test@example.invalid"),
            ("core.autocrlf", "false"),
            ("commit.gpgsign", "false"),
        ] {
            run(p, &["config", k, v]).unwrap();
        }
        let mut ids = Vec::new();
        for name in ["a", "b", "c", "d"] {
            std::fs::write(p.join(name), name).unwrap();
            run(p, &["add", name]).unwrap();
            run(p, &["commit", "-m", &format!("Add {name}")]).unwrap();
            ids.push(run(p, &["rev-parse", "HEAD"]).unwrap().trim().to_owned());
        }
        (dir, ids)
    }

    fn log(p: &Path) -> Vec<String> {
        run(p, &["log", "--format=%s", "--reverse"])
            .unwrap()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn edits_an_older_commit_and_restores() {
        let (dir, ids) = setup();
        let p = dir.path();
        let tree = run(p, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let preview = preview(p, &ids[1]).unwrap();
        assert_eq!(preview["commits"].as_array().unwrap().len(), 3);
        let mut request = preview.clone();
        request["message"] = json!("Add b, reworded");
        request["authorName"] = json!("New Author");
        request["committerName"] = json!("New Committer");
        let result = edit(p, &request).unwrap();
        assert_eq!(log(p), ["Add a", "Add b, reworded", "Add c", "Add d"]);
        assert_eq!(run(p, &["rev-parse", "HEAD^{tree}"]).unwrap(), tree);
        assert_eq!(
            run(p, &["show", "-s", "--format=%an|%cn", "HEAD~2"])
                .unwrap()
                .trim(),
            "New Author|New Committer"
        );
        assert_eq!(
            run(p, &["show", "-s", "--format=%an", "HEAD"])
                .unwrap()
                .trim(),
            "gitowl Test"
        );
        assert!(edit(p, &request).is_err(), "stale head must be rejected");
        restore(p, &result).unwrap();
        assert_eq!(run(p, &["rev-parse", "HEAD"]).unwrap().trim(), ids[3]);
    }

    #[test]
    fn applies_a_rebase_plan_and_blocks_published_commits() {
        let (dir, ids) = setup();
        let p = dir.path();
        let mut request = preview(p, &ids[1]).unwrap();
        request["steps"] = json!([
            {"id": ids[3], "action": "pick"},
            {"id": ids[1], "action": "pick"},
            {"id": ids[2], "action": "fixup"},
        ]);
        plan(p, &request).unwrap();
        assert_eq!(log(p), ["Add a", "Add d", "Add b"]);
        assert!(p.join("c").exists());

        let head = run(p, &["rev-parse", "HEAD"]).unwrap();
        run(p, &["update-ref", "refs/remotes/origin/main", head.trim()]).unwrap();
        assert!(
            !preview(p, head.trim()).unwrap()["blocked"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn rewrites_through_merges_and_runs_hooks() {
        let (dir, ids) = setup();
        let p = dir.path();
        run(p, &["switch", "-q", "-c", "side", &ids[1]]).unwrap();
        std::fs::write(p.join("side"), "side").unwrap();
        run(p, &["add", "side"]).unwrap();
        run(p, &["commit", "-m", "Side work"]).unwrap();
        run(p, &["switch", "-q", "main"]).unwrap();
        run(p, &["merge", "--no-ff", "-m", "Merge side", "side"]).unwrap();
        let hooks = p.join(".git").join("hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        std::fs::write(
            hooks.join("commit-msg"),
            "#!/bin/sh\necho 'Signed-off-by: Hook' >> \"$1\"\n",
        )
        .unwrap();
        std::fs::write(
            hooks.join("post-rewrite"),
            "#!/bin/sh\ncat > .git/rewritten-by-hook\n",
        )
        .unwrap();
        #[cfg(unix)]
        for hook in ["commit-msg", "post-rewrite"] {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(hooks.join(hook), std::fs::Permissions::from_mode(0o755))
                .unwrap();
        }
        let tree = run(p, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let mut request = preview(p, &ids[0]).unwrap();
        assert_eq!(request["merges"], true);
        assert!(plan(p, &request).is_err());
        request["message"] = json!("Add a, reworded");
        edit(p, &request).unwrap();
        assert_eq!(run(p, &["rev-parse", "HEAD^{tree}"]).unwrap(), tree);
        assert_eq!(
            run(p, &["rev-list", "--count", "--merges", "HEAD"])
                .unwrap()
                .trim(),
            "1"
        );
        let root = run(p, &["rev-list", "--max-parents=0", "HEAD"]).unwrap();
        let message = run(p, &["show", "-s", "--format=%B", root.trim()]).unwrap();
        assert!(message.starts_with("Add a, reworded") && message.contains("Signed-off-by: Hook"));
        let mapping = std::fs::read_to_string(p.join(".git").join("rewritten-by-hook")).unwrap();
        assert_eq!(mapping.lines().count(), 6);
        // The side branch still holds the old history; the merge's second parent is rewritten too.
        assert!(run(p, &["merge-base", "--is-ancestor", root.trim(), "HEAD^2"]).is_ok());
    }
}
