//! Batched song-family matching. No host imports, network, storage or account data.
//! UTF-16 units intentionally preserve the reference JavaScript typo semantics.
use std::cell::RefCell;
const MAX_INPUT: usize = 2 * 1024 * 1024;
const MAX_CANDIDATES: usize = 1000;
thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}
struct Token {
    units: Vec<u16>,
    numeric: bool,
}
struct Song {
    tokens: Vec<usize>,
    artists: Vec<u32>,
    variants: Vec<u32>,
    duration: f64,
    distinctive: bool,
}
struct Job {
    candidates: Vec<Song>,
    recent: Vec<Song>,
    offered: Vec<Song>,
    tokens: Vec<Token>,
}
fn contains<T: PartialEq>(values: &[T], value: &T) -> bool {
    values.contains(value)
}
fn prepare(song: &mut Song, tokens: &[Token]) -> bool {
    if song.tokens.len() > 64
        || song.artists.len() > 32
        || song.variants.len() > 32
        || song.tokens.iter().any(|&index| index >= tokens.len())
        || !song.duration.is_finite()
    {
        return false;
    }
    let distinct = song
        .tokens
        .iter()
        .enumerate()
        .filter(|(i, value)| !song.tokens[..*i].contains(value))
        .count();
    song.distinctive = distinct >= 3
        && song
            .tokens
            .iter()
            .map(|&i| tokens[i].units.len())
            .sum::<usize>()
            >= 16
        && song
            .tokens
            .iter()
            .filter(|&&i| tokens[i].units.len() >= 4)
            .count()
            >= 2;
    true
}
fn one_character_apart(a: &Token, b: &Token) -> bool {
    let a_units = &a.units;
    let b_units = &b.units;
    if a.numeric
        || b.numeric
        || a_units.len().min(b_units.len()) < 5
        || a_units.len().abs_diff(b_units.len()) > 1
    {
        return false;
    }
    let (mut i, mut j, mut differences) = (0, 0, 0);
    while i < a_units.len() && j < b_units.len() {
        if a_units[i] == b_units[j] {
            i += 1;
            j += 1;
            continue;
        }
        differences += 1;
        if differences > 1 {
            return false;
        }
        if a_units.len() >= b_units.len() {
            i += 1;
        }
        if b_units.len() >= a_units.len() {
            j += 1;
        }
    }
    differences + usize::from(i < a_units.len() || j < b_units.len()) <= 1
}
fn tokens_match(a: &Token, b: &Token) -> bool {
    if a.units == b.units {
        return true;
    }
    let maximum = if a.units.len() >= 8 {
        2
    } else if a.units.len() >= 4 {
        1
    } else {
        0
    };
    if maximum == 0 || a.units.len().abs_diff(b.units.len()) > maximum {
        return false;
    }
    let mut previous: Vec<usize> = (0..=b.units.len()).collect();
    // Preserve the existing recurrence exactly. Changing fuzzy matching is a separate behavior change.
    for i in 1..=a.units.len() {
        let mut current = i;
        let mut best = current;
        for j in 1..=b.units.len() {
            let temporary = previous[j];
            previous[j] = (previous[j] + 1)
                .min(current + 1)
                .min(previous[j - 1] + usize::from(a.units[i - 1] != b.units[j - 1]));
            current = temporary;
            best = best.min(previous[j]);
        }
        if best > maximum {
            return false;
        }
    }
    previous[b.units.len()] <= maximum
}
fn duplicate_recording(a: &Song, b: &Song, tokens: &[Token]) -> bool {
    if a.tokens.is_empty()
        || b.tokens.is_empty()
        || (a.duration > 0.0 && b.duration > 0.0 && (a.duration - b.duration).abs() > 8.0)
        || a.variants.len() != b.variants.len()
        || a.variants.iter().any(|v| !contains(&b.variants, v))
    {
        return false;
    }
    let (small, large) = if a.tokens.len() <= b.tokens.len() {
        (a, b)
    } else {
        (b, a)
    };
    let overlapping = small
        .tokens
        .iter()
        .filter(|&&index| {
            contains(&large.tokens, &index)
                || (tokens[index].units.len() >= 4
                    && large
                        .tokens
                        .iter()
                        .any(|&other| tokens_match(&tokens[index], &tokens[other])))
        })
        .count();
    if overlapping == 0 {
        return false;
    }
    let coefficient = overlapping as f64 / small.tokens.len() as f64;
    coefficient >= 0.99 || (coefficient >= 0.75 && small.tokens.len() >= 3)
}
fn same_song(a: &Song, b: &Song, tokens: &[Token]) -> bool {
    if !a.artists.iter().any(|artist| contains(&b.artists, artist)) {
        if a.tokens.len() != b.tokens.len() || !a.distinctive || !b.distinctive {
            return false;
        }
        let mut differences = 0;
        return a.tokens.iter().zip(&b.tokens).all(|(&left, &right)| {
            if left == right {
                return true;
            }
            differences += 1;
            differences <= 1 && one_character_apart(&tokens[left], &tokens[right])
        });
    }
    if duplicate_recording(a, b, tokens) {
        return true;
    }
    let (small, large) = if a.tokens.len() <= b.tokens.len() {
        (a, b)
    } else {
        (b, a)
    };
    small.tokens.len() >= 2
        && small
            .tokens
            .iter()
            .any(|index| contains(&large.tokens, index))
        && small.tokens.iter().all(|&index| {
            contains(&large.tokens, &index)
                || large
                    .tokens
                    .iter()
                    .any(|&other| one_character_apart(&tokens[index], &tokens[other]))
        })
}

