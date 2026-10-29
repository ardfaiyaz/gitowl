use crate::git::{self, Result, run};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

pub struct Service {
    current: Option<PathBuf>,
}
// shortcut: "full context" is 100k lines either side; enough for any file under the 1 MB preview limit.
fn diff_options(r: &Value) -> Vec<&'static str> {
    let mut extra = Vec::new();
    if r["ignoreWhitespace"].as_bool() == Some(true) {
        extra.push("-w");
    }
    if r["fullContext"].as_bool() == Some(true) {
        extra.push("-U100000");
    }
    extra
}
fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
pub fn downloads() -> PathBuf {
    home().join("Downloads")
}
fn recent_file() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("XDG_CONFIG_HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".config"))
        .join("gitowl")
        .join("recent.json")
}
/// Recently opened projects, so switching does not need the folder picker. Never scans the device.
fn recent() -> Vec<String> {
    let file = recent_file();
    // Carry over the list saved under the app's previous name (Gityard) until the first save.
    let legacy = file
        .parent()
        .unwrap()
        .with_file_name("gityard")
        .join("recent.json");
    std::fs::read_to_string(&file)
        .or_else(|_| std::fs::read_to_string(legacy))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|p| Path::new(p).is_dir())
        .collect()
}
fn save_recent(list: &[String]) {
    let file = recent_file();
    // Best effort: a read-only profile must not prevent opening a project.
    let _ = std::fs::create_dir_all(file.parent().unwrap());
    let _ = std::fs::write(file, serde_json::to_string(list).unwrap_or_default());
}
pub fn remember(path: &Path) {
    let path = git::display(path);
    let mut list = recent();
    list.retain(|p| *p != path);
    list.insert(0, path);
    list.truncate(12);
    save_recent(&list);
}
fn roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        ('C'..='Z')
            .map(|c| PathBuf::from(format!("{c}:\\")))
            .filter(|p| p.exists())
            .collect()
    }
    #[cfg(not(windows))]
    {
        vec![PathBuf::from("/")]
    }
}
impl Service {
    pub fn new(current: Option<PathBuf>) -> Self {
        Self { current }
    }
    pub fn execute(&mut self, request: Value) -> Result<Value> {
        let op = text(&request, "op");
        match op {
            "bootstrap" => {
                return Ok(
                    json!({"repo":self.current.as_ref().map(|p|git::display(p)), "home":git::display(&home()), "recent":recent()}),
                );
            }
            "open" => {
                let path = git::root(Path::new(text(&request, "path")))?;
                self.current = Some(path.clone());
                remember(&path);
                return git::status(&path);
            }
            "init_repo" => {
                let name = text(&request, "name").trim();
                if name.is_empty()
                    || name.len() > 100
                    || name.starts_with(['.', '-'])
                    || !name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
                {
                    return Err(
                        "Use letters, numbers, dashes, dots or underscores for the name.".into(),
                    );
                }
                let parent = PathBuf::from(text(&request, "location"));
                if !parent.is_dir() {
                    return Err("Choose an existing folder for the location.".into());
                }
                if git::root(&parent).is_ok() {
                    return Err(
                        "That location is inside another repository. Choose a folder outside it."
                            .into(),
                    );
                }
                let dir = parent.join(name);
                // Never write into a folder that already has files in it.
                if dir.exists()
                    && std::fs::read_dir(&dir)
                        .map(|mut d| d.next().is_some())
                        .unwrap_or(true)
                {
                    return Err("That folder already exists and isn't empty.".into());
                }
                // Fetch templates before creating anything, so a failure leaves no half-made folder.
                let gitignore = match text(&request, "gitignore") {
                    "" => None,
                    t => Some(crate::github::template("gitignore", t)?),
                };
                let license = match text(&request, "license") {
                    "" => None,
                    t => Some(crate::github::template("license", t)?),
                };
                let write = |file: &str, body: &str| {
                    std::fs::write(dir.join(file), body).map_err(|e| e.to_string())
                };
                std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                run(&dir, &["init", "-b", "main"])?;
                if request["readme"].as_bool().unwrap_or(false) {
                    write("README.md", &format!("# {name}\n"))?;
                }
                if let Some(body) = gitignore {
                    write(".gitignore", &body)?;
                }
                if let Some(body) = license {
                    let owner = run(&dir, &["config", "user.name"]).unwrap_or_default();
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| 1970 + d.as_secs() / 31_556_952)
                        .unwrap_or(2026);
                    write(
                        "LICENSE",
                        &body
                            .replace("[year]", &now.to_string())
                            .replace("[fullname]", owner.trim()),
                    )?;
                }
                run(&dir, &["add", "-A"])?;
                let message = match run(&dir, &["commit", "-m", "Initial commit"]) {
                    Ok(_) => "Created the repository with a first commit.",
                    Err(_) => {
                        "Created the repository. Set your Git name and email in Settings, then make the first commit."
                    }
                };
                return Ok(json!({ "path": git::display(&dir), "message": message }));
            }
            "recent_forget" => {
                let mut list = recent();
                list.retain(|p| p != text(&request, "path"));
                save_recent(&list);
                return Ok(json!({ "recent": list }));
            }
            "browse" => {
                let path = if text(&request, "path").is_empty() {
                    home()
                } else {
                    PathBuf::from(text(&request, "path"))
                };
                let path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
                let mut dirs: Vec<_> = std::fs::read_dir(&path).map_err(|e|e.to_string())?.filter_map(|e|e.ok())
                    .filter(|e|e.file_type().is_ok_and(|t| t.is_dir())).map(|e|json!({"name":e.file_name().to_string_lossy(), "path":git::display(&e.path())})).collect();
                dirs.sort_by_key(|e| text(e, "name").to_lowercase());
                return Ok(
                    json!({"path":git::display(&path), "parent":path.parent().map(git::display), "directories":dirs, "roots":roots().iter().map(|p|git::display(p)).collect::<Vec<_>>()}),
                );
            }
            _ => {
                if let Some(result) = crate::github::account(op, &request) {
                    return result;
                }
            }
        }
        let path = self.current.clone().ok_or("Open a repository first.")?;
        if text(&request, "repo") != git::display(&path) {
            return Err(
                "The active project changed. Reopen this project before continuing.".into(),
            );
        }
        let file = text(&request, "file");
        let output = match op {
            "status" => return git::status(&path),
            "commit_edit_preview" => {
                return crate::commit_edit::preview(
                    &path,
                    request["includeStaged"].as_bool().unwrap_or(false),
                );
            }
            "rewrite_preview" => return crate::rewrite::preview(&path, text(&request, "target")),
            "rewrite_edit" => return crate::rewrite::edit(&path, &request),
            "rewrite_restore" => return crate::rewrite::restore(&path, &request),
            "rewrite_plan" => return crate::rewrite::plan(&path, &request),
            "recovery_list" => return crate::commit_edit::recovery_list(&path),
            "recovery_branch" => crate::commit_edit::recovery_branch(
                &path,
                text(&request, "reference"),
                text(&request, "branch"),
            )?,
            "recovery_delete" => {
                crate::commit_edit::recovery_delete(&path, text(&request, "reference"))?
            }
            "compare" => {
                return crate::branches::compare(
                    &path,
                    text(&request, "base"),
                    text(&request, "target"),
                );
            }
            "hunk" => crate::hunks::apply(
                &path,
                file,
                text(&request, "mode"),
                request["index"].as_u64().unwrap_or(u64::MAX) as usize,
                request["lines"]
                    .as_array()
                    .map(|l| {
                        l.iter()
                            .filter_map(|v| v.as_u64().map(|n| n as usize))
                            .collect::<Vec<_>>()
                    })
                    .as_deref(),
                text(&request, "previous"),
            )?,
            "conflict_take" => crate::conflict::take(&path, file, text(&request, "side"))?,
            "packages" => return Ok(crate::packages::list(&path)),
            "package_publish" => return crate::packages::publish(&path, &request),
            gh if gh.starts_with("gh_") => return crate::github::execute(&path, gh, &request),
            "commit_edit" => return crate::commit_edit::edit(&path, &request),
            "commit_edit_restore" => return crate::commit_edit::restore(&path, &request),
            "branches" => return crate::branches::list(&path),
            "checkout_remote" => crate::branches::checkout(
                &path,
                text(&request, "reference"),
                text(&request, "branch"),
            )?,
            "publish" => {
                crate::branches::publish(&path, text(&request, "remote"), text(&request, "branch"))?
            }
            "conflict_read" => return crate::conflict::read(&path, file),
            "conflict_save" => crate::conflict::save(
                &path,
                file,
                text(&request, "previous"),
                text(&request, "stages"),
                text(&request, "content"),
            )?,
            "diff" => {
                let extra = diff_options(&request);
                return Ok(
                    json!({"text":git::diff_with(&path,file,text(&request,"mode"),&extra)?}),
                );
            }
            "blame" => return git::blame(&path, file, text(&request, "id")),
            "reflog" => return git::reflog(&path),
            "branch_at" => git::branch_at(&path, text(&request, "branch"), text(&request, "id"))?,
            "stage" | "unstage" => {
                git::validate_file(file)?;
                if op == "stage" {
                    run(&path, &["add", "--", file])?
                } else if run(&path, &["rev-parse", "HEAD"]).is_ok() {
                    run(&path, &["restore", "--staged", "--", file])?
                } else {
                    run(&path, &["rm", "--cached", "--", file])?
                }
            }
            "stage_all" => {
                if git::has_conflicts(&path)? {
                    return Err("Resolve conflicts before staging all files.".into());
                }
                run(&path, &["add", "--all"])?;
                "Staged all changed and untracked files.".to_owned()
            }
            "unstage_all" => {
                if git::has_conflicts(&path)? {
                    return Err("Resolve conflicts before unstaging all files.".into());
                }
                if run(&path, &["rev-parse", "HEAD"]).is_ok() {
                    run(&path, &["restore", "--staged", "--", "."])?;
                } else if !run(&path, &["ls-files"])?.trim().is_empty() {
                    run(&path, &["rm", "--cached", "-r", "--", "."])?;
                }
                "Moved all changes out of the next commit.".to_owned()
            }
            "discard" => git::discard(&path, file)?,
            "stash_list" => return crate::stash::list(&path),
            "stash_save" => crate::stash::save(
                &path,
                text(&request, "message"),
                request["includeUntracked"].as_bool().unwrap_or(false),
            )?,
            "stash_pop" => crate::stash::pop(&path, request["index"].as_u64().unwrap_or(u64::MAX))?,
            "commit" => {
                let mut message = text(&request, "message").trim_end().to_owned();
                let co: Vec<&str> = request["coAuthors"]
                    .as_array()
                    .map(|a| a.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                for person in &co {
                    // "Name <email>" on one line, as GitHub expects in a Co-authored-by trailer.
                    let ok = person.contains(" <")
                        && person.ends_with('>')
                        && !person.contains(['\n', '\r']);
                    if !ok {
                        return Err(format!("Write each co-author as Name <email>: {person}"));
                    }
                }
                if !co.is_empty() && !message.is_empty() {
                    message.push_str("\n\n");
                    message.push_str(
                        &co.iter()
                            .map(|p| format!("Co-authored-by: {p}"))
                            .collect::<Vec<_>>()
                            .join("\n"),
                    );
                }
                git::commit(&path, &message, text(&request, "fingerprint"))?
            }
            "clean_preview" => return Ok(json!({ "files": git::clean_preview(&path)? })),
            "clean" => {
                let files: Vec<String> = request["files"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default();
                git::clean(&path, &files)?
            }
            "lfs_info" => {
                let files: Vec<String> = request["files"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|v| v.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default();
                return git::lfs_info(&path, &files);
            }
            "lfs_track" => git::lfs_track(&path, file)?,
            "tools" => return Ok(git::tools(&path)),
            "reset" => git::reset_to(&path, text(&request, "id"), text(&request, "mode"))?,
            "signing_status" => return Ok(git::signing_status(&path)),
            "signing_set" => git::signing_set(&path, request["enable"].as_bool() == Some(true))?,
            "difftool" => git::difftool(&path, file, text(&request, "mode") == "staged")?,
            "force_push_preview" => return git::force_push_preview(&path),
            "force_push" => git::force_push(&path, text(&request, "confirm"))?,
            "image_pair" => {
                git::validate_file(file)?;
                let mime = match file
                    .rsplit('.')
                    .next()
                    .unwrap_or("")
                    .to_ascii_lowercase()
                    .as_str()
                {
                    "png" => "image/png",
                    "jpg" | "jpeg" => "image/jpeg",
                    "gif" => "image/gif",
                    "webp" => "image/webp",
                    "bmp" => "image/bmp",
                    "ico" => "image/x-icon",
                    _ => {
                        return Err(
                            "Only PNG, JPEG, GIF, WebP, BMP and ICO images can be compared.".into(),
                        );
                    }
                };
                let staged = text(&request, "mode") == "staged";
                let old = git::show_bytes(
                    &path,
                    &format!("{}:{file}", if staged { "HEAD" } else { "" }),
                );
                let new = if staged {
                    git::show_bytes(&path, &format!(":{file}"))
                } else {
                    std::fs::read(path.join(file)).ok()
                };
                let url = |b: Option<Vec<u8>>| {
                    b.filter(|b| b.len() <= 10 * 1024 * 1024).map(|b| json!({"url": format!("data:{mime};base64,{}", git::base64(&b)), "bytes": b.len()}))
                };
                return Ok(json!({ "old": url(old), "new": url(new) }));
            }
            "undo_commit" | "revert" | "cherry_pick" => {
                let state = git::status(&path)?;
                if state["merging"].as_bool().unwrap_or(false)
                    || state["rebasing"].as_bool().unwrap_or(false)
                {
                    return Err("Finish or abort the current merge or rebase first.".into());
                }
                if op == "undo_commit" {
                    let head = run(&path, &["rev-parse", "HEAD"])?.trim().to_owned();
                    run(&path, &["rev-parse", "--verify", "HEAD~1"]).map_err(
                        |_| "This is the first commit, so there is nothing to undo it onto.",
                    )?;
                    if run(
                        &path,
                        &["merge-base", "--is-ancestor", "HEAD", "@{upstream}"],
                    )
                    .is_ok()
                    {
                        return Err("This commit is already pushed. Revert it instead, so collaborators keep the same history.".into());
                    }
                    let recovery =
                        format!("refs/gitowl/recovery/{head}/{:016x}", rand::random::<u64>());
                    run(&path, &["update-ref", &recovery, &head, ""])?;
                    run(&path, &["reset", "--soft", "HEAD~1"])?;
                    "Undid the last commit. Its changes are staged again, and a recovery point was saved.".to_owned()
                } else {
                    let id = text(&request, "id");
                    if !(4..=64).contains(&id.len()) || !id.chars().all(|c| c.is_ascii_hexdigit()) {
                        return Err("Choose a commit first.".into());
                    }
                    let cmd = if op == "revert" {
                        "revert"
                    } else {
                        "cherry-pick"
                    };
                    if let Err(error) = run(&path, &[cmd, "--no-edit", id]) {
                        // shortcut: conflicts are rolled back, not resolved in-app; add a conflict flow if people hit this often.
                        let _ = run(&path, &[cmd, "--abort"]);
                        return Err(format!("Git stopped, so nothing was changed.\n{error}"));
                    }
                    if op == "revert" {
                        "Reverted the commit with a new commit.".to_owned()
                    } else {
                        "Copied the commit onto this branch.".to_owned()
                    }
                }
            }
            "open_in" => {
                // Paths and URLs go as one argument to a program, never through a shell.
                let target = text(&request, "target");
                let url = text(&request, "url");
                if target == "url"
                    && !(url.starts_with("https://github.com/")
                        && !url.chars().any(|c| c.is_whitespace() || c == '"'))
                {
                    return Err("Only github.com links can be opened.".into());
                }
                let program = match (target, std::env::consts::OS) {
                    ("terminal", os) => {
                        open_terminal(&path, os)?;
                        return Ok(json!({"message": "Opened a terminal in the repository."}));
                    }
                    ("folder" | "url", "windows") => "explorer",
                    ("folder" | "url", "macos") => "open",
                    ("folder" | "url", _) => "xdg-open",
                    // The editor is the Settings choice: VS Code, Zed, or a program path (run directly, no shell).
                    ("editor", os) => match text(&request, "editor").trim() {
                        "" | "code" if os == "windows" => "code.cmd",
                        "" | "code" => "code",
                        "zed" => "zed",
                        custom
                            if !custom.contains('"') && !custom.chars().any(char::is_control) =>
                        {
                            custom
                        }
                        _ => return Err("Choose an editor program in Settings.".into()),
                    },
                    _ => return Err("Unknown place to open.".into()),
                };
                std::process::Command::new(program)
                    .arg(if target == "url" {
                        std::ffi::OsStr::new(url)
                    } else {
                        path.as_os_str()
                    })
                    .spawn()
                    .map_err(|e| format!("Couldn't start {program}: {e}"))?;
                "Opened.".to_owned()
            }
            "history" => {
                if run(&path, &["rev-parse", "HEAD"]).is_err() {
                    return Ok(json!({"commits":[],"more":false}));
                }
                let skip = request["page"].as_u64().unwrap_or(0).min(100_000) * 40;
                let skip = format!("--skip={skip}");
                let mut args = vec![
                    "log",
                    "-41",
                    &skip,
                    "--format=%x1e%H%x00%an%x00%ae%x00%at%x00%G?%x00%s%x00",
                    "--fixed-strings",
                    "--regexp-ignore-case",
                ];
                let query = format!("--grep={}", text(&request, "query"));
                let author = format!("--author={}", text(&request, "author"));
                let since = format!("--since={}", text(&request, "since"));
                if !text(&request, "query").is_empty() {
                    args.push(&query);
                }
                if !text(&request, "author").is_empty() {
                    args.push(&author);
                }
                if !text(&request, "since").is_empty() {
                    args.push(&since);
                }
                args.push("HEAD");
                args.push("--");
                if !file.is_empty() {
                    git::validate_file(file)?;
                    // Follow renames; --name-only reports the file's path in each commit.
                    args.splice(2..2, ["--follow", "--name-only"]);
                    args.push(file);
                }
                let raw = run(&path, &args)?;
                let commits: Vec<_> = raw
                    .split('\u{1e}')
                    .filter_map(|record| {
                        let c: Vec<_> = record.splitn(7, '\0').collect();
                        // %G?: G good, U good but untrusted key, N unsigned; anything else is signed but unverifiable.
                        (c.len() == 7).then(|| json!({"id":c[0].trim(),"author":c[1],"email":c[2],"time":c[3],"signature":c[4],"message":c[5],"path":c[6].trim()}))
                    })
                    .collect();
                return Ok(
                    json!({"more":commits.len()>40,"commits":commits.into_iter().take(40).collect::<Vec<_>>()}),
                );
            }
            "commit_diff" => {
                let id = text(&request, "id");
                if id.len() < 4 || id.len() > 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Err("Enter a valid commit hash.".into());
                }
                let extra = diff_options(&request);
                let mut args = vec![
                    "show",
                    "--format=fuller",
                    "--first-parent",
                    "--no-ext-diff",
                    "--no-textconv",
                ];
                args.extend(&extra);
                args.extend([id, "--"]);
                if !file.is_empty() {
                    git::validate_file(file)?;
                    args.push(file);
                }
                return Ok(json!({"text":run(&path,&args)?}));
            }
            "switch" | "create_branch" | "merge" => {
                let branch = text(&request, "branch");
                if branch.starts_with('-') {
                    return Err("Invalid branch name.".into());
                }
                run(&path, &["check-ref-format", "--branch", branch])?;
                match op {
                    "switch" => run(&path, &["switch", branch])?,
                    "create_branch" => {
                        crate::branches::create(&path, branch, text(&request, "base"))?
                    }
                    _ => run(&path, &["merge", "--no-edit", branch])?,
                }
            }
            "branch_rename" => {
                crate::branches::rename(&path, text(&request, "branch"), text(&request, "newName"))?
            }
            "branch_delete" => crate::branches::delete(&path, text(&request, "branch"))?,
            "merge_abort" => run(&path, &["merge", "--abort"])?,
            "rebase_continue" => {
                run(&path, &["rebase", "--continue"])?;
                "Continued the rebase. Review the branch tip before pushing.".to_owned()
            }
            "rebase_abort" => {
                run(&path, &["rebase", "--abort"])?;
                "Aborted the rebase and restored the previous branch tip.".to_owned()
            }
            "fetch" => run(&path, &["fetch", "--all"])?,
            "pull" => {
                let flag = match text(&request, "mode") {
                    "" | "ff" | "fast-forward" => "--ff-only",
                    "merge" => "--no-rebase",
                    "rebase" => "--rebase",
                    _ => return Err("Choose fast-forward, merge, or rebase.".into()),
                };
                run(&path, &["pull", flag])?
            }
            "push" => run(&path, &["push"])?,
            "identity" => {
                let name = text(&request, "name");
                let email = text(&request, "email");
                if name.trim().is_empty()
                    || email.trim().is_empty()
                    || name.contains(['\n', '\r'])
                    || email.contains(['\n', '\r'])
                {
                    return Err("Enter a name and email without line breaks.".into());
                }
                run(&path, &["config", "--local", "user.name", name])?;
                run(&path, &["config", "--local", "user.email", email])?
            }
            "ignore_read" | "ignore_save" => {
                let target = path.join(".gitignore");
                if std::fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) {
                    return Err("Editing a linked .gitignore is not supported.".into());
                }
                let old = if target.exists() {
                    std::fs::read_to_string(&target).map_err(|e| e.to_string())?
                } else {
                    String::new()
                };
                if op == "ignore_read" {
                    return Ok(json!({"text":old}));
                }
                if old != text(&request, "previous") {
                    return Err(
                        ".gitignore changed externally. Reopen the editor before saving.".into(),
                    );
                }
                std::fs::write(target, text(&request, "content")).map_err(|e| e.to_string())?;
                "Saved .gitignore. Review and stage it in Changes.".into()
            }
            "tag" => crate::tags::create(&path, text(&request, "tag"), text(&request, "message"))?,
            "tag_delete" => crate::tags::delete(&path, text(&request, "tag"))?,
            "tag_push" => {
                crate::tags::push(&path, text(&request, "remote"), text(&request, "tag"))?
            }
            "remote_add" => {
                crate::remotes::add(&path, text(&request, "name"), text(&request, "url"))?
            }
            "remote_set_url" => {
                crate::remotes::set_url(&path, text(&request, "name"), text(&request, "url"))?
            }
            "remote_remove" => crate::remotes::remove(&path, text(&request, "name"))?,
            _ => return Err("Unknown operation.".into()),
        };
        Ok(json!({"message":if output.trim().is_empty() { "Done." } else { output.trim() }}))
    }
}

