use crate::git::{Result, run};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path};

// Git walks each reachable commit once, even when local and remote branches share it.
// Recovery refs, reflogs and stashes aren't branch history and are deliberately excluded.
pub fn repository_activity(path: &Path) -> Result<Value> {
    let head = run(path, &["rev-parse", "--verify", "HEAD"]).is_ok();
    let refs = run(
        path,
        &[
            "for-each-ref",
            "--format=%(objectname)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    let mut days = BTreeMap::<String, u64>::new();
    if head || !refs.trim().is_empty() {
        let mut args = vec![
            "log",
            "--no-show-signature",
            "--format=%as",
            "--branches",
            "--remotes",
        ];
        if head {
            args.push("HEAD");
        }
        args.push("--");
        for date in run(path, &args)?.lines().filter(|line| !line.is_empty()) {
            *days.entry(date.to_owned()).or_default() += 1;
        }
    }
    let shallow = run(path, &["rev-parse", "--is-shallow-repository"])?;
    Ok(json!({"days":days,"shallow":shallow.trim() == "true"}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git;

    fn commit(path: &Path, date: &str, author: &str) {
        let mut command = std::process::Command::new("git");
        command.current_dir(path);
        command
            .args([
                "-c",
                "user.name=Demo",
                "-c",
                "user.email=demo@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--allow-empty",
                "-m",
                "Activity",
            ])
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date)
            .env("GIT_AUTHOR_NAME", author);
        git::execute(command).unwrap();
    }

    #[test]
    fn counts_all_contributors_and_deduplicates_shared_branches() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        run(path, &["init", "-b", "main"]).unwrap();
        assert_eq!(repository_activity(path).unwrap()["days"], json!({}));
        commit(path, "2024-02-29T10:00:00+0800", "One");
        run(path, &["branch", "feature"]).unwrap();
        commit(path, "2024-02-29T12:00:00+0800", "Two");
        run(path, &["update-ref", "refs/remotes/origin/main", "HEAD"]).unwrap();
        run(path, &["checkout", "feature"]).unwrap();
        commit(path, "2025-01-01T00:30:00+0800", "Three");
        let result = repository_activity(path).unwrap();
        assert_eq!(result["days"], json!({"2024-02-29":2,"2025-01-01":1}));
        assert_eq!(result["shallow"], false);
        run(path, &["checkout", "--detach"]).unwrap();
        commit(path, "2025-01-02T12:00:00+0800", "Four");
        assert_eq!(repository_activity(path).unwrap()["days"]["2025-01-02"], 1);
        run(path, &["update-ref", "refs/gitowl/recovery/test", "HEAD"]).unwrap();
        run(path, &["checkout", "main"]).unwrap();
        assert!(
            repository_activity(path).unwrap()["days"]
                .get("2025-01-02")
                .is_none()
        );
    }
}
