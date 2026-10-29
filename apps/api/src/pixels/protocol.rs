//! WebSocket messages. Both directions are JSON objects tagged by `t`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// `[cell index, colour]`, colour `-1` erases.
pub type Cell = (u16, i8);

#[derive(Debug, Deserialize, TS)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export, rename = "PixelClientMessage")]
pub enum ClientMessage {
    /// A batch of strokes. Cells beyond the remaining ink are rejected.
    Paint { cells: Vec<Cell> },
    /// Pointer position as a fraction of the board, `c` is the held colour.
    Cursor { x: f32, y: f32, c: i8 },
    /// The pointer left the board.
    Leave,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export, rename = "PixelServerMessage")]
pub enum ServerMessage {
    Hello {
        /// Below 2^53, safe as a JavaScript number.
        #[ts(type = "number")]
        id: u64,
        width: u16,
        height: u16,
        palette: Vec<String>,
        board: String,
        ink: u32,
        ink_max: u32,
        /// Ink regained per second.
        ink_regen: f32,
        /// Nobody may paint; the board is only shown.
        locked: bool,
        peers: u32,
    },
    /// Cells someone painted. `by` is the painter's connection id.
    Paint {
        /// Below 2^53, safe as a JavaScript number.
        #[ts(type = "number")]
        by: u64,
        cells: Vec<Cell>,
    },
    /// Reply to the sender's own `paint`: remaining ink and the current value
    /// of every cell that was rejected, so the optimistic UI can roll back.
    Ack {
        ink: u32,
        revert: Vec<Cell>,
    },
    Cursor {
        /// Below 2^53, safe as a JavaScript number.
        #[ts(type = "number")]
        id: u64,
        x: f32,
        y: f32,
        c: i8,
    },
    Gone {
        /// Below 2^53, safe as a JavaScript number.
        #[ts(type = "number")]
        id: u64,
    },
    Peers {
        n: u32,
    },
    /// The whole board, after a clear or a resync.
    Board {
        board: String,
    },
    /// The admin changed how much people may paint.
    Rules {
        ink_max: u32,
        ink_regen: f32,
        locked: bool,
    },
}
