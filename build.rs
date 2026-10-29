fn main() {
    println!("cargo:rerun-if-changed=assets/brand/gitowl.ico");
    // Embed the owl icon in gitowl.exe so Explorer, the Start menu and the installer show it.
    #[cfg(windows)]
    {
        let mut resource = winresource::WindowsResource::new();
        resource.set_icon("assets/brand/gitowl.ico");
        resource.compile().expect("embed the Windows icon resource");
    }
}
