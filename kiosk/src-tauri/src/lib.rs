use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;

struct Sidecar(Mutex<Option<Child>>);

const KIOSK_PORT: u16 = 4003;

fn log_line(msg: &str) {
  use std::io::Write;
  let path = std::env::temp_dir().join("printflow-kiosk.log");
  if let Ok(mut f) = std::fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(path)
  {
    let _ = writeln!(f, "{msg}");
  }
}

fn strip_verbatim(path: std::path::PathBuf) -> std::path::PathBuf {
  let s = path.to_string_lossy();
  match s.strip_prefix(r"\\?\") {
    Some(stripped) => std::path::PathBuf::from(stripped),
    None => path,
  }
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
  let start = Instant::now();
  while start.elapsed() < timeout {
    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
      return true;
    }
    std::thread::sleep(Duration::from_millis(250));
  }
  false
}

fn kill_sidecar(app: &tauri::AppHandle) {
  if let Some(sidecar) = app.try_state::<Sidecar>() {
    if let Some(child) = sidecar.0.lock().unwrap().as_mut() {
      let _ = child.kill();
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(Sidecar(std::sync::Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let resource_dir = strip_verbatim(app.path().resource_dir()?);
      let cache_dir = app
        .path()
        .app_cache_dir()
        .map(strip_verbatim)
        .unwrap_or_else(|_| std::env::temp_dir().join("printflow-kiosk"));
      let _ = std::fs::create_dir_all(&cache_dir);
      // Config opcional do kiosk em ~/.config/com.printflow.kiosk/.env
      let env_file = app
        .path()
        .app_config_dir()
        .map(|d| strip_verbatim(d).join(".env"))
        .unwrap_or_else(|_| resource_dir.join(".env"));

      let port = std::env::var("KIOSK_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(KIOSK_PORT);

      let already_running = TcpStream::connect(("127.0.0.1", port)).is_ok();
      if !already_running {
        let script = resource_dir.join("server-kiosk.js");
        log_line(&format!(
          "spawning sidecar: script={:?} exists={} cache={:?}",
          script,
          script.exists(),
          cache_dir
        ));

        let child = Command::new("node")
          .arg(&script)
          .current_dir(&resource_dir)
          .env("KIOSK_CACHE_DIR", &cache_dir)
          .env("KIOSK_ENV_FILE", &env_file)
          .stdout(std::process::Stdio::inherit())
          .stderr(std::process::Stdio::inherit())
          .spawn()
          .expect("failed to start kiosk sidecar (node server-kiosk.js)");

        *app.state::<Sidecar>().0.lock().unwrap() = Some(child);
      }

      let ready = wait_for_port(port, std::time::Duration::from_secs(30));
      log_line(&format!("sidecar port {} ready={}", port, ready));
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
      }

      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        kill_sidecar(window.app_handle());
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        kill_sidecar(app);
      }
    });
}