/// A terminal window in `path`: Windows Terminal or cmd, Terminal.app, or the Linux default. No shell strings.
fn open_terminal(path: &Path, os: &str) -> Result<()> {
    let spawn = |program: &str, args: &[&std::ffi::OsStr]| {
        std::process::Command::new(program)
            .args(args)
            .current_dir(path)
            .spawn()
            .map(|_| ())
    };
    let dir = path.as_os_str();
    let started = match os {
        "windows" => spawn("wt", &["-d".as_ref(), dir]).or_else(|_| {
            spawn(
                "cmd",
                &["/C".as_ref(), "start".as_ref(), "".as_ref(), "cmd".as_ref()],
            )
        }),
        "macos" => spawn("open", &["-a".as_ref(), "Terminal".as_ref(), dir]),
        _ => spawn("x-terminal-emulator", &[]),
    };
    started.map_err(|e| format!("Couldn't open a terminal: {e}"))
}
#[cfg(test)]
mod tests {
    use super::*;

    fn configure(path: &Path) {
        run(path, &["config", "user.name", "gitowl Test"]).unwrap();
        run(path, &["config", "user.email", "test@example.invalid"]).unwrap();
        run(path, &["config", "core.autocrlf", "false"]).unwrap();
        run(path, &["config", "commit.gpgsign", "false"]).unwrap();
    }

