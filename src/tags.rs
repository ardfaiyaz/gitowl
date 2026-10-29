use crate::git::{Result, run};
use crate::remotes;
use std::path::Path;

fn validate_tag(path: &Path, tag: &str) -> Result<()> {
    if tag.is_empty() || tag.starts_with('-') {
        return Err("Enter a tag name, such as v1.0.0.".into());
    }
    run(path, &["check-ref-format", &format!("refs/tags/{tag}")])?;
    Ok(())
}

pub fn create(path: &Path, tag: &str, message: &str) -> Result<String> {
    validate_tag(path, tag)?;
    let message = message.trim();
    if message.contains('\0') {
        return Err("The tag annotation contains an invalid character.".into());
    }
    if message.is_empty() {
        run(path, &["tag", tag])?;
        Ok(format!(
            "Created local lightweight tag {tag}. It has not been pushed."
        ))
    } else {
        run(path, &["tag", "--annotate", tag, "--message", message])?;
        Ok(format!(
            "Created local annotated tag {tag}. It has not been pushed."
        ))
    }
}

pub fn delete(path: &Path, tag: &str) -> Result<String> {
    validate_tag(path, tag)?;
    run(path, &["tag", "--delete", tag])?;
    Ok(format!(
        "Deleted local tag {tag}. Remote tags are unchanged."
    ))
}

pub fn push(path: &Path, remote: &str, tag: &str) -> Result<String> {
    validate_tag(path, tag)?;
    remotes::validate_remote(path, remote)?;
    run(
        path,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/tags/{tag}"),
        ],
    )
    .map_err(|_| format!("Tag {tag} no longer exists."))?;
    let refspec = format!("refs/tags/{tag}:refs/tags/{tag}");
    run(path, &["push", "--", remote, &refspec])?;
    Ok(format!("Pushed tag {tag} to {remote}."))
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
        git::run(dir.path(), &["commit", "--allow-empty", "-m", "Initial"]).unwrap();
        dir
    }

    #[test]
    fn creates_and_deletes_lightweight_and_annotated_tags() {
        let dir = repo();
        let path = dir.path();
        create(path, "v1.0.0", "").unwrap();
        create(path, "v1.1.0", "Release notes").unwrap();
        let tags = git::run(path, &["tag", "--list"]).unwrap();
        assert!(tags.lines().any(|tag| tag == "v1.0.0"));
        assert!(tags.lines().any(|tag| tag == "v1.1.0"));
        let annotated = git::run(path, &["cat-file", "-t", "refs/tags/v1.1.0"]).unwrap();
        assert_eq!(annotated.trim(), "tag");
        delete(path, "v1.0.0").unwrap();
        assert!(git::run(path, &["tag", "--list"]).unwrap().trim() == "v1.1.0");
    }

    #[test]
    fn pushes_a_tag_only_to_a_configured_remote() {
        let dir = repo();
        let path = dir.path();
        let bare = dir.path().join("remote.git");
        git::run(dir.path(), &["init", "--bare", bare.to_str().unwrap()]).unwrap();
        create(path, "v2.0.0", "").unwrap();
        remotes::add(path, "origin", bare.to_str().unwrap()).unwrap();
        push(path, "origin", "v2.0.0").unwrap();
        let remote_tags = git::run(&bare, &["tag", "--list"]).unwrap();
        assert_eq!(remote_tags.trim(), "v2.0.0");
        assert!(push(path, "missing", "v2.0.0").is_err());
        assert!(push(path, "origin", "missing").is_err());
    }
}
