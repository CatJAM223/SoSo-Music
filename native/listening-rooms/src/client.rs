use crate::{
    domain::{label, Member, Playback, Song},
    internet::Internet,
    output_session,
    relay::{retryable, ws_config, Relay},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    net::{IpAddr, Ipv4Addr, TcpStream, ToSocketAddrs},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tungstenite::{client_tls_with_config, stream::MaybeTlsStream, Message};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    code: String,
    name: String,
    self_id: String,
    role: String,
    members: Vec<Member>,
    revision: u64,
    #[serde(default)]
    seek_revision: u64,
    playback: Playback,
}

struct State {
    snapshot: Option<Snapshot>,
    received: Instant,
    latency: f64,
    endpoint: String,
    error: Option<String>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            snapshot: None,
            received: Instant::now(),
            latency: 0.0,
            endpoint: String::new(),
            error: None,
        }
    }
}
impl State {
    fn playback(&self, snapshot: &Snapshot) -> Playback {
        let elapsed = self.received.elapsed().as_secs_f64();
        let mut playback = snapshot.playback.projected(elapsed.min(4.0) + self.latency);
        if elapsed > 4.0 {
            // Retain the room during transport recovery, but never keep playing
            // from an unconfirmed clock when its host is no longer reachable.
            playback.playing = false;
            playback.preparing = false;
        }
        playback
    }
    fn view(&self) -> Value {
        match &self.snapshot {
            None => json!({"status":"idle","error":self.error}),
            Some(snapshot) => json!({
                "status":"connected", "name":snapshot.name, "selfId":snapshot.self_id,
                "role":snapshot.role,"members":snapshot.members,"revision":snapshot.revision,
                "playback":self.playback(snapshot),
                "invitation":invitation(&self.endpoint, &snapshot.code),
                "latencyMs":(self.latency * 2000.0).round(), "error":self.error,
            }),
        }
    }
}

pub fn invitation(endpoint: &str, code: &str) -> String {
    let encoded: String = endpoint
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    format!("SOSO1.{encoded}.{code}")
}
pub fn parse_invitation(value: &str) -> Result<(String, String), String> {
    if value.len() > 2048 {
        return Err("invalid_invitation".into());
    }
    let parts: Vec<_> = value.trim().split('.').collect();
    if parts.len() != 3
        || parts[0] != "SOSO1"
        || parts[1].len() % 2 != 0
        || !parts[1].bytes().all(|b| b.is_ascii_hexdigit())
        || parts[2].len() != 32
        || !parts[2].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("invalid_invitation".into());
    }
    let decoded: Result<Vec<_>, _> = (0..parts[1].len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&parts[1][i..i + 2], 16))
        .collect();
    let endpoint = String::from_utf8(decoded.map_err(|_| "invalid_invitation")?)
        .map_err(|_| "invalid_invitation")?;
    validate_endpoint(&endpoint)?;
    Ok((endpoint, parts[2].to_string()))
}

fn trusted_ip(ip: Ipv4Addr) -> bool {
    let b = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || b[0] == 26
        || (b[0] == 100 && (64..=127).contains(&b[1]))
}
fn validate_endpoint(endpoint: &str) -> Result<(), String> {
    if endpoint.len() > 800 {
        return Err("invalid_relay".into());
    }
    let parsed = url::Url::parse(endpoint).map_err(|_| "invalid_relay")?;
    if parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err("invalid_relay".into());
    }
    if parsed.scheme() == "iroh" {
        crate::internet::parse(endpoint)?;
        return Ok(());
    }
    match parsed.scheme() {
        "wss" => Ok(()),
        "ws" if parsed.host_str() == Some("localhost")
            || parsed
                .host_str()
                .and_then(|h| h.parse::<Ipv4Addr>().ok())
                .is_some_and(trusted_ip) =>
        {
            Ok(())
        }
        _ => Err("secure_relay_required".into()),
    }
}

