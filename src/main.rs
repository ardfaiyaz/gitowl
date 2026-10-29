mod activity;
mod branches;
mod commit_edit;
mod conflict;
#[cfg(feature = "desktop")]
mod desktop;
mod git;
mod github;
mod hunks;
mod packages;
mod remotes;
mod rewrite;
mod service;
mod stash;
mod tags;
mod update;

use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode, Uri},
    response::Response,
    routing::post,
};
use clap::{Parser, Subcommand};
use rust_embed::RustEmbed;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::Mutex;

#[derive(Parser)]
#[command(
    version,
    args_conflicts_with_subcommands = true,
    about = "Your local Git workspace. One command, a clearer view."
)]
struct Cli {
    #[command(subcommand)]
    command: Option<CliCommand>,
    /// Repository or a folder inside it. Defaults to the current directory.
    path: Option<PathBuf>,
    /// Port for the local server; 0 picks a free port.
    #[arg(long, default_value_t = 0)]
    port: u16,
    /// Run only the local server (for development and automated checks).
    #[arg(long)]
    no_browser: bool,
    /// Show the Open folder screen instead of opening the current repository.
    #[arg(long)]
    library: bool,
}

#[derive(Subcommand)]
enum CliCommand {
    /// Check GitHub Releases and download a verified upgrade; opens Setup on Windows.
    Update(update::Options),
}

#[cfg(test)]
mod cli_tests {
    use super::*;

    #[test]
    fn update_options_are_separate_from_repository_and_server_arguments() {
        let cli = Cli::try_parse_from(["gitowl", "update", "--check"]).unwrap();
        assert!(cli.path.is_none());
        assert!(matches!(
            cli.command,
            Some(CliCommand::Update(update::Options {
                check: true,
                download_only: false
            }))
        ));
        let cli = Cli::try_parse_from(["gitowl", "./update"]).unwrap();
        assert_eq!(cli.path, Some(PathBuf::from("./update")));
        assert!(cli.command.is_none());
        assert!(Cli::try_parse_from(["gitowl", "update", "--check", "--download-only"]).is_err());
        // An existing GUI/server argument makes this a repository path, preserving old invocations.
        let cli = Cli::try_parse_from(["gitowl", "--no-browser", "update"]).unwrap();
        assert!(cli.command.is_none());
        assert_eq!(cli.path, Some(PathBuf::from("update")));
    }
}

#[derive(RustEmbed)]
#[folder = "frontend/dist/"]
struct Assets;

#[derive(Clone)]
struct App {
    service: Arc<Mutex<service::Service>>,
    token: String,
    origin: String,
}

async fn action(
    State(app): State<App>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let authorized =
        headers.get("x-gitowl-token").and_then(|v| v.to_str().ok()) == Some(&app.token);
    let origin_ok = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .is_none_or(|v| v == app.origin);
    let host_ok =
        headers.get("host").and_then(|v| v.to_str().ok()) == app.origin.strip_prefix("http://");
    if !authorized || !origin_ok || !host_ok {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error":"Session rejected. Open the URL printed by gitowl."})),
        ));
    }
    let guard = app.service.lock_owned().await;
    let result = tokio::task::spawn_blocking(move || {
        let mut service = guard;
        service.execute(request)
    })
    .await;
    match result {
        Ok(Ok(value)) => Ok(Json(value)),
        Ok(Err(error)) => Err((StatusCode::BAD_REQUEST, Json(json!({"error":error})))),
        Err(error) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":error.to_string()})),
        )),
    }
}

async fn asset(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match Assets::get(path) {
        Some(file) => Response::builder()
            .header("Content-Type", mime_guess::from_path(path).first_or_octet_stream().as_ref())
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("Referrer-Policy", "no-referrer")
            .header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
            .body(Body::from(file.data.into_owned())).unwrap(),
        None => Response::builder().status(404).body(Body::from("Not found")).unwrap(),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    if let Some(CliCommand::Update(options)) = cli.command {
        return update::run(options).map_err(Into::into);
    }
    tracing_subscriber::fmt()
        .with_env_filter("gitowl=info")
        .init();
    git::check_git().map_err(std::io::Error::other)?;
    let path = cli.path.clone().unwrap_or(std::env::current_dir()?);
    let initial = if cli.library {
        None
    } else {
        match git::root(&path) {
            Ok(root) => Some(root),
            Err(error) if cli.path.is_some() => return Err(std::io::Error::other(error).into()),
            Err(_) => None,
        }
    };
    if let Some(root) = &initial {
        service::remember(root);
    }
    let runtime = tokio::runtime::Runtime::new()?;
    let listener = runtime.block_on(tokio::net::TcpListener::bind((
        std::net::Ipv4Addr::LOCALHOST,
        cli.port,
    )))?;
    let origin = format!("http://127.0.0.1:{}", listener.local_addr()?.port());
    let token: String = rand::random::<[u8; 32]>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let url = format!("{origin}/#token={token}");
    let state = App {
        service: Arc::new(Mutex::new(service::Service::new(initial))),
        token,
        origin,
    };
    let router = Router::new()
        .route("/api/action", post(action))
        .fallback(asset)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .with_state(state);
    if cli.no_browser {
        println!("\n  gitowl development server\n\n  {url}\n\n  Press Ctrl+C to stop.\n");
        runtime.block_on(async {
            axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = tokio::signal::ctrl_c().await;
                })
                .await
        })?;
        return Ok(());
    }
    #[cfg(feature = "desktop")]
    {
        let (shutdown, stopped) = tokio::sync::oneshot::channel();
        let server = runtime.spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await
        });
        let result = desktop::run(&url, &runtime);
        let _ = shutdown.send(());
        // Allow any Git action in progress to finish before exiting.
        runtime.block_on(server)??;
        result?;
    }
    #[cfg(not(feature = "desktop"))]
    return Err(std::io::Error::other("This build has no desktop window. Use --no-browser for server checks, or rebuild with default features.").into());
    #[cfg(feature = "desktop")]
    Ok(())
}
