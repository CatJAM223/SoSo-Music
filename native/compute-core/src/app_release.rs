//! Decisions about stable desktop releases and their short notes.
use crate::{INPUT, OUTPUT};

fn version(tag: &str) -> Option<([u64; 3], &str)> {
    let value = tag.strip_prefix('v').unwrap_or(tag);
    let mut parts = value.split('.');
    let mut numbers = [0; 3];
    for number in &mut numbers {
        let part = parts.next()?;
        if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        *number = part.parse().ok()?;
        if *number > 9_007_199_254_740_991 {
            return None;
        }
    }
    parts.next().is_none().then_some((numbers, value))
}

fn heading(line: &str) -> Option<(&str, &str)> {
    let (marks, text) = line.split_once(char::is_whitespace)?;
    (!marks.is_empty() && marks.len() <= 6 && marks.bytes().all(|byte| byte == b'#'))
        .then_some((marks, text.trim()))
}

fn bullet(line: &str) -> Option<&str> {
    let (mark, text) = line.split_once(char::is_whitespace)?;
    matches!(mark, "-" | "*" | "+").then_some(text.trim())
}

fn highlights(body: &str) -> Option<(String, Vec<String>)> {
    let mut lines = body.lines().map(str::trim);
    lines.find(|line| {
        heading(line).is_some_and(|(level, text)| {
            level == "##" && (text == "Главное" || text.eq_ignore_ascii_case("Highlights"))
        })
    })?;
    let mut lines = lines
        .take_while(|line| heading(line).is_none())
        .filter(|line| !line.is_empty());
    let plain = |line: &str, limit| -> String {
        line.replace("**", "").trim().chars().take(limit).collect()
    };
    let first = lines.next()?;
    let summary = plain(bullet(first).unwrap_or(first), 180);
    if summary.is_empty() {
        return None;
    }
    let mut changes = Vec::with_capacity(3);
    for line in lines.filter_map(bullet) {
        let line = plain(line, 220);
        if !line.is_empty() && !changes.contains(&line) {
            changes.push(line);
            if changes.len() == 3 {
                break;
            }
        }
    }
    Some((summary, changes))
}

fn write_text(output: &mut Vec<u8>, value: &str) {
    output.extend((value.len() as u32).to_le_bytes());
    output.extend(value.bytes());
}

fn release(unstable: bool, current: &str, tag: &str, body: &str) -> Vec<u8> {
    if unstable {
        return vec![3];
    }
    let Some(((current, _), (release, name))) = version(current).zip(version(tag)) else {
        return vec![0];
    };
    let mut output = vec![if release > current { 2 } else { 1 }];
    write_text(&mut output, name);
    if release > current {
        if let Some((summary, changes)) = highlights(body) {
            write_text(&mut output, &summary);
            for change in changes {
                write_text(&mut output, &change);
            }
        }
    }
    output
}

fn read_text<'a>(input: &mut &'a [u8]) -> Option<&'a str> {
    let length = u32::from_le_bytes(input.get(..4)?.try_into().ok()?) as usize;
    let value = input.get(4..4 + length)?;
    *input = input.get(4 + length..)?;
    std::str::from_utf8(value).ok()
}

fn read_packet(input: &[u8]) -> Option<Vec<u8>> {
    let (&flags, mut rest) = input.split_first()?;
    let current = read_text(&mut rest)?;
    let tag = read_text(&mut rest)?;
    let body = read_text(&mut rest)?;
    (flags <= 1 && rest.is_empty()).then(|| release(flags != 0, current, tag, body))
}

#[no_mangle]
pub extern "C" fn app_release(length: usize) -> i32 {
    OUTPUT.with(|out| out.borrow_mut().clear());
    INPUT.with(|input| {
        let input = input.borrow();
        let Some(output) = input.get(..length).and_then(read_packet) else {
            return -1;
        };
        let length = output.len() as i32;
        OUTPUT.with(|out| *out.borrow_mut() = output);
        length
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_validates_versions_and_respects_stability() {
        assert_eq!(release(false, "3.9.0", "v3.10.0", "")[0], 2);
        assert_eq!(release(false, "3.0.0", "3.0.0", "")[0], 1);
        assert_eq!(release(false, "3.0.0", "2.9.6", "")[0], 1);
        assert_eq!(release(false, "3.0.0", "v3.1.0-beta", ""), [0]);
        assert_eq!(release(false, "3.0.0", "3.0.0/../../evil", ""), [0]);
        assert_eq!(release(false, "3.0.0", "9007199254740992.1.0", ""), [0]);
        assert_eq!(release(true, "3.0.0", "v3.1.0", ""), [3]);
    }

    #[test]
    fn reads_only_the_release_summary_and_three_distinct_changes() {
        let text = "# Release\r\n## Главное\r\n\r\nРеже повторяются песни.\r\n- **Первое**\n- Первое\n- Второе\n- Третье\n- Четвёртое\n## Детали\n- Другое";
        let (summary, changes) = highlights(text).unwrap();
        assert_eq!(summary, "Реже повторяются песни.");
        assert_eq!(changes, ["Первое", "Второе", "Третье"]);
        assert_eq!(highlights("## Главное\n## Другой раздел\nТекст"), None);
        assert_eq!(highlights("## Other\n- Something"), None);
        assert_eq!(highlights("## Highlights\nNext").unwrap().0, "Next");
    }
}