fn networks() -> Vec<String> {
    let mut result: Vec<String> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .iter()
        .filter_map(|iface| match iface.ip() {
            IpAddr::V4(ip) if !ip.is_loopback() && trusted_ip(ip) => Some(ip.to_string()),
            _ => None,
        })
        .collect();
    result.sort();
    result.dedup();
    result
}

struct Connection {
    stop: Arc<AtomicBool>,
    sender: mpsc::SyncSender<Value>,
    _relay: Option<Relay>,
    _internet: Option<Internet>,
    replies: mpsc::Receiver<Value>,
}
impl Drop for Connection {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

#[derive(Default)]
pub struct Runtime {
    state: Arc<Mutex<State>>,
    connection: Option<Connection>,
    sequence: u64,
    prepared_entry: Option<String>,
}

impl Runtime {
    pub fn command(&mut self, op: &str, payload: &Value) -> Result<Value, String> {
        match op {
            "status" => Ok(self.state.lock().unwrap().view()),
            "networks" => Ok(json!(networks())),
            "create" | "join" => self.connect(op, payload),
            "leave" => {
                self.prepared_entry = None;
                self.connection = None;
                self.state = Arc::new(Mutex::new(State::default()));
                Ok(self.state.lock().unwrap().view())
            }
            "pulse" => {
                self.connection
                    .as_ref()
                    .ok_or("not_connected")?
                    .sender
                    .try_send(json!({"op":"pulse","payload":payload}))
                    .map_err(|_| "connection_busy")?;
                Ok(Value::Null)
            }
            "command" => {
                self.sequence += 1;
                let id = self.sequence;
                let connection = self.connection.as_ref().ok_or("not_connected")?;
                connection
                    .sender
                    .try_send(json!({"op":"command","requestId":id,"payload":payload}))
                    .map_err(|_| "connection_busy")?;
                let deadline = Instant::now() + Duration::from_secs(5);
                loop {
                    let result = connection
                        .replies
                        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                        .map_err(|_| "room_command_timeout")?;
                    if result["requestId"] != id {
                        continue;
                    }
                    if let Some(error) = result["error"].as_str() {
                        return Err(error.into());
                    }
                    return Ok(Value::Null);
                }
            }
            "synchronize" => {
                let state = self.state.lock().unwrap();
                let Some(snapshot) = &state.snapshot else {
                    return Ok(json!({"action":"none"}));
                };
                let mut playback = state.playback(snapshot);
                let local_position = payload["position"]
                    .as_f64()
                    .filter(|v| v.is_finite())
                    .unwrap_or(0.0);
                let pending_seek =
                    payload["seekRevision"].as_u64().unwrap_or_default() != snapshot.seek_revision;
                let action = match &playback.track {
                    None if payload["playing"] == true || payload["loading"] == true => "pause",
                    None => "none",
                    Some(track)
                        if payload["id"] != track.id
                            || payload["source"] != track.source
                            || payload["entryId"].as_str() != track.entry_id.as_deref() =>
                    {
                        if playback.preparing {
                            "buffer"
                        } else if playback.playing {
                            "load"
                        } else {
                            "prepare"
                        }
                    }
                    Some(_) if !playback.playing && payload["loading"] == true => "pause",
                    Some(_) if payload["loading"] == true => "none",
                    Some(_) if payload["blocked"] == true => "none",
                    Some(_) if playback.preparing && payload["ready"] != true => "buffer",
                    Some(_) if playback.preparing => "none",
                    Some(track)
                        if track.duration == 0.0
                            && pending_seek
                            && (playback.playing || payload["playing"] == false) =>
                    {
                        "seek"
                    }
                    // Wait for the relay to apply the host's completion pulse.
                    Some(track)
                        if track.duration == 0.0
                            && playback.playing
                            && payload["ended"] == true =>
                    {
                        "none"
                    }
                    Some(_) if payload["playing"] != playback.playing => {
                        if playback.playing {
                            "play"
                        } else {
                            "pause"
                        }
                    }
                    Some(_) if (local_position - playback.position).abs() > 1.2 => "seek",
                    _ => "none",
                };
                if action == "buffer" {
                    self.prepared_entry = playback
                        .track
                        .as_ref()
                        .and_then(|track| track.entry_id.clone());
                } else if action == "play"
                    && self.prepared_entry.as_deref()
                        == playback
                            .track
                            .as_ref()
                            .and_then(|track| track.entry_id.as_deref())
                {
                    // Prepared listeners hear the intro, rather than seeking over the
                    // few hundred milliseconds used to deliver the shared start.
                    if playback.position < 1.2 {
                        playback.position = 0.0;
                    }
                    self.prepared_entry = None;
                }
                if !playback.playing {
                    self.prepared_entry = None;
                }
                let local_queue = serde_json::from_value::<Vec<Song>>(payload["queue"].clone())
                    .unwrap_or_default();
                let replace_queue = local_queue != playback.queue;
                Ok(json!({
                    "action":action, "playback":playback, "replaceQueue":replace_queue,
                    "seekRevision":snapshot.seek_revision,
                }))
            }
            _ => Err("invalid_command".into()),
        }
    }