    fn commit(path: &Path, file: &str, content: &str, message: &str) {
        std::fs::write(path.join(file), content).unwrap();
        run(path, &["add", "--", file]).unwrap();
        run(path, &["commit", "-m", message]).unwrap();
    }

    fn call(service: &mut Service, repo: &Path, op: &str, data: Value) -> Result<Value> {
        let mut request = data;
        request["op"] = json!(op);
        request["repo"] = json!(git::display(repo));
        service.execute(request)
    }

    #[test]
    fn init_repo_creates_and_refuses_unsafe_targets() {
        let dir = tempfile::tempdir().unwrap();
        let base = std::fs::canonicalize(dir.path()).unwrap();
        let mut service = Service::new(None);
        let init = |s: &mut Service, name: &str, location: &Path| {
            s.execute(json!({"op": "init_repo", "name": name, "location": git::display(location), "readme": true}))
        };
        let made = init(&mut service, "weather-cli", &base).unwrap();
        let path = PathBuf::from(made["path"].as_str().unwrap());
        assert!(path.join(".git").exists());
        assert_eq!(
            std::fs::read_to_string(path.join("README.md")).unwrap(),
            "# weather-cli\n"
        );
        assert!(
            init(&mut service, "weather-cli", &base).is_err(),
            "non-empty folder"
        );
        assert!(
            init(&mut service, "nested", &path).is_err(),
            "inside a repository"
        );
        assert!(
            init(&mut service, "../escape", &base).is_err(),
            "path in name"
        );
        assert!(
            init(&mut service, "ok", &base.join("missing")).is_err(),
            "missing location"
        );
    }

