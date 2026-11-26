//! Per-video persisted state and subtitle-source selection rules.

use crate::subs::{find_sidecar, read_sidecar, Sentence};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Embedded,
    External,
    Recognize,
}

fn yes() -> bool {
    true
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct VideoState {
    #[serde(default)]
    pub source: Option<Source>,
    #[serde(default)]
    pub subtitle: Option<PathBuf>,
    /// Remembered external subtitle association (kept while using embedded).
    #[serde(default)]
    pub external: Option<PathBuf>,
    /// Edited sentences keyed by lowercase subtitle path.
    #[serde(default)]
    pub edits: BTreeMap<String, Vec<Sentence>>,
    #[serde(default = "yes")]
    pub pos_enabled: bool,
    #[serde(default)]
    pub pos: usize,
}

pub fn app_dir() -> &'static Path {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        if let Some(dir) = std::env::var_os("FOLLOWENGLISH_APP_DIR") {
            return PathBuf::from(dir);
        }
        std::env::current_exe()
            .ok()
            .and_then(|p| p.canonicalize().ok().or(Some(p)))
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .map(|p| PathBuf::from(p.to_string_lossy().trim_start_matches(r"\\?\")))
            .unwrap_or_else(|| PathBuf::from("."))
    })
}

pub fn data_dir() -> PathBuf {
    let d = app_dir().join("data");
    let _ = std::fs::create_dir_all(&d);
    d
}

pub fn fnv(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

pub fn path_key(p: &Path) -> String {
    let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    abs.to_string_lossy().to_lowercase()
}

pub fn video_key(p: &Path) -> String {
    fnv(&path_key(p))
}

fn state_file(key: &str) -> PathBuf {
    let d = data_dir().join("videos");
    let _ = std::fs::create_dir_all(&d);
    d.join(format!("{key}.json"))
}

pub fn load_state(key: &str) -> VideoState {
    std::fs::read(state_file(key))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(VideoState { pos_enabled: true, ..Default::default() })
}

pub fn save_state(key: &str, st: &VideoState) {
    if let Ok(b) = serde_json::to_vec(st) {
        let _ = std::fs::write(state_file(key), b);
    }
}

// ---------------------------------------------------------------- selection rules

pub fn external_path(video: &Path, st: &VideoState) -> Option<PathBuf> {
    let assoc = st.external.clone().or_else(|| {
        if st.source != Some(Source::Embedded) {
            st.subtitle.clone()
        } else {
            None
        }
    });
    if let Some(a) = assoc.filter(|a| a.is_file()) {
        return Some(a);
    }
    find_sidecar(video)
}

/// Switches `st` to the given subtitle source and returns its sentences.
/// Saved edits for the same subtitle file win over re-reading it; freshly
/// generated sentences (`given`) replace any old edits.
pub fn apply(st: &mut VideoState, source: Source, path: PathBuf, given: Option<Vec<Sentence>>) -> Result<Vec<Sentence>, String> {
    let key = path_key(&path);
    let contents = match given {
        Some(s) => {
            st.edits.remove(&key);
            s
        }
        None => match st.edits.get(&key) {
            Some(e) => e.clone(),
            None => read_sidecar(&path)?,
        },
    };
    let external = if source != Source::Embedded {
        Some(path.clone())
    } else {
        st.external.clone().or_else(|| if st.source != Some(Source::Embedded) { st.subtitle.clone() } else { None })
    };
    st.source = Some(source);
    st.subtitle = Some(path);
    st.external = external;
    Ok(contents)
}

/// Remembered selection -> same-name sidecar -> embedded text track -> none.
pub fn resolve_open(video: &Path, st: &mut VideoState) -> Result<Vec<Sentence>, String> {
    if let (Some(src), Some(p)) = (st.source, st.subtitle.clone()) {
        if p.is_file() {
            return apply(st, src, p, None);
        }
    }
    if let Some(p) = external_path(video, st) {
        return apply(st, Source::External, p, None);
    }
    if let Some(p) = crate::media::embedded(video)? {
        return apply(st, Source::Embedded, p, None);
    }
    st.source = None;
    st.subtitle = None;
    Ok(Vec::new())
}
