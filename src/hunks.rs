use crate::git::{self, Result, run};
use std::path::Path;

/// Splits a single-file unified diff into its file header and hunks.
fn split(diff: &str) -> (String, Vec<String>) {
    let mut header = String::new();
    let mut hunks: Vec<String> = Vec::new();
    for line in diff.split_inclusive('\n') {
        if line.starts_with("@@") {
            hunks.push(String::new());
        }
        match hunks.last_mut() {
            Some(hunk) => hunk.push_str(line),
            None => header.push_str(line),
        }
    }
    (header, hunks)
}

/// Keeps only the chosen body lines (0 = first line after the @@ header) of a hunk as changes.
/// An unchosen line that exists on the side the patch applies to becomes context; the other is dropped.
fn select(hunk: &str, chosen: &[usize], reverse: bool) -> Result<String> {
    let (keep, drop) = if reverse { ('+', '-') } else { ('-', '+') };
    let mut lines = hunk.split_inclusive('\n');
    let mut out = lines.next().unwrap_or_default().to_owned();
    let mut previous_kept = true;
    let mut changes = 0;
    for (i, line) in lines.enumerate() {
        if line.starts_with('\\') {
            if previous_kept {
                out.push_str(line);
            }
            continue;
        }
        previous_kept = true;
        let first = line.chars().next();
        if first == Some(keep) || first == Some(drop) {
            if chosen.contains(&i) {
                changes += 1;
                out.push_str(line);
            } else if first == Some(keep) {
                out.push(' ');
                out.push_str(&line[1..]);
            } else {
                previous_kept = false;
            }
        } else {
            out.push_str(line);
        }
    }
    if changes == 0 {
        return Err("Select at least one added or removed line.".into());
    }
    Ok(out)
}

/// Stages (mode "working") or unstages (mode "staged") one hunk, or chosen lines of it, from the diff the user reviewed.
pub fn apply(
    path: &Path,
    file: &str,
    mode: &str,
    index: usize,
    lines: Option<&[usize]>,
    previous: &str,
) -> Result<String> {
    if mode != "working" && mode != "staged" {
        return Err("Choose a staged or unstaged diff to move a hunk.".into());
    }
    let current = git::diff(path, file, mode)?;
    if current != previous {
        return Err(
            "This file changed since the diff was shown. Review the refreshed diff.".into(),
        );
    }
    let (header, hunks) = split(&current);
    if !header.starts_with("diff --git") {
        return Err("Hunk staging needs a tracked text file. Stage the whole file instead.".into());
    }
    let hunk = hunks.get(index).ok_or("That hunk no longer exists.")?;
    let hunk = match lines {
        Some(lines) => select(hunk, lines, mode == "staged")?,
        None => hunk.clone(),
    };
    let patch = git::git_path(path, "gitowl-hunk.patch");
    std::fs::write(&patch, format!("{header}{hunk}")).map_err(|e| e.to_string())?;
    let patch_arg = git::display(&patch);
    // --recount: line selection changes the hunk's sizes, so let Git count them.
    let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
    if mode == "staged" {
        args.push("-R");
    }
    args.push(&patch_arg);
    let result = run(path, &args);
    let _ = std::fs::remove_file(&patch);
    result?;
    let what = if lines.is_some() {
        "the selected lines"
    } else {
        "the hunk"
    };
    Ok(if mode == "staged" {
        format!("Moved {what} out of the next commit. Your working file is unchanged.")
    } else {
        format!("Staged {what} for the next commit.")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stages_and_unstages_single_hunks() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        run(repo, &["init"]).unwrap();
        run(repo, &["config", "user.name", "gitowl Test"]).unwrap();
        run(repo, &["config", "user.email", "test@example.invalid"]).unwrap();
        run(repo, &["config", "core.autocrlf", "false"]).unwrap();
        let original: String = (1..=30).map(|i| format!("line {i}\n")).collect();
        std::fs::write(repo.join("f.txt"), &original).unwrap();
        run(repo, &["add", "f.txt"]).unwrap();
        run(repo, &["commit", "-m", "init"]).unwrap();
        let edited = original
            .replace("line 2\n", "line two\n")
            .replace("line 28\n", "line twenty-eight\n");
        std::fs::write(repo.join("f.txt"), &edited).unwrap();

        let working = git::diff(repo, "f.txt", "working").unwrap();
        assert_eq!(split(&working).1.len(), 2);
        assert!(apply(repo, "f.txt", "working", 0, None, "stale").is_err());
        apply(repo, "f.txt", "working", 0, None, &working).unwrap();
        let staged = git::diff(repo, "f.txt", "staged").unwrap();
        assert!(staged.contains("+line two") && !staged.contains("twenty-eight"));
        assert!(
            git::diff(repo, "f.txt", "working")
                .unwrap()
                .contains("+line twenty-eight")
        );

        apply(repo, "f.txt", "staged", 0, None, &staged).unwrap();
        assert!(git::diff(repo, "f.txt", "staged").unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(repo.join("f.txt")).unwrap(), edited);
    }

    #[test]
    fn stages_and_unstages_selected_lines() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        run(repo, &["init"]).unwrap();
        run(repo, &["config", "user.name", "gitowl Test"]).unwrap();
        run(repo, &["config", "user.email", "test@example.invalid"]).unwrap();
        run(repo, &["config", "core.autocrlf", "false"]).unwrap();
        std::fs::write(repo.join("f.txt"), "a\nb\nc\nd\n").unwrap();
        run(repo, &["add", "f.txt"]).unwrap();
        run(repo, &["commit", "-m", "init"]).unwrap();
        std::fs::write(repo.join("f.txt"), "a\nB\nc\nD\nnew\n").unwrap();
        let working = git::diff(repo, "f.txt", "working").unwrap();
        let (_, hunks) = split(&working);
        assert_eq!(hunks.len(), 1);
        let body: Vec<_> = hunks[0].lines().skip(1).collect();
        let pick = |wanted: &[&str]| -> Vec<usize> {
            body.iter()
                .enumerate()
                .filter(|(_, l)| wanted.contains(l))
                .map(|(i, _)| i)
                .collect()
        };
        assert!(apply(repo, "f.txt", "working", 0, Some(&pick(&[" a"])), &working).is_err());
        apply(
            repo,
            "f.txt",
            "working",
            0,
            Some(&pick(&["-b", "+B", "+new"])),
            &working,
        )
        .unwrap();
        assert_eq!(run(repo, &["show", ":f.txt"]).unwrap(), "a\nB\nc\nd\nnew\n");

        let staged = git::diff(repo, "f.txt", "staged").unwrap();
        let body: Vec<_> = split(&staged).1[0]
            .lines()
            .skip(1)
            .map(str::to_owned)
            .collect();
        let new_line = body.iter().position(|l| l == "+new").unwrap();
        apply(repo, "f.txt", "staged", 0, Some(&[new_line]), &staged).unwrap();
        assert_eq!(run(repo, &["show", ":f.txt"]).unwrap(), "a\nB\nc\nd\n");
        assert_eq!(
            std::fs::read_to_string(repo.join("f.txt")).unwrap(),
            "a\nB\nc\nD\nnew\n"
        );
    }
}
