"""Logos des mini-jeux, générés par l'API OpenAI Images (gpt-image-2.5-sunburst).

Usage : python3 scripts/minijeux_logos.py [nom ...]
La clé est lue dans ~/.config/openai/api_key (jamais dans le dépôt).
Sortie : assets/minijeux/logos/<nom>.png en 1024 px, puis réduits en 512 px par sips.
"""
import base64
import json
import os
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

MODEL = 'gpt-image-2.5-sunburst'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'minijeux', 'logos')

# Direction artistique commune : la même famille d'icônes, chaque jeu sa couleur
DA = (
    'Mobile game app icon, square with large rounded corners filling the whole canvas. '
    'Style: glossy soft 3D, like a premium vinyl toy or clay render, smooth bevels, gentle studio lighting from the top left, '
    'soft inner glow and a subtle rim light, clean and bold silhouette readable at 48 pixels. '
    'Background inside the icon: deep night purple (#1A1025 to #2B1B4A) with a soft radial glow of the signature color behind the subject. '
    'Playful but premium, consistent with a family of icons for a party mini-games app for a group of friends. '
    'Absolutely no text, no letters, no numbers, no watermark, no border frame outside the rounded square.'
)

LOGOS = {
    'stack': 'Subject: a tower of five thick isometric slabs stacked on top of each other, each one slightly smaller, '
    'the top slab sliding in from the side and a small cut-off piece falling away. '
    'Signature color: violet (#C77DFF) shading to pink (#FF9EBC) from bottom to top.',
    'flappy': 'Subject: a cute round chubby yellow bird (#FFD93D) with a small coral beak (#FF6B6B), big white eye, '
    'one wing raised mid-flap, flying between the rims of two teal pipes (#4ECDC4), tiny motion lines behind it. '
    'Signature color: sunny yellow, with a hint of sunset coral in the glow.',
    'basket': 'Subject: an orange basketball with dark seams swishing through an orange-red hoop with a white net, '
    'seen slightly from below, the net flicking with motion, small spark of light at the rim. '
    'Signature color: warm orange (#F28A2E) and coral (#FF6B6B).',
    'stop10': 'Subject: a chunky pink chrome stopwatch (#FF9EBC) with a big crown button on top being pressed, '
    'its single hand pointing straight up, a glowing ring around the dial that is almost complete. '
    'Signature color: candy pink with a white highlight.',
    'reflexes': 'Subject: a big round glossy teal arcade button (#4ECDC4) being hit, with a bright lightning bolt '
    'bursting out of it and a circular shockwave ripple. '
    'Signature color: electric teal with a white-hot center.',
    'puissance4': 'Subject: a tilted close-up of a connect-four style grid in glossy indigo plastic (#3B2C8C), '
    'with round coral (#FF6B6B) and yellow (#FFD93D) discs in the holes forming a diagonal line, '
    'one yellow disc dropping in from the top with a small motion trail. '
    'Signature color: indigo with coral and yellow accents.',
    'classement': 'Subject: a shiny golden trophy cup with two handles on a small dark pedestal, framed by a laurel '
    'wreath, with a few sparkles around it. Signature color: gold (#FFD93D) with warm highlights.',
}


def generate(name):
    key = open(os.path.expanduser('~/.config/openai/api_key')).read().strip()
    body = json.dumps({
        'model': MODEL,
        'prompt': f'{DA}\n\n{LOGOS[name]}',
        'size': '1024x1024',
        'quality': 'high',
        'n': 1,
    }).encode()
    req = urllib.request.Request(
        'https://api.openai.com/v1/images/generations',
        data=body,
        headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    path = os.path.join(OUT, f'{name}.png')
    with open(path, 'wb') as fh:
        fh.write(base64.b64decode(data['data'][0]['b64_json']))
    # 512 px suffisent pour l'appli (icônes de 52 à 96 points)
    subprocess.run(['sips', '-Z', '512', path], check=True, capture_output=True)
    return name


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(LOGOS)
    with ThreadPoolExecutor(4) as pool:
        for done in pool.map(generate, names):
            print('ok', done)
