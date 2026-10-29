use crate::git::{Result, run_plain, status};
use serde_json::{Value, json};
use std::path::Path;

pub fn list(path: &Path) -> Result<Value> {
    let raw = run_plain(path, &["stash", "list", "--format=%gd%x00%gs%x00%cr"])?;
    let stashes: Vec<Value> = raw
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.splitn(3, '\0').collect();
            if fields.len() != 3 {
                return None;
            }
            let index = fields[0]
                .strip_prefix("stash@{")?
                .strip_suffix('}')?
                .parse::<u64>()
                .ok()?;
            Some(json!({"index":index, "ref":fields[0], "message":fields[1], "date":fields[2]}))
        })
        .collect();
    Ok(json!({"stashes":stashes}))
}

fn guard_operation(path: &Path) -> Result<()> {
    let state = status(path)?;
    if state["merging"].as_bool().unwrap_or(false) || state["rebasing"].as_bool().unwrap_or(false) {
        return Err("Finish or abort the current merge or rebase before using stashes.".into());
    }
    Ok(())
}

pub fn save(path: &Path, message: &str, include_untracked: bool) -> Result<String> {
    guard_operation(path)?;
    let message = message.trim();
    if message.contains(['\n', '\r', '\0']) {
        return Err("Use a single-line stash message.".into());
    }
    let mut args = vec!["stash", "push"];
    if include_untracked {
        args.push("--include-untracked");
    }
    if !message.is_empty() {
        args.push("-m");
        args.push(message);
    }
    let output = run_plain(path, &args)?;
    if output.contains("No local changes to save") {
        return Ok("No local changes to stash.".into());
    }
    Ok("Saved the uncommitted changes to a stash. Your working tree is clean.".into())
}

pub fn pop(path: &Path, index: u64) -> Result<String> {
    guard_operation(path)?;
    if index > 999 {
        return Err("Choose a stash from the list.".into());
    }
    let reference = format!("stash@{{{index}}}");
    run_plain(path, &["stash", "pop", &reference])?;
    Ok(format!(
        "Restored {reference}. Git kept the stash if applying it produced conflicts."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git;

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        git::run(dir.path(), &["init", "-b", "main"]).unwrap();
        git::run(dir.path(), &["config", "user.name", "gitowl Test"]).unwrap();
        git::run(
            dir.path(),
            &["config", "user.email", "test@example.invalid"],
        )
        .unwrap();
        git::run(dir.path(), &["config", "core.autocrlf", "false"]).unwrap();
        std::fs::write(dir.path().join("tracked.txt"), "first\n").unwrap();
        git::run(dir.path(), &["add", "tracked.txt"]).unwrap();
        git::run(dir.path(), &["commit", "-m", "Initial"]).unwrap();
        dir
    }

    #[test]
    fn saves_lists_and_pops_stashes() {
        let dir = repo();
        let path = dir.path();
        std::fs::write(path.join("tracked.txt"), "second\n").unwrap();
        std::fs::write(path.join("untracked.txt"), "later\n").unwrap();
        save(path, "Work in progress", false).unwrap();
        assert_eq!(
            std::fs::read_to_string(path.join("tracked.txt")).unwrap(),
            "first\n"
        );
        assert!(path.join("untracked.txt").exists());
        let listed = list(path).unwrap();
        assert_eq!(listed["stashes"].as_array().unwrap().len(), 1);
        assert_eq!(listed["stashes"][0]["index"], 0);
        assert!(
            listed["stashes"][0]["message"]
                .as_str()
                .unwrap()
                .contains("Work in progress")
        );
        pop(path, 0).unwrap();
        assert_eq!(
            std::fs::read_to_string(path.join("tracked.txt")).unwrap(),
            "second\n"
        );
        assert_eq!(list(path).unwrap()["stashes"].as_array().unwrap().len(), 0);
        assert!(pop(path, 42).is_err());
    }

    #[test]
    fn includes_untracked_when_requested() {
        let dir = repo();
        let path = dir.path();
        std::fs::write(path.join("tracked.txt"), "second\n").unwrap();
        std::fs::write(path.join("untracked.txt"), "later\n").unwrap();
        save(path, "", true).unwrap();
        assert!(!path.join("untracked.txt").exists());
        assert_eq!(list(path).unwrap()["stashes"].as_array().unwrap().len(), 1);
    }
}
