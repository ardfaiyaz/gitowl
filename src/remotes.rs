use crate::git::{Result, run};
use std::path::Path;

fn validate_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.starts_with('-')
        || name
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '/' || c == '\\')
    {
        return Err("Enter a remote name such as origin, without spaces.".into());
    }
    Ok(())
}

fn validate_url(url: &str) -> Result<()> {
    if url.is_empty() || url.starts_with('-') || url.contains('\0') || url.contains(['\n', '\r']) {
        return Err("Enter a remote URL or local path without line breaks.".into());
    }
    Ok(())
}

pub fn validate_remote(path: &Path, remote: &str) -> Result<()> {
    validate_name(remote)?;
    if !run(path, &["remote"])?.lines().any(|name| name == remote) {
        return Err("Choose a configured remote from this repository.".into());
    }
    Ok(())
}

fn exists(path: &Path, name: &str) -> Result<bool> {
    Ok(run(path, &["remote"])?.lines().any(|remote| remote == name))
}

pub fn add(path: &Path, name: &str, url: &str) -> Result<String> {
    validate_name(name)?;
    validate_url(url)?;
    if exists(path, name)? {
        return Err("That remote name already exists.".into());
    }
    run(path, &["remote", "add", name, url])?;
    Ok(format!("Added remote {name}."))
}

pub fn set_url(path: &Path, name: &str, url: &str) -> Result<String> {
    validate_name(name)?;
    validate_url(url)?;
    if !exists(path, name)? {
        return Err("That remote no longer exists.".into());
    }
    run(path, &["remote", "set-url", name, url])?;
    Ok(format!("Updated the URL for {name}."))
}

pub fn remove(path: &Path, name: &str) -> Result<String> {
    validate_name(name)?;
    if !exists(path, name)? {
        return Err("That remote no longer exists.".into());
    }
    run(path, &["remote", "remove", name])?;
    Ok(format!(
        "Removed remote {name}. Remote-tracking branches for it are gone; local branches are unchanged."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git;

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        git::run(dir.path(), &["init", "-b", "main"]).unwrap();
        dir
    }

    #[test]
    fn adds_updates_and_removes_remotes() {
        let dir = repo();
        let path = dir.path();
        add(path, "origin", "https://example.invalid/first.git").unwrap();
        assert!(add(path, "origin", "https://example.invalid/other.git").is_err());
        set_url(path, "origin", "https://example.invalid/second.git").unwrap();
        assert!(
            git::run(path, &["remote", "get-url", "origin"])
                .unwrap()
                .contains("second")
        );
        remove(path, "origin").unwrap();
        assert!(git::run(path, &["remote"]).unwrap().trim().is_empty());
        assert!(remove(path, "origin").is_err());
        assert!(add(path, "-bad", "https://example.invalid/x.git").is_err());
        assert!(set_url(path, "origin", "bad\nurl").is_err());
    }
}
