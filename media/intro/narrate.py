"""Generate Mandarin narration with the Apache-2.0 Kokoro Chinese model."""
from pathlib import Path
import hashlib
import json
import numpy as np
import soundfile as sf
import torch
from huggingface_hub import hf_hub_download
from kokoro import KModel, KPipeline

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'output'
REPO = 'hexgrad/Kokoro-82M-v1.1-zh'
REVISION = '01e7505bd6a7a2ac4975463114c3a7650a9f7218'
MODEL_SHA = 'b1d8410fa44dfb5c15471fd6c4225ea6b4e9ac7fa03c98e8bea47a9928476e2b'
torch.set_num_threads(4)
OUT.mkdir(exist_ok=True)

def download(name):
    return hf_hub_download(REPO, name, revision=REVISION)

config = download('config.json')
weights = download('kokoro-v1_1-zh.pth')
assert hashlib.sha256(Path(weights).read_bytes()).hexdigest() == MODEL_SHA
voice = download('voices/zf_001.pt')
model = KModel(repo_id=REPO, config=config, model=weights).eval()
english = KPipeline(lang_code='a', repo_id=REPO, model=False)
pipeline = KPipeline(lang_code='z', repo_id=REPO, model=model,
                     en_callable=lambda text: next(english(text)).phonemes)
for scene in json.loads((ROOT / 'storyboard.json').read_text()):
    parts = [result.audio.numpy() for result in pipeline(scene['voice'], voice=voice, speed=1.06)]
    audio = np.concatenate(parts)
    # The final audio mixer reserves 0.8 seconds for the opening and closing pause.
    if len(audio)/24000 > scene['duration']-.8:
        ratio = (len(audio)/24000)/(scene['duration']-.85)
        parts = [result.audio.numpy() for result in pipeline(scene['voice'], voice=voice, speed=1.06*ratio)]
        audio = np.concatenate(parts)
    sf.write(OUT/(scene['id']+'-kokoro.wav'),audio,24000,subtype='PCM_16')
    print(f'{scene["id"]}: {len(audio)/24000:.2f}s',flush=True)
(OUT/'voice-provenance.json').write_text(json.dumps({'model':REPO,'revision':REVISION,'sha256':MODEL_SHA,'voice':'zf_001','license':'Apache-2.0'},indent=2)+'\n')
