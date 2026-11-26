mod media;
mod store;
mod subs;
mod web_subtitles;
mod win;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let [flag, rest @ ..] = args.as_slice() {
        if flag == "--web-subtitles" {
            web_subtitles::run(rest);
            return;
        }
    }
    eprintln!("Usage: FollowEnglish-subtitles --web-subtitles <action> <video> [index]");
    std::process::exit(2);
}