struct Cursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl Cursor<'_> {
    fn word(&mut self) -> Option<u32> {
        let end = self.offset.checked_add(4)?;
        let value = u32::from_le_bytes(self.bytes.get(self.offset..end)?.try_into().ok()?);
        self.offset = end;
        Some(value)
    }
    fn indices(&mut self, count: usize) -> Option<Vec<u32>> {
        (0..count).map(|_| self.word()).collect()
    }
    fn song(&mut self) -> Option<Song> {
        let token_count = self.word()? as usize;
        let artist_count = self.word()? as usize;
        let variant_count = self.word()? as usize;
        if token_count > 64 || artist_count > 32 || variant_count > 32 {
            return None;
        }
        let low = self.word()? as u64;
        let high = self.word()? as u64;
        let duration = f64::from_bits(low | (high << 32));
        if !duration.is_finite() {
            return None;
        }
        let tokens = self
            .indices(token_count)?
            .into_iter()
            .map(|v| v as usize)
            .collect();
        Some(Song {
            tokens,
            artists: self.indices(artist_count)?,
            variants: self.indices(variant_count)?,
            duration,
            distinctive: false,
        })
    }
}
fn read_job(bytes: &[u8]) -> Option<Job> {
    let mut cursor = Cursor { bytes, offset: 0 };
    if cursor.word()? != 0x534f534f || cursor.word()? != 2 {
        return None;
    }
    let count = cursor.word()? as usize;
    let recent_count = cursor.word()? as usize;
    let offered_count = cursor.word()? as usize;
    let token_count = cursor.word()? as usize;
    if count > MAX_CANDIDATES || recent_count > 300 || offered_count > 80 || token_count > 8192 {
        return None;
    }
    let mut tokens = Vec::with_capacity(token_count);
    let mut total_units = 0;
    for _ in 0..token_count {
        let length = cursor.word()? as usize;
        let numeric = cursor.word()?;
        total_units += length;
        if length > 1024 || total_units > 262144 || numeric > 1 {
            return None;
        }
        let units: Option<Vec<u16>> = (0..length)
            .map(|_| u16::try_from(cursor.word()?).ok())
            .collect();
        tokens.push(Token {
            units: units?,
            numeric: numeric == 1,
        });
    }
    let candidates: Option<Vec<Song>> = (0..count).map(|_| cursor.song()).collect();
    let recent: Option<Vec<Song>> = (0..recent_count).map(|_| cursor.song()).collect();
    let offered: Option<Vec<Song>> = (0..offered_count).map(|_| cursor.song()).collect();
    if cursor.offset != bytes.len() {
        return None;
    }
    Some(Job {
        candidates: candidates?,
        recent: recent?,
        offered: offered?,
        tokens,
    })
}

fn calculate_job(mut job: Job) -> Option<Vec<u8>> {
    let count = job.candidates.len();
    if count > MAX_CANDIDATES
        || job.recent.len() > 300
        || job.offered.len() > 80
        || job.tokens.len() > 8192
        || job.tokens.iter().any(|token| token.units.len() > 1024)
        || job
            .tokens
            .iter()
            .map(|token| token.units.len())
            .sum::<usize>()
            > 262144
    {
        return None;
    }
    for song in job
        .candidates
        .iter_mut()
        .chain(job.recent.iter_mut())
        .chain(job.offered.iter_mut())
    {
        if !prepare(song, &job.tokens) {
            return None;
        }
    }
    let mut output = vec![0; count * count + count * 2];
    for (index, candidate) in job.candidates.iter().enumerate() {
        output[index] = u8::from(
            job.recent
                .iter()
                .any(|song| same_song(song, candidate, &job.tokens)),
        );
        output[count + index] = u8::from(
            job.offered
                .iter()
                .any(|song| same_song(song, candidate, &job.tokens)),
        );
        for (other_index, other) in job.candidates.iter().enumerate() {
            // Ordered matrix: the reference fuzzy comparison is not assumed symmetric.
            output[2 * count + index * count + other_index] =
                u8::from(same_song(candidate, other, &job.tokens));
        }
    }
    Some(output)
}
#[no_mangle]
pub extern "C" fn abi_version() -> u32 {
    2
}
#[no_mangle]
pub extern "C" fn reserve(length: usize) -> usize {
    if length > MAX_INPUT {
        return 0;
    }
    INPUT.with(|input| {
        let mut input = input.borrow_mut();
        input.resize(length, 0);
        input.as_mut_ptr() as usize
    })
}
#[no_mangle]
pub extern "C" fn calculate(length: usize) -> i32 {
    OUTPUT.with(|output| output.borrow_mut().clear());
    if length > MAX_INPUT {
        return -1;
    }
    INPUT.with(|input| {
        let input = input.borrow();
        let Some(bytes) = input.get(..length) else {
            return -1;
        };
        let Some(job) = read_job(bytes) else {
            return -1;
        };
        let Some(result) = calculate_job(job) else {
            return -1;
        };
        let size = result.len();
        OUTPUT.with(|output| *output.borrow_mut() = result);
        size as i32
    })
}
#[no_mangle]
pub extern "C" fn output_ptr() -> usize {
    OUTPUT.with(|output| output.borrow().as_ptr() as usize)
}
