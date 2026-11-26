//! Thin Win32 helpers (no extra crates).

use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use windows_sys::Win32::Globalization::MultiByteToWideChar;
use windows_sys::Win32::System::Registry::*;

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// UTF-16 BOM -> UTF-8 -> GB18030 fallback.
pub fn decode_text(b: &[u8]) -> String {
    if b.len() >= 2 && b[0] == 0xff && b[1] == 0xfe {
        let u: Vec<u16> = b[2..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        return String::from_utf16_lossy(&u);
    }
    if b.len() >= 2 && b[0] == 0xfe && b[1] == 0xff {
        let u: Vec<u16> = b[2..].chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        return String::from_utf16_lossy(&u);
    }
    if let Ok(s) = std::str::from_utf8(b) {
        return s.to_string();
    }
    unsafe {
        let n = MultiByteToWideChar(54936, 0, b.as_ptr(), b.len() as i32, std::ptr::null_mut(), 0);
        if n > 0 {
            let mut buf = vec![0u16; n as usize];
            MultiByteToWideChar(54936, 0, b.as_ptr(), b.len() as i32, buf.as_mut_ptr(), n);
            return String::from_utf16_lossy(&buf);
        }
    }
    String::from_utf8_lossy(b).into_owned()
}

/// Explorer can keep an old PATH after tools are installed; append the
/// persisted machine/user PATH so ffmpeg can be found.
pub fn refresh_search_path() {
    let mut paths = vec![std::env::var_os("PATH").unwrap_or_default()];
    for (root, key) in [
        (HKEY_LOCAL_MACHINE, "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"),
        (HKEY_CURRENT_USER, "Environment"),
    ] {
        if let Some(v) = read_reg_path(root, key) {
            paths.push(v);
        }
    }
    let joined = std::env::join_paths(paths.iter().flat_map(std::env::split_paths)).unwrap_or_default();
    std::env::set_var("PATH", joined);
}

fn read_reg_path(root: HKEY, key: &str) -> Option<OsString> {
    unsafe {
        let k = wide(key);
        let v = wide("Path");
        let mut size: u32 = 0;
        // RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ, expansion is done by RegGetValueW.
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
        if RegGetValueW(root, k.as_ptr(), v.as_ptr(), flags, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) != 0 {
            return None;
        }
        let mut buf = vec![0u16; size as usize / 2 + 1];
        if RegGetValueW(root, k.as_ptr(), v.as_ptr(), flags, std::ptr::null_mut(), buf.as_mut_ptr() as _, &mut size) != 0 {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(OsString::from_wide(&buf[..len]))
    }
}
