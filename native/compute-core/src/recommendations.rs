//! Recommendation decisions shared by the main process and renderer. No JS fallback.
use crate::{read_job, same_song, INPUT, MAX_INPUT, OUTPUT};

#[no_mangle]
pub extern "C" fn wave_duration_allowed(duration: f64) -> u32 {
    u32::from(duration.is_finite() && (duration == 0.0 || (30.0..=600.0).contains(&duration)))
}

/// Brief auditions only cool down for half an hour; substantial listening for one day.
#[no_mangle]
pub extern "C" fn wave_memory_ttl(seconds: f64, duration: f64) -> f64 {
    if !seconds.is_finite() || seconds < 0.5 {
        return 0.0;
    }
    let substantial = if duration.is_finite() && duration > 0.0 {
        (duration * 0.5).min(60.0)
    } else {
        60.0
    };
    if seconds >= substantial {
        86_400_000.0
    } else {
        1_800_000.0
    }
}

#[no_mangle]
pub extern "C" fn daily_refill(count: u32, attempt: u32, added: u32) -> u32 {
    u32::from(count < 5 && attempt < 3 && (attempt == 0 || added > 0))
}

#[no_mangle]
pub extern "C" fn daily_cache_fresh(count: u32, age_ms: f64) -> u32 {
    u32::from(count >= 5 || (age_ms.is_finite() && (0.0..300_000.0).contains(&age_ms)))
}

#[no_mangle]
pub extern "C" fn daily_artist_feedback(count: u32) -> f64 {
    -0.75 * count.min(2) as f64
}

#[no_mangle]
pub extern "C" fn wave_search_limit(base: u32, exposed: u32, attempt: u32) -> u32 {
    base.saturating_add(exposed.saturating_mul(2))
        .saturating_add(attempt.saturating_mul(15))
        .min(40)
}

#[no_mangle]
pub extern "C" fn wave_search_retry(count: u32, attempt: u32) -> u32 {
    u32::from(count < 15 && attempt < 2)
}

#[no_mangle]
pub extern "C" fn taste_age_weight(age_ms: f64) -> f64 {
    if !age_ms.is_finite() {
        return 0.0;
    }
    0.5_f64.powf(age_ms.max(0.0) / (90.0 * 86_400_000.0))
}

#[no_mangle]
pub extern "C" fn taste_history_score(raw: f64, known: f64, weighted: f64, legacy_age: f64) -> f64 {
    if !raw.is_finite() || !known.is_finite() || !weighted.is_finite() {
        return 0.0;
    }
    (raw - known).clamp(-12.0, 12.0) * taste_age_weight(legacy_age) + weighted
}