    #[test]
    fn undo_revert_and_cherry_pick() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().to_path_buf();
        run(&repo, &["init", "-b", "main"]).unwrap();
        configure(&repo);
        commit(&repo, "a.txt", "one\n", "First");
        let mut service = Service::new(Some(repo.clone()));
        assert!(
            call(&mut service, &repo, "undo_commit", json!({})).is_err(),
            "root commit can't be undone"
        );

        commit(&repo, "a.txt", "two\n", "Second");
        call(&mut service, &repo, "undo_commit", json!({})).unwrap();
        assert_eq!(
            run(&repo, &["log", "-1", "--format=%s"]).unwrap().trim(),
            "First"
        );
        assert_eq!(
            run(&repo, &["diff", "--cached", "--name-only"])
                .unwrap()
                .trim(),
            "a.txt"
        );
        assert!(
            !run(&repo, &["for-each-ref", "refs/gitowl/recovery"])
                .unwrap()
                .trim()
                .is_empty()
        );

        run(&repo, &["commit", "-m", "Second again"]).unwrap();
        let second = run(&repo, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_owned();
        call(&mut service, &repo, "revert", json!({"id": second})).unwrap();
        assert_eq!(
            std::fs::read_to_string(repo.join("a.txt")).unwrap(),
            "one\n"
        );

        // A conflicting cherry-pick is rolled back and leaves nothing half-applied.
        run(&repo, &["switch", "-c", "side", "HEAD~2"]).unwrap();
        commit(&repo, "a.txt", "side\n", "Side");
        let side = run(&repo, &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_owned();
        run(&repo, &["switch", "main"]).unwrap();
        commit(&repo, "a.txt", "main\n", "Main");
        assert!(call(&mut service, &repo, "cherry_pick", json!({"id": side})).is_err());
        assert!(run(&repo, &["rev-parse", "--verify", "CHERRY_PICK_HEAD"]).is_err());
        assert!(
            run(&repo, &["status", "--porcelain"])
                .unwrap()
                .trim()
                .is_empty()
        );
        assert!(call(&mut service, &repo, "revert", json!({"id": "HEAD; rm"})).is_err());
        for url in [
            "file:///C:/Windows",
            "https://github.com.evil.io/x",
            "https://github.com/a b",
        ] {
            assert!(
                call(
                    &mut service,
                    &repo,
                    "open_in",
                    json!({"target": "url", "url": url})
                )
                .is_err(),
                "{url}"
            );
        }
    }

    #[test]
    fn history_paginates_and_filters() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().to_path_buf();
        run(&repo, &["init", "-b", "main"]).unwrap();
        configure(&repo);
        commit(&repo, "tracked.txt", "one\n", "Add tracked file");
        for i in 0..43 {
            run(
                &repo,
                &["commit", "--allow-empty", "-m", &format!("Filler {i}")],
            )
            .unwrap();
        }
        run(
            &repo,
            &[
                "-c",
                "user.name=Other Person",
                "commit",
                "--allow-empty",
                "-m",
                "Needle message",
            ],
        )
        .unwrap();
        let mut service = Service::new(Some(repo.clone()));
        let mut history = |data: Value| call(&mut service, &repo, "history", data).unwrap();
        let messages = |v: &Value| {
            v["commits"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c["message"].as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        };

        let first = history(json!({}));
        assert_eq!(messages(&first).len(), 40);
        assert_eq!(first["more"], true);
        let second = history(json!({"page":1}));
        assert_eq!(messages(&second).len(), 5);
        assert_eq!(second["more"], false);
        assert_eq!(
            messages(&history(json!({"query":"needle"}))),
            ["Needle message"]
        );
        assert_eq!(
            messages(&history(json!({"author":"Other"}))),
            ["Needle message"]
        );
        assert_eq!(
            messages(&history(json!({"file":"tracked.txt"}))),
            ["Add tracked file"]
        );
        assert!(messages(&history(json!({"since":"2099-01-01"}))).is_empty());
        assert_eq!(messages(&history(json!({"since":"2000-01-01"}))).len(), 40);
        run(&repo, &["mv", "tracked.txt", "renamed.txt"]).unwrap();
        run(&repo, &["commit", "-m", "Rename file"]).unwrap();
        let followed = history(json!({"file":"renamed.txt"}));
        assert_eq!(messages(&followed), ["Rename file", "Add tracked file"]);
        assert_eq!(followed["commits"][1]["path"], "tracked.txt");
    }

    #[test]
    fn pull_strategies_and_rebase_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let bare = dir.path().join("remote.git");
        let repo = dir.path().join("local");
        let clone = dir.path().join("clone");
        run(
            dir.path(),
            &["init", "--bare", "-b", "main", bare.to_str().unwrap()],
        )
        .unwrap();
        std::fs::create_dir(&repo).unwrap();
        run(&repo, &["init", "-b", "main"]).unwrap();
        configure(&repo);
        commit(&repo, "shared.txt", "base\n", "Initial");
        run(&repo, &["remote", "add", "origin", bare.to_str().unwrap()]).unwrap();
        run(&repo, &["push", "--set-upstream", "origin", "main"]).unwrap();
        run(
            dir.path(),
            &["clone", bare.to_str().unwrap(), clone.to_str().unwrap()],
        )
        .unwrap();
        configure(&clone);
        run(&clone, &["config", "core.autocrlf", "false"]).unwrap();
        let reset_clone = || {
            run(&clone, &["fetch", "origin"]).unwrap();
            run(&clone, &["reset", "--hard", "origin/main"]).unwrap();
        };
        let mut service = Service::new(Some(repo.clone()));

        reset_clone();
        commit(&clone, "ff.txt", "remote\n", "Fast-forward change");
        run(&clone, &["push", "origin", "main"]).unwrap();
        call(&mut service, &repo, "pull", json!({"mode":"ff"})).unwrap();
        assert!(repo.join("ff.txt").exists());

        reset_clone();
        commit(&clone, "merge-remote.txt", "remote\n", "Merge remote");
        run(&clone, &["push", "origin", "main"]).unwrap();
        commit(&repo, "merge-local.txt", "local\n", "Merge local");
        call(&mut service, &repo, "pull", json!({"mode":"merge"})).unwrap();
        assert!(repo.join("merge-remote.txt").exists());
        assert_eq!(
            run(&repo, &["rev-list", "--parents", "-n", "1", "HEAD"])
                .unwrap()
                .split_whitespace()
                .count(),
            3
        );

        reset_clone();
        commit(&clone, "rebase-remote.txt", "remote\n", "Rebase remote");
        run(&clone, &["push", "origin", "main"]).unwrap();
        commit(&repo, "rebase-local.txt", "local\n", "Rebase local");
        call(&mut service, &repo, "pull", json!({"mode":"rebase"})).unwrap();
        assert!(repo.join("rebase-remote.txt").exists());
        assert_eq!(
            run(&repo, &["rev-list", "--parents", "-n", "1", "HEAD"])
                .unwrap()
                .split_whitespace()
                .count(),
            2
        );
        let log = run(&repo, &["log", "--format=%s", "-4"]).unwrap();
        assert!(log.contains("Rebase local"));
        assert!(log.contains("Rebase remote"));

        reset_clone();
        commit(&clone, "conflict.txt", "remote\n", "Remote conflict");
        run(&clone, &["push", "origin", "main"]).unwrap();
        commit(&repo, "conflict.txt", "local\n", "Local conflict");
        assert!(call(&mut service, &repo, "pull", json!({"mode":"rebase"})).is_err());
        assert!(git::status(&repo).unwrap()["rebasing"].as_bool().unwrap());
        std::fs::write(repo.join("conflict.txt"), "resolved\n").unwrap();
        run(&repo, &["add", "conflict.txt"]).unwrap();
        call(&mut service, &repo, "rebase_continue", json!({})).unwrap();
        assert!(!git::status(&repo).unwrap()["rebasing"].as_bool().unwrap());
        assert_eq!(
            std::fs::read_to_string(repo.join("conflict.txt")).unwrap(),
            "resolved\n"
        );
        let log = run(&repo, &["log", "--format=%s", "-4"]).unwrap();
        assert!(log.contains("Local conflict"));
        assert!(log.contains("Remote conflict"));

        reset_clone();
        commit(&clone, "conflict.txt", "remote-2\n", "Remote conflict 2");
        run(&clone, &["push", "origin", "main"]).unwrap();
        commit(&repo, "conflict.txt", "local-2\n", "Local conflict 2");
        assert!(call(&mut service, &repo, "pull", json!({"mode":"rebase"})).is_err());
        assert!(git::status(&repo).unwrap()["rebasing"].as_bool().unwrap());
        call(&mut service, &repo, "rebase_abort", json!({})).unwrap();
        assert!(!git::status(&repo).unwrap()["rebasing"].as_bool().unwrap());
        assert_eq!(
            run(&repo, &["log", "--format=%s", "-1"]).unwrap().trim(),
            "Local conflict 2"
        );
        assert_eq!(
            std::fs::read_to_string(repo.join("conflict.txt")).unwrap(),
            "local-2\n"
        );
    }
}
