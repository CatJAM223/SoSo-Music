//! Text matching, query recovery, scoring and duplicate selection for desktop search.
use crate::{INPUT, MAX_INPUT, OUTPUT};
use std::collections::{HashMap, HashSet};

const MAX_ROWS: u32 = 65_536;
const VERSION: u8 = 2;
const VARIANTS: u8 = 2;
const LIVE: &[&str] = &["live", "concert", "концерт", "концертная", "лайв"];
const MODIFIERS: &[&[&str]] = &[
    LIVE,
    &["remix", "ремикс", "bootleg", "mashup", "мешап"],
    &["acoustic", "акустика", "акустическая"],
    &[
        "instrumental",
        "karaoke",
        "караоке",
        "минус",
        "минусовка",
        "type beat",
    ],
    &["cover", "кавер", "tribute", "трибьют"],
    &["slowed", "sped up", "nightcore", "bass boosted", "reverb"],
    &["loop", "1 hour", "10 hours", "часовая", "hours"],
    &[
        "podcast",
        "reaction",
        "подкаст",
        "voiceover",
        "skit",
        "meme",
    ],
    &["demo", "демо"],
    &[
        "edit",
        "radio edit",
        "extended",
        "remaster",
        "ремастер",
        "mono",
        "stereo",
    ],
];

fn normalize(value: &str) -> String {
    let mut result = String::new();
    let mut space = false;
    for c in value.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() {
            if space {
                result.push(' ');
            }
            result.push(if c == 'ё' { 'е' } else { c });
            space = false;
        } else if !result.is_empty() {
            space = true;
        }
    }
    result
}

fn has_phrase(text: &str, phrase: &str) -> bool {
    if phrase.is_empty() {
        return false;
    }
    text.match_indices(phrase).any(|(start, value)| {
        let end = start + value.len();
        (start == 0 || text.as_bytes()[start - 1] == b' ')
            && (end == text.len() || text.as_bytes()[end] == b' ')
    })
}

fn modifiers(text: &str) -> u32 {
    MODIFIERS.iter().enumerate().fold(0, |mask, (i, words)| {
        mask | (u32::from(words.iter().any(|word| has_phrase(text, word))) << i)
    })
}

const LATIN: &str = "`qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const CYRILLIC: &str = "ёйцукенгшщзхъфывапролджэячсмитьбю";
const TRANSLIT: &[(char, &str)] = &[
    ('щ', "shch"),
    ('ш', "sh"),
    ('ч', "ch"),
    ('ж', "zh"),
    ('ц', "ts"),
    ('ю', "yu"),
    ('я', "ya"),
    ('ё', "yo"),
    ('х', "kh"),
    ('а', "a"),
    ('б', "b"),
    ('в', "v"),
    ('г', "g"),
    ('д', "d"),
    ('е', "e"),
    ('з', "z"),
    ('и', "i"),
    ('й', "y"),
    ('к', "k"),
    ('л', "l"),
    ('м', "m"),
    ('н', "n"),
    ('о', "o"),
    ('п', "p"),
    ('р', "r"),
    ('с', "s"),
    ('т', "t"),
    ('у', "u"),
    ('ф', "f"),
    ('ы', "y"),
    ('э', "e"),
    ('ь', ""),
    ('ъ', ""),
];

fn variants(raw: &str) -> Vec<String> {
    let raw = raw.trim().to_lowercase();
    let query = normalize(&raw);
    let mut result = Vec::new();
    if !(3..=120).contains(&query.chars().count()) {
        return result;
    }
    let latin = query.chars().all(|c| c.is_ascii_alphanumeric() || c == ' ');
    let cyrillic = query
        .chars()
        .all(|c| c.is_ascii_digit() || c == ' ' || CYRILLIC.contains(c));
    if latin || cyrillic {
        let (from, to) = if latin {
            (LATIN, CYRILLIC)
        } else {
            (CYRILLIC, LATIN)
        };
        let to: Vec<char> = to.chars().collect();
        result.push(normalize(
            &raw.chars()
                .map(|c| from.chars().position(|key| key == c).map_or(c, |i| to[i]))
                .collect::<String>(),
        ));
        let mut translit = String::new();
        if latin {
            let mut remaining = query.as_str();
            while let Some(c) = remaining.chars().next() {
                if let Some((letter, matched)) = TRANSLIT
                    .iter()
                    .find(|(_, spelling)| !spelling.is_empty() && remaining.starts_with(spelling))
                {
                    translit.push(*letter);
                    remaining = &remaining[matched.len()..];
                } else {
                    translit.push(c);
                    remaining = &remaining[c.len_utf8()..];
                }
            }
        } else {
            for c in raw.chars() {
                match TRANSLIT.iter().find(|(letter, _)| *letter == c) {
                    Some((_, spelling)) => translit.push_str(spelling),
                    None => translit.push(c),
                }
            }
        }
        result.push(normalize(&translit));
    }
    let mut previous = ' ';
    result.push(
        query
            .chars()
            .filter(|&c| {
                let keep = c != previous;
                previous = c;
                keep
            })
            .collect(),
    );
    let mut seen = HashSet::new();
    result.retain(|value| value != &query && !value.is_empty() && seen.insert(value.clone()));
    result
}

