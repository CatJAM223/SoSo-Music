//! Bounded incremental MPEG-TS/PES audio extraction. PAT/PMT selects one audio PID;
//! video, metadata, null packets, adaptation bytes and PES headers never enter the audio.
use crate::{INPUT, OUTPUT};
use std::cell::RefCell;
const CHUNK: usize = 1024 * 1024;
#[derive(Default)]
struct Section {
    data: Vec<u8>,
}
impl Section {
    fn feed(&mut self, payload: &[u8], start: bool) -> Option<Vec<Vec<u8>>> {
        let mut sections = Vec::new();
        let mut rest = payload;
        if start {
            let pointer = *rest.first()? as usize;
            rest = rest.get(1..)?;
            if pointer > rest.len() {
                return None;
            }
            if !self.data.is_empty() {
                self.data.extend_from_slice(&rest[..pointer]);
                self.drain(&mut sections)?;
                if !self.data.is_empty() {
                    return None;
                }
            }
            self.data.clear();
            rest = &rest[pointer..];
        } else if self.data.is_empty() {
            return Some(sections);
        }
        self.data.extend_from_slice(rest);
        self.drain(&mut sections)?;
        Some(sections)
    }
    fn drain(&mut self, out: &mut Vec<Vec<u8>>) -> Option<()> {
        loop {
            if self.data.first() == Some(&0xff) {
                self.data.clear();
                return Some(());
            }
            if self.data.len() < 3 {
                return Some(());
            }
            let length = 3 + (((self.data[1] & 15) as usize) << 8) + self.data[2] as usize;
            if !(12..=1024).contains(&length) {
                return None;
            }
            if self.data.len() < length {
                return Some(());
            }
            let section: Vec<u8> = self.data.drain(..length).collect();
            let mut crc = 0xffffffff_u32;
            for &byte in &section {
                crc ^= (byte as u32) << 24;
                for _ in 0..8 {
                    crc = if crc & 0x80000000 != 0 {
                        (crc << 1) ^ 0x04c11db7
                    } else {
                        crc << 1
                    };
                }
            }
            if crc != 0 {
                return None;
            }
            out.push(section);
        }
    }
}
#[derive(Default)]
struct Demux {
    tail: Vec<u8>,
    pat: Section,
    pmt: Section,
    pmt_pid: Option<u16>,
    program: Option<u16>,
    audio_pid: Option<u16>,
    codec: u32,
    continuity: Option<u8>,
    last_packet: Vec<u8>,
    header: Vec<u8>,
    pes: bool,
    remaining: Option<usize>,
    failed: bool,
    total: usize,
}
impl Demux {
    fn table(&mut self, section: &[u8], pat: bool) -> Option<()> {
        if section[5] & 1 == 0 {
            return Some(());
        } // Ignore a table announced for future use.
        if pat {
            if section[0] != 0 {
                return None;
            }
            for item in section[8..section.len() - 4].chunks_exact(4) {
                let program = u16::from_be_bytes([item[0], item[1]]);
                if program != 0 {
                    let pid = (((item[2] & 31) as u16) << 8) | item[3] as u16;
                    if self.pmt_pid.is_some_and(|old| old != pid) {
                        return None;
                    }
                    self.pmt_pid = Some(pid);
                    self.program = Some(program);
                    break;
                }
            }
        } else {
            if section[0] != 2 || Some(u16::from_be_bytes([section[3], section[4]])) != self.program
            {
                return None;
            }
            let end = section.len() - 4;
            if end < 12 {
                return None;
            }
            let info = (((section[10] & 15) as usize) << 8) | section[11] as usize;
            let mut pos = 12 + info;
            if pos > end {
                return None;
            }
            while pos < end {
                let entry = section.get(pos..pos + 5)?;
                let pid = (((entry[1] & 31) as u16) << 8) | entry[2] as u16;
                let extra = (((entry[3] & 15) as usize) << 8) | entry[4] as usize;
                if matches!(entry[0], 0x0f | 0x03 | 0x04) {
                    if self.audio_pid.is_some_and(|old| old != pid) {
                        return None;
                    }
                    self.audio_pid = Some(pid);
                    let codec = if entry[0] == 0x0f { 1 } else { 2 };
                    if self.codec != 0 && self.codec != codec {
                        return None;
                    }
                    self.codec = codec;
                    break;
                }
                pos = pos.checked_add(5 + extra)?;
                if pos > end {
                    return None;
                }
            }
        }
        Some(())
    }
    fn payload(&mut self, mut bytes: &[u8], start: bool, out: &mut Vec<u8>) -> Option<()> {
        if start {
            // A bounded PES must finish before a new one begins.
            if self.pes && (self.remaining.is_some_and(|n| n > 0) || !self.header.is_empty()) {
                return None;
            }
            self.header.clear();
            self.pes = true;
            self.remaining = None;
        } else if !self.pes {
            return Some(());
        }
        if !self.header.is_empty() || start {
            // Headers may span transport packets. Only copy header bytes, never the complete PES.
            loop {
                let needed = if self.header.len() < 9 {
                    9
                } else {
                    9 + self.header[8] as usize
                };
                let count = (needed - self.header.len()).min(bytes.len());
                self.header.extend_from_slice(&bytes[..count]);
                bytes = &bytes[count..];
                if self.header.len() < needed {
                    return Some(());
                }
                if needed == 9 {
                    let h = &self.header;
                    if h[..3] != [0, 0, 1]
                        || !matches!(h[3], 0xc0..=0xdf | 0xbd)
                        || h[6] & 0xc0 != 0x80
                    {
                        return None;
                    }
                    if h[8] != 0 {
                        continue;
                    }
                }
                let length = u16::from_be_bytes([self.header[4], self.header[5]]) as usize;
                self.remaining = if length == 0 {
                    None
                } else {
                    Some(length.checked_sub(3 + self.header[8] as usize)?)
                };
                self.header.clear();
                break;
            }
        }
        let count = self.remaining.map_or(bytes.len(), |n| n.min(bytes.len()));
        out.extend_from_slice(&bytes[..count]);
        self.total += count;
        if let Some(left) = self.remaining.as_mut() {
            *left -= count;
        }
        Some(())
    }
    fn packet(&mut self, packet: &[u8], out: &mut Vec<u8>) -> Option<()> {
        if packet[0] != 0x47 {
            return None;
        }
        let pid = (((packet[1] & 31) as u16) << 8) | packet[2] as u16;
        let relevant = pid == 0 || Some(pid) == self.pmt_pid || Some(pid) == self.audio_pid;
        if !relevant {
            return Some(());
        }
        if packet[1] & 0x80 != 0 || packet[3] & 0xc0 != 0 {
            return None;
        }
        let control = (packet[3] >> 4) & 3;
        if control == 0 {
            return None;
        }
        let mut pos = 4;
        let mut discontinuity = false;
        if control & 2 != 0 {
            let n = packet[4] as usize;
            pos = 5 + n;
            if pos > 188 {
                return None;
            }
            if n > 0 {
                discontinuity = packet[5] & 0x80 != 0;
            }
        }
        if Some(pid) == self.audio_pid && discontinuity {
            self.continuity = None;
            self.pes = false;
            self.header.clear();
            self.remaining = None;
        }
        if control & 1 == 0 || pos == 188 {
            return Some(());
        }
        let start = packet[1] & 0x40 != 0;
        let bytes = &packet[pos..];
        if pid == 0 || Some(pid) == self.pmt_pid {
            let sections = if pid == 0 {
                self.pat.feed(bytes, start)?
            } else {
                self.pmt.feed(bytes, start)?
            };
            for section in sections {
                self.table(&section, pid == 0)?;
            }
        } else if Some(pid) == self.audio_pid {
            let cc = packet[3] & 15;
            if let Some(previous) = self.continuity {
                if cc == previous && self.last_packet == packet {
                    return Some(());
                }
                if cc != (previous + 1) & 15 {
                    return None;
                }
            }
            self.continuity = Some(cc);
            self.last_packet.clear();
            self.last_packet.extend_from_slice(packet);
            self.payload(bytes, start, out)?;
        }
        Some(())
    }
    fn push(&mut self, bytes: &[u8]) -> Option<Vec<u8>> {
        if self.failed || bytes.len() > CHUNK {
            return None;
        }
        let mut out = Vec::with_capacity(bytes.len() + 188);
        let mut input = bytes;
        if !self.tail.is_empty() {
            let take = (188 - self.tail.len()).min(input.len());
            self.tail.extend_from_slice(&input[..take]);
            input = &input[take..];
            if self.tail.len() < 188 {
                return Some(out);
            }
            let packet = std::mem::take(&mut self.tail);
            self.packet(&packet, &mut out)?;
        }
        let mut packets = input.chunks_exact(188);
        for packet in &mut packets {
            self.packet(packet, &mut out)?;
        }
        self.tail.extend_from_slice(packets.remainder());
        Some(out)
    }
    fn finish(&self) -> bool {
        !self.failed
            && self.tail.is_empty()
            && self.audio_pid.is_some()
            && self.total > 0
            && self.header.is_empty()
            && self.remaining.is_none_or(|n| n == 0)
    }
}
thread_local! {static DEMUX:RefCell<Demux>=RefCell::new(Demux::default());}
#[no_mangle]
pub extern "C" fn demux_reset() {
    DEMUX.with(|d| *d.borrow_mut() = Demux::default());
}
#[no_mangle]
pub extern "C" fn demux_push(length: usize) -> i32 {
    OUTPUT.with(|out| out.borrow_mut().clear());
    INPUT.with(|input| {
        let input = input.borrow();
        let Some(bytes) = input.get(..length).filter(|_| length <= CHUNK) else {
            return -1;
        };
        DEMUX.with(|d| {
            let mut d = d.borrow_mut();
            match d.push(bytes) {
                Some(result) => {
                    let size = result.len();
                    OUTPUT.with(|out| *out.borrow_mut() = result);
                    size as i32
                }
                None => {
                    d.failed = true;
                    -1
                }
            }
        })
    })
}
#[no_mangle]
pub extern "C" fn demux_finish() -> i32 {
    DEMUX.with(|d| {
        let d = d.borrow();
        if d.finish() {
            d.codec as i32
        } else {
            -1
        }
    })
}

/// HLS discontinuities start an independent transport sequence; incomplete audio is rejected.
#[no_mangle]
pub extern "C" fn demux_boundary() -> i32 {
    DEMUX.with(|state| {
        let mut state = state.borrow_mut();
        if !state.finish() {
            state.failed = true;
            return -1;
        }
        let total = state.total;
        let codec = state.codec;
        *state = Demux {
            total,
            codec,
            ..Demux::default()
        };
        0
    })
}
