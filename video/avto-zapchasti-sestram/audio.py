"""Саунд-дизайн ролика: 128 BPM, 15 c. Синтез на numpy, без внешних сэмплов.
Тайминги совпадают с index.html (B = длина бита, сцены по 6/8/6/4/8 битов).
    python3 audio.py             ->  audio.wav      (с музыкой: бит, бас, арпеджио + эффекты)
    python3 audio.py --no-music  ->  audio-sfx.wav  (только звуковые эффекты, без музыки)
"""
import sys
import wave
import numpy as np

MUSIC = '--no-music' not in sys.argv
OUT = 'audio.wav' if MUSIC else 'audio-sfx.wav'

SR = 44100
BPM = 128
B = 60 / BPM
DUR = 15.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
mix = np.zeros((N, 2))


def add(sig, t0, gain=1.0, pan=0.0):
    """pan: -1..1 (число или массив той же длины, что и sig)"""
    i = int(t0 * SR)
    if i >= N or i + len(sig) <= 0:
        return
    sig = np.asarray(sig) * gain
    n = min(len(sig), N - i)
    p = np.broadcast_to(np.asarray(pan, dtype=float), (len(sig),))[:n]
    l = np.cos((p + 1) * np.pi / 4)
    r = np.sin((p + 1) * np.pi / 4)
    mix[i:i + n, 0] += sig[:n] * l
    mix[i:i + n, 1] += sig[:n] * r


def tt(d):
    return np.arange(int(d * SR)) / SR


def bandnoise(d, lo, hi):
    n = int(d * SR)
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    spec *= ((f >= lo) & (f <= hi)).astype(float)
    out = np.fft.irfft(spec, n)
    return out / (np.max(np.abs(out)) + 1e-9)


def kick(g=1.0, t0=0):
    t = tt(.32)
    f = 46 + 120 * np.exp(-t * 32)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * 9) + .35 * np.sin(ph * 2) * np.exp(-t * 30)
    s[:60] += np.linspace(.5, 0, 60)
    add(s, t0, g)


def clap(g=1.0, t0=0):
    t = tt(.22)
    n = bandnoise(.22, 900, 6500)
    env = sum(np.exp(-np.clip(t - d, 0, None) * 38) * (t >= d) for d in (0, .011, .022)) * .6 + np.exp(-t * 16) * .55
    add(n * env, t0, g * .75, pan=.15)


def snare(g=1.0, t0=0):
    t = tt(.18)
    s = bandnoise(.18, 1500, 9000) * np.exp(-t * 24) + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 28) * .5
    add(s, t0, g * .6)


def hat(g=1.0, t0=0, open_=False):
    d = .22 if open_ else .06
    t = tt(d)
    add(bandnoise(d, 6500, 16000) * np.exp(-t * (14 if open_ else 70)), t0, g * .35, pan=-.2)


def bass(f, g=1.0, t0=0, d=.26):
    t = tt(d)
    s = np.tanh(2.2 * (np.sin(2 * np.pi * f * t) + .35 * np.sin(2 * np.pi * 2 * f * t))) * np.exp(-t * 9)
    s *= np.minimum(t / .004, 1)
    add(s, t0, g * .5)


def pluck(f, g=1.0, t0=0, pan=0.0):
    t = tt(.4)
    s = (np.sin(2 * np.pi * f * t) + .4 * np.sin(2 * np.pi * 2 * f * t) + .15 * np.sin(2 * np.pi * 3 * f * t)) * np.exp(-t * 9)
    s *= np.minimum(t / .003, 1)
    add(s, t0, g * .35, pan=pan)


def blip(f0, f1, g=1.0, t0=0, d=.11):
    t = tt(d)
    f = np.linspace(f0, f1, len(t))
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 22) * np.minimum(t / .002, 1)
    add(s, t0, g * .45)


def tick(g=1.0, t0=0, f=2400):
    t = tt(.03)
    add(np.sin(2 * np.pi * f * t) * np.exp(-t * 120), t0, g * .25)


def boom(g=1.0, t0=0, d=1.1, f=38):
    t = tt(d)
    fr = f + 90 * np.exp(-t * 14)
    s = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 3.2)
    s += bandnoise(d, 80, 5000) * np.exp(-t * 8) * .45
    add(s, t0, g)


def whoosh(t_center, g=1.0, d=.5, up=True):
    """полоса шума, пробегающая от низких частот к высоким; пан слева направо (как плашка-вайп)"""
    t = tt(d)
    out = np.zeros(len(t))
    bands = 9
    for k in range(bands):
        lo = 200 * 1.55 ** k
        hi = lo * 1.9
        c = (k + .5) / bands * d if up else (1 - (k + .5) / bands) * d
        env = np.exp(-((t - c) / (d * .16)) ** 2)
        out += bandnoise(d, lo, min(hi, 18000)) * env
    out *= np.sin(np.pi * np.clip(t / d, 0, 1)) ** .6
    add(out, t_center - d * .55, g * .5, pan=np.linspace(-.8, .8, len(t)))


def riser(t0, d, g=1.0):
    t = tt(d)
    n = bandnoise(d, 1200, 12000) * (t / d) ** 2.2
    f = 200 * 2 ** (t / d * 3)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / d) ** 2 * .25
    add(n + tone, t0, g * .55)


