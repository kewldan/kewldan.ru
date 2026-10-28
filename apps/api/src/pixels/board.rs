//! The 64×32 board and its wire encoding.
//!
//! A board is encoded as a 2048-character string, one byte per cell: `.` for
//! an empty cell, `'0' + c` for palette colour `c`. The same bytes live in
//! Valkey, so a single `SETRANGE` paints a cell.

pub const WIDTH: usize = 64;
pub const HEIGHT: usize = 32;
pub const CELLS: usize = WIDTH * HEIGHT;

/// Palette shared with the web app (`hello.palette`).
pub const PALETTE: [&str; 7] = [
    "#0d0d0f", "#ffe14d", "#7aa2ff", "#5fe39a", "#ff9a4d", "#2a35ff", "#ff8fd0",
];

pub const EMPTY: i8 = -1;
const EMPTY_BYTE: u8 = b'.';

#[derive(Clone)]
pub struct Board {
    cells: Box<[i8; CELLS]>,
}

impl Board {
    pub fn empty() -> Self {
        Self {
            cells: Box::new([EMPTY; CELLS]),
        }
    }

    /// The board a fresh deployment starts with: "kewldan" with an underline.
    pub fn seed() -> Self {
        const GLYPHS: [(char, [&str; 7]); 7] = [
            (
                'k',
                [
                    "#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#.",
                ],
            ),
            (
                'e',
                [
                    ".....", ".....", ".###.", "#...#", "#####", "#....", ".###.",
                ],
            ),
            (
                'w',
                [
                    ".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#.",
                ],
            ),
            ('l', ["##.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"]),
            (
                'd',
                [
                    "....#", "....#", ".##.#", "#..##", "#...#", "#...#", ".####",
                ],
            ),
            (
                'a',
                [
                    ".....", ".....", ".###.", "....#", ".####", "#...#", ".####",
                ],
            ),
            (
                'n',
                [
                    ".....", ".....", "#.##.", "##..#", "#...#", "#...#", "#...#",
                ],
            ),
        ];
        let glyph = |c: char| &GLYPHS.iter().find(|(g, _)| *g == c).unwrap().1;
        let word = "kewldan";
        let width = word.chars().map(|c| glyph(c)[0].len() + 1).sum::<usize>() - 1;
        let x0 = (WIDTH - width) / 2;
        let y0 = (HEIGHT - 7) / 2 - 1;

        let mut board = Self::empty();
        let mut x = x0;
        for c in word.chars() {
            let g = glyph(c);
            for (r, row) in g.iter().enumerate() {
                for (q, px) in row.bytes().enumerate() {
                    if px == b'#' {
                        board.cells[(y0 + r) * WIDTH + x + q] = 0;
                    }
                }
            }
            x += g[0].len() + 1;
        }
        for i in x0 - 2..x0 + width + 2 {
            board.cells[(y0 + 9) * WIDTH + i] = 1;
        }
        board
    }

    pub fn get(&self, index: u16) -> i8 {
        self.cells[usize::from(index)]
    }

    pub fn set(&mut self, index: u16, color: i8) {
        self.cells[usize::from(index)] = color;
    }

    pub fn encode(&self) -> String {
        self.cells
            .iter()
            .map(|&c| char::from(encode_cell(c)))
            .collect()
    }

    pub fn decode(raw: &[u8]) -> Option<Self> {
        if raw.len() != CELLS {
            return None;
        }
        let mut board = Self::empty();
        for (cell, &b) in board.cells.iter_mut().zip(raw) {
            *cell = decode_cell(b)?;
        }
        Some(board)
    }
}

pub fn is_valid_cell(index: u16, color: i8) -> bool {
    usize::from(index) < CELLS && (color == EMPTY || (0..PALETTE.len() as i8).contains(&color))
}

pub fn encode_cell(color: i8) -> u8 {
    if color == EMPTY {
        EMPTY_BYTE
    } else {
        b'0' + color as u8
    }
}

pub fn decode_cell(b: u8) -> Option<i8> {
    match b {
        EMPTY_BYTE => Some(EMPTY),
        b'0'..=b'9' if usize::from(b - b'0') < PALETTE.len() => Some((b - b'0') as i8),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_roundtrip() {
        let seed = Board::seed();
        let decoded = Board::decode(seed.encode().as_bytes()).unwrap();
        assert_eq!(decoded.encode(), seed.encode());
    }

    #[test]
    fn seed_has_ink_and_underline() {
        let s = Board::seed().encode();
        assert!(s.contains('0') && s.contains('1'));
        assert_eq!(s.len(), CELLS);
    }

    #[test]
    fn rejects_bad_cells() {
        assert!(!is_valid_cell(CELLS as u16, 0));
        assert!(!is_valid_cell(0, PALETTE.len() as i8));
        assert!(!is_valid_cell(0, -2));
        assert!(is_valid_cell(0, EMPTY));
        assert!(Board::decode(b"x").is_none());
    }
}
