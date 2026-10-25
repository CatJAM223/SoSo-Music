//! Complete Wave preparation, taste scoring, filtering and selection. One Rust implementation.
use super::ranking::{Candidate, Job as RankJob, Profile};
use super::{prepare, read_job, same_song, Cursor, Song, Token, INPUT, MAX_INPUT, OUTPUT};
struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl Reader<'_> {
    fn raw(&mut self) -> Option<f64> {
        let end = self.offset.checked_add(8)?;
        let value = f64::from_le_bytes(self.bytes.get(self.offset..end)?.try_into().ok()?);
        self.offset = end;
        Some(value)
    }
    fn number(&mut self) -> Option<f64> {
        let v = self.raw()?;
        v.is_finite().then_some(v)
    }
    fn int(&mut self, max: usize) -> Option<usize> {
        let v = self.number()?;
        (v >= 0.0 && v <= max as f64 && v.fract() == 0.0).then_some(v as usize)
    }
    fn flag(&mut self) -> Option<bool> {
        Some(self.int(1)? == 1)
    }
    fn ids(&mut self, max: usize) -> Option<Vec<usize>> {
        let count = self.int(max)?;
        (0..count).map(|_| self.int(65535)).collect()
    }
    fn profile(&mut self) -> Option<Profile> {
        let energy = self.number()?;
        if !(-1.0..=1.0).contains(&energy) {
            return None;
        }
        Some(Profile {
            energy,
            styles: self.ids(64)?,
        })
    }
}
struct Aux {
    artists: Vec<usize>,
    profile: Profile,
    id: usize,
    liked: bool,
}
struct RawCandidate {
    valid: bool,
    version: usize,
    source: usize,
    duration: f64,
    radio: Option<f64>,
    genre: f64,
    album: bool,
    non_song: bool,
}
fn similarity(a: &Profile, b: &Profile) -> f64 {
    if a.styles.is_empty() || b.styles.is_empty() {
        return 0.0;
    }
    let shared = a.styles.iter().filter(|id| b.styles.contains(id)).count();
    shared as f64 / ((a.styles.len() * b.styles.len()) as f64).sqrt()
        * if a.energy * b.energy < 0.0 { 0.2 } else { 1.0 }
}
pub(super) fn mood_score(energy: f64, mood: usize) -> f64 {
    if mood == 1 {
        energy * 12.0
    } else if mood == 2 {
        -energy * 12.0
    } else {
        0.0
    }
}
pub(super) fn discovery(mood: usize, adjustment: f64) -> f64 {
    let (base, low, high) = match mood {
        3 => (0.75, 0.6, 0.9),
        4 => (0.5, 0.3, 0.7),
        5 => (0.25, 0.1, 0.35),
        0 => (0.25, 0.1, 0.4),
        _ => (1.0 / 3.0, 0.15, 0.55),
    };
    let change = if adjustment.is_finite() {
        adjustment.clamp(-0.2, 0.2)
    } else {
        0.0
    };
    (base + change).clamp(low, high)
}
fn genre_score(profile: &Profile, genres: &[(usize, f64)]) -> f64 {
    let dominant = genres.iter().map(|(_, s)| *s).fold(0.0_f64, f64::max);
    if profile.styles.is_empty() || dominant == 0.0 {
        return 0.0;
    }
    let matched = genres
        .iter()
        .filter(|(id, _)| profile.styles.contains(id))
        .map(|(_, s)| *s)
        .fold(0.0_f64, f64::max);
    if matched > 0.0 {
        matched / dominant * 6.0
    } else {
        -2.0
    }
}
fn feedback_score(artists: &[usize], feedback: &[f64]) -> f64 {
    let mut negative = 0.0_f64;
    let mut positive = 0.0_f64;
    for &id in artists {
        let v = feedback[id];
        negative = negative.min(v);
        positive = positive.max(v);
    }
    (if negative != 0.0 { negative } else { positive }).clamp(-3.0, 3.0) * 4.0
}
fn music_score(
    profile: &Profile,
    mood: usize,
    taste: &[&Profile],
    positives: &[&Profile],
    skipped: &[&Profile],
    learned: &[&Profile],
) -> f64 {
    let affinity = |pool: &[&Profile], decay: f64| {
        pool.iter()
            .enumerate()
            .map(|(i, p)| similarity(profile, p) * decay.powf(i as f64))
            .fold(0.0_f64, f64::max)
    };
    let negative_evidence = skipped.iter().enumerate().fold(0.0, |sum, (i, p)| {
        sum + similarity(profile, p) * 0.75_f64.powf(i as f64)
    });
    let positive =
        affinity(positives, 0.85) * (1.0 - (negative_evidence - 1.5).max(0.0) / 0.75).max(0.0);
    let negative = (negative_evidence / 2.0).min(1.0);
    let mut score = mood_score(profile.energy, mood)
        + affinity(taste, 1.0) * 2.0
        + affinity(learned, 1.0) * 1.5
        + positive * 4.0;
    score -= (negative - positive).max(0.0) * 4.0;
    score
}
fn profiles(aux: &[Aux], start: usize, count: usize, limit: usize) -> Vec<&Profile> {
    let mut ids = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in &aux[start..start + count] {
        if ids.insert(item.id) {
            out.push(&item.profile);
            if out.len() >= limit {
                break;
            }
        }
    }
    out
}
fn liked(
    index: usize,
    aux: &[Aux],
    songs: &[Song],
    liked_indices: &[usize],
    tokens: &[Token],
) -> bool {
    aux[index].liked
        || liked_indices
            .iter()
            .any(|&i| aux[i].id == aux[index].id || same_song(&songs[i], &songs[index], tokens))
}
fn execute(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut cursor = Cursor { bytes, offset: 0 };
    let length = cursor.word()? as usize;
    let end = cursor.offset.checked_add(length)?;
    let mut songs = read_job(bytes.get(cursor.offset..end)?)?;
    if !songs.recent.is_empty() || !songs.offered.is_empty() {
        return None;
    }
    for song in &mut songs.candidates {
        if !prepare(song, &songs.tokens) {
            return None;
        }
    }
    let mut r = Reader {
        bytes: bytes.get(end..)?,
        offset: 0,
    };
    if r.int(u32::MAX as usize)? != 0x46574f53 || r.int(3)? != 3 {
        return None;
    }
    let mood = r.int(5)?;
    let limit = r.int(4096)?;
    let offset = r.number()?;
    if offset < 0.0 || offset.fract() != 0.0 {
        return None;
    }
    let adjustment = r.raw()?;
    let counts: Option<Vec<usize>> = (0..7).map(|_| r.int(4096)).collect();
    let sizes = counts?;
    if sizes.iter().sum::<usize>() != songs.candidates.len() {
        return None;
    }
    let mut starts = [0usize; 7];
    for i in 1..7 {
        starts[i] = starts[i - 1] + sizes[i - 1];
    }
    let has_genres = r.flag()?;
    let familiar = r.ids(65536)?;
    let feedback_count = r.int(65536)?;
    let mut feedback = vec![0.0; 65536];
    for _ in 0..feedback_count {
        let id = r.int(65535)?;
        let v = r.raw()?;
        feedback[id] = if v.is_nan() { 0.0 } else { v };
    }
    let recent_artist_count = r.int(40)?;
    let mut recent: Vec<Vec<usize>> = (0..recent_artist_count)
        .map(|_| r.ids(64))
        .collect::<Option<_>>()?;
    let genre_count = r.int(4096)?;
    let mut genres = Vec::new();
    for _ in 0..genre_count {
        let id = r.int(65535)?;
        let share = r.raw()?;
        if share.is_finite() && share > 0.0 {
            genres.push((id, share));
        }
    }
    let mut aux = Vec::with_capacity(songs.candidates.len());
    for _ in 0..songs.candidates.len() {
        aux.push(Aux {
            artists: r.ids(64)?,
            profile: r.profile()?,
            id: r.int(65535)?,
            liked: r.flag()?,
        });
    }
    let mut raw = Vec::with_capacity(sizes[0]);
    for _ in 0..sizes[0] {
        let valid = r.flag()?;
        let version = r.int(15)?;
        let source = r.int(65536)?;
        let duration = r.raw()?;
        let has_radio = r.flag()?;
        let radio = r.number()?;
        raw.push(RawCandidate {
            valid,
            version,
            source,
            duration,
            radio: has_radio.then_some(radio),
            genre: r.raw()?,
            album: r.flag()?,
            non_song: r.flag()?,
        });
    }
    if r.offset != r.bytes.len() {
        return None;
    }
    let mut artist_counts = vec![0.0; 65536];
    recent.extend(
        aux[starts[1]..starts[1] + sizes[1]]
            .iter()
            .rev()
            .take(40)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|a| a.artists.clone()),
    );
    for group in recent.iter().rev().take(40) {
        for &id in group {
            artist_counts[id] += 1.0;
        }
    }
    let recent_music = (starts[1]..starts[1] + sizes[1]).rev().find(|&i| {
        !aux[starts[5]..starts[5] + sizes[5]]
            .iter()
            .any(|s| s.id == aux[i].id)
    });
    let previous = recent_music.map(|i| Profile {
        energy: aux[i].profile.energy,
        styles: aux[i].profile.styles.clone(),
    });
    let liked_indices: Vec<usize> = (starts[3]..starts[3] + sizes[3])
        .filter(|&i| aux[i].liked)
        .collect();
    let liked_artists: std::collections::HashSet<usize> = liked_indices
        .iter()
        .flat_map(|&i| aux[i].artists.iter().copied())
        .collect();
    let previous_liked = sizes[1] > 0
        && liked(
            starts[1] + sizes[1] - 1,
            &aux,
            &songs.candidates,
            &liked_indices,
            &songs.tokens,
        );
    let taste = profiles(&aux, starts[3], sizes[3], 48);
    let positive = profiles(&aux, starts[4], sizes[4], 12);
    let skipped = profiles(&aux, starts[5], sizes[5], 12);
    let learned = profiles(&aux, starts[6], sizes[6], 48);
    let mut candidates = Vec::new();
    let mut original = Vec::new();
    let mut priorities = Vec::new();
    for (i, raw) in raw.iter().enumerate() {
        if !raw.valid
            || (starts[1]..starts[1] + sizes[1])
                .any(|h| same_song(&songs.candidates[h], &songs.candidates[i], &songs.tokens))
        {
            continue;
        }
        let a = &aux[i];
        let known = a.artists.iter().any(|id| familiar.contains(id));
        let version = if raw.version & 1 != 0 {
            18.0
        } else if raw.version & 2 != 0 {
            8.0
        } else if raw.version & 4 != 0 {
            3.0
        } else if raw.version & 8 != 0 {
            1.0
        } else {
            0.0
        };
        let exposed = (starts[2]..starts[2] + sizes[2])
            .any(|o| same_song(&songs.candidates[o], &songs.candidates[i], &songs.tokens));
        let offered_artist_count = aux[starts[2]..starts[2] + sizes[2]]
            .iter()
            .rev()
            .take(25)
            .filter(|o| o.artists.iter().any(|id| a.artists.contains(id)))
            .count();
        let exact_like = liked_indices
            .iter()
            .any(|&l| same_song(&songs.candidates[l], &songs.candidates[i], &songs.tokens));
        let has_liked_artist = a.artists.iter().any(|id| liked_artists.contains(id));
        let genre = if has_genres {
            genre_score(&a.profile, &genres)
        } else if raw.genre.is_finite() {
            raw.genre.clamp(-2.0, 6.0)
        } else {
            0.0
        };
        candidates.push(Candidate {
            matrix_index: candidates.len(),
            artists: a.artists.clone(),
            profile: Profile {
                energy: a.profile.energy,
                styles: a.profile.styles.clone(),
            },
            known,
            liked: liked(i, &aux, &songs.candidates, &liked_indices, &songs.tokens),
            source: raw.source,
            music: music_score(&a.profile, mood, &taste, &positive, &skipped, &learned) + genre,
            like: if has_liked_artist {
                if exact_like {
                    2.0
                } else {
                    1.0
                }
            } else {
                0.0
            },
            exposure: (if exposed { 8.0 } else { 0.0 }) + offered_artist_count.min(4) as f64,
            version,
            radio: raw.radio.map(|v| v.clamp(0.0, 1.0)).unwrap_or(-1.0),
            feedback: feedback_score(&a.artists, &feedback),
            album: raw.album,
            duration: raw.duration >= 150.0 && raw.duration <= 360.0,
            non_song: raw.non_song,
        });
        original.push(i);
        priorities.push(version + if known { 0.0 } else { 0.5 });
    }
    let count = candidates.len();
    let mut pairs = vec![0; count * count];
    for i in 0..count {
        for j in 0..count {
            pairs[i * count + j] = u8::from(same_song(
                &songs.candidates[original[i]],
                &songs.candidates[original[j]],
                &songs.tokens,
            ));
        }
    }
    let keep: Vec<bool> = (0..count)
        .map(|i| !(0..count).any(|j| priorities[j] < priorities[i] && pairs[i * count + j] == 1))
        .collect();
    let mapping: Vec<usize> = original
        .iter()
        .enumerate()
        .filter(|(i, _)| keep[*i])
        .map(|(_, id)| *id)
        .collect();
    let candidates = candidates
        .into_iter()
        .enumerate()
        .filter(|(i, _)| keep[*i])
        .map(|(_, c)| c)
        .collect();
    let result = super::ranking::calculate(RankJob {
        candidates,
        pairs,
        matrix_count: count,
        limit,
        mood,
        previous_liked,
        novelty: discovery(mood, adjustment),
        phase: if mood == 3 { 0.75 } else { 0.0 },
        offset,
        counts: artist_counts,
        recent,
        previous,
    });
    Some(
        result
            .chunks_exact(4)
            .flat_map(|bytes| {
                let index = u32::from_le_bytes(bytes.try_into().unwrap()) as usize;
                (mapping[index] as u32).to_le_bytes()
            })
            .collect(),
    )
}
#[no_mangle]
pub extern "C" fn sequence_wave(length: usize) -> i32 {
    OUTPUT.with(|output| output.borrow_mut().clear());
    INPUT.with(|input| {
        let input = input.borrow();
        let Some(bytes) = input.get(..length).filter(|_| length <= MAX_INPUT) else {
            return -1;
        };
        let Some(result) = execute(bytes) else {
            return -1;
        };
        let size = result.len();
        OUTPUT.with(|output| *output.borrow_mut() = result);
        size as i32
    })
}
#[no_mangle]
pub extern "C" fn wave_mood_score(energy: f64, mood: usize) -> f64 {
    mood_score(energy, mood)
}
#[no_mangle]
pub extern "C" fn wave_discovery_target(mood: usize, change: f64) -> f64 {
    discovery(mood, change)
}
#[no_mangle]
pub extern "C" fn bounded_genre_score(score: f64) -> f64 {
    if score.is_finite() {
        score.clamp(-2.0, 6.0)
    } else {
        0.0
    }
}
#[no_mangle]
pub extern "C" fn genre_affinity(length: usize) -> i32 {
    OUTPUT.with(|output| output.borrow_mut().clear());
    INPUT.with(|input| {
        let input = input.borrow();
        let Some(bytes) = input.get(..length).filter(|_| length <= MAX_INPUT) else {
            return -1;
        };
        let mut r = Reader { bytes, offset: 0 };
        let Some(styles) = r.ids(64) else {
            return -1;
        };
        let Some(count) = r.int(4096) else {
            return -1;
        };
        let mut genres = Vec::new();
        for _ in 0..count {
            let (Some(id), Some(share)) = (r.int(65535), r.raw()) else {
                return -1;
            };
            if share.is_finite() && share > 0.0 {
                genres.push((id, share));
            }
        }
        if r.offset != bytes.len() {
            return -1;
        }
        let result = genre_score(
            &Profile {
                styles,
                energy: 0.0,
            },
            &genres,
        )
        .to_le_bytes();
        OUTPUT.with(|output| *output.borrow_mut() = result.to_vec());
        8
    })
}