def chime(f, g=1.0, t0=0):
    t = tt(1.2)
    s = (np.sin(2 * np.pi * f * t) + .5 * np.sin(2 * np.pi * 2.01 * f * t) + .25 * np.sin(2 * np.pi * 3.02 * f * t)) * np.exp(-t * 4.5)
    add(s, t0, g * .35, pan=.1)


beat = lambda b: b * B

# ---------------- сцена 1 (0–6 бит): тревога → «без паники» ----------------
riser(0, beat(3), .9)
if MUSIC:
    for b, g in ((0, .7), (1, .6), (2, .45)):
        kick(g, beat(b))
boom(1.0, beat(3))                                   # глитч + «БЕЗ»
blip(1500, 300, .5, beat(1))                         # слэм ЗАГОРЕЛАСЬ
blip(1500, 300, .5, beat(1.5))                       # слэм ЛАМПОЧКА?
tick(1.0, beat(3) + .06, 1800)
blip(900, 200, .6, beat(4))                          # слэм ПАНИКИ.
for k in range(4):                                   # щелчки-«лампа»
    tick(.8, beat(1.0) + k * B / 2, 3200)

# ---------------- грув: с 4-го бита ----------------
chords = [55.0, 55.0, 65.41, 49.0]                   # A1 A1 C2 G1
arp = [440, 523.25, 659.25, 783.99, 659.25, 523.25, 587.33, 523.25]
for b in (range(4, 32) if MUSIC else ()):
    t0 = beat(b)
    vol = min(1.0, (b - 3) / 3)
    if b < 6 or b != 24:
        kick(.95 * vol, t0)
    if b >= 6 and b % 4 in (1, 3):
        clap(.9, t0)
    hat(.8 * vol, t0 + B / 2)
    if b >= 14:
        hat(.5, t0 + B / 4)
        hat(.5, t0 + 3 * B / 4)
    if b >= 6:
        bass(chords[(b // 4) % 4], .95, t0 + B / 2)
        bass(chords[(b // 4) % 4], .55, t0 + .75 * B, d=.16)
    if b >= 14:
        for h in range(2):
            pluck(arp[(b * 2 + h) % 8], .22 if b < 24 else .42, t0 + h * B / 2, pan=-.4 + .8 * ((b + h) % 2))

# ---------------- переходы (вайпы) ----------------
for b in (6, 14, 20, 24):
    whoosh(beat(b), 1.0 if b != 24 else 1.2, d=.55)

# ---------------- сцена 2 ----------------
riser(beat(6), beat(1), .35)
for i, f0 in enumerate((500, 600, 750, 900)):         # бейджи-запчасти
    blip(f0, f0 * 2, .75, beat(7 + .5 * i))
for i in range(12):                                   # буквы АВТОЗАПЧАСТИ
    tick(.9, beat(9) + i * .035, 2000 + i * 90)
boom(.55, beat(10.5), d=.5, f=55)                     # плашка «СЁСТРАМ»
blip(1200, 2200, .5, beat(12))

# ---------------- сцена 3 ----------------
blip(700, 1400, .55, beat(14) + .1)
for i in range(3):
    t0 = beat(15 + i)
    blip(400, 900, .8, t0)
    boom(.35, t0, d=.3, f=70)
    tick(1.0, t0 + .45, 3600)

# ---------------- сцена 4 ----------------
for i in range(8):
    tick(.8, beat(20) + i * .04, 1500 + i * 130)
for k in (range(8) if MUSIC else ()):                 # снейр-ролл в дроп
    snare(.35 + .08 * k, beat(22) + k * B / 2 * 1.0 if k < 4 else beat(23) + (k - 4) * B / 4)
blip(900, 1800, .6, beat(20.5))
boom(.55, beat(21), d=.5, f=60)                       # ВСЁ ДЛЯ ТВОЕЙ
boom(.8, beat(21.5), d=.8, f=48)                      # МАШИНЫ

# ---------------- сцена 5: дроп и призыв ----------------
boom(1.0, beat(24) + .02, d=1.4, f=42)
if MUSIC:
    hat(1.0, beat(24), open_=True)
blip(600, 1500, .7, beat(24.5))                       # значок
for i in range(12):
    tick(.8, beat(25.5) + i * .035, 2200 + i * 80)
blip(800, 1600, .45, beat(27))                        # ник
blip(500, 1000, .6, beat(28))                         # кнопка
tapT = beat(30)
add(np.sin(2 * np.pi * 180 * tt(.05)) * np.exp(-tt(.05) * 90), tapT, 1.0)   # клик
tick(1.2, tapT, 1500)
chime(880, 1.0, tapT + .04)
chime(1318.5, .9, tapT + .13)
chime(1760, .8, tapT + .22)
for i in range(18):                                   # конфетти
    tick(.35, tapT + .04 + rng.random() * .7, 3000 + rng.random() * 3000)

# ---------------- мастеринг ----------------
fade = np.ones(N)
fade[-int(.5 * SR):] = np.linspace(1, 0, int(.5 * SR))
fade[:int(.01 * SR)] = np.linspace(0, 1, int(.01 * SR))
mix *= fade[:, None]
mix = np.tanh(mix * 1.15) / np.tanh(1.15)             # мягкий лимитер
mix *= .89 / np.max(np.abs(mix))
pcm = (mix * 32767).astype('<i2')
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(OUT, DUR, 'c', '(с музыкой)' if MUSIC else '(без музыки)')
