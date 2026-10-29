use serde_json::{Value, json};
use std::{
    hash::{Hash, Hasher},
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
pub type Result<T> = std::result::Result<T, String>;
pub fn check_git() -> Result<()> {
    run(Path::new("."), &["--version"]).map(|_| ())
}

// Arguments go directly to Git. Never interpolate a shell command.
pub fn run(path: &Path, args: &[&str]) -> Result<String> {
    run_with(path, args, true)
}
pub fn run_plain(path: &Path, args: &[&str]) -> Result<String> {
    run_with(path, args, false)
}
pub fn run_env(path: &Path, args: &[&str], env: &[(&str, &str)]) -> Result<String> {
    let mut command = git_command(path, true);
    command.args(args).envs(env.iter().copied());
    execute(command)
}
fn git_command(path: &Path, literal_pathspecs: bool) -> Command {
    let mut command = Command::new("git");
    command.arg("--no-pager");
    if literal_pathspecs {
        command.arg("--literal-pathspecs");
    }
    command
        .arg("-C")
        .arg(path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no");
    command
}
fn run_with(path: &Path, args: &[&str], literal_pathspecs: bool) -> Result<String> {
    let mut command = git_command(path, literal_pathspecs);
    command.args(args);
    execute(command)
}
// Runs a prepared command without a shell, with bounded output and a timeout.
pub fn execute(mut command: Command) -> Result<String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let program = command.get_program().to_string_lossy().into_owned();
    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot run {program}: {e}. Check that it is installed."))?;
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let reader = |stream: &mut dyn Read| {
        let mut bytes = Vec::new();
        let mut buf = [0; 8192];
        loop {
            match stream.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if bytes.len() < 8 * 1024 * 1024 {
                        bytes.extend_from_slice(&buf[..n]);
                    }
                }
            }
        }
        bytes
    };
    let out = std::thread::spawn(move || reader(&mut stdout));
    let err = std::thread::spawn(move || reader(&mut stderr));
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(120) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "{program} timed out. Check authentication or hooks in your terminal, then refresh."
            ));
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    let output = String::from_utf8_lossy(&out.join().unwrap_or_default()).into_owned();
    let error = String::from_utf8_lossy(&err.join().unwrap_or_default()).into_owned();
    if status.success() {
        Ok(output)
    } else {
        Err(if error.trim().is_empty() {
            output
        } else {
            error
        }
        .trim()
        .to_owned())
    }
}
pub fn root(path: &Path) -> Result<PathBuf> {
    let value = run(path, &["rev-parse", "--show-toplevel"])?;
    std::fs::canonicalize(value.trim()).map_err(|e| e.to_string())
}
pub fn display(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_owned()
}
pub fn validate_file(file: &str) -> Result<()> {
    if file.is_empty()
        || file.contains('\0')
        || Path::new(file)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        || file
            .split(['/', '\\'])
            .any(|c| c.eq_ignore_ascii_case(".git") || c == "..")
    {
        return Err("Select a file inside this repository.".into());
    }
    Ok(())
}
pub fn fingerprint(path: &Path) -> Result<String> {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    run(
        path,
        &[
            "diff",
            "--cached",
            "--raw",
            "--no-abbrev",
            "--no-ext-diff",
            "--no-textconv",
        ],
    )?
    .hash(&mut hash);
    run(path, &["rev-parse", "HEAD"])
        .unwrap_or_default()
        .hash(&mut hash);
    Ok(format!("{:x}", hash.finish()))
}
pub fn git_path(path: &Path, name: &str) -> PathBuf {
    let value = run(path, &["rev-parse", "--git-path", name]).unwrap_or_default();
    let value = PathBuf::from(value.trim());
    if value.is_absolute() {
        value
    } else {
        path.join(value)
    }
}
pub fn status(path: &Path) -> Result<Value> {
    let raw = run(
        path,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let mut entries = raw.split('\0');
    let mut files = Vec::new();
    while let Some(line) = entries.next() {
        if line.len() < 4 {
            continue;
        }
        let code = &line[..2];
        let file = &line[3..];
        let original = if code.contains('R') || code.contains('C') {
            entries.next()
        } else {
            None
        };
        files.push(json!({"path": file, "code":code, "original":original,
            "staged":code.as_bytes()[0] != b' ' && code != "??", "unstaged":code.as_bytes()[1] != b' ',
            "conflict":code.contains('U') || code == "AA" || code == "DD"}));
    }
    let branch = run(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .unwrap_or_else(|_| "Detached HEAD".into());
    let remotes = run(path, &["remote", "-v"])?;
    let branches = run(
        path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
    )?;
    let counts = run(
        path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .unwrap_or_default();
    Ok(
        json!({"path":display(path), "name":path.file_name().unwrap_or_default().to_string_lossy(),
        "branch":branch.trim(), "files":files, "branches":branches.lines().collect::<Vec<_>>(),
        "remotes":remotes, "remoteNames":run(path, &["remote"])?.lines().collect::<Vec<_>>(),
        "upstream":run(path, &["rev-parse", "--abbrev-ref", "@{upstream}"]).unwrap_or_default().trim(), "counts":counts.trim(), "fingerprint":fingerprint(path)?,
        "merging":run(path, &["rev-parse","--verify","MERGE_HEAD"]).is_ok(),
        "rebasing":git_path(path, "rebase-merge").exists() || git_path(path, "rebase-apply").exists(),
        "identity":{"name":run(path, &["config", "user.name"]).unwrap_or_default().trim(), "email":run(path, &["config", "user.email"]).unwrap_or_default().trim()}}),
    )
}
pub fn has_conflicts(path: &Path) -> Result<bool> {
    Ok(!run(path, &["diff", "--name-only", "--diff-filter=U"])?
        .trim()
        .is_empty())
}
fn in_head(path: &Path, file: &str) -> Result<bool> {
    if run(path, &["rev-parse", "--verify", "HEAD"]).is_err() {
        return Ok(false);
    }
    Ok(
        !run(path, &["ls-tree", "-r", "--name-only", "HEAD", "--", file])?
            .trim()
            .is_empty(),
    )
}
fn remove_worktree_file(path: &Path, file: &str) -> Result<()> {
    let target = path.join(file);
    let metadata = match std::fs::symlink_metadata(&target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.is_dir() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&target).map_err(|e| e.to_string())
    }
}
pub fn discard(path: &Path, file: &str) -> Result<String> {
    validate_file(file)?;
    let state = status(path)?;
    if state["merging"].as_bool().unwrap_or(false) || state["rebasing"].as_bool().unwrap_or(false) {
        return Err("Finish or abort the current merge or rebase before discarding files.".into());
    }
    let entry = state["files"]
        .as_array()
        .and_then(|files| files.iter().find(|entry| entry["path"] == file))
        .cloned()
        .ok_or("That file has no changes to discard.")?;
    if entry["conflict"].as_bool().unwrap_or(false) {
        return Err("Resolve the conflict instead of discarding this file.".into());
    }
    if entry["code"] == "??" {
        let target = std::fs::canonicalize(path.join(file)).map_err(|e| e.to_string())?;
        if !target.starts_with(path) {
            return Err("This file points outside the repository.".into());
        }
        remove_worktree_file(path, file)?;
        return Ok(format!("Deleted untracked file {file}."));
    }
    let original = entry["original"].as_str().unwrap_or_default();
    if !original.is_empty() && in_head(path, original)? {
        run(
            path,
            &[
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                original,
            ],
        )?;
    }
    if in_head(path, file)? {
        run(
            path,
            &[
                "restore",
                "--source=HEAD",
                "--staged",
                "--worktree",
                "--",
                file,
            ],
        )?;
    } else {
        run(
            path,
            &[
                "rm",
                "--cached",
                "--force",
                "--quiet",
                "--ignore-unmatch",
                "--",
                file,
            ],
        )?;
        remove_worktree_file(path, file)?;
    }
    Ok(format!("Discarded changes to {file}."))
}
pub fn diff(path: &Path, file: &str, mode: &str) -> Result<String> {
    diff_with(path, file, mode, &[])
}
/// `extra` holds display options such as `-w` or `-U<n>`; hunk staging always uses plain `diff`.
pub fn diff_with(path: &Path, file: &str, mode: &str, extra: &[&str]) -> Result<String> {
    validate_file(file)?;
    let git_diff = |base: &[&str]| {
        let mut args = vec!["diff"];
        args.extend(base);
        args.extend(extra);
        args.extend(["--no-ext-diff", "--no-textconv", "--", file]);
        run(path, &args)
    };
    if mode == "working" && !run(path, &["ls-files", "--", file])?.is_empty() {
        return git_diff(&[]);
    }
    if mode == "staged" {
        return git_diff(&["--cached"]);
    }
    if mode == "head"
        && run(path, &["rev-parse", "HEAD"]).is_ok()
        && !run(path, &["ls-files", "--", file])?.is_empty()
    {
        return git_diff(&["HEAD"]);
    }
    let target = std::fs::canonicalize(path.join(file)).map_err(|e| e.to_string())?;
    if !target.starts_with(path) {
        return Err("This file points outside the repository.".into());
    }
    if std::fs::metadata(&target).map_err(|e| e.to_string())?.len() > 1024 * 1024 {
        return Ok("File is too large for an inline preview (1 MB limit).".into());
    }
    let bytes = std::fs::read(target).map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Ok("Binary file — text preview unavailable.".into());
    }
    Ok(String::from_utf8_lossy(&bytes)
        .lines()
        .map(|line| format!("+{line}\n"))
        .collect())
}
pub fn commit(path: &Path, message: &str, expected: &str) -> Result<String> {
    if message.trim().is_empty() {
        return Err("Enter a commit message.".into());
    }
    if fingerprint(path)? != expected {
        return Err("Staged changes or HEAD changed since your last preview. Refresh and review before committing.".into());
    }
    if run(path, &["diff", "--cached", "--name-only"])?.is_empty()
        && run(path, &["rev-parse", "--verify", "MERGE_HEAD"]).is_err()
    {
        return Err("Stage at least one change first.".into());
    }
    run(path, &["commit", "-m", message])
}
pub fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..4 {
            out.push(if i <= chunk.len() {
                TABLE[(n >> (18 - 6 * i)) as usize & 63] as char
            } else {
                '='
            });
        }
    }
    out
}
/// Raw bytes of `spec` (e.g. "HEAD:path", ":path"); None when that version doesn't exist.
pub fn show_bytes(path: &Path, spec: &str) -> Option<Vec<u8>> {
    let mut command = git_command(path, false);
    command.args(["show", spec]).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let out = command.output().ok()?;
    out.status.success().then_some(out.stdout)
}
/// Untracked files and folders `git clean` would remove (ignored files are never included).
pub fn clean_preview(path: &Path) -> Result<Vec<String>> {
    Ok(run(path, &["clean", "-n", "-d"])?
        .lines()
        .filter_map(|l| l.strip_prefix("Would remove ").map(str::to_owned))
        .collect())
}
/// Removes exactly the listed untracked paths, each re-checked against a fresh preview.
pub fn clean(path: &Path, files: &[String]) -> Result<String> {
    let allowed = clean_preview(path)?;
    if files.is_empty() {
        return Err("Choose at least one file to remove.".into());
    }
    for file in files {
        validate_file(file.trim_end_matches('/'))?;
        if !allowed.contains(file) {
            return Err(format!(
                "{file} is no longer untracked. Refresh and try again."
            ));
        }
    }
    let mut args = vec!["clean", "-f", "-d", "--"];
    args.extend(files.iter().map(String::as_str));
    run(path, &args)?;
    Ok(format!(
        "Removed {} untracked item{}.",
        files.len(),
        if files.len() == 1 { "" } else { "s" }
    ))
}
/// Which changed files Git LFS stores, and which are large enough to suggest it (50 MB).
pub fn lfs_info(path: &Path, files: &[String]) -> Result<Value> {
    let installed = run(path, &["lfs", "version"]).is_ok();
    let mut lfs = Vec::new();
    let mut large = Vec::new();
    for file in files {
        validate_file(file)?;
        let attr = run(path, &["check-attr", "filter", "--", file]).unwrap_or_default();
        if attr.trim_end().ends_with(": lfs") {
            lfs.push(file.clone());
        } else if std::fs::metadata(path.join(file))
            .map(|m| m.len() > 50 * 1024 * 1024)
            .unwrap_or(false)
        {
            large.push(file.clone());
        }
    }
    Ok(json!({ "installed": installed, "lfs": lfs, "large": large }))
}
pub fn lfs_track(path: &Path, file: &str) -> Result<String> {
    validate_file(file)?;
    // Glob characters in a real file name would widen the pattern; LFS patterns escape them with "\".
    let pattern: String = file
        .chars()
        .flat_map(|c| {
            if "*?[] ".contains(c) {
                vec!['\\', c]
            } else {
                vec![c]
            }
        })
        .collect();
    run(path, &["lfs", "track", "--", &pattern])?;
    run(path, &["add", "--", ".gitattributes"])?;
    Ok(format!(
        "Git LFS now stores {file}. Stage it again so the pointer is committed."
    ))
}
/// The configured external diff and merge tools, if any.
pub fn tools(path: &Path) -> Value {
    let get = |key: &str| {
        run(path, &["config", "--get", key])
            .map(|v| v.trim().to_owned())
            .unwrap_or_default()
    };
    json!({ "diff": get("diff.tool"), "merge": get("merge.tool") })
}
/// Opens the configured diff tool for one file without waiting for it to close.
pub fn difftool(path: &Path, file: &str, staged: bool) -> Result<String> {
    validate_file(file)?;
    if tools(path)["diff"] == "" {
        return Err(
            "No diff tool is set. Set one with: git config --global diff.tool <name>".into(),
        );
    }
    let mut command = git_command(path, true);
    command.args(["difftool", "--no-prompt"]);
    if staged {
        command.arg("--cached");
    }
    command
        .args(["--", file])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
        .spawn()
        .map_err(|e| format!("Couldn't start git difftool: {e}"))?;
    Ok(format!("Opened {file} in your diff tool."))
}
/// Remote commits a force push would replace, and whether this is the remote's default branch.
pub fn force_push_preview(path: &Path) -> Result<Value> {
    let upstream = run(path, &["rev-parse", "--abbrev-ref", "@{upstream}"])
        .map_err(|_| "This branch has no upstream to force push to.".to_owned())?;
    let upstream = upstream.trim();
    let lost: Vec<Value> = run(path, &["log", "--format=%h%x00%s", "HEAD..@{upstream}"])?
        .lines()
        .filter_map(|l| {
            l.split_once('\0')
                .map(|(id, s)| json!({"id": id, "message": s}))
        })
        .collect();
    let remote = upstream.split('/').next().unwrap_or("origin");
    let default = run(
        path,
        &[
            "symbolic-ref",
            "--short",
            &format!("refs/remotes/{remote}/HEAD"),
        ],
    )
    .unwrap_or_default();
    let branch = run(path, &["branch", "--show-current"])?.trim().to_owned();
    Ok(
        json!({ "upstream": upstream, "branch": branch, "lost": lost, "isDefault": default.trim() == upstream }),
    )
}
/// --force-with-lease stops if the remote moved since the last fetch, so nobody's new work is lost.
pub fn force_push(path: &Path, confirm: &str) -> Result<String> {
    let preview = force_push_preview(path)?;
    let branch = preview["branch"].as_str().unwrap_or_default();
    if preview["isDefault"] == true && confirm != branch {
        return Err(format!(
            "Type {branch} to confirm replacing the default branch."
        ));
    }
    run(path, &["push", "--force-with-lease"])?;
    Ok(format!("Force pushed {branch} with lease."))
}
fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}
/// Global commit-signing settings, plus an SSH key to suggest when none is set.
pub fn signing_status(path: &Path) -> Value {
    let get = |key: &str| {
        run(path, &["config", "--global", "--get", key])
            .map(|v| v.trim().to_owned())
            .unwrap_or_default()
    };
    let suggested = home()
        .map(|h| h.join(".ssh").join("id_ed25519.pub"))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().replace('\\', "/"));
    json!({
        "enabled": get("commit.gpgsign") == "true",
        "format": get("gpg.format"),
        "key": get("user.signingkey"),
        "suggested": suggested,
    })
}
/// Turns signing on for every repository after a real test signature in this one, or turns it off.
pub fn signing_set(path: &Path, enable: bool) -> Result<String> {
    if !enable {
        run(path, &["config", "--global", "commit.gpgsign", "false"])?;
        return Ok("New commits are no longer signed.".into());
    }
    let status = signing_status(path);
    if status["key"] == "" {
        let key = status["suggested"].as_str().ok_or(
            "No signing key found. Create one with: ssh-keygen -t ed25519, or set user.signingkey in Git config.",
        )?;
        run(path, &["config", "--global", "gpg.format", "ssh"])?;
        run(path, &["config", "--global", "user.signingkey", key])?;
    }
    // Sign a throwaway commit object (never referenced, so Git garbage-collects it) to prove the key works.
    let tree = run(path, &["write-tree"])?;
    if let Err(e) = run(
        path,
        &[
            "commit-tree",
            "-S",
            tree.trim(),
            "-m",
            "gitowl signing test",
        ],
    ) {
        return Err(format!("Signing failed, so it stays off: {e}"));
    }
    run(path, &["config", "--global", "commit.gpgsign", "true"])?;
    Ok("New commits are signed. Test signature OK.".into())
}
/// Moves the current branch to an earlier commit. A recovery point keeps the old tip either way.
pub fn reset_to(path: &Path, id: &str, mode: &str) -> Result<String> {
    if !(4..=64).contains(&id.len()) || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Choose a commit first.".into());
    }
    let flag = match mode {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => return Err("Choose soft, mixed or hard.".into()),
    };
    if run(path, &["rev-parse", "--verify", "MERGE_HEAD"]).is_ok()
        || path.join(".git/rebase-merge").exists()
        || path.join(".git/rebase-apply").exists()
    {
        return Err("Finish or abort the merge or rebase first.".into());
    }
    // Only earlier commits on this branch: resetting sideways would silently drop unrelated history.
    if run(path, &["merge-base", "--is-ancestor", id, "HEAD"]).is_err() {
        return Err("Reset only to a commit in this branch's history.".into());
    }
    let head = run(path, &["rev-parse", "HEAD"])?.trim().to_owned();
    let recovery = format!("refs/gitowl/recovery/{head}/{:016x}", rand::random::<u64>());
    run(path, &["update-ref", &recovery, &head, ""])?;
    run(path, &["reset", flag, id])?;
    let short = &id[..8.min(id.len())];
    Ok(match mode {
        "soft" => format!(
            "Moved the branch to {short}. Later changes are staged; a recovery point was saved."
        ),
        "mixed" => format!(
            "Moved the branch to {short}. Later changes are unstaged in your files; a recovery point was saved."
        ),
        _ => format!(
            "Reset to {short} and discarded later changes to tracked files. Restore them from the recovery point in Settings."
        ),
    })
}
/// Who last changed each line of `file` at `rev`, ignoring whitespace and following moved code.
pub fn blame(path: &Path, file: &str, rev: &str) -> Result<Value> {
    validate_file(file)?;
    let rev = if rev.is_empty() { "HEAD" } else { rev };
    if rev != "HEAD"
        && (rev.len() < 4 || rev.len() > 64 || !rev.chars().all(|c| c.is_ascii_hexdigit()))
    {
        return Err("Enter a valid commit hash.".into());
    }
    let out = run(path, &["blame", "--porcelain", "-w", "-C", rev, "--", file])?;
    // Porcelain prints author details only the first time each commit appears.
    let mut who = std::collections::HashMap::<String, (String, String)>::new();
    let mut id = String::new();
    let mut lines = Vec::new();
    for line in out.lines() {
        if let Some(code) = line.strip_prefix('\t') {
            let (author, time) = who.get(&id).cloned().unwrap_or_default();
            lines.push(json!({"id": id, "author": author, "time": time, "text": code}));
        } else if let Some(author) = line.strip_prefix("author ") {
            who.entry(id.clone()).or_default().0 = author.to_owned();
        } else if let Some(time) = line.strip_prefix("author-time ") {
            who.entry(id.clone()).or_default().1 = time.to_owned();
        } else if line.len() > 40 && line.as_bytes()[..40].iter().all(u8::is_ascii_hexdigit) {
            id = line[..40].to_owned();
        }
    }
    Ok(json!({ "lines": lines }))
}
/// Where HEAD has been, newest first, with each move's reflog message.
pub fn reflog(path: &Path) -> Result<Value> {
    if run(path, &["rev-parse", "HEAD"]).is_err() {
        return Ok(json!({ "entries": [] }));
    }
    let out = run(
        path,
        &[
            "reflog",
            "-n",
            "50",
            "--date=unix",
            "--format=%H%x00%gs%x00%gd",
        ],
    )?;
    let entries: Vec<Value> = out
        .lines()
        .filter_map(|l| {
            let mut parts = l.split('\0');
            let (id, message, selector) = (parts.next()?, parts.next()?, parts.next()?);
            // --date=unix turns the selector into HEAD@{<seconds>}.
            let time = selector.rsplit('{').next()?.trim_end_matches('}');
            Some(json!({"id": id, "message": message, "time": time}))
        })
        .collect();
    Ok(json!({ "entries": entries }))
}
/// Creates `branch` at commit `id` without switching to it.
pub fn branch_at(path: &Path, branch: &str, id: &str) -> Result<String> {
    if id.len() < 4 || id.len() > 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Enter a valid commit hash.".into());
    }
    if branch.starts_with('-') {
        return Err("Invalid branch name.".into());
    }
    run(path, &["check-ref-format", "--branch", branch])?;
    run(path, &["branch", branch, id])?;
    Ok(format!(
        "Created branch {branch} at {}. Your current branch is unchanged.",
        &id[..8.min(id.len())]
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init"]).unwrap();
        run(dir.path(), &["config", "user.name", "gitowl Test"]).unwrap();
        run(
            dir.path(),
            &["config", "user.email", "test@example.invalid"],
        )
        .unwrap();
        run(dir.path(), &["config", "core.autocrlf", "false"]).unwrap();
        dir
    }
    #[test]
    fn selected_files_only_and_stale_preview() {
        let dir = repo();
        let p = dir.path();
        std::fs::write(p.join("selected.txt"), "one\n").unwrap();
        std::fs::write(p.join("later.txt"), "later\n").unwrap();
        run(p, &["add", "--", "selected.txt"]).unwrap();
        let old = fingerprint(p).unwrap();
        std::fs::write(p.join("selected.txt"), "two\n").unwrap();
        commit(p, "initial", &old).unwrap();
        assert_eq!(run(p, &["show", "HEAD:selected.txt"]).unwrap(), "one\n");
        assert!(run(p, &["show", "HEAD:later.txt"]).is_err());
        run(p, &["add", "--", "selected.txt"]).unwrap();
        assert!(commit(p, "stale", &old).is_err());
    }

    #[test]
    fn blame_reflog_and_branch_at() {
        let dir = repo();
        let p = dir.path();
        std::fs::write(p.join("a.txt"), "one\ntwo\n").unwrap();
        run(p, &["add", "a.txt"]).unwrap();
        run(p, &["commit", "-m", "first"]).unwrap();
        std::fs::write(p.join("a.txt"), "one\n2\n").unwrap();
        run(p, &["commit", "-am", "second"]).unwrap();
        let head = run(p, &["rev-parse", "HEAD"]).unwrap();
        let lines = blame(p, "a.txt", "").unwrap()["lines"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["text"], "one");
        assert_eq!(lines[1]["id"], head.trim());
        assert_eq!(lines[0]["author"], "gitowl Test");
        assert!(blame(p, "../x", "").is_err() && blame(p, "a.txt", "HEAD;rm").is_err());
        let entries = reflog(p).unwrap()["entries"].as_array().unwrap().clone();
        assert_eq!(entries[0]["id"], head.trim());
        assert!(entries[0]["message"].as_str().unwrap().contains("second"));
        assert!(entries[0]["time"].as_str().unwrap().parse::<u64>().is_ok());
        let first = entries[1]["id"].as_str().unwrap().to_owned();
        branch_at(p, "lost", &first).unwrap();
        assert_eq!(run(p, &["rev-parse", "lost"]).unwrap().trim(), first);
        assert!(branch_at(p, "-x", &first).is_err() && branch_at(p, "ok", "HEAD").is_err());
        // reset: modes, validation and the recovery point
        let tip = run(p, &["rev-parse", "HEAD"]).unwrap().trim().to_owned();
        assert!(reset_to(p, &first, "sideways").is_err() && reset_to(p, "HEAD~1", "soft").is_err());
        reset_to(p, &first, "soft").unwrap();
        assert_eq!(run(p, &["rev-parse", "HEAD"]).unwrap().trim(), first);
        assert!(
            run(p, &["diff", "--cached", "--name-only"])
                .unwrap()
                .contains("a.txt")
        );
        assert!(
            run(
                p,
                &[
                    "for-each-ref",
                    "--format=%(objectname)",
                    "refs/gitowl/recovery"
                ]
            )
            .unwrap()
            .contains(&tip)
        );
        assert!(reset_to(p, &tip, "hard").unwrap_err().contains("history"));
        reset_to(p, &first, "hard").unwrap();
        assert_eq!(
            std::fs::read_to_string(p.join("a.txt")).unwrap(),
            "one\ntwo\n"
        );
        assert_eq!(show_bytes(p, "HEAD:a.txt").unwrap(), b"one\ntwo\n");
        assert!(show_bytes(p, "HEAD:missing").is_none());
        std::fs::write(p.join("junk.log"), "x").unwrap();
        std::fs::create_dir(p.join("build")).unwrap();
        std::fs::write(p.join("build/out.o"), "x").unwrap();
        let preview = clean_preview(p).unwrap();
        assert_eq!(preview, vec!["build/".to_owned(), "junk.log".to_owned()]);
        assert!(clean(p, &["a.txt".to_owned()]).is_err());
        assert!(clean(p, &["../x".to_owned()]).is_err());
        clean(p, &["junk.log".to_owned()]).unwrap();
        assert!(!p.join("junk.log").exists() && p.join("build/out.o").exists());
        assert!(force_push_preview(p).unwrap_err().contains("no upstream"));
        assert!(difftool(p, "a.txt", false).is_err() || tools(p)["diff"] != "");
    }
    #[test]
    fn subfolder_and_path_validation() {
        let dir = repo();
        std::fs::create_dir(dir.path().join("nested")).unwrap();
        assert_eq!(
            root(&dir.path().join("nested")).unwrap(),
            std::fs::canonicalize(dir.path()).unwrap()
        );
        assert!(validate_file("../outside").is_err());
        assert!(validate_file(".git/config").is_err());
        assert!(validate_file("file with spaces.txt").is_ok());
    }
    #[test]
    fn conflict_resolution_checks_external_edits() {
        let dir = repo();
        let p = root(dir.path()).unwrap();
        std::fs::write(p.join("file.txt"), "base\n").unwrap();
        run(&p, &["add", "file.txt"]).unwrap();
        run(&p, &["commit", "-m", "base"]).unwrap();
        run(&p, &["branch", "-M", "main"]).unwrap();
        run(&p, &["switch", "-c", "other"]).unwrap();
        std::fs::write(p.join("file.txt"), "other\n").unwrap();
        run(&p, &["commit", "-am", "other"]).unwrap();
        run(&p, &["switch", "main"]).unwrap();
        std::fs::write(p.join("file.txt"), "ours\n").unwrap();
        run(&p, &["commit", "-am", "ours"]).unwrap();
        assert!(run(&p, &["merge", "other"]).is_err());
        let view = crate::conflict::read(&p, "file.txt").unwrap();
        assert_eq!(view["base"], "base\n");
        assert_eq!(view["ours"], "ours\n");
        let previous = view["result"].as_str().unwrap();
        let stages = view["stages"].as_str().unwrap();
        assert!(crate::conflict::save(&p, "file.txt", "stale", stages, "resolved\n").is_err());
        crate::conflict::save(&p, "file.txt", previous, stages, "ours\n").unwrap();
        assert!(run(&p, &["ls-files", "-u"]).unwrap().is_empty());
        let expected = fingerprint(&p).unwrap();
        commit(&p, "resolve merge", &expected).unwrap();
        assert_eq!(run(&p, &["show", "HEAD:file.txt"]).unwrap(), "ours\n");
    }
    #[test]
    fn discard_restores_tracked_and_removes_untracked_files() {
        let dir = repo();
        let p = root(dir.path()).unwrap();
        std::fs::write(p.join("tracked.txt"), "first\n").unwrap();
        run(&p, &["add", "tracked.txt"]).unwrap();
        run(&p, &["commit", "-m", "base"]).unwrap();
        std::fs::write(p.join("tracked.txt"), "second\n").unwrap();
        discard(&p, "tracked.txt").unwrap();
        assert_eq!(
            std::fs::read_to_string(p.join("tracked.txt")).unwrap(),
            "first\n"
        );
        std::fs::write(p.join("untracked.txt"), "later\n").unwrap();
        discard(&p, "untracked.txt").unwrap();
        assert!(!p.join("untracked.txt").exists());
        std::fs::write(p.join("staged.txt"), "new\n").unwrap();
        run(&p, &["add", "staged.txt"]).unwrap();
        discard(&p, "staged.txt").unwrap();
        assert!(!p.join("staged.txt").exists());
        assert!(
            run(&p, &["ls-files", "--", "staged.txt"])
                .unwrap()
                .is_empty()
        );
        assert!(discard(&p, "missing.txt").is_err());
    }

    #[test]
    fn discard_reverses_a_staged_rename() {
        let dir = repo();
        let p = root(dir.path()).unwrap();
        std::fs::write(p.join("old.txt"), "content\n").unwrap();
        run(&p, &["add", "old.txt"]).unwrap();
        run(&p, &["commit", "-m", "base"]).unwrap();
        run(&p, &["mv", "old.txt", "new.txt"]).unwrap();
        discard(&p, "new.txt").unwrap();
        assert!(p.join("old.txt").exists());
        assert!(!p.join("new.txt").exists());
        assert!(
            run(&p, &["status", "--porcelain"])
                .unwrap()
                .trim()
                .is_empty()
        );
    }

    #[test]
    fn staged_and_unstaged_versions_are_distinct() {
        let dir = repo();
        let p = root(dir.path()).unwrap();
        std::fs::write(p.join("space name.txt"), "base\n").unwrap();
        run(&p, &["add", "--", "space name.txt"]).unwrap();
        run(&p, &["commit", "-m", "base"]).unwrap();
        std::fs::write(p.join("space name.txt"), "staged\n").unwrap();
        run(&p, &["add", "--", "space name.txt"]).unwrap();
        std::fs::write(p.join("space name.txt"), "later\n").unwrap();
        assert!(
            diff(&p, "space name.txt", "staged")
                .unwrap()
                .contains("+staged")
        );
        assert!(
            diff(&p, "space name.txt", "working")
                .unwrap()
                .contains("+later")
        );
        let state = status(&p).unwrap();
        assert_eq!(state["files"][0]["code"], "MM");
        assert!(
            diff_with(&p, "space name.txt", "working", &["-U0"])
                .unwrap()
                .contains("@@ -1 +1 @@")
        );
        run(&p, &["restore", "--staged", "--", "space name.txt"]).unwrap();
        assert_eq!(
            std::fs::read_to_string(p.join("space name.txt")).unwrap(),
            "later\n"
        );
    }
}
