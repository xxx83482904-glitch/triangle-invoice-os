from pathlib import Path
import json, subprocess, wave
import imageio_ffmpeg

root = Path(__file__).resolve().parents[1]
waves = root.parent / 'outputs/akira-preschool-ux-2026-11-01/wav'
out = root / 'public/akira-kitchen/audio'
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
texts = json.loads((root / 'content/narration.json').read_text(encoding='utf-8'))
report = []
for key, text in texts.items():
    source = waves / (key + '.wav')
    with wave.open(str(source)) as f:
        seconds = f.getnframes() / f.getframerate()
    speed = max(1, seconds / 1.78)
    target = out / (key + '.mp3')
    subprocess.run([ffmpeg, '-nostdin', '-loglevel', 'error', '-y', '-i', str(source), '-af', f'atempo={speed:.5f},loudnorm=I=-18:TP=-2:LRA=7', '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '48k', str(target)], check=True)
    # Decode the actual encoded file, including MP3 padding, to verify its length.
    pcm = subprocess.check_output([ffmpeg, '-nostdin', '-loglevel', 'error', '-i', str(target), '-f', 's16le', '-ac', '1', '-ar', '24000', '-'])
    duration = len(pcm) / 48000
    if duration > 2:
        raise RuntimeError(f'{key} exceeds two seconds: {duration}')
    report.append({'id': key, 'text': text, 'seconds': round(duration, 3), 'bytes': target.stat().st_size})
(root / 'audio-build.json').write_text(json.dumps({'generator': 'Microsoft Sayaka / System.Speech offline synthesis; MP3 encoding', 'runtime': 'local pre-generated MP3; no speechSynthesis or API', 'clips': report}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'clips':len(report), 'bytes':sum(v['bytes'] for v in report), 'maxSeconds':max(v['seconds'] for v in report)}))
