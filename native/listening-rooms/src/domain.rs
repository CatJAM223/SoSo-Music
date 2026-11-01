use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    time::{Duration, Instant},
};
const HOST_PLAYBACK_LEASE: Duration = Duration::from_secs(4);

pub const MAX_MEMBERS: usize = 8;
pub const MAX_QUEUE: usize = 20;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Song {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_id: Option<String>,
    pub id: String,
    pub source: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    pub duration: f64,
}

impl Song {
    fn validate(&self) -> Result<(), String> {
        if self.cover.as_ref().is_some_and(|cover| {
            cover.len() > 2048
                || url::Url::parse(cover).map_or(true, |url| {
                    url.scheme() != "https"
                        || url.host_str().is_none()
                        || !url.username().is_empty()
                        || url.password().is_some()
                })
        }) {
            return Err("unsupported_track".into());
        }
        if self
            .entry_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 384 || id.chars().any(char::is_control))
        {
            return Err("unsupported_track".into());
        }
        if !matches!(self.source.as_str(), "youtube" | "soundcloud")
            || self.id.is_empty()
            || self.id.len() > 180
            || self.title.is_empty()
            || self.title.len() > 512
            || self.artist.len() > 512
            || self.album.len() > 512
            || !self.duration.is_finite()
            || !(0.0..=86400.0).contains(&self.duration)
            || !self
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-:.".contains(&c))
        {
            return Err("unsupported_track".into());
        }
        Ok(())
    }
}

#[derive(Clone, Default, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Playback {
    pub track: Option<Song>,
    pub queue: Vec<Song>,
    pub playing: bool,
    #[serde(default)]
    pub preparing: bool,
    pub position: f64,
}

impl Playback {
    pub fn validate(&self) -> Result<(), String> {
        if !self.position.is_finite()
            || !(0.0..=86400.0).contains(&self.position)
            || self.queue.len() > MAX_QUEUE
            || (self.track.is_none() && self.playing)
        {
            return Err("invalid_playback".into());
        }
        if let Some(song) = &self.track {
            song.validate()?;
        }
        for song in &self.queue {
            song.validate()?;
        }
        Ok(())
    }