// A bounded, Unicode-aware comparison for one substitution, omission or adjacent transposition.
fn near(a: &str, b: &str) -> bool {
    if a.len().abs_diff(b.len()) > 4 {
        return false;
    }
    let a: Vec<char> = a.chars().take(81).collect();
    let b: Vec<char> = b.chars().take(81).collect();
    if a.len() < 4 || b.len() < 4 || a.len().max(b.len()) > 80 || a.len().abs_diff(b.len()) > 1 {
        return false;
    }
    let mismatch = a
        .iter()
        .zip(&b)
        .position(|(a, b)| a != b)
        .unwrap_or(a.len().min(b.len()));
    match a.len().cmp(&b.len()) {
        std::cmp::Ordering::Less => a[mismatch..] == b[mismatch + 1..],
        std::cmp::Ordering::Greater => a[mismatch + 1..] == b[mismatch..],
        std::cmp::Ordering::Equal if mismatch < a.len() => {
            a[mismatch + 1..] == b[mismatch + 1..]
                || (mismatch + 1 < a.len()
                    && a[mismatch] == b[mismatch + 1]
                    && a[mismatch + 1] == b[mismatch]
                    && a[mismatch + 2..] == b[mismatch + 2..])
        }
        _ => false,
    }
}

struct Query {
    text: String,
    versions: u32,
}

impl Query {
    fn new(text: String) -> Self {
        let versions = modifiers(&text);
        Self { text, versions }
    }

    fn relevance(
        &self,
        artist: &str,
        title: &str,
        album: &str,
        versions: u32,
        alternate: bool,
    ) -> i32 {
        let query = self.text.as_str();
        if query.is_empty() {
            return 0;
        }
        if title.is_empty() {
            return if artist == query {
                600
            } else if alternate {
                0
            } else if has_phrase(artist, query) {
                300
            } else if artist.starts_with(query) {
                250
            } else if near(query, artist) {
                190
            } else {
                10 * query
                    .split_whitespace()
                    .filter(|w| has_phrase(artist, w))
                    .count()
                    .min(8) as i32
            };
        }
        let credited = query
            .strip_suffix(title)
            .and_then(|prefix| prefix.strip_suffix(' '))
            .or_else(|| {
                query
                    .strip_prefix(title)
                    .and_then(|suffix| suffix.strip_prefix(' '))
            });
        let base = if credited == Some(artist) {
            640
        } else if credited.is_some_and(|name| has_phrase(artist, name)) {
            610
        } else if query == title && query == artist {
            600
        } else if query == title {
            580
        } else if query == artist {
            550
        } else {
            let mut total = 0;
            let mut coverage = 0;
            for word in query.split_whitespace() {
                total += 1;
                if has_phrase(artist, word)
                    || has_phrase(title, word)
                    || (self.versions & versions != 0
                        && MODIFIERS.iter().enumerate().any(|(i, synonyms)| {
                            self.versions & versions & (1 << i) != 0 && synonyms.contains(&word)
                        }))
                {
                    coverage += 1;
                }
            }
            if coverage == total
                && artist
                    .split_whitespace()
                    .any(|word| has_phrase(query, word))
            {
                if self.versions & versions != 0 {
                    630
                } else {
                    470
                }
            } else if alternate {
                0
            } else if has_phrase(title, query) || has_phrase(artist, query) {
                300
            } else if title.starts_with(query) || artist.starts_with(query) {
                260
            } else if query == album {
                220
            } else if near(query, title)
                || near(query, artist)
                || ((artist.len() + title.len() + 1).abs_diff(query.len()) <= 4
                    && (near(query, &format!("{artist} {title}"))
                        || near(query, &format!("{title} {artist}"))))
            {
                360
            } else {
                coverage.min(8) * 14
            }
        };
        let missing = self.versions & !versions;
        // A version word can also be the actual name of a track or performer.
        let mismatch = if base >= 550 && (query == title || query == artist) {
            0
        } else {
            missing.count_ones() as i32 * 120
        };
        let unrequested = versions & !self.versions;
        let penalties = [90, 90, 90, 120, 110, 100, 360, 360, 90, 90];
        let noise: i32 = penalties
            .into_iter()
            .enumerate()
            .filter(|(i, _)| unrequested & (1 << i) != 0)
            .map(|(_, penalty)| penalty)
            .sum();
        base - mismatch - noise
    }
}

fn read_u32(input: &mut &[u8]) -> Option<u32> {
    let (word, rest) = input.split_at_checked(4)?;
    *input = rest;
    Some(u32::from_le_bytes(word.try_into().ok()?))
}

