//! Import scoring and stable ranking. Text canonicalization is shared with catalog metadata.
use crate::{INPUT, MAX_INPUT, OUTPUT};
struct Read<'a> {
    bytes: &'a [u8],
    pos: usize,
}
impl<'a> Read<'a> {
    fn word(&mut self) -> Option<u32> {
        let end = self.pos.checked_add(4)?;
        let v = u32::from_le_bytes(self.bytes.get(self.pos..end)?.try_into().ok()?);
        self.pos = end;
        Some(v)
    }
    fn number(&mut self) -> Option<f64> {
        let end = self.pos.checked_add(8)?;
        let v = f64::from_le_bytes(self.bytes.get(self.pos..end)?.try_into().ok()?);
        self.pos = end;
        v.is_finite().then_some(v)
    }
    fn text(&mut self) -> Option<&'a str> {
        let len = self.word()? as usize;
        if len > 65536 {
            return None;
        }
        let end = self.pos.checked_add(len)?;
        let v = std::str::from_utf8(self.bytes.get(self.pos..end)?).ok()?;
        self.pos = end;
        Some(v)
    }
    fn strings(&mut self) -> Option<Vec<&'a str>> {
        let n = self.word()? as usize;
        if n > 256 {
            return None;
        }
        (0..n).map(|_| self.text()).collect()
    }
}
fn token_matches(a: &str, b: &str) -> bool {
    a == b
        || (a.ends_with("masktoken")
            && a.encode_utf16().count() >= 11
            && b.starts_with(&a[..a.len() - 9]))
        || (b.ends_with("masktoken")
            && b.encode_utf16().count() >= 11
            && a.starts_with(&b[..b.len() - 9]))
}
fn unique_words(s: &str) -> Vec<&str> {
    let mut words = Vec::new();
    for w in s.split(' ').filter(|w| !w.is_empty()) {
        if !words.contains(&w) {
            words.push(w);
        }
    }
    words
}
fn score(
    expected: &str,
    title: &str,
    original_duration: f64,
    duration: f64,
    exact_artist: bool,
    artist_matches: bool,
    same_variants: bool,
    valid: bool,
) -> (f64, bool) {
    if !valid || !same_variants || !artist_matches || expected.is_empty() {
        return (0.0, false);
    }
    let wanted = unique_words(expected);
    let actual = unique_words(title);
    let common = wanted
        .iter()
        .filter(|a| actual.iter().any(|b| token_matches(a, b)))
        .count() as f64;
    let recall = common / wanted.len().max(1) as f64;
    let precision = common / actual.len().max(1) as f64;
    if recall < 0.6 || precision < 0.5 {
        return (0.0, false);
    }
    let known = original_duration >= 15.0 && duration > 0.0;
    let difference = if known {
        (original_duration - duration).abs()
    } else {
        0.0
    };
    if known
        && ((original_duration > 60.0 && duration <= 35.0)
            || (difference > 20.0_f64.max(original_duration * 0.1) && recall < 0.95))
    {
        return (0.0, false);
    }
    let exact = title == expected;
    let masked = expected.contains("masktoken") || title.contains("masktoken");
    let confident = !(original_duration > 0.0 && original_duration < 15.0)
        && (!masked || exact)
        && (exact || (recall >= 0.95 && precision >= 0.9))
        && (!known || difference <= 8.0);
    (
        recall * 45.0
            + precision * 30.0
            + if exact_artist { 15.0 } else { 8.0 }
            + if known {
                0.0_f64.max(10.0 - difference)
            } else {
                3.0
            },
        confident,
    )
}
fn run(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut r = Read { bytes, pos: 0 };
    if r.word()? != 1 {
        return None;
    }
    let count = r.word()? as usize;
    if count > 256 {
        return None;
    }
    let duration = r.number()?;
    let artist = r.text()?;
    let expected = r.text()?;
    let variants = r.strings()?;
    let artist_keys = r.strings()?;
    let mut ranked = Vec::with_capacity(count);
    for index in 0..count {
        let flags = r.word()?;
        if flags > 1 {
            return None;
        }
        let candidate_duration = r.number()?;
        let candidate_artist = r.text()?;
        let title = r.text()?;
        let other_variants = r.strings()?;
        let other_keys = r.strings()?;
        let exact_artist = candidate_artist == artist;
        let artist_matches = exact_artist || artist_keys.iter().any(|key| other_keys.contains(key));
        let same_variants = variants.len() == other_variants.len()
            && variants.iter().all(|v| other_variants.contains(v));
        let (score, confident) = score(
            expected,
            title,
            duration,
            candidate_duration,
            exact_artist,
            artist_matches,
            same_variants,
            flags == 1 && !artist.is_empty(),
        );
        ranked.push((index as u32, score, confident));
    }
    if r.pos != bytes.len() {
        return None;
    }
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut out = Vec::with_capacity(count * 16);
    for (index, score, confident) in ranked {
        out.extend_from_slice(&index.to_le_bytes());
        out.extend_from_slice(&score.to_le_bytes());
        out.extend_from_slice(&u32::from(confident).to_le_bytes());
    }
    Some(out)
}
#[no_mangle]
pub extern "C" fn match_import(length: usize) -> i32 {
    OUTPUT.with(|out| out.borrow_mut().clear());
    INPUT.with(|input| {
        let input = input.borrow();
        let Some(bytes) = input.get(..length).filter(|_| length <= MAX_INPUT) else {
            return -1;
        };
        let Some(result) = run(bytes) else {
            return -1;
        };
        let len = result.len();
        OUTPUT.with(|out| *out.borrow_mut() = result);
        len as i32
    })
}
