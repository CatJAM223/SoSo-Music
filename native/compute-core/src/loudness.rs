//! Mono/stereo 48 kHz BS.1770 K-weighting, 400 ms/75% gating and Annex 2 true peak.
//! A separate WASM instance owns each recording. No PCM is retained beyond the window/FIR.
use crate::{INPUT, OUTPUT};
use std::cell::RefCell;
const RATE: usize = 48000;
const WINDOW: usize = RATE * 4 / 10;
const HOP: usize = RATE / 10;
const MAX_BLOCKS: usize = 72000; // Two hours; bounded allocation before audio processing begins.
const FIR: [[f64; 4]; 12] = [
    [
        0.001708984375,
        -0.0291748046875,
        -0.0189208984375,
        -0.00830078125,
    ],
    [0.010986328125, 0.029296875, 0.0330810546875, 0.014892578125],
    [
        -0.0196533203125,
        -0.0517578125,
        -0.0582275390625,
        -0.026611328125,
    ],
    [0.033203125, 0.089111328125, 0.1015625, 0.047607421875],
    [
        -0.0594482421875,
        -0.16650390625,
        -0.2003173828125,
        -0.102294921875,
    ],
    [
        0.1373291015625,
        0.465087890625,
        0.77978515625,
        0.97216796875,
    ],
    [
        0.97216796875,
        0.77978515625,
        0.465087890625,
        0.1373291015625,
    ],
    [
        -0.102294921875,
        -0.2003173828125,
        -0.16650390625,
        -0.0594482421875,
    ],
    [0.047607421875, 0.1015625, 0.089111328125, 0.033203125],
    [
        -0.026611328125,
        -0.0582275390625,
        -0.0517578125,
        -0.0196533203125,
    ],
    [0.014892578125, 0.0330810546875, 0.029296875, 0.010986328125],
    [
        -0.00830078125,
        -0.0189208984375,
        -0.0291748046875,
        0.001708984375,
    ],
];
#[derive(Clone, Copy, Default)]
struct Filter {
    z1: f64,
    z2: f64,
}
impl Filter {
    fn tick(&mut self, x: f64, b: [f64; 3], a: [f64; 2]) -> f64 {
        let y = b[0] * x + self.z1;
        self.z1 = b[1] * x - a[0] * y + self.z2;
        self.z2 = b[2] * x - a[1] * y;
        if self.z1.abs() < 1e-30 {
            self.z1 = 0.0;
        }
        if self.z2.abs() < 1e-30 {
            self.z2 = 0.0;
        }
        y
    }
}
struct Meter {
    channels: usize,
    shelf: [Filter; 2],
    hp: [Filter; 2],
    history: [[f64; 12]; 2],
    hist_pos: usize,
    ring: Vec<f64>,
    pos: usize,
    window_samples: usize,
    sum: f64,
    total: u64,
    blocks: Vec<f64>,
    peak: f64,
    invalid: bool,
}
impl Meter {
    fn new(channels: usize) -> Self {
        Self {
            channels,
            shelf: [Filter::default(); 2],
            hp: [Filter::default(); 2],
            history: [[0.0; 12]; 2],
            hist_pos: 0,
            ring: vec![0.0; WINDOW],
            pos: 0,
            window_samples: 0,
            sum: 0.0,
            total: 0,
            blocks: Vec::with_capacity(MAX_BLOCKS),
            peak: 0.0,
            invalid: false,
        }
    }
    fn true_peak(&mut self, channel: usize, x: f64) {
        self.history[channel][self.hist_pos] = x;
        self.peak = self.peak.max(x.abs());
        let mut phases = [0.0; 4];
        for (tap, coefficients) in FIR.iter().enumerate() {
            let sample = self.history[channel][(self.hist_pos + 12 - tap) % 12];
            for phase in 0..4 {
                phases[phase] += sample * coefficients[phase];
            }
        }
        for value in phases {
            self.peak = self.peak.max(value.abs());
        }
    }
    fn push(&mut self, bytes: &[u8]) -> bool {
        if self.invalid || bytes.len() % (4 * self.channels) != 0 {
            return false;
        }
        let frames = bytes.len() / 4 / self.channels;
        if frames == 0 || frames > 16384 {
            return false;
        }
        // Validate the entire block before mutating the meter. Malformed capture is never amplified.
        if bytes.chunks_exact(4).any(|b| {
            let x = f32::from_le_bytes(b.try_into().unwrap());
            !x.is_finite() || x.abs() > 16.0
        }) {
            self.invalid = true;
            return false;
        }
        for frame in 0..frames {
            let mut power = 0.0;
            for channel in 0..self.channels {
                let index = (channel * frames + frame) * 4;
                let x = f32::from_le_bytes(bytes[index..index + 4].try_into().unwrap()) as f64;
                self.true_peak(channel, x);
                let y = self.shelf[channel].tick(
                    x,
                    [1.53512485958697, -2.69169618940638, 1.19839281085285],
                    [-1.69065929318241, 0.73248077421585],
                );
                let z = self.hp[channel].tick(
                    y,
                    [1.0, -2.0, 1.0],
                    [-1.99004745483398, 0.99007225036621],
                );
                power += z * z;
            }
            self.hist_pos = (self.hist_pos + 1) % 12;
            self.sum += power - self.ring[self.pos];
            self.ring[self.pos] = power;
            self.pos = (self.pos + 1) % WINDOW;
            self.window_samples += 1;
            self.total += 1;
            if self.window_samples >= WINDOW && (self.window_samples - WINDOW) % HOP == 0 {
                let mean = self.sum.max(0.0) / WINDOW as f64;
                if mean > 10.0_f64.powf((-70.0 + 0.691) / 10.0) {
                    if self.blocks.len() == MAX_BLOCKS {
                        self.invalid = true;
                        return false;
                    }
                    self.blocks.push(mean);
                }
            }
        }
        true
    }
    fn gap(&mut self) {
        // Flush FIR tail without adding silence to the integrated loudness windows.
        for _ in 0..12 {
            for channel in 0..self.channels {
                self.true_peak(channel, 0.0);
            }
            self.hist_pos = (self.hist_pos + 1) % 12;
        }
        self.shelf = [Filter::default(); 2];
        self.hp = [Filter::default(); 2];
        self.history = [[0.0; 12]; 2];
        self.ring.fill(0.0);
        self.pos = 0;
        self.window_samples = 0;
        self.sum = 0.0;
    }
    fn stats(&self) -> [f64; 5] {
        let mut lufs = f64::NAN;
        let mut gain = f64::NAN;
        if !self.invalid && self.blocks.len() >= 27 && self.peak > 0.0 {
            let threshold = self.blocks.iter().sum::<f64>() / self.blocks.len() as f64 / 10.0;
            let (sum, count) = self
                .blocks
                .iter()
                .filter(|&&p| p > threshold)
                .fold((0.0, 0_usize), |(sum, n), p| (sum + p, n + 1));
            if count > 0 {
                lufs = -0.691 + 10.0 * (sum / count as f64).log10();
                // Product target -14 LUFS, bounded by measured pre-EQ true peak at -1 dBTP.
                gain = (-14.0 - lufs)
                    .min(-1.0 - 20.0 * self.peak.log10())
                    .clamp(-24.0, 18.0);
            }
        }
        [
            lufs,
            if self.peak > 0.0 {
                20.0 * self.peak.log10()
            } else {
                f64::NEG_INFINITY
            },
            gain,
            self.blocks.len() as f64,
            self.total as f64,
        ]
    }
}
thread_local! {static METER:RefCell<Option<Meter>>=const{RefCell::new(None)};}
#[no_mangle]
pub extern "C" fn loudness_reset(rate: u32, channels: u32) -> i32 {
    METER.with(|m| {
        *m.borrow_mut() = None;
        if rate != RATE as u32 || !(1..=2).contains(&channels) {
            return -1;
        }
        *m.borrow_mut() = Some(Meter::new(channels as usize));
        0
    })
}
#[no_mangle]
pub extern "C" fn loudness_push(length: usize) -> i32 {
    INPUT.with(|input| {
        let input = input.borrow();
        let Some(bytes) = input.get(..length).filter(|_| length <= 16384 * 2 * 4) else {
            return -1;
        };
        METER.with(|m| match m.borrow_mut().as_mut() {
            Some(m) => {
                if m.push(bytes) {
                    0
                } else {
                    -1
                }
            }
            _ => -1,
        })
    })
}
#[no_mangle]
pub extern "C" fn loudness_gap() {
    METER.with(|m| {
        if let Some(m) = m.borrow_mut().as_mut() {
            m.gap();
        }
    });
}
#[no_mangle]
pub extern "C" fn loudness_read() -> i32 {
    let stats = METER.with(|m| m.borrow().as_ref().map(Meter::stats));
    let Some(stats) = stats else {
        return -1;
    };
    OUTPUT.with(|out| {
        let mut out = out.borrow_mut();
        out.clear();
        for value in stats {
            out.extend_from_slice(&value.to_le_bytes());
        }
    });
    40
}
