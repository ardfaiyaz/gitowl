use crate::git::{self, Result};
use serde_json::{Value, json};
use std::{path::Path, process::Command};

struct Package {
    ecosystem: &'static str,
    manifest: &'static str,
    name: String,
    version: String,
    publishable: bool,
}

// shortcut: reads only top-level [package] name/version/publish lines, enough for ordinary manifests; use a TOML parser if workspaces need support.
fn cargo_package(text: &str) -> Option<Package> {
    let mut in_package = false;
    let (mut name, mut version, mut publishable) = (None, None, true);
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_package = line == "[package]";
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !in_package {
            continue;
        }
        let value = value.trim().trim_matches('"').to_owned();
        match key.trim() {
            "name" => name = Some(value),
            "version" => version = Some(value),
            "publish" => publishable = value != "false",
            _ => {}
        }
    }
    Some(Package {
        ecosystem: "cargo",
        manifest: "Cargo.toml",
        name: name?,
        version: version?,
        publishable,
    })
}

fn detect(path: &Path) -> Vec<Package> {
    let mut found = Vec::new();
    if let Ok(text) = std::fs::read_to_string(path.join("package.json"))
        && let Ok(v) = serde_json::from_str::<Value>(&text)
        && let (Some(name), Some(version)) = (v["name"].as_str(), v["version"].as_str())
    {
        found.push(Package {
            ecosystem: "npm",
            manifest: "package.json",
            name: name.to_owned(),
            version: version.to_owned(),
            publishable: v["private"] != true,
        });
    }
    if let Some(p) = std::fs::read_to_string(path.join("Cargo.toml"))
        .ok()
        .and_then(|t| cargo_package(&t))
    {
        found.push(p);
    }
    found
}

pub fn list(path: &Path) -> Value {
    json!({ "packages": detect(path).iter().map(|p| json!({
        "ecosystem": p.ecosystem, "manifest": p.manifest, "name": p.name,
        "version": p.version, "publishable": p.publishable,
    })).collect::<Vec<_>>() })
}

/// Publishes with the ecosystem's own tool and the developer's existing login. A real publish needs the exact name@version typed.
pub fn publish(path: &Path, request: &Value) -> Result<Value> {
    let ecosystem = request["ecosystem"].as_str().unwrap_or("");
    let dry_run = request["dryRun"].as_bool() != Some(false);
    let package = detect(path)
        .into_iter()
        .find(|p| p.ecosystem == ecosystem)
        .ok_or("No publishable package manifest for that ecosystem at the repository root.")?;
    if !package.publishable {
        return Err(format!(
            "{} marks this package as private.",
            package.manifest
        ));
    }
    let expected = format!("{}@{}", package.name, package.version);
    if !dry_run && request["confirm"].as_str() != Some(expected.as_str()) {
        return Err(format!("Type {expected} to confirm publishing."));
    }
    let program = match (ecosystem, cfg!(windows)) {
        ("npm", true) => "npm.cmd",
        ("npm", false) => "npm",
        _ => "cargo",
    };
    let mut command = Command::new(program);
    command.current_dir(path).arg("publish");
    if dry_run {
        command.arg("--dry-run");
    }
    let output = git::execute(command)?;
    Ok(json!({
        "output": output.trim(),
        "message": if dry_run {
            format!("Dry run for {expected} finished. Nothing was published.")
        } else {
            format!("Published {expected}. Registries do not allow re-publishing the same version.")
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_packages_and_requires_confirmation() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        std::fs::write(
            p.join("package.json"),
            r#"{"name":"demo-pkg","version":"1.2.3"}"#,
        )
        .unwrap();
        std::fs::write(
            p.join("Cargo.toml"),
            "[package]\nname = \"demo\"\nversion = \"0.1.0\"\npublish = false\n\n[dependencies]\nname = \"x\"\n",
        )
        .unwrap();
        let found = list(p);
        assert_eq!(found["packages"][0]["name"], "demo-pkg");
        assert_eq!(found["packages"][1]["version"], "0.1.0");
        assert_eq!(found["packages"][1]["publishable"], false);
        let unconfirmed = publish(
            p,
            &json!({"ecosystem": "npm", "dryRun": false, "confirm": "demo-pkg"}),
        );
        assert!(unconfirmed.unwrap_err().contains("demo-pkg@1.2.3"));
        assert!(
            publish(p, &json!({"ecosystem": "cargo"}))
                .unwrap_err()
                .contains("private")
        );
        assert!(publish(p, &json!({"ecosystem": "pip"})).is_err());
    }
}
