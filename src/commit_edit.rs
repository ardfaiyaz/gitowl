use crate::git::{Result, run};
use serde_json::{Value, json};
use std::path::Path;

pub fn preview(path: &Path, include_staged: bool) -> Result<Value> {
    let head = run(path, &["rev-parse", "--verify", "HEAD"])
        .map_err(|_| "Make a first commit before editing commit details.".to_owned())?;
    let branch = run(path, &["symbolic-ref", "--quiet", "HEAD"]).unwrap_or_default();
    let fields = run(
        path,
        &[
            "show",
            "-s",
            "--format=%B%x00%an%x00%ae%x00%cn%x00%ce",
            "HEAD",
        ],
    )?;
    let fields: Vec<_> = fields.trim_end().split('\0').collect();
    if fields.len() != 5 {
        return Err("Cannot read commit details.".into());
    }
    let remote = run(
        path,
        &[
            "for-each-ref",
            "--contains=HEAD",
            "--format=%(refname:short)",
            "refs/remotes/",
        ],
    )?;
    let mut blocked = Vec::new();
    if branch.trim().is_empty() {
        blocked.push("Switch to a local branch before editing a commit.".to_owned());
    }
    let staged = run(path, &["diff", "--cached", "--name-only"])?;
    if include_staged {
        if staged.trim().is_empty() {
            blocked.push("Stage the changes you want to add to the latest commit.".into());
        }
    } else if !run(path, &["status", "--porcelain=v1", "--untracked-files=all"])?.is_empty() {
        blocked.push("Commit or safely set aside your working changes first. This editor requires a clean working tree and index.".into());
    }
    if !remote.is_empty() {
        blocked.push(format!("This commit is contained in fetched remote branches: {}. Editing published history is not available here.", remote.lines().collect::<Vec<_>>().join(", ")));
    }
    if !run(path, &["tag", "--points-at", "HEAD"])?
        .trim()
        .is_empty()
    {
        blocked.push(
            "This commit has a version tag. Editing tagged commits is not available here.".into(),
        );
    }
    for marker in [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
    ] {
        let location = run(
            path,
            &["rev-parse", "--path-format=absolute", "--git-path", marker],
        )?;
        if Path::new(location.trim()).exists() {
            blocked.push(
                "Finish or abort the current merge, rebase, cherry-pick or revert first.".into(),
            );
            break;
        }
    }
    Ok(
        json!({"head":head.trim(),"branch":branch.trim(),"message":fields[0].trim_end(),"authorName":fields[1],"authorEmail":fields[2],"committerName":fields[3],"committerEmail":fields[4],"blocked":blocked,"staged":staged.lines().collect::<Vec<_>>(),"fingerprint":crate::git::fingerprint(path)?}),
    )
}
fn eligible(path: &Path, expected: &str, branch: &str, include_staged: bool) -> Result<Value> {
    let current = preview(path, include_staged)?;
    if current["head"] != expected || current["branch"] != branch {
        return Err(
            "The branch or latest commit changed. Close this editor and review a fresh preview."
                .into(),
        );
    }
    if !current["blocked"].as_array().unwrap().is_empty() {
        return Err(current["blocked"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("\n"));
    }
    Ok(current)
}
pub fn edit(path: &Path, request: &Value) -> Result<Value> {
    let text = |key: &str| request[key].as_str().unwrap_or("");
    let expected = text("head");
    let branch = text("branch");
    let include_staged = request["includeStaged"].as_bool().unwrap_or(false);
    let current = eligible(path, expected, branch, include_staged)?;
    if include_staged && current["fingerprint"] != request["fingerprint"] {
        return Err("Staged changes changed since the preview. Review a fresh preview.".into());
    }
    let message = text("message");
    if message.trim().is_empty() || message.contains('\0') {
        return Err("Enter a non-empty commit message.".into());
    }
    let name = text("authorName");
    let email = text("authorEmail");
    if [name, email]
        .iter()
        .any(|value| value.trim().is_empty() || value.contains(['\r', '\n', '\0', '<', '>']))
    {
        return Err("Enter an author name and email without line breaks or angle brackets.".into());
    }
    let recovery = format!(
        "refs/gitowl/recovery/{}/{:016x}",
        expected,
        rand::random::<u64>()
    );
    run(path, &["update-ref", &recovery, expected, ""])?;
    let author = format!("{name} <{email}>");
    // Normal Git commit runs configured hooks and signing. --only excludes staged files.
    let mut args = vec![
        "commit",
        "--amend",
        "--allow-empty",
        "-m",
        message,
        "--author",
        &author,
    ];
    if !include_staged {
        args.push("--only");
    }
    run(path, &args).map_err(|error| {
        format!("Commit editing did not complete. Recovery retained at {recovery}.\n{error}")
    })?;
    let head = run(path, &["rev-parse", "HEAD"])?;
    Ok(
        json!({"head":head.trim(),"branch":branch,"recovery":recovery,"message":"Updated the latest commit. The previous commit is retained for recovery."}),
    )
}
pub fn restore(path: &Path, request: &Value) -> Result<Value> {
    let text = |key: &str| request[key].as_str().unwrap_or("");
    let expected = text("head");
    let branch = text("branch");
    eligible(path, expected, branch, false)?;
    let reference = text("recovery");
    check_recovery(path, reference)?;
    let old = run(
        path,
        &["rev-parse", "--verify", &format!("{reference}^{{commit}}")],
    )?;
    // Recovery only moves metadata between identical snapshots and parents, preserving files/index.
    for format in ["--format=%T", "--format=%P"] {
        if run(path, &["show", "-s", format, expected])?
            != run(path, &["show", "-s", format, old.trim()])?
        {
            return Err("This recovery is no longer a metadata-only change. Use Git's recovery tools to review it.".into());
        }
    }
    run(
        path,
        &[
            "update-ref",
            "-m",
            "gitowl: restore commit metadata",
            branch,
            old.trim(),
            expected,
        ],
    )?;
    Ok(json!({"message":"Restored the previous commit metadata. Working files are unchanged."}))
}

pub fn check_recovery(path: &Path, reference: &str) -> Result<()> {
    // Keep recovery references from the app's previous names (Gityard, GitNest) readable.
    let recovery_prefix = [
        "refs/gitowl/recovery/",
        "refs/gityard/recovery/",
        "refs/gitnest/recovery/",
    ]
    .iter()
    .any(|prefix| reference.starts_with(prefix));
    if !recovery_prefix || reference.contains(['\0', '\n', '\r']) {
        return Err("Choose a recovery reference created by gitowl.".into());
    }
    run(path, &["check-ref-format", reference]).map(|_| ())
}
pub fn recovery_list(path: &Path) -> Result<Value> {
    let raw = run(
        path,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)%00%(objectname)%00%(committerdate:unix)%00%(subject)",
            "refs/gitowl/recovery/",
            "refs/gityard/recovery/",
            "refs/gitnest/recovery/",
        ],
    )?;
    let points: Vec<_> = raw
        .lines()
        .filter_map(|l| {
            let f: Vec<_> = l.splitn(4, '\0').collect();
            (f.len() == 4).then(|| json!({"ref":f[0],"id":f[1],"time":f[2],"message":f[3]}))
        })
        .collect();
    Ok(json!({ "points": points }))
}
pub fn recovery_branch(path: &Path, reference: &str, branch: &str) -> Result<String> {
    check_recovery(path, reference)?;
    if branch.starts_with('-') {
        return Err("Invalid branch name.".into());
    }
    run(path, &["check-ref-format", "--branch", branch])?;
    run(path, &["branch", branch, reference])?;
    Ok(format!(
        "Created branch {branch} from the recovery point. Your current branch is unchanged."
    ))
}
pub fn recovery_delete(path: &Path, reference: &str) -> Result<String> {
    check_recovery(path, reference)?;
    run(path, &["update-ref", "-d", reference])?;
    Ok("Deleted the recovery point. Git may garbage-collect commits no longer referenced.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_legacy_recovery_references() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        run(path, &["init", "-b", "main"]).unwrap();
        run(path, &["config", "user.name", "gitowl Test"]).unwrap();
        run(path, &["config", "user.email", "test@example.invalid"]).unwrap();
        run(path, &["config", "commit.gpgsign", "false"]).unwrap();
        run(path, &["commit", "--allow-empty", "-m", "Before rename"]).unwrap();
        let mut request = preview(path, false).unwrap();
        let original = request["head"].as_str().unwrap().to_owned();
        request["message"] = json!("After rename");
        let mut changed = edit(path, &request).unwrap();
        assert!(
            changed["recovery"]
                .as_str()
                .unwrap()
                .starts_with("refs/gitowl/recovery/")
        );
        assert!(check_recovery(path, "refs/gityard/recovery/abc/1").is_ok());
        let legacy = format!("refs/gitnest/recovery/{original}/legacy");
        run(path, &["update-ref", &legacy, &original]).unwrap();
        changed["recovery"] = json!(legacy);
        restore(path, &changed).unwrap();
        assert_eq!(preview(path, false).unwrap()["head"], original);
    }

    #[test]
    fn edit_recovery_and_stale_dirty_published_guards() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        run(p, &["init", "-b", "main"]).unwrap();
        run(p, &["config", "user.name", "Original"]).unwrap();
        run(p, &["config", "user.email", "original@example.invalid"]).unwrap();
        run(p, &["config", "commit.gpgsign", "false"]).unwrap();
        std::fs::write(p.join("file.txt"), "original\n").unwrap();
        run(p, &["add", "file.txt"]).unwrap();
        run(p, &["commit", "-m", "Original message"]).unwrap();
        let original = preview(p, false).unwrap();
        let mut request = original.clone();
        request["message"] = json!("Reworded message");
        request["authorName"] = json!("Correct Author");
        request["authorEmail"] = json!("author@example.invalid");
        std::fs::write(p.join("file.txt"), "staged\n").unwrap();
        run(p, &["add", "file.txt"]).unwrap();
        assert!(edit(p, &request).is_err());
        assert_eq!(run(p, &["show", ":file.txt"]).unwrap(), "staged\n");
        run(p, &["restore", "--staged", "--worktree", "file.txt"]).unwrap();
        let changed = edit(p, &request).unwrap();
        assert_eq!(run(p, &["show", "HEAD:file.txt"]).unwrap(), "original\n");
        assert_eq!(preview(p, false).unwrap()["authorName"], "Correct Author");
        assert!(edit(p, &request).is_err());
        assert_eq!(
            run(p, &["rev-parse", changed["recovery"].as_str().unwrap()])
                .unwrap()
                .trim(),
            original["head"].as_str().unwrap()
        );
        restore(p, &changed).unwrap();
        assert_eq!(preview(p, false).unwrap()["head"], original["head"]);
        let reference = "refs/remotes/origin/main";
        run(p, &["update-ref", reference, "HEAD"]).unwrap();
        assert!(edit(p, &request).is_err());
        run(p, &["update-ref", "-d", reference]).unwrap();
        run(p, &["tag", "v-test"]).unwrap();
        assert!(edit(p, &request).is_err());
        run(p, &["tag", "-d", "v-test"]).unwrap();
        let merge = run(
            p,
            &[
                "rev-parse",
                "--path-format=absolute",
                "--git-path",
                "MERGE_HEAD",
            ],
        )
        .unwrap();
        std::fs::write(merge.trim(), original["head"].as_str().unwrap()).unwrap();
        assert!(edit(p, &request).is_err());
    }

    #[test]
    fn amends_staged_content_and_browses_recovery_points() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        run(p, &["init", "-b", "main"]).unwrap();
        run(p, &["config", "user.name", "gitowl Test"]).unwrap();
        run(p, &["config", "user.email", "test@example.invalid"]).unwrap();
        run(p, &["config", "commit.gpgsign", "false"]).unwrap();
        run(p, &["commit", "--allow-empty", "-m", "Start"]).unwrap();
        assert!(
            !preview(p, true).unwrap()["blocked"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        std::fs::write(p.join("added.txt"), "content").unwrap();
        std::fs::write(p.join("unstaged.txt"), "keep out").unwrap();
        run(p, &["add", "added.txt"]).unwrap();
        let mut request = preview(p, true).unwrap();
        assert_eq!(request["blocked"], json!([]));
        request["includeStaged"] = json!(true);
        let saved = edit(p, &request).unwrap();
        let files = run(p, &["show", "--name-only", "--format=", "HEAD"]).unwrap();
        assert_eq!(files.trim(), "added.txt");
        assert!(p.join("unstaged.txt").exists());

        let points = recovery_list(p).unwrap();
        assert_eq!(points["points"][0]["ref"], saved["recovery"]);
        let reference = saved["recovery"].as_str().unwrap();
        recovery_branch(p, reference, "before-amend").unwrap();
        assert_eq!(
            run(p, &["log", "-1", "--format=%s", "before-amend"])
                .unwrap()
                .trim(),
            "Start"
        );
        assert!(recovery_branch(p, "refs/heads/main", "x").is_err());
        recovery_delete(p, reference).unwrap();
        assert_eq!(recovery_list(p).unwrap()["points"], json!([]));
    }
}
