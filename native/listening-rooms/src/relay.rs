use crate::domain::{label, Member, Playback, Room};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io,
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tungstenite::{accept_with_config, protocol::WebSocketConfig, Message};

type Rooms = Arc<Mutex<HashMap<String, Room>>>;

pub fn random_key() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "random_failed".to_string())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

pub fn retryable(error: &tungstenite::Error) -> bool {
    matches!(error, tungstenite::Error::Io(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut | io::ErrorKind::Interrupted))
}

pub fn ws_config() -> WebSocketConfig {
    let mut config = WebSocketConfig::default();
    config.max_message_size = Some(64 * 1024);
    config.max_frame_size = Some(64 * 1024);
    config
}

pub struct Relay {
    pub port: u16,
    stop: Arc<AtomicBool>,
}

impl Drop for Relay {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Relay {
    pub fn start(bind: &str) -> Result<Self, String> {
        let listener = TcpListener::bind(bind).map_err(|_| "relay_bind_failed".to_string())?;
        let port = listener
            .local_addr()
            .map_err(|_| "relay_bind_failed".to_string())?
            .port();
        listener
            .set_nonblocking(true)
            .map_err(|_| "relay_bind_failed".to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let rooms: Rooms = Arc::new(Mutex::new(HashMap::new()));
        let active = Arc::new(AtomicUsize::new(0));
        thread::spawn(move || {
            while !stopping.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if active.load(Ordering::Relaxed) >= 64 {
                            continue;
                        }
                        active.fetch_add(1, Ordering::Relaxed);
                        let rooms = rooms.clone();
                        let active = active.clone();
                        let stop = stopping.clone();
                        thread::spawn(move || {
                            serve(stream, rooms, stop);
                            active.fetch_sub(1, Ordering::Relaxed);
                        });
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(20))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self { port, stop })
    }
}

fn serve(stream: std::net::TcpStream, rooms: Rooms, stop: Arc<AtomicBool>) {
    // Accepted sockets inherit the listener's nonblocking mode on Windows.
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(4)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
    let _ = stream.set_nodelay(true);
    let Ok(mut ws) = accept_with_config(stream, Some(ws_config())) else {
        return;
    };
    let Ok(Message::Text(first)) = ws.read() else {
        return;
    };
    let Ok(hello) = serde_json::from_str::<Value>(&first) else {
        return;
    };
    let Ok(member_name) = label(hello.get("displayName").and_then(Value::as_str), "Listener")
    else {
        return;
    };
    let Ok(id) = random_key() else {
        return;
    };
    let is_host = hello["op"] == "create";
    let code = if is_host {
        random_key().unwrap_or_default()
    } else {
        hello["code"].as_str().unwrap_or_default().to_string()
    };
    let setup = (|| -> Result<(), String> {
        if hello["version"] != 1 || code.len() != 32 || !code.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("invalid_invitation".into());
        }
        let mut guard = rooms.lock().unwrap();
        if is_host {
            if guard.len() >= 64 {
                return Err("relay_full".into());
            }
            guard.insert(
                code.clone(),
                Room {
                    name: label(hello["name"].as_str(), "SoSo room")?,
                    host_id: id.clone(),
                    members: vec![Member {
                        id: id.clone(),
                        name: member_name,
                        is_host: true,
                    }],
                    playback: Playback::default(),
                    anchor: Instant::now(),
                    revision: 0,
                    heartbeat: Instant::now(),
                    waiting_for: Default::default(),
                },
            );
        } else if hello["op"] == "join" {
            guard
                .get_mut(&code)
                .ok_or("room_not_found")?
                .add_member(Member {
                    id: id.clone(),
                    name: member_name,
                    is_host: false,
                })?;
        } else {
            return Err("invalid_command".into());
        }
        Ok(())
    })();
    if let Err(error) = setup {
        let _ = ws.send(Message::text(json!({"error":error}).to_string()));
        let _ = ws.close(None);
        return;
    }
    let _ = ws
        .get_mut()
        .set_read_timeout(Some(Duration::from_millis(100)));
    let mut sent = Instant::now() - Duration::from_secs(1);
    let mut activity = Instant::now();
    let mut seen_revision = u64::MAX;
    while !stop.load(Ordering::Relaxed) && activity.elapsed() < Duration::from_secs(90) {
        let snapshot = {
            let mut guard = rooms.lock().unwrap();
            guard.get_mut(&code).map(|room| {
                let playback = room.snapshot_playback();
                (
                    room.revision,
                    json!({
                        "type":"snapshot", "code":code, "name":room.name,
                        "selfId":id, "role":if is_host { "host" } else { "guest" },
                        "members":room.members, "revision":room.revision,
                        "playback":playback,
                    }),
                )
            })
        };
        let Some((revision, data)) = snapshot else {
            let _ = ws.send(Message::text(json!({"error":"room_closed"}).to_string()));
            break;
        };
        if sent.elapsed() >= Duration::from_millis(500) || seen_revision != revision {
            if ws.send(Message::text(data.to_string())).is_err() {
                break;
            }
            sent = Instant::now();
            seen_revision = revision;
        }
        match ws.read() {
            Ok(Message::Text(text)) => {
                activity = Instant::now();
                let Ok(message) = serde_json::from_str::<Value>(&text) else {
                    break;
                };
                match message["op"].as_str() {
                    Some("command") => {
                        let result = rooms
                            .lock()
                            .unwrap()
                            .get_mut(&code)
                            .ok_or("room_closed".to_string())
                            .and_then(|room| room.command(&id, &message["payload"]));
                        let reply = match result {
                            Ok(()) => {
                                json!({"type":"commandResult","requestId":message["requestId"],"ok":true})
                            }
                            Err(error) => {
                                json!({"type":"commandResult","requestId":message["requestId"],"error":error})
                            }
                        };
                        if ws.send(Message::text(reply.to_string())).is_err() {
                            break;
                        }
                    }
                    Some("pulse") => {
                        if let Some(room) = rooms.lock().unwrap().get_mut(&code) {
                            room.pulse(&id, &message["payload"]);
                        }
                    }
                    Some("publish") => {
                        let _ = ws.send(Message::text(json!({"error":"host_only"}).to_string()));
                    }
                    Some("ping") => {
                        if ws
                            .send(Message::text(json!({"type":"pong"}).to_string()))
                            .is_err()
                        {
                            break;
                        }
                    }
                    _ => break,
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(ref e) if retryable(e) => {}
            Err(_) => break,
        }
    }
    {
        let mut guard = rooms.lock().unwrap();
        if is_host {
            guard.remove(&code);
        } else if let Some(room) = guard.get_mut(&code) {
            room.members.retain(|member| member.id != id);
            room.waiting_for.remove(&id);
        }
    }
    let _ = ws.close(None);
}
