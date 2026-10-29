use clap::Args;
use reqwest::blocking::Client;
use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
    time::Duration,
};

type Result<T> = std::result::Result<T, String>;
const MAX_PACKAGE: u64 = 256 * 1024 * 1024;

#[derive(Args, Debug)]
pub struct Options {
    /// Check for a newer version without downloading or launching anything.
    #[arg(long, conflicts_with = "download_only")]
    pub check: bool,
    /// Download and verify the latest stable package, without launching it.
    #[arg(long)]
    pub download_only: bool,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
}

fn repository_slug(repository: &str) -> Result<&str> {
    let slug = repository
        .strip_prefix("https://github.com/")
        .unwrap_or("")
        .trim_end_matches(".git");
    let parts: Vec<_> = slug.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || [".", ".."].contains(part)
                || !part
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
    {
        return Err("This build has no valid GitHub release repository configured.".into());
    }
    Ok(slug)
}

fn release_version(release: &Release) -> Result<Version> {
    let version = Version::parse(
        release
            .tag_name
            .strip_prefix('v')
            .unwrap_or(&release.tag_name),
    )
    .map_err(|_| "GitHub returned an invalid release version.".to_owned())?;
    if release.draft || release.prerelease || !version.pre.is_empty() {
        return Err("The latest release is not a published stable version.".into());
    }
    Ok(version)
}

fn package_name(version: &Version, os: &str, arch: &str) -> Result<String> {
    match (os, arch) {
        ("windows", "x86_64") => Ok(format!("gitowl-{version}-windows-setup.exe")),
        ("macos", "aarch64") => Ok(format!("gitowl-v{version}-macos.dmg")),
        ("linux", "x86_64") => Ok(format!("gitowl-v{version}-x86_64-unknown-linux-gnu.tar.gz")),
        _ => Err(format!(
            "No update package is published for {os}/{arch}. See the release page for supported platforms."
        )),
    }
}

fn asset<'a>(release: &'a Release, slug: &str, name: &str, limit: u64) -> Result<&'a Asset> {
    let mut matches = release.assets.iter().filter(|asset| asset.name == name);
    let item = matches
        .next()
        .ok_or_else(|| format!("The release is missing {name}. Nothing was installed."))?;
    if matches.next().is_some() || item.size == 0 || item.size > limit {
        return Err(format!(
            "The release contains an invalid package: {name}. Nothing was installed."
        ));
    }
    if item.browser_download_url
        != format!(
            "https://github.com/{slug}/releases/download/{}/{name}",
            release.tag_name
        )
    {
        return Err("The download URL does not match the configured GitHub repository. Nothing was installed.".into());
    }
    Ok(item)
}

fn bounded_read(reader: impl Read, limit: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Couldn't read the download: {e}"))?;
    if bytes.len() as u64 > limit {
        return Err("The download exceeded its allowed size.".into());
    }
    Ok(bytes)
}

fn response(client: &Client, url: &str) -> Result<reqwest::blocking::Response> {
    let response = client.get(url).send().map_err(|e| {
        format!("Couldn't contact GitHub: {e}. Check your connection and try again.")
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "GitHub returned HTTP {status}. Try again later or download the update from GitHub Releases."
        ));
    }
    Ok(response)
}

fn checksum(bytes: &[u8], name: &str) -> Result<String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Invalid checksum file.".to_owned())?;
    let fields: Vec<_> = text.split_whitespace().collect();
    if fields.len() != 2
        || fields[0].len() != 64
        || !fields[0].bytes().all(|c| c.is_ascii_hexdigit())
        || fields[1].strip_prefix('*').unwrap_or(fields[1]) != name
    {
        return Err("The SHA-256 checksum file is invalid or names a different package. Nothing was installed.".into());
    }
    Ok(fields[0].to_ascii_lowercase())
}

fn download(
    mut reader: impl Read,
    mut file: File,
    expected_size: u64,
    expected_hash: &str,
) -> Result<()> {
    let mut hash = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|e| format!("Download interrupted: {e}. Nothing was installed."))?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > expected_size || total > MAX_PACKAGE {
            return Err("The package exceeded its expected size. Nothing was installed.".into());
        }
        file.write_all(&buffer[..count])
            .map_err(|e| format!("Couldn't save the update: {e}"))?;
        hash.update(&buffer[..count]);
    }
    if total != expected_size || format!("{:x}", hash.finalize()) != expected_hash {
        return Err("The download failed SHA-256 verification. Nothing was installed. Try downloading again.".into());
    }
    file.sync_all()
        .map_err(|e| format!("Couldn't save the verified update: {e}"))
}

#[cfg(windows)]
fn launch(path: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let file: Vec<_> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let args: Vec<_> = "/SP- /NORESTART".encode_utf16().chain(Some(0)).collect();
    // Uses Setup's normal UAC prompt, and doesn't interpolate a shell command.
    // SAFETY: both UTF-16 buffers are NUL-terminated and live throughout the call;
    // the null window, verb and working directory are documented optional arguments.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(),
            file.as_ptr(),
            args.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as usize <= 32 {
        return Err(format!(
            "Couldn't open Windows Setup (code {}). Run the verified installer manually: {}",
            result as usize,
            path.display()
        ));
    }
    println!(
        "Windows Setup opened. Close other gitowl windows and complete the wizard to upgrade."
    );
    Ok(())
}

