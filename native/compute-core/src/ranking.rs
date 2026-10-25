//! Numeric Wave queue selection. Text normalization and stable object identities stay in JS.

pub(super) struct Profile {
    pub(super) energy: f64,
    pub(super) styles: Vec<usize>,
}
pub(super) struct Candidate {
    pub(super) matrix_index: usize,
    pub(super) artists: Vec<usize>,
    pub(super) profile: Profile,
    pub(super) known: bool,
    pub(super) liked: bool,
    pub(super) source: usize,
    pub(super) music: f64,
    pub(super) like: f64,
    pub(super) exposure: f64,
    pub(super) version: f64,
    pub(super) radio: f64,
    pub(super) feedback: f64,
    pub(super) album: bool,
    pub(super) duration: bool,
    pub(super) non_song: bool,
}
pub(super) struct Job {
    pub(super) candidates: Vec<Candidate>,
    pub(super) pairs: Vec<u8>,
    pub(super) matrix_count: usize,
    pub(super) limit: usize,
    pub(super) mood: usize,
    pub(super) previous_liked: bool,
    pub(super) novelty: f64,
    pub(super) phase: f64,
    pub(super) offset: f64,
    pub(super) counts: Vec<f64>,
    pub(super) recent: Vec<Vec<usize>>,
    pub(super) previous: Option<Profile>,
}
fn overlap(left: &[usize], right: &[usize]) -> bool {
    left.iter().any(|artist| right.contains(artist))
}
pub(super) fn transition(a: &Profile, b: Option<&Profile>, mood: usize) -> f64 {
    let Some(b) = b else { return 0.0 };
    let opposite = a.energy * b.energy < 0.0;
    let similarity = if a.styles.is_empty() || b.styles.is_empty() {
        0.0
    } else {
        let shared = a.styles.iter().filter(|id| b.styles.contains(id)).count();
        shared as f64 / ((a.styles.len() * b.styles.len()) as f64).sqrt()
            * if opposite { 0.2 } else { 1.0 }
    };
    if mood == 4 {
        -similarity * 3.0
    } else {
        similarity * 1.5 - if opposite { 1.0 } else { 0.0 }
    }
}
pub(super) fn calculate(mut job: Job) -> Vec<u8> {
    const DISTANCE: [f64; 8] = [48.0, 40.0, 32.0, 24.0, 18.0, 12.0, 8.0, 4.0];
    let mut remaining: Vec<usize> = (0..job.candidates.len()).collect();
    let mut selected: Vec<usize> = Vec::with_capacity(job.limit);
    let mut previous_source = 0;
    let mut previous_music = job.previous.as_ref();
    while !remaining.is_empty() && selected.len() < job.limit {
        let space_likes = job.mood != 5
            && job.previous_liked
            && remaining.iter().any(|&i| !job.candidates[i].liked);
        let position = job.offset + selected.len() as f64;
        let wants_familiar = ((position + 1.0) * job.novelty + job.phase + 1e-9).floor()
            == (position * job.novelty + job.phase + 1e-9).floor();
        let mut best_index = 0;
        let mut best_score = f64::NEG_INFINITY;
        for (index, &id) in remaining.iter().enumerate() {
            let c = &job.candidates[id];
            if space_likes && c.liked {
                continue;
            }
            let mut score = if c.known == wants_familiar {
                if job.mood == 3 {
                    12.0
                } else if job.mood == 4 {
                    8.0
                } else {
                    4.0
                }
            } else {
                0.0
            };
            score += if c.known { 0.5 } else { 0.0 };
            score -= c.exposure;
            score += c.like + c.music + transition(&c.profile, previous_music, job.mood);
            // radio == -1 represents an absent/non-finite provider value.
            if c.radio >= 0.0 {
                score += c.radio * 1.5;
            }
            score += c.feedback;
            let mut distance = 0.0;
            let mut density = 0;
            for (back, artists) in job.recent.iter().rev().take(12).enumerate() {
                if overlap(&c.artists, artists) {
                    density += 1;
                    if back < 8 && distance == 0.0 {
                        distance = DISTANCE[back];
                    }
                }
            }
            score -= distance;
            score -= if density >= 2 {
                (density - 1) as f64 * 24.0
            } else {
                0.0
            };
            let count = c
                .artists
                .iter()
                .map(|&id| job.counts[id])
                .fold(0.0_f64, f64::max);
            score -= count * 6.0;
            if previous_source != 0 && c.source != 0 && previous_source != c.source {
                score += 0.5;
            }
            if c.album {
                score += 0.4;
            }
            if c.duration {
                score += 0.3;
            }
            score -= c.version;
            if c.non_song {
                score -= 5.0;
            }
            score -= index as f64 * 0.001;
            if score > best_score {
                best_score = score;
                best_index = index;
            }
        }
        let id = remaining.remove(best_index);
        let chosen = &job.candidates[id];
        selected.push(id);
        job.previous_liked = chosen.liked;
        previous_source = chosen.source;
        previous_music = Some(&chosen.profile);
        job.recent.push(chosen.artists.clone());
        if job.recent.len() > 12 {
            job.recent.remove(0);
        }
        for &artist in &chosen.artists {
            job.counts[artist] += 1.0;
        }
        remaining.retain(|&other| {
            job.pairs[chosen.matrix_index * job.matrix_count + job.candidates[other].matrix_index]
                != 1
        });
    }
    selected
        .iter()
        .flat_map(|&id| (id as u32).to_le_bytes())
        .collect()
}