#[no_mangle]
pub extern "C" fn music_affinity(length: usize) -> i32 {
    OUTPUT.with(|output| output.borrow_mut().clear());
    INPUT.with(|input| {
        let input = input.borrow();
        let Some(bytes) = input.get(..length).filter(|_| length <= MAX_INPUT) else {
            return -1;
        };
        let mut r = Reader { bytes, offset: 0 };
        let Some(mood) = r.int(5) else {
            return -1;
        };
        let Some(profile) = r.profile() else {
            return -1;
        };
        let mut aux = Vec::new();
        let mut starts = [0; 4];
        let mut sizes = [0; 4];
        for pool in 0..4 {
            starts[pool] = aux.len();
            let Some(count) = r.int(4096) else {
                return -1;
            };
            sizes[pool] = count;
            for _ in 0..count {
                let (Some(id), Some(profile)) = (r.int(65535), r.profile()) else {
                    return -1;
                };
                aux.push(Aux {
                    artists: Vec::new(),
                    profile,
                    id,
                    liked: false,
                });
            }
        }
        if r.offset != bytes.len() {
            return -1;
        }
        let pools = [
            profiles(&aux, starts[0], sizes[0], 48),
            profiles(&aux, starts[1], sizes[1], 12),
            profiles(&aux, starts[2], sizes[2], 12),
            profiles(&aux, starts[3], sizes[3], 48),
        ];
        let result =
            music_score(&profile, mood, &pools[0], &pools[1], &pools[2], &pools[3]).to_le_bytes();
        OUTPUT.with(|output| *output.borrow_mut() = result.to_vec());
        8
    })
}
