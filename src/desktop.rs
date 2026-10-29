use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::run_return::EventLoopExtRunReturn,
    window::{Icon, WindowBuilder},
};
use wry::{NewWindowResponse, WebViewBuilder};

pub fn run(url: &str, runtime: &tokio::runtime::Runtime) -> Result<(), Box<dyn std::error::Error>> {
    let mut event_loop = EventLoopBuilder::<()>::with_user_event().build();
    // Owl app icon as raw 64×64 RGBA (rendered from assets/brand/gitowl-mark.svg).
    let icon = Icon::from_rgba(
        include_bytes!("../assets/brand/window-icon-64.rgba").to_vec(),
        64,
        64,
    )
    .ok();
    let window = WindowBuilder::new()
        .with_title("gitowl")
        .with_window_icon(icon)
        .with_inner_size(LogicalSize::new(1280.0, 850.0))
        .with_min_inner_size(LogicalSize::new(640.0, 480.0))
        .build(&event_loop)?;
    let allowed = format!("{}/", url.split("/#").next().unwrap_or(url));
    let builder = WebViewBuilder::new()
        .with_url(url)
        .with_incognito(true)
        .with_devtools(false)
        .with_navigation_handler(move |target| target.starts_with(&allowed))
        .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
        .with_ipc_handler(|request| {
            if matches!(
                request.body().as_str(),
                "ready:repository" | "ready:welcome"
            ) {
                println!("gitowl desktop {}", request.body());
            }
        });
    #[cfg(not(target_os = "linux"))]
    let webview = builder.build(&window)?;
    #[cfg(target_os = "linux")]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        builder.build_gtk(window.gtk_window())?
    };
    let proxy = event_loop.create_proxy();
    let signal = runtime.spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            let _ = proxy.send_event(());
        }
    });
    println!("gitowl desktop opened. Close the window to exit.");
    event_loop.run_return(|event, _, flow| {
        *flow = ControlFlow::Wait;
        if matches!(
            event,
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } | Event::UserEvent(())
        ) {
            *flow = ControlFlow::Exit;
        }
    });
    signal.abort();
    drop(webview);
    drop(window);
    Ok(())
}