    pub fn projected(&self, elapsed: f64) -> Self {
        let mut result = self.clone();
        if result.playing && !result.preparing {
            result.position += elapsed.max(0.0);
        }
        if let Some(song) = &result.track {
            if song.duration > 0.0 {
                result.position = result.position.min(song.duration);
            }
        }
        result
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Member {
    pub id: String,
    pub name: String,
    pub is_host: bool,
}

pub struct Room {
    pub name: String,
    pub host_id: String,
    pub members: Vec<Member>,
    pub playback: Playback,
    pub anchor: Instant,
    pub revision: u64,
    pub heartbeat: Instant,
    pub waiting_for: HashSet<String>,
}

impl Room {
    pub fn snapshot_playback(&mut self) -> Playback {
        let elapsed = self.heartbeat.elapsed();
        if self.playback.playing && elapsed > HOST_PLAYBACK_LEASE {
            self.playback = self.playback.projected(
                self.anchor.elapsed().as_secs_f64() - elapsed.as_secs_f64()
                    + HOST_PLAYBACK_LEASE.as_secs_f64(),
            );
            self.playback.playing = false;
            self.playback.preparing = false;
            self.waiting_for.clear();
            self.anchor = Instant::now();
            self.revision += 1;
        }
        if self.playback.preparing
            && (self.waiting_for.is_empty()
                || self.anchor.elapsed() > Duration::from_secs(15)
                    && !self.waiting_for.contains(&self.host_id))
        {
            self.finish_preparing();
        }
        if self.playback.playing
            && !self.playback.preparing
            && self.playback.track.as_ref().is_some_and(|song| {
                song.duration > 0.0
                    && self.playback.position + self.anchor.elapsed().as_secs_f64() >= song.duration
            })
        {
            self.advance(true);
        }
        self.playback.projected(self.anchor.elapsed().as_secs_f64())
    }
    fn advance(&mut self, playing: bool) {
        self.playback.track = if self.playback.queue.is_empty() {
            None
        } else {
            Some(self.playback.queue.remove(0))
        };
        self.playback.position = 0.0;
        self.playback.playing = playing && self.playback.track.is_some();
        self.playback.preparing = self.playback.playing;
        self.waiting_for = if self.playback.preparing {
            self.members
                .iter()
                .map(|member| member.id.clone())
                .collect()
        } else {
            HashSet::new()
        };
        self.anchor = Instant::now();
        self.revision += 1;
    }
    fn finish_preparing(&mut self) {
        self.playback.preparing = false;
        self.waiting_for.clear();
        self.anchor = Instant::now();
        self.revision += 1;
    }
    pub fn pulse(&mut self, sender: &str, payload: &serde_json::Value) {
        if sender == self.host_id {
            self.heartbeat = Instant::now();
        }
        if self.playback.preparing
            && payload["ready"] == true
            && self.playback.track.as_ref().is_some_and(|track| {
                payload["entryId"].as_str() == track.entry_id.as_deref()
                    && payload["id"] == track.id
                    && payload["source"] == track.source
            })
        {
            self.waiting_for.remove(sender);
            if self.waiting_for.is_empty() {
                self.finish_preparing();
            }
        }
    }
    pub fn command(&mut self, sender: &str, payload: &serde_json::Value) -> Result<(), String> {
        if !self.members.iter().any(|member| member.id == sender) {
            return Err("not_connected".into());
        }
        let mut action = payload["action"].as_str().ok_or("invalid_command")?;
        if action == "toggle" {
            action = if self.playback.playing {
                "pause"
            } else {
                "play"
            };
        }
        if action == "enqueue" {
            let mut song: Song =
                serde_json::from_value(payload["song"].clone()).map_err(|_| "unsupported_track")?;
            song.validate()?;
            if self.playback.queue.len() >= MAX_QUEUE {
                return Err("queue_full".into());
            }
            song.entry_id = Some(crate::relay::random_key()?);
            let start_playback = self.playback.track.is_none() && self.playback.queue.is_empty();
            self.playback.queue.push(song);
            if start_playback {
                self.heartbeat = Instant::now();
                self.advance(true);
            } else {
                self.revision += 1;
            }
            return Ok(());
        }
        if sender != self.host_id {
            return Err("host_only".into());
        }
        match action {
            "seek" => {
                let position = payload["position"]
                    .as_f64()
                    .filter(|value| value.is_finite() && (0.0..=86400.0).contains(value))
                    .ok_or("invalid_playback")?;
                self.playback.position = self.playback.track.as_ref().map_or(0.0, |song| {
                    if song.duration > 0.0 {
                        position.min(song.duration)
                    } else {
                        position
                    }
                });
                self.anchor = Instant::now();
            }
            "remove" => {
                let entry = payload["entryId"].as_str().ok_or("invalid_command")?;
                let index = self
                    .playback
                    .queue
                    .iter()
                    .position(|song| song.entry_id.as_deref() == Some(entry))
                    .ok_or("queue_entry_missing")?;
                self.playback.queue.remove(index);
            }
            "next" => {
                self.advance(self.playback.playing);
                return Ok(());
            }
            "play" => {
                if self.playback.track.is_none() {
                    self.advance(true);
                } else {
                    self.playback = self.snapshot_playback();
                    self.playback.playing = true;
                }
                self.heartbeat = Instant::now();
                self.anchor = Instant::now();
            }
            "pause" => {
                self.playback = self.snapshot_playback();
                self.playback.playing = false;
                self.playback.preparing = false;
                self.waiting_for.clear();
                self.anchor = Instant::now();
            }
            _ => return Err("invalid_command".into()),
        }
        self.revision += 1;
        Ok(())
    }
    pub fn add_member(&mut self, member: Member) -> Result<(), String> {
        if self.members.len() >= MAX_MEMBERS {
            return Err("room_full".into());
        }
        self.members.push(member);
        Ok(())
    }
}

pub fn label(value: Option<&str>, fallback: &str) -> Result<String, String> {
    let value = value.unwrap_or(fallback).trim();
    if value.is_empty() || value.chars().count() > 48 || value.chars().any(char::is_control) {
        return Err("invalid_name".into());
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn room() -> Room {
        Room {
            name: "room".into(),
            host_id: "host".into(),
            members: vec![
                Member {
                    id: "host".into(),
                    name: "Host".into(),
                    is_host: true,
                },
                Member {
                    id: "guest".into(),
                    name: "Guest".into(),
                    is_host: false,
                },
            ],
            playback: Playback::default(),
            anchor: Instant::now(),
            heartbeat: Instant::now(),
            waiting_for: HashSet::new(),
            revision: 0,
        }
    }
    fn song() -> serde_json::Value {
        json!({"id":"sc_one","source":"soundcloud","title":"One","artist":"Artist","album":"","duration":100})
    }
    #[test]
    fn empty_room_and_collaborative_queue() {
        let mut r = room();
        assert!(r.playback.track.is_none());
        r.command("guest", &json!({"action":"enqueue","song":song()}))
            .unwrap();
        r.command("host", &json!({"action":"enqueue","song":song()}))
            .unwrap();
        assert_eq!(r.playback.queue.len(), 1);
        assert!(r.playback.playing);
        assert_ne!(
            r.playback.track.as_ref().unwrap().entry_id,
            r.playback.queue[0].entry_id
        );
    }
    #[test]
    fn enqueue_starts_empty_room_but_preserves_paused_or_playing_track() {
        for sender in ["host", "guest"] {
            let mut r = room();
            r.heartbeat = Instant::now() - Duration::from_secs(60);
            r.command(sender, &json!({"action":"enqueue","song":song()}))
                .unwrap();
            assert!(r.snapshot_playback().playing);
            assert!(r.playback.queue.is_empty());
            let entry = r.playback.track.as_ref().unwrap().entry_id.clone();
            r.command("host", &json!({"action":"seek","position":20}))
                .unwrap();
            r.command(sender, &json!({"action":"enqueue","song":song()}))
                .unwrap();
            assert_eq!(r.playback.track.as_ref().unwrap().entry_id, entry);
            assert!(r.playback.playing);
            assert_eq!(r.playback.position, 20.0);
            r.command("host", &json!({"action":"next"})).unwrap();
            r.command("host", &json!({"action":"pause"})).unwrap();
            let paused_entry = r.playback.track.as_ref().unwrap().entry_id.clone();
            r.command(sender, &json!({"action":"enqueue","song":song()}))
                .unwrap();
            assert!(!r.playback.playing);
            assert_eq!(r.playback.track.as_ref().unwrap().entry_id, paused_entry);
            r.command("host", &json!({"action":"next"})).unwrap();
            r.command("host", &json!({"action":"next"})).unwrap();
            assert!(r.playback.track.is_none());
            r.command(sender, &json!({"action":"enqueue","song":song()}))
                .unwrap();
            assert!(r.playback.playing);
            assert!(r.playback.queue.is_empty());
        }
    }
    #[test]
    fn authority_and_atomic_rejection() {
        let mut r = room();
        for action in ["play", "pause", "next", "remove", "seek", "toggle"] {
            assert_eq!(
                r.command("guest", &json!({"action":action})).unwrap_err(),
                "host_only"
            );
        }
        assert!(r
            .command("stranger", &json!({"action":"enqueue","song":song()}))
            .is_err());
        let mut bad = song();
        bad["preview"] = json!("file:///private");
        assert!(r
            .command("guest", &json!({"action":"enqueue","song":bad}))
            .is_err());
        assert!(r.playback.queue.is_empty());
    }
    #[test]
    fn queue_limits_and_removal_by_occurrence() {
        let mut r = room();
        for _ in 0..=MAX_QUEUE {
            r.command("guest", &json!({"action":"enqueue","song":song()}))
                .unwrap();
        }
        assert_eq!(
            r.command("host", &json!({"action":"enqueue","song":song()}))
                .unwrap_err(),
            "queue_full"
        );
        let entry = r.playback.queue[1].entry_id.clone();
        r.command("host", &json!({"action":"remove","entryId":entry}))
            .unwrap();
        assert_eq!(r.playback.queue.len(), MAX_QUEUE - 1);
        assert!(r
            .command("host", &json!({"action":"remove","entryId":entry}))
            .is_err());
    }
    #[test]
    fn playback_pause_seek_next_and_end() {
        let mut r = room();
        for _ in 0..2 {
            r.command("guest", &json!({"action":"enqueue","song":song()}))
                .unwrap();
        }
        r.command("host", &json!({"action":"play"})).unwrap();
        r.command("host", &json!({"action":"pause"})).unwrap();
        r.command("host", &json!({"action":"seek","position":20}))
            .unwrap();
        assert_eq!(r.snapshot_playback().position, 20.0);
        r.command("host", &json!({"action":"next"})).unwrap();
        assert!(!r.playback.playing);
        assert_eq!(r.playback.position, 0.0);
        r.command("host", &json!({"action":"play"})).unwrap();
        r.anchor = Instant::now() - Duration::from_secs(101);
        assert!(r.snapshot_playback().track.is_none());
        assert!(!r.playback.playing);
    }
    #[test]
    fn heartbeat_lease_pauses_stalled_renderer() {
        let mut r = room();
        r.command("guest", &json!({"action":"enqueue","song":song()}))
            .unwrap();
        r.command("host", &json!({"action":"play"})).unwrap();
        r.playback.preparing = false;
        r.anchor = Instant::now() - Duration::from_secs(8);
        r.heartbeat = Instant::now() - Duration::from_secs(8);
        let p = r.snapshot_playback();
        assert!(!p.playing);
        assert!((p.position - 4.0).abs() < 0.1);
    }
    #[test]
    fn shared_clock_waits_for_both_decoders_without_skipping_the_intro() {
        let mut r = room();
        r.command("host", &json!({"action":"enqueue","song":song()}))
            .unwrap();
        let track = r.playback.track.clone().unwrap();
        let ready =
            json!({"id":track.id,"source":track.source,"entryId":track.entry_id,"ready":true});
        r.anchor = Instant::now() - Duration::from_secs(3);
        assert_eq!(r.snapshot_playback().position, 0.0);
        r.pulse("host", &ready);
        assert!(r.playback.preparing);
        assert_eq!(r.snapshot_playback().position, 0.0);
        r.pulse("guest", &json!({"id":"other","ready":true}));
        assert!(r.playback.preparing);
        r.pulse("guest", &ready);
        assert!(!r.playback.preparing);
        assert!(r.snapshot_playback().position < 0.1);
    }
}
