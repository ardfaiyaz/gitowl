use crate::git::{Result, run};
use serde_json::{Value, json};
use std::path::Path;

pub fn list(path: &Path) -> Result<Value> {
    let local = run(
        path,
        &[
            "for-each-ref",
            "--format=%(refname:short)%00%(upstream:short)%00%(objectname:short)%00%(subject)",
            "refs/heads/",
        ],
    )?;
    let remote = run(
        path,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(symref)%00%(objectname:short)",
            "refs/remotes/",
        ],
    )?;
    let tags = run(path, &["tag", "--list", "--sort=-version:refname"])?;
    let mut names: Vec<String> = run(path, &["remote"])?.lines().map(str::to_owned).collect();
    names.sort_by_key(|n| std::cmp::Reverse(n.len()));
    let locals: Vec<Value> = local
        .lines()
        .filter_map(|line| {
            let f: Vec<_> = line.splitn(4, '\0').collect();
            (f.len() == 4).then(|| json!({"name":f[0],"upstream":f[1],"hash":f[2],"subject":f[3]}))
        })
        .collect();
    let remotes: Vec<Value> = remote.lines().filter_map(|line| {
        let f: Vec<_> = line.split('\0').collect();
        if f.len() != 3 || !f[1].is_empty() { return None; }
        let short = f[0].strip_prefix("refs/remotes/")?;
        let name = names.iter().find(|name| short.starts_with(&format!("{name}/")))?;
        Some(json!({"reference":f[0],"name":short,"localName":&short[name.len()+1..],"hash":f[2]}))
    }).collect();
    Ok(json!({"local":locals,"remote":remotes,"tags":tags.lines().collect::<Vec<_>>()}))
}
fn validate_branch(path: &Path, branch: &str) -> Result<()> {
    if branch.is_empty() || branch.starts_with('-') || branch.starts_with('@') {
        return Err("Enter a branch name, such as feature/my-change.".into());
    }
    run(path, &["check-ref-format", &format!("refs/heads/{branch}")])?;
    Ok(())
}
fn exists(path: &Path, branch: &str) -> bool {
    run(
        path,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
    .is_ok()
}
pub fn rename(path: &Path, branch: &str, new_name: &str) -> Result<String> {
    validate_branch(path, branch)?;
    validate_branch(path, new_name)?;
    if branch == new_name {
        return Err("Enter a different branch name.".into());
    }
    if !exists(path, branch) {
        return Err("That local branch no longer exists.".into());
    }
    if exists(path, new_name) {
        return Err("A local branch with that name already exists.".into());
    }
    run(path, &["branch", "--move", branch, new_name])?;
    Ok(format!("Renamed {branch} to {new_name}."))
}
pub fn delete(path: &Path, branch: &str) -> Result<String> {
    validate_branch(path, branch)?;
    let current = run(path, &["symbolic-ref", "--quiet", "--short", "HEAD"]).unwrap_or_default();
    if current.trim() == branch {
        return Err("Switch to another branch before deleting this one.".into());
    }
    if !exists(path, branch) {
        return Err("That local branch no longer exists.".into());
    }
    run(path, &["branch", "--delete", branch])?;
    Ok(format!("Deleted local branch {branch}."))
}
pub fn checkout(path: &Path, reference: &str, branch: &str) -> Result<String> {
    validate_branch(path, branch)?;
    let branches = list(path)?;
    if !branches["remote"]
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r["reference"] == reference)
    {
        return Err(
            "That remote branch is no longer available. Fetch and refresh the list.".into(),
        );
    }
    run(path, &["switch", "--track", "-c", branch, reference])?;
    Ok(format!("Switched to {branch} and configured its upstream."))
}
pub fn publish(path: &Path, remote: &str, branch: &str) -> Result<String> {
    validate_branch(path, branch)?;
    let current = run(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    if current.trim() != branch {
        return Err("The current branch changed. Review the destination again.".into());
    }
    if remote.starts_with('-') || !run(path, &["remote"])?.lines().any(|r| r == remote) {
        return Err("Choose a configured remote from this repository.".into());
    }
    run(path, &["rev-parse", "--verify", "HEAD"])?;
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    run(path, &["push", "--set-upstream", "--", remote, &refspec])?;
    Ok(format!(
        "Published {branch} to {remote} and configured its upstream."
    ))
}

fn commit_ref(path: &Path, reference: &str) -> Result<String> {
    if reference.is_empty() || reference.starts_with('-') || reference.contains("..") {
        return Err("Choose a branch, tag or commit.".into());
    }
    Ok(run(
        path,
        &["rev-parse", "--verify", &format!("{reference}^{{commit}}")],
    )?
    .trim()
    .to_owned())
}
pub fn create(path: &Path, branch: &str, base: &str) -> Result<String> {
    validate_branch(path, branch)?;
    if base.is_empty() {
        return run(path, &["switch", "-c", branch]);
    }
    let base_id = commit_ref(path, base)?;
    run(path, &["switch", "-c", branch, &base_id])?;
    Ok(format!("Created {branch} from {base} and switched to it."))
}
/// Compares two refs the way a pull request does: commits unique to each side and the diff since they diverged.
pub fn compare(path: &Path, base: &str, target: &str) -> Result<Value> {
    let base = commit_ref(path, base)?;
    let target = commit_ref(path, target)?;
    let counts = run(
        path,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{base}...{target}"),
        ],
    )?;
    let (behind, ahead) = counts.trim().split_once('\t').unwrap_or(("0", "0"));
    let commits: Vec<_> = run(
        path,
        &[
            "log",
            "-200",
            "--format=%H%x00%an%x00%at%x00%s",
            &format!("{base}..{target}"),
        ],
    )?
    .lines()
    .filter_map(|l| {
        let f: Vec<_> = l.splitn(4, '\0').collect();
        (f.len() == 4).then(|| json!({"id":f[0],"author":f[1],"time":f[2],"message":f[3]}))
    })
    .collect();
    let range = format!("{base}...{target}");
    Ok(json!({
        "ahead": ahead.parse::<u64>().unwrap_or(0), "behind": behind.parse::<u64>().unwrap_or(0),
        "commits": commits,
        "stat": run(path, &["diff", "--stat", "--no-ext-diff", &range])?,
        "text": run(path, &["diff", "--no-ext-diff", "--no-textconv", &range])?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_checkout_publish_and_guards() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("working project");
        let bare = dir.path().join("remote.git");
        std::fs::create_dir(&repo).unwrap();
        run(dir.path(), &["init", "--bare", bare.to_str().unwrap()]).unwrap();
        run(&repo, &["init", "-b", "main"]).unwrap();
        run(&repo, &["config", "user.name", "Test"]).unwrap();
        run(&repo, &["config", "user.email", "test@example.invalid"]).unwrap();
        run(
            &repo,
            &[
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--allow-empty",
                "-m",
                "Initial",
            ],
        )
        .unwrap();
        run(&repo, &["remote", "add", "origin", bare.to_str().unwrap()]).unwrap();
        assert!(publish(&repo, "origin", "wrong").is_err());
        assert!(publish(&repo, "--all", "main").is_err());
        publish(&repo, "origin", "main").unwrap();
        assert_eq!(
            run(&repo, &["rev-parse", "--abbrev-ref", "@{upstream}"])
                .unwrap()
                .trim(),
            "origin/main"
        );
        run(&repo, &["push", "origin", "HEAD:refs/heads/feature/shared"]).unwrap();
        run(&repo, &["fetch", "origin"]).unwrap();
        run(&repo, &["remote", "set-head", "origin", "main"]).unwrap();
        let listed = list(&repo).unwrap();
        assert_eq!(listed["remote"].as_array().unwrap().len(), 2);
        assert!(checkout(&repo, "refs/heads/main", "bad").is_err());
        assert!(checkout(&repo, "refs/remotes/origin/main", "--force").is_err());
        checkout(&repo, "refs/remotes/origin/feature/shared", "feature/local").unwrap();
        assert_eq!(
            run(&repo, &["rev-parse", "--abbrev-ref", "@{upstream}"])
                .unwrap()
                .trim(),
            "origin/feature/shared"
        );
        assert!(checkout(&repo, "refs/remotes/origin/main", "feature/local").is_err());
    }

    #[test]
    fn renames_and_safely_deletes_local_branches() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        run(path, &["init", "-b", "main"]).unwrap();
        run(path, &["config", "user.name", "Test"]).unwrap();
        run(path, &["config", "user.email", "test@example.invalid"]).unwrap();
        run(path, &["commit", "--allow-empty", "-m", "Initial"]).unwrap();
        run(path, &["switch", "-c", "feature/old"]).unwrap();
        rename(path, "feature/old", "feature/new").unwrap();
        assert_eq!(
            run(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])
                .unwrap()
                .trim(),
            "feature/new"
        );
        assert!(rename(path, "feature/new", "main").is_err());
        run(path, &["switch", "main"]).unwrap();
        assert!(delete(path, "main").is_err());
        delete(path, "feature/new").unwrap();
        assert!(!exists(path, "feature/new"));
    }

    #[test]
    fn creates_from_a_base_and_compares() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        run(path, &["init", "-b", "main"]).unwrap();
        run(path, &["config", "user.name", "Test"]).unwrap();
        run(path, &["config", "user.email", "test@example.invalid"]).unwrap();
        run(path, &["commit", "--allow-empty", "-m", "Initial"]).unwrap();
        run(path, &["commit", "--allow-empty", "-m", "Second"]).unwrap();
        create(path, "feature", "main~1").unwrap();
        std::fs::write(path.join("new.txt"), "hello").unwrap();
        run(path, &["add", "new.txt"]).unwrap();
        run(path, &["commit", "-m", "Feature work"]).unwrap();
        let result = compare(path, "main", "feature").unwrap();
        assert_eq!(
            (result["ahead"].as_u64(), result["behind"].as_u64()),
            (Some(1), Some(1))
        );
        assert_eq!(result["commits"][0]["message"], "Feature work");
        assert!(result["text"].as_str().unwrap().contains("+hello"));
        assert!(create(path, "other", "--orphan").is_err());
        assert!(compare(path, "main", "a..b").is_err());
    }
}
