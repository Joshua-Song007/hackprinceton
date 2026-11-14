fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["open_panel_window", "install_plugin", "uninstall_plugin", "start_runtime", "stop_runtime"])),
    )
    .expect("failed to run tauri-build");
}