    fn connect(&mut self, op: &str, payload: &Value) -> Result<Value, String> {
        if self.state.lock().unwrap().snapshot.is_none() {
            self.connection = None;
        }
        if self.connection.is_some() {
            return Err("already_connected".into());
        }
        let display_name = label(payload["displayName"].as_str(), "Listener")?;
        let mut local_relay = None;
        let mut internet = None;
        let automatic = op == "create" && payload["mode"] == "internet";
        let (endpoint, code) = if op == "join" {
            parse_invitation(payload["invitation"].as_str().ok_or("invalid_invitation")?)?
        } else if automatic {
            let relay = Relay::start("127.0.0.1:0")?;
            let endpoint = format!("ws://127.0.0.1:{}/", relay.port);
            local_relay = Some(relay);
            (endpoint, String::new())
        } else if payload["mode"] == "local" {
            let available = networks();
            let address = match payload["address"].as_str().filter(|s| !s.is_empty()) {
                Some(requested) => available
                    .iter()
                    .find(|ip| ip.as_str() == requested)
                    .map(String::as_str),
                None => available.first().map(String::as_str),
            }
            .ok_or("no_local_network")?;
            let relay = Relay::start(&format!("{address}:0"))?;
            let endpoint = format!("ws://{address}:{}/", relay.port);
            local_relay = Some(relay);
            (endpoint, String::new())
        } else {
            let endpoint = payload["relay"].as_str().unwrap_or("").trim().to_string();
            validate_endpoint(&endpoint)?;
            (endpoint, String::new())
        };
        let transport_endpoint = if endpoint.starts_with("iroh://") {
            let connection = Internet::join(&endpoint, &code)?;
            let address = format!("ws://127.0.0.1:{}/", connection.port);
            internet = Some(connection);
            address
        } else {
            endpoint.clone()
        };
        let name = label(payload["name"].as_str(), "SoSo room")?;
        let unreachable = if internet.is_some() {
            "internet_peer_unreachable"
        } else {
            "relay_unreachable"
        };
        let parsed = url::Url::parse(&transport_endpoint).map_err(|_| "invalid_relay")?;
        let host = parsed.host_str().ok_or("invalid_relay")?;
        let port = parsed.port_or_known_default().ok_or("invalid_relay")?;
        let addresses = (host, port).to_socket_addrs().map_err(|_| unreachable)?;
        let deadline = Instant::now() + Duration::from_secs(4);
        let mut connected = None;
        for address in addresses.take(8) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            if let Ok(tcp) = TcpStream::connect_timeout(&address, remaining) {
                connected = Some(tcp);
                break;
            }
        }
        let tcp = connected.ok_or(unreachable)?;
        tcp.set_read_timeout(Some(Duration::from_secs(4)))
            .map_err(|_| unreachable)?;
        tcp.set_write_timeout(Some(Duration::from_secs(3)))
            .map_err(|_| unreachable)?;
        let _ = tcp.set_nodelay(true);
        let (mut ws, _) =
            client_tls_with_config(transport_endpoint.as_str(), tcp, Some(ws_config()), None)
                .map_err(|_| unreachable)?;
        let tcp = match ws.get_mut() {
            MaybeTlsStream::Plain(tcp) => tcp,
            MaybeTlsStream::Rustls(tls) => &mut tls.sock,
            _ => return Err(unreachable.into()),
        };
        tcp.set_read_timeout(Some(Duration::from_secs(4)))
            .map_err(|_| unreachable)?;
        tcp.set_write_timeout(Some(Duration::from_secs(3)))
            .map_err(|_| unreachable)?;
        let _ = tcp.set_nodelay(true);
        ws.send(Message::text(
            json!({"op":op,"version":1,"name":name,"displayName":display_name,"code":code})
                .to_string(),
        ))
        .map_err(|_| unreachable)?;
        let first = ws.read().map_err(|_| unreachable)?;
        let first: Value = serde_json::from_str(first.to_text().map_err(|_| "invalid_relay")?)
            .map_err(|_| "invalid_relay")?;
        if let Some(error) = first["error"].as_str() {
            return Err(error.to_string());
        }
        let snapshot = decode_snapshot(first)?;
        let room_code = snapshot.code.clone();
        let relay_port = local_relay.as_ref().map(|relay| relay.port);
        self.state = Arc::new(Mutex::new(State {
            snapshot: Some(snapshot),
            endpoint,
            ..State::default()
        }));
        let state = self.state.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let announced = Arc::new(AtomicBool::new(!automatic));
        let worker_announced = announced.clone();
        let (sender, receiver) = mpsc::sync_channel::<Value>(16);
        let (reply_sender, replies) = mpsc::sync_channel::<Value>(32);
        match ws.get_mut() {
            MaybeTlsStream::Plain(tcp) => {
                let _ = tcp.set_read_timeout(Some(Duration::from_millis(100)));
            }
            MaybeTlsStream::Rustls(tls) => {
                let _ = tls.sock.set_read_timeout(Some(Duration::from_millis(100)));
            }
            _ => {}
        }
        thread::spawn(move || {
            let mut ping = Instant::now() - Duration::from_secs(3);
            let mut received = Instant::now();
            let mut error = "connection_lost".to_string();
            let mut diagnostic = "snapshot_timeout";
            while !stopping.load(Ordering::Relaxed) && received.elapsed() < Duration::from_secs(60)
            {
                let mut failed = false;
                while let Ok(message) = receiver.try_recv() {
                    if ws.send(Message::text(message.to_string())).is_err() {
                        diagnostic = "write_failed";
                        failed = true;
                        break;
                    }
                }
                if failed {
                    break;
                }
                if ping.elapsed() >= Duration::from_secs(2) {
                    if ws.send(Message::text("{\"op\":\"ping\"}")).is_err() {
                        diagnostic = "keepalive_failed";
                        break;
                    }
                    ping = Instant::now();
                }
                match ws.read() {
                    Ok(Message::Text(text)) => {
                        received = Instant::now();
                        let Ok(message) = serde_json::from_str::<Value>(&text) else {
                            error = "invalid_relay".into();
                            break;
                        };
                        if message["type"] == "commandResult" {
                            let _ = reply_sender.try_send(message);
                            continue;
                        }
                        if let Some(e) = message["error"].as_str() {
                            error = e.to_string();
                            break;
                        }
                        if message["type"] == "pong" {
                            state.lock().unwrap().latency =
                                (ping.elapsed().as_secs_f64() / 2.0).min(1.0);
                        } else if message["type"] == "snapshot" {
                            match decode_snapshot(message) {
                                Ok(snapshot) => {
                                    let view = {
                                        let mut guard = state.lock().unwrap();
                                        guard.snapshot = Some(snapshot);
                                        guard.received = Instant::now();
                                        guard.view()
                                    };
                                    if !stopping.load(Ordering::Relaxed)
                                        && worker_announced.load(Ordering::Relaxed)
                                    {
                                        output_session(
                                            json!({"event":"session","session":view}),
                                            &stopping,
                                        );
                                    }
                                }
                                Err(e) => {
                                    error = e;
                                    break;
                                }
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        diagnostic = "socket_closed";
                        break;
                    }
                    Ok(_) => {}
                    Err(ref e) if retryable(e) => {}
                    Err(_) => {
                        diagnostic = "read_failed";
                        break;
                    }
                }
            }
            let _ = ws.close(None);
            if !stopping.load(Ordering::Relaxed) {
                crate::output(json!({"event":"diagnostic","code":diagnostic}));
                let view = {
                    let mut guard = state.lock().unwrap();
                    guard.snapshot = None;
                    guard.error = Some(error);
                    guard.view()
                };
                if worker_announced.load(Ordering::Relaxed) {
                    output_session(json!({"event":"session","session":view}), &stopping);
                }
            }
        });
        self.connection = Some(Connection {
            stop,
            sender,
            _relay: local_relay,
            _internet: internet,
            replies,
        });
        if automatic {
            let result = Internet::host(relay_port.ok_or("internet_unavailable")?, &room_code);
            match result {
                Ok(internet) => {
                    let mut state = self.state.lock().unwrap();
                    if state.snapshot.is_none() {
                        drop(state);
                        self.connection = None;
                        return Err("internet_unavailable".into());
                    }
                    state.endpoint = internet.address.clone();
                    self.connection.as_mut().unwrap()._internet = Some(internet);
                    announced.store(true, Ordering::Relaxed);
                }
                Err(error) => {
                    self.connection = None;
                    self.state = Arc::new(Mutex::new(State::default()));
                    return Err(error);
                }
            }
        }
        Ok(self.state.lock().unwrap().view())
    }
}

fn decode_snapshot(value: Value) -> Result<Snapshot, String> {
    let snapshot: Snapshot = serde_json::from_value(value).map_err(|_| "invalid_relay")?;
    snapshot.playback.validate()?;
    if !matches!(snapshot.role.as_str(), "host" | "guest")
        || snapshot.members.len() > 8
        || snapshot.code.len() != 32
        || !snapshot.code.bytes().all(|b| b.is_ascii_hexdigit())
        || snapshot.self_id.len() != 32
        || label(Some(&snapshot.name), "").is_err()
        || snapshot
            .members
            .iter()
            .any(|m| m.id.len() != 32 || label(Some(&m.name), "").is_err())
    {
        return Err("invalid_relay".into());
    }
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn an_ended_decoder_applies_a_new_seek_before_waiting_for_room_advance() {
        let mut runtime = Runtime::default();
        runtime.state.lock().unwrap().snapshot = Some(
            serde_json::from_value(json!({
                "code":"room", "name":"Room", "selfId":"host", "role":"host", "members":[],
                "revision":2, "seekRevision":2,
                "playback":{
                    "track":{
                        "entryId":"one", "id":"sc_one", "source":"soundcloud",
                        "title":"One", "artist":"Artist", "album":"", "duration":0
                    },
                    "queue":[], "playing":true, "position":1
                }
            }))
            .unwrap(),
        );
        let mut sample = json!({
            "entryId":"one", "id":"sc_one", "source":"soundcloud", "playing":false,
            "position":30, "ended":true, "seekRevision":0
        });
        let decision = runtime.command("synchronize", &sample).unwrap();
        assert_eq!(decision["action"], "seek");
        assert_eq!(decision["seekRevision"], 2);
        sample["seekRevision"] = json!(2);
        sample["position"] = json!(1);
        sample["ended"] = json!(false);
        assert_eq!(
            runtime.command("synchronize", &sample).unwrap()["action"],
            "play"
        );
    }

    #[test]
    fn invitations_roundtrip_and_reject_public_plaintext() {
        let key = "0123456789abcdef0123456789abcdef";
        let value = invitation("wss://relay.example/rooms", key);
        assert_eq!(
            parse_invitation(&value).unwrap(),
            ("wss://relay.example/rooms".into(), key.into())
        );
        assert!(parse_invitation(&invitation("ws://8.8.8.8/", key)).is_err());
        assert!(validate_endpoint("wss://user:pass@example.com/").is_err());
        assert!(parse_invitation("SOSO1.é.123").is_err());
    }
}
