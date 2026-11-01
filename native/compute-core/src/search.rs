//! Batched search scoring, first-occurrence deduplication and stable ranking.
use crate::{INPUT, MAX_INPUT, OUTPUT};
use std::collections::HashSet;
const HEADER: usize = 5;
const ROW: usize = 7;
fn rank(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.len() > MAX_INPUT || bytes.len() % 8 != 0 {
        return None;
    }
    let values: Vec<f64> = bytes
        .chunks_exact(8)
        .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
        .collect();
    if values.len() < HEADER
        || values.iter().any(|v| !v.is_finite())
        || values[0] != 1397900104.0
        || values[1] != 1.0
    {
        return None;
    }
    let integer = |v: f64, max: u32| -> Option<u32> {
        (v >= 0.0 && v <= max as f64 && v.fract() == 0.0).then_some(v as u32)
    };
    let count = integer(values[2], 65536)? as usize;
    if values.len() != HEADER + count * ROW {
        return None;
    }
    let split = integer(values[3], 1)? != 0;
    let exemptions = integer(values[4], 511)?;
    let mut seen = HashSet::with_capacity(count);
    let mut scores = Vec::with_capacity(count);
    for (index, row) in values[HEADER..].chunks_exact(ROW).enumerate() {
        let flags = integer(row[0], 1023)?;
        let matched = integer(row[1], 1_000_000)?;
        let total = integer(row[2], 1_000_000)?;
        if matched > total {
            return None;
        }
        let junk = integer(row[3], 255)?;
        let features = integer(row[4], 15)?;
        let duration = row[5];
        let identity = integer(row[6], 65536)?;
        if !seen.insert(identity) {
            continue;
        }
        let mut score = 50.0;
        if split {
            if flags & 1 != 0 {
                score += 170.0;
                if flags & 2 != 0 {
                    score += 70.0;
                }
            }
            if flags & 4 != 0 {
                score += 65.0;
            } else if flags & 8 != 0 {
                score -= 55.0;
            }
        }
        if flags & 16 != 0 {
            score += 160.0;
        }
        if flags & 32 != 0 {
            score += 65.0;
        } else if flags & 64 != 0 {
            score += 40.0;
        } else if flags & 128 != 0 {
            score += 25.0;
        }
        score += matched as f64 / total.max(1) as f64 * 40.0;
        if flags & 256 != 0 {
            score += 15.0;
        }
        if features & 1 != 0 {
            score += 30.0;
        } else if features & 2 != 0 {
            score += if features & 4 != 0 { 10.0 } else { -5.0 };
        }
        for (bit, penalty) in [75.0, 60.0, 50.0, 30.0, 65.0, 60.0, 55.0, 25.0]
            .iter()
            .enumerate()
        {
            if junk & (1 << bit) != 0 && exemptions & (1 << bit) == 0 {
                score -= penalty;
            }
        }
        if flags & 512 != 0 {
            score -= 45.0;
        }
        if duration > 900.0 {
            if exemptions & 256 == 0 {
                score -= 50.0;
            }
        } else if duration > 0.0 && duration < 35.0 {
            score -= 40.0;
        }
        if (150.0..=360.0).contains(&duration) {
            score += 10.0;
        }
        scores.push((index as u32, score));
    }
    scores.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    Some(
        scores
            .iter()
            .flat_map(|(index, _)| index.to_le_bytes())
            .collect(),
    )
}
#[no_mangle]
pub extern "C" fn rank_search(length: usize) -> i32 {
    let result = INPUT.with(|input| {
        let input = input.borrow();
        rank(input.get(..length)?)
    });
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

#[cfg(test)]
mod tests {
    use super::*;
    fn packet(values: &[f64]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_le_bytes()).collect()
    }
    #[test]
    fn invalid_packets_are_rejected() {
        assert!(rank(&[]).is_none());
        assert!(rank(&packet(&[1397900104.0, 1.0, 1.0, 0.0, 0.0])).is_none());
        assert!(rank(&packet(&[1397900104.0, 1.0, 0.0, 0.0, f64::NAN])).is_none());
    }
    #[test]
    fn first_duplicate_wins_and_ties_stay_stable() {
        let mut values = vec![1397900104.0, 1.0, 3.0, 0.0, 0.0];
        values.extend([0.0, 0.0, 0.0, 0.0, 0.0, 180.0, 0.0]);
        values.extend([32.0, 0.0, 0.0, 0.0, 0.0, 180.0, 0.0]);
        values.extend([0.0, 0.0, 0.0, 0.0, 0.0, 180.0, 1.0]);
        assert_eq!(
            rank(&packet(&values)).unwrap(),
            [0u32.to_le_bytes(), 2u32.to_le_bytes()].concat()
        );
    }
}
