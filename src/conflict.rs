use crate::git::{self, Result, run};
use serde_json::{Value, json};
use std::path::Path;

fn current(path: &Path, file: &str) -> Result<String> {
    git::validate_file(file)?;
    let target = path.join(file);
    if std::fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Symlink conflicts must be resolved in your editor.".into());
    }
    let resolved = std::fs::canonicalize(&target).map_err(|e| e.to_string())?;
    if !resolved.starts_with(path) {
        return Err("File points outside the repository.".into());
    }
    if std::fs::metadata(&resolved)
        .map_err(|e| e.to_string())?
        .len()
        > 1024 * 1024
    {
        return Err("Conflict editor supports text files up to 1 MB.".into());
    }
    let value = std::fs::read_to_string(resolved).map_err(|_| "This is not a UTF-8 text file.")?;
    if value.contains('\0') {
        return Err("Binary conflicts must be resolved in your editor.".into());
    }
    Ok(value)
}
pub fn read(path: &Path, file: &str) -> Result<Value> {
    git::validate_file(file)?;
    let stages = run(path, &["ls-files", "-u", "--", file])?;
    if stages.is_empty() {
        return Err("This file no longer has a conflict. Refresh the project.".into());
    }
    let result = current(path, file)?;
    let base = run(path, &["show", &format!(":1:{file}")]).unwrap_or_default();
    let ours = run(path, &["show", &format!(":2:{file}")]).unwrap_or_default();
    let theirs = run(path, &["show", &format!(":3:{file}")]).unwrap_or_default();
    // Missing stages (add/delete conflicts) need an explicit file deletion decision.
    if !stages.lines().any(|l| l.contains(" 2\t")) || !stages.lines().any(|l| l.contains(" 3\t")) {
        return Err("Add/delete conflicts need a file decision in your editor. Then use Stage latest edits.".into());
    }
    Ok(json!({"base":base,"ours":ours,"theirs":theirs,"result":result,"stages":stages}))
}
pub fn save(
    path: &Path,
    file: &str,
    previous: &str,
    stages: &str,
    content: &str,
) -> Result<String> {
    if current(path, file)? != previous || run(path, &["ls-files", "-u", "--", file])? != stages {
        return Err(
            "The conflict changed externally. Reopen the conflict editor before saving.".into(),
        );
    }
    if content
        .lines()
        .any(|l| l.starts_with("<<<<<<< ") || l.starts_with(">>>>>>> ") || l == "=======")
    {
        return Err(
            "Remove the remaining conflict markers before marking this file resolved.".into(),
        );
    }
    std::fs::write(path.join(file), content).map_err(|e| e.to_string())?;
    run(path, &["add", "--", file])?;
    Ok(
        "Resolution saved and staged. Review the staged diff, then commit to finish the merge."
            .into(),
    )
}
/// Resolves any conflict (including add/delete and binary) by taking one side as a whole.
pub fn take(path: &Path, file: &str, side: &str) -> Result<String> {
    git::validate_file(file)?;
    let (stage, flag) = match side {
        "ours" => (" 2\t", "--ours"),
        "theirs" => (" 3\t", "--theirs"),
        _ => return Err("Choose side 2 (ours) or side 3 (theirs).".into()),
    };
    let stages = run(path, &["ls-files", "-u", "--", file])?;
    if stages.is_empty() {
        return Err("This file no longer has a conflict. Refresh the project.".into());
    }
    if stages.lines().any(|l| l.contains(stage)) {
        run(path, &["checkout", flag, "--", file])?;
        run(path, &["add", "--", file])?;
        Ok(format!(
            "Kept the {side} version of {file} and marked it resolved."
        ))
    } else {
        run(path, &["rm", "--quiet", "--", file])?;
        Ok(format!(
            "The {side} side deleted {file}; removed it and marked it resolved."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_a_side_including_deletions() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        run(p, &["init", "-b", "main"]).unwrap();
        run(p, &["config", "user.name", "T"]).unwrap();
        run(p, &["config", "user.email", "t@example.invalid"]).unwrap();
        std::fs::write(p.join("a.txt"), "base").unwrap();
        std::fs::write(p.join("b.txt"), "base").unwrap();
        run(p, &["add", "."]).unwrap();
        run(p, &["commit", "-m", "base"]).unwrap();
        run(p, &["switch", "-c", "other"]).unwrap();
        std::fs::write(p.join("a.txt"), "theirs").unwrap();
        run(p, &["rm", "-q", "b.txt"]).unwrap();
        run(p, &["commit", "-am", "other"]).unwrap();
        run(p, &["switch", "main"]).unwrap();
        std::fs::write(p.join("a.txt"), "ours").unwrap();
        std::fs::write(p.join("b.txt"), "ours").unwrap();
        run(p, &["commit", "-am", "main"]).unwrap();
        assert!(run(p, &["merge", "other"]).is_err());
        take(p, "a.txt", "theirs").unwrap();
        assert_eq!(std::fs::read_to_string(p.join("a.txt")).unwrap(), "theirs");
        take(p, "b.txt", "theirs").unwrap();
        assert!(!p.join("b.txt").exists());
        assert!(!git::has_conflicts(p).unwrap());
    }
}