#[cfg(target_os = "macos")]
fn launch(path: &Path) -> Result<()> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg(path)
        .status()
        .map_err(|e| {
            format!(
                "Couldn't open the disk image: {e}. Open {} manually.",
                path.display()
            )
        })?;
    if !status.success() {
        return Err(format!(
            "Couldn't open the disk image. Open {} manually.",
            path.display()
        ));
    }
    println!(
        "Disk image opened. Quit gitowl, then drag gitowl to Applications and choose Replace."
    );
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn launch(path: &Path) -> Result<()> {
    println!(
        "Extract {} and replace your existing gitowl binary using your original installation method.",
        path.display()
    );
    println!(
        "If you installed the Debian package, install the latest .deb from the release page instead."
    );
    Ok(())
}

pub fn run(options: Options) -> Result<()> {
    let slug = repository_slug(env!("CARGO_PKG_REPOSITORY"))?;
    let current = Version::parse(env!("CARGO_PKG_VERSION")).map_err(|e| e.to_string())?;
    println!("Checking GitHub Releases for gitowl updates…");
    let client = Client::builder()
        .user_agent(format!("gitowl-updater/{current}"))
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;
    let metadata = bounded_read(
        response(
            &client,
            &format!("https://api.github.com/repos/{slug}/releases/latest"),
        )?,
        1024 * 1024,
    )?;
    let release: Release = serde_json::from_slice(&metadata)
        .map_err(|e| format!("GitHub returned invalid release metadata: {e}"))?;
    let latest = release_version(&release)?;
    let url = format!(
        "https://github.com/{slug}/releases/tag/{}",
        release.tag_name
    );
    println!("Installed: {current}\nLatest:    {latest}\n{url}");
    if latest <= current && !options.download_only {
        println!("gitowl is up to date. Nothing was installed.");
        return Ok(());
    }
    if options.check {
        return Ok(());
    }
    let name = package_name(&latest, std::env::consts::OS, std::env::consts::ARCH)?;
    let package = asset(&release, slug, &name, MAX_PACKAGE)?;
    let checksum_name = format!("{name}.sha256");
    let checksum_asset = asset(&release, slug, &checksum_name, 4096)?;
    let checksum_bytes = bounded_read(
        response(&client, &checksum_asset.browser_download_url)?,
        4096,
    )?;
    let expected_hash = checksum(&checksum_bytes, &name)?;
    let staging = tempfile::Builder::new()
        .prefix("gitowl-update-")
        .tempdir()
        .map_err(|e| format!("Couldn't create an update folder: {e}"))?;
    let path = staging.path().join(&name);
    println!("Downloading {name}…");
    let file = File::options()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    download(
        response(&client, &package.browser_download_url)?,
        file,
        package.size,
        &expected_hash,
    )?;
    std::fs::write(staging.path().join(checksum_name), checksum_bytes)
        .map_err(|e| e.to_string())?;
    // Keep the verified installer alive after this process exits and unlocks gitowl.exe.
    let folder = staging.keep();
    let path = folder.join(name);
    println!("SHA-256 verified. Saved to {}", path.display());
    if options.download_only {
        return Ok(());
    }
    launch(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_versions_platforms_and_download_origin() {
        let mut release = Release {
            tag_name: "v1.0.1".into(),
            draft: false,
            prerelease: false,
            assets: vec![],
        };
        let version = release_version(&release).unwrap();
        assert!(version > Version::new(1, 0, 0));
        assert_eq!(
            package_name(&version, "windows", "x86_64").unwrap(),
            "gitowl-1.0.1-windows-setup.exe"
        );
        assert!(package_name(&version, "macos", "x86_64").is_err());
        assert!(
            package_name(&version, "linux", "x86_64")
                .unwrap()
                .ends_with(".tar.gz")
        );
        assert!(
            package_name(&version, "macos", "aarch64")
                .unwrap()
                .ends_with(".dmg")
        );
        assert!(repository_slug("https://example.com/owner/repo").is_err());
        assert!(repository_slug("https://github.com/../repo").is_err());
        let name = "gitowl-1.0.1-windows-setup.exe";
        release.assets.push(Asset {
            name: name.into(),
            browser_download_url: "https://example.com/installer.exe".into(),
            size: 3,
        });
        assert!(asset(&release, "owner/repo", name, MAX_PACKAGE).is_err());
        release.assets[0].browser_download_url =
            format!("https://github.com/owner/repo/releases/download/v1.0.1/{name}");
        assert!(asset(&release, "owner/repo", name, MAX_PACKAGE).is_ok());
        release.tag_name = "v1.1.0-rc.1".into();
        assert!(release_version(&release).is_err());
        release.tag_name = "../../malicious".into();
        assert!(release_version(&release).is_err());
    }

    #[test]
    fn rejects_corrupt_truncated_oversized_and_mislabeled_packages() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"verified package";
        let hash = format!("{:x}", Sha256::digest(bytes));
        let file = || File::create(dir.path().join("package")).unwrap();
        assert!(download(&bytes[..], file(), bytes.len() as u64, &hash).is_ok());
        assert!(download(&b"corrupt package!"[..], file(), bytes.len() as u64, &hash).is_err());
        assert!(download(&bytes[..3], file(), bytes.len() as u64, &hash).is_err());
        assert!(download(&bytes[..], file(), 3, &hash).is_err());
        assert_eq!(
            checksum(format!("{hash}  setup.exe\r\n").as_bytes(), "setup.exe").unwrap(),
            hash
        );
        assert!(checksum(format!("{hash}  other.exe").as_bytes(), "setup.exe").is_err());
        assert!(checksum(b"bad-hash setup.exe", "setup.exe").is_err());
        assert!(bounded_read(&bytes[..], 3).is_err());
    }
}