#[no_mangle]
pub extern "C" fn album_match_score(
    valid: u32,
    exact: u32,
    contained: u32,
    wanted_version: u32,
    actual_version: u32,
) -> u32 {
    if valid == 0 {
        0
    } else if exact != 0 {
        3
    } else if contained != 0 && wanted_version == actual_version {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_history_and_edition_compatibility() {
        assert!((taste_age_weight(90.0 * 86_400_000.0) - 0.5).abs() < 1e-10);
        assert_eq!(taste_history_score(1000.0, 0.0, 0.0, 0.0), 12.0);
        assert_eq!(taste_history_score(4.0, 4.0, 2.0, 0.0), 2.0);
        assert_eq!(taste_history_score(0.0, 0.0, 0.0, 0.0), 0.0);
        assert_eq!(album_match_score(1, 1, 1, 0, 0), 3);
        assert_eq!(album_match_score(1, 0, 1, 0, 1), 0);
        assert_eq!(wave_search_limit(10, 0, 2), 40);
        assert_eq!(wave_search_limit(10, 500, 2), 40);
    }
    #[test]
    fn duration_and_audition_boundaries() {
        assert_eq!(wave_duration_allowed(600.0), 1);
        assert_eq!(wave_duration_allowed(600.01), 0);
        assert_eq!(wave_duration_allowed(f64::NAN), 0);
        assert_eq!(wave_memory_ttl(0.49, 180.0), 0.0);
        assert_eq!(wave_memory_ttl(2.0, 180.0), 1_800_000.0);
        assert_eq!(wave_memory_ttl(60.0, 180.0), 86_400_000.0);
        assert_eq!(daily_cache_fresh(2, 300_000.0), 0);
        assert_eq!(daily_cache_fresh(5, 864_000.0), 1);
        assert_eq!(daily_refill(3, 3, 25), 0);
        assert_eq!(daily_refill(3, 1, 0), 0);
    }
}

/// Song packet + exact provider IDs + unavailable flags. Returns indices or rejection counts.
fn run(bytes: &[u8], mode: u32) -> Option<Vec<u8>> {
    let size = u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    let mut job = read_job(bytes.get(4..4usize.checked_add(size)?)?)?;
    for song in job
        .candidates
        .iter_mut()
        .chain(job.recent.iter_mut())
        .chain(job.offered.iter_mut())
    {
        if !crate::prepare(song, &job.tokens) {
            return None;
        }
    }
    let total = job.candidates.len() + job.recent.len() + job.offered.len();
    let tail = bytes.get(4 + size..)?;
    if tail.len() != (total + job.candidates.len() + 1) * 4 {
        return None;
    }
    let words: Vec<u32> = tail
        .chunks_exact(4)
        .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    let n = job.candidates.len();
    let blocked_ids = &words[n + job.recent.len()..total];
    let counts: Vec<u32> = job
        .candidates
        .iter()
        .map(|candidate| {
            candidate
                .artists
                .iter()
                .map(|artist| {
                    let mut rejected = Vec::new();
                    for (i, song) in job.offered.iter().enumerate() {
                        if song.artists.contains(artist)
                            && !rejected.iter().any(|&j: &usize| {
                                blocked_ids[j] == blocked_ids[i]
                                    || same_song(&job.offered[j], song, &job.tokens)
                            })
                        {
                            rejected.push(i);
                            if rejected.len() == 2 {
                                break;
                            }
                        }
                    }
                    rejected.len().min(2) as u32
                })
                .max()
                .unwrap_or(0)
        })
        .collect();
    if mode == 1 {
        return Some(counts.iter().flat_map(|v| v.to_le_bytes()).collect());
    }
    let mut ranked: Vec<usize> = (0..n).collect();
    let preserve = words[total + n] as usize;
    if preserve > n {
        return None;
    }
    ranked.sort_by_key(|&i| (i >= preserve, if i < preserve { 0 } else { counts[i] }));
    let mut selected: Vec<usize> = Vec::new();
    for limit in [1, 2] {
        for &i in &ranked {
            if selected.len() == 5 {
                break;
            }
            let song = &job.candidates[i];
            if words[total + i] != 0
                || (mode != 2 && song.artists.is_empty())
                || selected.contains(&i)
                || blocked_ids.contains(&words[i])
                || job.offered.iter().any(|s| same_song(s, song, &job.tokens))
                || job
                    .recent
                    .iter()
                    .enumerate()
                    .any(|(j, s)| words[n + j] == words[i] || same_song(s, song, &job.tokens))
                || selected.iter().any(|&j| {
                    words[j] == words[i] || same_song(&job.candidates[j], song, &job.tokens)
                })
                || (i >= preserve
                    && song.artists.iter().any(|a| {
                        selected
                            .iter()
                            .filter(|&&j| job.candidates[j].artists.contains(a))
                            .count()
                            >= limit
                    }))
            {
                continue;
            }
            selected.push(i);
        }
    }
    Some(
        selected
            .iter()
            .flat_map(|&i| (i as u32).to_le_bytes())
            .collect(),
    )
}

fn dispatch(length: usize, mode: u32) -> i32 {
    OUTPUT.with(|out| out.borrow_mut().clear());
    INPUT.with(|input| {
        let input = input.borrow();
        let Some(result) = input
            .get(..length)
            .filter(|_| length <= MAX_INPUT)
            .and_then(|b| run(b, mode))
        else {
            return -1;
        };
        let size = result.len() as i32;
        OUTPUT.with(|out| *out.borrow_mut() = result);
        size
    })
}
#[no_mangle]
pub extern "C" fn daily_select(length: usize) -> i32 {
    dispatch(length, 0)
}
#[no_mangle]
pub extern "C" fn daily_rejections(length: usize) -> i32 {
    dispatch(length, 1)
}

#[no_mangle]
pub extern "C" fn daily_accepts(length: usize) -> i32 {
    dispatch(length, 2)
}