fn read_text<'a>(input: &mut &'a [u8]) -> Option<&'a str> {
    let size = read_u32(input)? as usize;
    let (text, rest) = input.split_at_checked(size)?;
    *input = rest;
    std::str::from_utf8(text).ok()
}

fn rank(input: &[u8]) -> Option<Vec<u8>> {
    if input.len() > MAX_INPUT {
        return None;
    }
    let (&version, rest) = input.split_first()?;
    if version != VERSION {
        return None;
    }
    let (&mode, mut input) = rest.split_first()?;
    let raw_query = read_text(&mut input)?;
    let alternate = variants(raw_query);
    if mode == VARIANTS && input.is_empty() {
        return Some(alternate.join("\n").into_bytes());
    }
    if mode > 1 {
        return None;
    }
    let primary = Query::new(normalize(raw_query));
    let alternate: Vec<_> = alternate.into_iter().map(Query::new).collect();
    let count = read_u32(&mut input)?;
    if count > MAX_ROWS || count as usize > input.len() / 32 {
        return None;
    }
    let mut scores = Vec::with_capacity(count as usize);
    let mut titles = HashMap::new();
    let mut artists = HashMap::new();
    let mut albums = HashMap::new();
    let mut match_scores = HashMap::new();
    let mut strong = false;
    for index in 0..count {
        let raw_title = read_text(&mut input)?;
        let raw_artist = read_text(&mut input)?;
        let raw_album = read_text(&mut input)?;
        let (title, versions) = titles.entry(raw_title).or_insert_with(|| {
            let text = normalize(raw_title);
            let versions = modifiers(&text);
            (text, versions)
        });
        let artist = artists
            .entry(raw_artist)
            .or_insert_with(|| normalize(raw_artist));
        let album = albums
            .entry(raw_album)
            .or_insert_with(|| normalize(raw_album));
        let id = read_text(&mut input)?;
        let flags = read_u32(&mut input)?;
        let provider_rank = read_u32(&mut input)?;
        let top_rank = read_u32(&mut input)?;
        let duration = read_u32(&mut input)?;
        if flags > 7 {
            return None;
        }
        if mode == 1 && artist.is_empty() {
            continue;
        }
        let (primary_score, relevance) = *match_scores
            .entry((raw_artist, raw_title, raw_album))
            .or_insert_with(|| {
                let primary_score = primary.relevance(artist, title, album, *versions, false);
                let relevance = if primary_score >= 470 {
                    primary_score
                } else {
                    alternate.iter().fold(primary_score, |score, query| {
                        score.max(query.relevance(artist, title, album, *versions, true) - 145)
                    })
                };
                (primary_score, relevance)
            });
        strong |= primary_score >= (if mode == 0 { 470 } else { 600 }) && flags & 4 == 0;
        let quality = (if flags & 1 != 0 { 9 } else { 0 }) + (if flags & 2 != 0 { 4 } else { 0 })
            - (if flags & 4 != 0 { 500 } else { 0 });
        let popularity = if top_rank > 0
            && *versions & !primary.versions == 0
            && has_phrase(artist, &primary.text)
        {
            (550 - relevance).max(0) + 45 + 5 * (13 - top_rank.min(12) as i32)
        } else {
            0
        };
        let provider_order = if provider_rank > 0 && popularity == 0 {
            24 - provider_rank.min(24) as i32
        } else {
            0
        };
        // Keep alternate recordings distinct, while preferring the best copy of identical metadata.
        let identity = if mode == 1 {
            artist.clone()
        } else if title.is_empty() || artist.is_empty() {
            format!("{id}\0{index}")
        } else {
            format!("{artist}\0{title}")
        };
        scores.push((
            relevance + quality + popularity + provider_order,
            index,
            identity,
            duration,
            id,
        ));
    }
    if !input.is_empty() {
        return None;
    }
    scores.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut seen: HashMap<String, Vec<u32>> = HashMap::new();
    let mut seen_ids = HashSet::new();
    let mut output = vec![u8::from(strong)];
    for (_, index, identity, duration, id) in scores {
        if mode == 0 && !seen_ids.insert(id) {
            continue;
        }
        let versions = seen.entry(identity).or_default();
        if versions
            .iter()
            .any(|&known| known == 0 || duration == 0 || known.abs_diff(duration) <= 8)
        {
            continue;
        }
        versions.push(duration);
        output.extend(index.to_le_bytes());
    }
    Some(output)
}

#[no_mangle]
pub extern "C" fn rank_search(length: usize) -> i32 {
    let result = INPUT.with(|input| rank(input.borrow().get(..length)?));
    OUTPUT.with(|output| {
        let mut output = output.borrow_mut();
        output.clear();
        match result {
            Some(bytes) => {
                *output = bytes;
                output.len() as i32
            }
            None => -1,
        }
    })
}
