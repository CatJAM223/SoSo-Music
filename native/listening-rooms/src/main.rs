mod client;
mod domain;
mod internet;
mod relay;

use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

pub fn output(value: Value) {
    let mut stdout = io::stdout().lock();
    let _ = writeln!(stdout, "{value}");
    let _ = stdout.flush();
}

fn main() {
    // Session writes and command replies share stdout's lock.
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--relay") {
        let bind = args.get(2).map(String::as_str).unwrap_or("127.0.0.1:41337");
        match relay::Relay::start(bind) {
            Ok(relay) => {
                eprintln!("SoSo listening relay ready on {bind} (port {}). Use a TLS reverse proxy for internet access.", relay.port);
                loop {
                    std::thread::park();
                }
            }
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1);
            }
        }
    }
    let mut runtime = client::Runtime::default();
    // Bound each IPC frame before parsing; EOF disposes the network session.
    let mut stdin = io::stdin().lock();
    loop {
        let mut bytes = Vec::new();
        let read = std::io::Read::take(&mut stdin, 128 * 1024 + 1).read_until(b'\n', &mut bytes);
        if !matches!(read, Ok(n) if n > 0) || bytes.len() > 128 * 1024 {
            break;
        }
        let Ok(request) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        let id = request["id"].clone();
        let result = runtime.command(request["op"].as_str().unwrap_or(""), &request["payload"]);
        match result {
            Ok(result) => output(json!({"id":id,"result":result})),
            Err(error) => output(json!({"id":id,"error":error})),
        }
    }
}

// Check lifetime under the reply lock so an old worker cannot resurrect a
// session after the leave response has been written.
pub fn output_session(value: Value, stopping: &std::sync::atomic::AtomicBool) {
    let mut stdout = io::stdout().lock();
    if stopping.load(std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let _ = writeln!(stdout, "{value}");
    let _ = stdout.flush();
}
