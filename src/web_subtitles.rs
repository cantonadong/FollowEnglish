use crate::{media, store, win};
use serde_json::{json, Value};
use std::{io, path::Path, sync::Arc};
use store::Source;

pub fn run(args: &[String]) {
    win::refresh_search_path();
    let result = handle(args);
    let message = match result {
        Ok(value) => value,
        Err(error) => json!({ "error": error }),
    };
    println!("FOLLOWENGLISH_SUBTITLES={message}");
}

fn handle(args: &[String]) -> Result<Value, String> {
    let [action, file, rest @ ..] = args else {
        return Err("缺少字幕操作参数".into());
    };
    let video = Path::new(file);
    let key = store::video_key(video);
    let mut state = store::load_state(&key);
    let mut warning = None;
    let sentences = match action.as_str() {
        "resolve" => match store::resolve_open(video, &mut state) {
            Ok(sentences) => sentences,
            Err(error) => {
                warning = Some(error);
                Vec::new()
            }
        },
        "external" => {
            let file = store::external_path(video, &state).ok_or("没有同名外置字幕")?;
            store::apply(&mut state, Source::External, file, None)?
        }
        "embedded" => {
            let file = media::embedded(video)?.ok_or("没有可读取的内置字幕")?;
            store::apply(&mut state, Source::Embedded, file, None)?
        }
        "recognize" => {
            let cancel = Arc::new(media::Cancel::default());
            let listener = Arc::clone(&cancel);
            std::thread::spawn(move || {
                let mut line = String::new();
                if io::stdin().read_line(&mut line).is_ok() && line.trim() == "cancel" {
                    listener.cancel();
                }
            });
            let (file, sentences) = media::recognize(video, &cancel)?;
            store::apply(&mut state, Source::Recognize, file, Some(sentences))?
        }
        "edit" => {
            let index: usize = rest.first().and_then(|i| i.parse().ok()).ok_or("字幕序号无效")?;
            let text: String = serde_json::from_reader(io::stdin().lock()).map_err(|error| error.to_string())?;
            let text = text.trim();
            let mut sentences = store::resolve_open(video, &mut state)?;
            let subtitle = state.subtitle.as_ref().ok_or("当前没有字幕")?;
            let sentence = sentences.get_mut(index).ok_or("字幕序号无效")?;
            if text.is_empty() {
                return Err("字幕内容不能为空".into());
            }
            sentence.text = text.to_owned();
            state.edits.insert(store::path_key(subtitle), sentences.clone());
            sentences
        }
        _ => return Err("不支持的字幕操作".into()),
    };
    store::save_state(&key, &state);
    Ok(json!({ "sentences": sentences, "source": state.source, "warning": warning }))
}
