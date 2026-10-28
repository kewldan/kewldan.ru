//! The board's history, for the timelapse and the admin's rewind.
//!
//! Every change is one line of text: `{ms} p {i}:{b},{i}:{b}` for painted
//! cells (`b` is the cell's byte, as in [`super::board`]) and `{ms} b {board}`
//! for a whole new board. `base` is the board just before the first line.
//! Past [`MAX`] lines the oldest are folded into `base` until [`KEEP`] remain,
//! so the history covers the last few days of painting, not all of it.

use std::collections::VecDeque;

use super::{
    board::{self, Board},
    protocol::Cell,
};

pub const MAX: usize = 30_000;
pub const KEEP: usize = 25_000;

pub fn paint_line(ms: u64, cells: &[Cell]) -> String {
    let cells: Vec<String> = cells
        .iter()
        .map(|&(i, c)| format!("{i}:{}", char::from(board::encode_cell(c))))
        .collect();
    format!("{ms} p {}", cells.join(","))
}

pub fn board_line(ms: u64, board: &str) -> String {
    format!("{ms} b {board}")
}

pub enum Change {
    Paint(Vec<Cell>),
    Board(Board),
}

pub struct Entry {
    pub ms: u64,
    pub change: Change,
}

pub fn parse(line: &str) -> Option<Entry> {
    let mut parts = line.splitn(3, ' ');
    let ms = parts.next()?.parse().ok()?;
    let change = match (parts.next()?, parts.next()?) {
        ("b", raw) => Change::Board(Board::decode(raw.as_bytes())?),
        ("p", raw) => Change::Paint(
            raw.split(',')
                .map(|cell| {
                    let (i, b) = cell.split_once(':')?;
                    let i: u16 = i.parse().ok()?;
                    let c = board::decode_cell(*b.as_bytes().first()?)?;
                    board::is_valid_cell(i, c).then_some((i, c))
                })
                .collect::<Option<_>>()?,
        ),
        _ => return None,
    };
    Some(Entry { ms, change })
}

pub fn apply(board: &mut Board, change: &Change) {
    match change {
        Change::Paint(cells) => {
            for &(i, c) in cells {
                board.set(i, c);
            }
        }
        Change::Board(b) => *board = b.clone(),
    }
}

/// The board as it was at `at` (Unix ms): `base` plus every line up to then.
pub fn board_at(base: &Board, lines: &[String], at: u64) -> Board {
    let mut board = base.clone();
    for entry in lines.iter().filter_map(|l| parse(l)) {
        if entry.ms > at {
            break;
        }
        apply(&mut board, &entry.change);
    }
    board
}

/// The history kept in process when there is no Valkey.
pub struct Memory {
    pub base: Board,
    pub lines: VecDeque<String>,
}

impl Memory {
    pub fn new(base: Board) -> Self {
        Self {
            base,
            lines: VecDeque::new(),
        }
    }

    pub fn push(&mut self, line: String) {
        self.lines.push_back(line);
        if self.lines.len() <= MAX {
            return;
        }
        while self.lines.len() > KEEP {
            let old = self.lines.pop_front().expect("longer than KEEP");
            if let Some(entry) = parse(&old) {
                apply(&mut self.base, &entry.change);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_roundtrip() {
        let line = paint_line(1_700, &[(5, 3), (2047, board::EMPTY)]);
        assert_eq!(line, "1700 p 5:3,2047:.");
        let Some(Entry {
            ms: 1_700,
            change: Change::Paint(cells),
        }) = parse(&line)
        else {
            panic!("bad parse");
        };
        assert_eq!(cells, vec![(5, 3), (2047, board::EMPTY)]);
        assert!(parse("12 p 9999:1").is_none());
        assert!(parse("12 b short").is_none());
    }

    #[test]
    fn rewinds_to_a_moment() {
        let base = Board::empty();
        let lines = vec![
            paint_line(10, &[(0, 1)]),
            paint_line(20, &[(0, 2), (1, 2)]),
            board_line(30, &Board::seed().encode()),
        ];
        assert_eq!(board_at(&base, &lines, 5).get(0), board::EMPTY);
        assert_eq!(board_at(&base, &lines, 10).get(0), 1);
        let at_20 = board_at(&base, &lines, 25);
        assert_eq!((at_20.get(0), at_20.get(1)), (2, 2));
        assert_eq!(board_at(&base, &lines, 99).encode(), Board::seed().encode());
    }

    #[test]
    fn folds_old_lines_into_the_base() {
        let mut h = Memory::new(Board::empty());
        for n in 0..=MAX as u64 {
            h.push(paint_line(n, &[((n % 2048) as u16, 4)]));
        }
        assert_eq!(h.lines.len(), KEEP);
        // Line 0 painted cell 0; it now lives in the base.
        assert_eq!(h.base.get(0), 4);
        assert!(
            h.lines
                .front()
                .unwrap()
                .starts_with(&format!("{} ", MAX + 1 - KEEP))
        );
    }
}
