#!/usr/bin/env python3
"""Synthesises every sound effect of the video (no music) and writes sfx.wav.
All timings are absolute seconds and mirror the keyframes in s0.js … s7.js."""
import sys, wave
import numpy as np
from scipy.signal import butter, sosfilt

SR = 44100
DUR = 55.0
rng = np.random.default_rng(11)
SB = [0, 4, 11, 18, 25, 32, 39, 46, 55]


# ---------------------------------------------------------------- primitives
def tt(d): return np.arange(int(d * SR)) / SR
def noise(d): return rng.standard_normal(int(d * SR))
def _sos(kind, f, order):
    return butter(order, f, btype=kind, fs=SR, output='sos')
def bp(x, lo, hi, o=2): return sosfilt(_sos('band', [lo, min(hi, SR / 2 - 100)], o), x)
def lp(x, f, o=2): return sosfilt(_sos('low', f, o), x)
def hp(x, f, o=2): return sosfilt(_sos('high', f, o), x)
def edge(x, a=.004, r=.01):
    n = len(x); y = x.copy()
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    y[:na] *= np.linspace(0, 1, na); y[-nr:] *= np.linspace(1, 0, nr)
    return y
def expenv(d, tau, a=.002):
    t = tt(d); return np.minimum(t / a, 1) * np.exp(-t / tau)
def bell_env(d, peak=.5, p=2):
    t = np.linspace(0, 1, int(d * SR)); k = np.where(t < peak, t / peak, (1 - t) / (1 - peak)); return np.clip(k, 0, 1) ** p


def whoosh(d, f0, f1, peak=.5, amp=1.0, width=.55):
    n = int(d * SR); t = np.linspace(0, 1, n)
    centers = np.geomspace(150, 9000, 14)
    x = noise(d)
    out = np.zeros(n)
    fc = f0 * (f1 / f0) ** t
    for c in centers:
        band = bp(x, c / 1.35, c * 1.35)
        w = np.exp(-.5 * (np.log(fc / c) / width) ** 2)
        out += band * w
    return edge(out * bell_env(d, peak, 1.6) * amp * .55, .01, .02)


def pop(f=520, d=.16, amp=1.0):
    t = tt(d); fr = f * (.45 + .55 * np.exp(-t * 28)); ph = 2 * np.pi * np.cumsum(fr) / SR
    return np.sin(ph) * np.exp(-t / .035) * amp


def boing(f=300, d=.5, amp=1.0):
    t = tt(d); fr = f * (1 + .35 * np.sin(2 * np.pi * 7 * t) * np.exp(-t * 6) + .6 * np.exp(-t * 14))
    ph = 2 * np.pi * np.cumsum(fr) / SR
    return (np.sin(ph) + .3 * np.sin(2 * ph)) * np.exp(-t / .14) * amp * .7


def hit(f=95, d=.7, amp=1.0, click=.5):
    t = tt(d); fr = 45 + (f - 45) * np.exp(-t * 18); ph = 2 * np.pi * np.cumsum(fr) / SR
    body = np.sin(ph) * np.exp(-t / .16)
    c = lp(noise(d), 3500) * np.exp(-t / .012) * click
    return (body + c) * amp


def ding(f=1200, d=1.4, amp=1.0):
    t = tt(d)
    s = np.sin(2 * np.pi * f * t) * np.exp(-t / .55) + .45 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / .3) + .2 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / .14)
    return edge(s * amp * .6, .001, .05)


def tink(f=2400, d=.35, amp=1.0):
    t = tt(d); return (np.sin(2 * np.pi * f * t) + .5 * np.sin(2 * np.pi * f * 2.3 * t)) * np.exp(-t / .07) * amp * .5


def click(d=.03, amp=1.0, f=3000):
    return hp(noise(d), f) * np.exp(-tt(d) / .004) * amp


def clunk(f=210, d=.45, amp=1.0):
    t = tt(d)
    m = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / tau) for a, r, tau in [(1, 1, .09), (.6, 1.52, .07), (.4, 2.9, .05), (.25, 4.1, .03)])
    th = np.sin(2 * np.pi * 70 * t * (1 - .3 * t)) * np.exp(-t / .1) * 1.3
    c = hp(noise(d), 1500) * np.exp(-t / .006) * .8
    return (m * .6 + th + c) * amp * .8


def glug(f=330, d=.16, amp=1.0):
    t = tt(d); fr = f * (1.45 - .6 * (t / d)); ph = 2 * np.pi * np.cumsum(fr) / SR
    env = np.sin(np.pi * t / d) ** 1.4
    return np.sin(ph) * env * amp * .8


def plink(f=900, d=.2, amp=1.0):
    t = tt(d); fr = f * (1 + .5 * (1 - np.exp(-t * 60))); ph = 2 * np.pi * np.cumsum(fr) / SR
    return np.sin(ph) * np.exp(-t / .03) * amp * .6


def hiss(d, lo=3000, hi=9000, amp=1.0, a=.02, r=.05):
    x = bp(noise(d), lo, hi) * amp
    return edge(x, a, r)


def squeal(f=2800, d=.8, amp=1.0, vib=14):
    t = tt(d)
    ph = 2 * np.pi * np.cumsum(f * (1 + .02 * np.sin(2 * np.pi * vib * t) - .15 * t / d)) / SR
    s = np.sin(ph) + .5 * np.sin(2 * ph) + .3 * np.sin(3 * ph)
    return edge(bp(s + .3 * noise(d), f * .6, f * 3) * amp * .5, .05, .15)


def creak(d, f0=420, f1=300, amp=1.0, rough=22):
    t = tt(d); fr = np.linspace(f0, f1, len(t)) * (1 + .1 * np.sin(2 * np.pi * rough * t))
    ph = np.cumsum(fr) / SR
    saw = 2 * (ph % 1) - 1
    gate = (np.sin(2 * np.pi * rough * t + 1.3 * np.sin(2 * np.pi * 3 * t)) > -.2).astype(float)
    gate = lp(gate, 90)
    return edge(bp(saw, 180, 2600) * gate * amp * .7, .03, .08)


def whine(d, f0, f1, amp=1.0, fm=40):
    t = tt(d); fr = np.linspace(f0, f1, len(t)); ph = 2 * np.pi * np.cumsum(fr) / SR
    s = np.sin(ph + 1.8 * np.sin(2 * np.pi * fm * t)) + .35 * np.sin(2 * ph)
    return edge(s * amp * .5, .08, .12)


def rumble(d, f=62, amp=1.0, am=6.0, rough=.3):
    t = tt(d); ph = 2 * np.pi * np.cumsum(np.full(len(t), f)) / SR
    saw = 2 * ((ph / (2 * np.pi)) % 1) - 1
    x = lp(saw + .4 * np.sign(np.sin(ph * 2)), 420, 3)
    m = 1 + rough * np.sin(2 * np.pi * am * t) + .3 * rough * lp(noise(d), 12)
    return edge(x * m * amp * .55, .1, .15)


def riser(d, f0=200, f1=2600, amp=1.0):
    t = tt(d); u = t / d
    fr = f0 * (f1 / f0) ** u; ph = 2 * np.pi * np.cumsum(fr) / SR
    s = np.sin(ph) * .4 + whoosh(d, f0 * 1.5, f1 * 1.5, .98, 1.0)[:len(t)]
    return edge(s * u ** 1.5 * amp, .02, .01)


def sparkle(n=6, gap=.07, f0=1500, amp=1.0):
    d = n * gap + 1.2; out = np.zeros(int(d * SR))
    sc = [1, 1.125, 1.26, 1.5, 1.68, 2.0, 2.25, 2.52]
    for i in range(n):
        s = ding(f0 * sc[i % len(sc)] * (1 + (i // len(sc))), .9, amp * (.9 - .04 * i)); k = int(i * gap * SR)
        out[k:k + len(s)] += s[:len(out) - k]
    return out


def splat(amp=1.0):
    d = .22; t = tt(d)
    return (lp(noise(d), 900 + 500 * rng.random()) * np.exp(-t / .05) * 1.2 + pop(170 + 90 * rng.random(), d, .8)) * amp


def spray(d, amp=1.0):
    x = bp(noise(d), 2500, 9500) * (.7 + .3 * lp(noise(d), 30) * 3)
    return edge(x * amp, .04, .12)


def swish(d, amp=1.0):
    return whoosh(d, 700, 2200, .45, amp, .5) * 1.1


def squeak(f=2200, d=.1, amp=1.0):
    t = tt(d); ph = 2 * np.pi * np.cumsum(f * (1 + .35 * t / d)) / SR
    return np.sin(ph) * np.sin(np.pi * t / d) * amp * .35


def ticks(n, d, amp=1.0, f=2500):
    out = np.zeros(int(d * SR))
    for _ in range(n):
        k = int(rng.random() * (d - .05) * SR); c = click(.02, amp * (.3 + rng.random() * .7), f * (.6 + rng.random()))
        out[k:k + len(c)] += c
    return out


def crackle(d, density, amp=1.0, f=1800):
    return ticks(int(density * d), d, amp, f)


# -------------------------------------------------------------------- mixer
L = np.zeros(int(DUR * SR) + SR * 2); R = L.copy()
def at(t, sig, g=1.0, pan=0.0):
    k = int(t * SR)
    if k < 0: sig = sig[-k:]; k = 0
    n = min(len(sig), len(L) - k)
    if n <= 0: return
    a = (pan + 1) * np.pi / 4
    L[k:k + n] += sig[:n] * g * np.cos(a) * 1.41421356
    R[k:k + n] += sig[:n] * g * np.sin(a) * 1.41421356


def pops_title(t0, g=.8):          # badge pop + two line whooshes
    at(t0, pop(480, .2), g * .9)
    at(t0 - .02, whoosh(.35, 500, 3000, .6, .8), g * .6, -.2)
    at(t0 + .15, whoosh(.3, 400, 2500, .6, .8), g * .5, .2)
    at(t0 + .08, hit(130, .35, .5, .3), g * .8)


# ============================================================ SCENE 0 (0–4)
at(0.0, noise(.95) * 0, 0)
car = lp(noise(.95), 900) * np.linspace(.9, .1, int(.95 * SR)) ** 1.5
car += rumble(.95, 72, 1.0, 11, .15) * np.linspace(1, .2, int(.95 * SR))
at(0.0, car, .9)
at(.78, squeal(3100, .22, .55, 24), .5, .3)
at(.86, hit(80, .4, .7, .2), .8); at(.86, clunk(150, .3, .5), .5)
for t0, f in [(.30, 480), (.78, 420)]:
    at(t0, whoosh(.3, 700, 3600, .55, .9), .75)
    at(t0 + .03, hit(140, .45, .9, .6), 1.0)
    at(t0 + .02, pop(f * 1.6, .1, .6), .4)
at(1.28, boing(380, .6), .6); at(1.3, ding(1600, 1.0, .6), .35)
at(1.0, creak(.75, 380, 240, 1.0, 17), .55, .2)
at(1.74, clunk(240, .55, 1.0), 1.0); at(1.74, hit(70, .5, .8, .1), .8)
at(1.78, ding(1320, 1.6, .8), .45); at(1.78, hiss(.6, 4000, 9000, .25, .05, .35), .4)
for i, f in enumerate([523, 587, 659, 784, 880, 1047]):
    t0 = 1.75 + i * .13
    at(t0 + .02, pop(f, .22, .8), .55, -.8 + i * .32)
    at(t0, whoosh(.45, 500, 2800, .4, .6), .3, -.8 + i * .32)
    at(t0 + .06, tink(f * 2, .4, .5), .25, -.8 + i * .32)
at(3.05, riser(.7, 180, 3200, 1.0), .6)
at(3.7, pop(900, .15, .8), .5); at(3.72, hit(100, .4, .7, .3), .7)

# ============================================================ transitions
for i, tb in enumerate(SB[1:8]):
    at(tb - .44, whoosh(.9, 350, 5200, .5, 1.2, .7), .75)
    at(tb - .12, hit(75, .45, .7, .1), .55)
    at(tb - .02, click(.03, .6), .5)

# ============================================================ SCENE 1 (4–11) OIL
s = SB[1]
pops_title(s + .28)
at(s + .1, hit(70, .5, .7, .1), .6)
# dry engine: clattery rumble, then smooth after oil
at(s + .15, rumble(2.5, 58, .9, 8, .55), .62)
at(s + .15, crackle(2.4, 28, .9, 2600) * np.linspace(1, .2, int(2.4 * SR)), .45)
at(s + .15, crackle(2.3, 12, .6, 5200) * np.linspace(1, .1, int(2.3 * SR)), .35, .3)
at(s + 2.2, rumble(1.6, 56, .8, 7, .3) * np.linspace(1, .6, int(1.6 * SR)), .4)
at(s + 3.6, rumble(3.6, 50, .75, 7.6, .08), .38)
# jug
at(s + .55, whoosh(.7, 350, 2600, .55, .9), .6, .5)
at(s + 1.2, crackle(.75, 20, .7, 1800), .4, .5)        # plastic crinkle while tilting
at(s + 1.2, creak(.6, 520, 380, .5, 30), .22, .5)
# pouring: stream noise + glugs
stream = bp(noise(2.55), 900, 3800) * (.6 + .4 * lp(noise(2.55), 14) * 4)
at(s + 1.72, edge(stream * .7, .15, .3), .5, .1)
for k in range(15):
    at(s + 1.72 + k * .18 + rng.random() * .05, glug(260 + 140 * rng.random(), .17, .9), .6, .1)
for k in range(11):
    at(s + 2.1 + k * .22 + rng.random() * .08, plink(1000 + 900 * rng.random(), .2, .8), .22, -.2 + rng.random() * .4)
# meters / shield
at(s + 2.45, whoosh(1.7, 1800, 400, .5, .7), .4, -.6)
at(s + 4.55, whoosh(.75, 400, 2600, .5, .9), .5, .5)
at(s + 5.33, hit(95, .8, 1.0, .5), 1.0); at(s + 5.35, ding(1175, 2.0, 1.0), .6)
at(s + 5.4, sparkle(7, .06, 1600, 1.0), .5)
at(s + 5.6, tink(3200, .3, .8), .25); at(s + 5.78, whoosh(.5, 800, 3800, .4, .8), .35)

# ============================================================ SCENE 2 (11–18) COOLANT
s = SB[2]
pops_title(s + .28)
at(s + .3, boing(300, .6, 1.0), .5); at(s + .5, whoosh(.5, 400, 2400, .5, .7), .4)
at(s + .6, edge(bp(noise(1.5), 300, 900) * (.6 + .4 * lp(noise(1.5), 16) * 3), .2, .4), .35)       # liquid fills
for k in range(14): at(s + .7 + k * .11 + rng.random() * .05, plink(500 + 700 * rng.random(), .15, .8), .22, -.5 + rng.random())
at(s + 1.95, hiss(.7, 3500, 9500, 1.0, .02, .5), .45); at(s + 1.95, clunk(520, .3, .5), .4)
at(s + 2.45, whoosh(.9, 350, 3000, .5, .9), .55)
at(s + 2.7, whoosh(.8, 500, 3500, .5, .9), .4, .4)
# flames roar & fan
roar = lp(noise(2.4), 700) * (.5 + .5 * lp(noise(2.4), 10) * 3)
at(s + 2.9, edge(roar * np.linspace(.9, .8, int(2.4 * SR)), .3, 1.0), .55)
at(s + 2.9, crackle(2.2, 22, .8, 3200) * np.linspace(1, .4, int(2.2 * SR)), .4)
fan = rumble(4.2, 95, 1.0, 22, .2) + .5 * bp(noise(4.2), 600, 2500) * (.5 + .5 * np.sin(2 * np.pi * 12 * tt(4.2)))
fenv = np.concatenate([np.ones(int(2.3 * SR)), np.linspace(1, .45, len(fan) - int(2.3 * SR))])
at(s + 3.0, fan * fenv, .3)
at(s + 3.3, whoosh(1.4, 3000, 500, .5, .8), .3)                      # cooling sweep (down)
at(s + 4.55, whoosh(.6, 400, 2800, .5, .9), .35)
# freeze
at(s + 5.15, hit(65, 1.1, 1.0, .3), 1.0)
at(s + 5.2, ding(1568, 2.4, .9), .55); at(s + 5.3, sparkle(8, .09, 1800, 1.0), .5)
at(s + 5.3, crackle(1.9, 30, 1.0, 4800) * np.linspace(1, .3, int(1.9 * SR)), .35)
for k in range(8): at(s + 5.4 + k * .17 + rng.random() * .1, tink(2400 + 1800 * rng.random(), .4, .8), .25, -.7 + rng.random() * 1.4)
at(s + 5.2, hiss(1.6, 5000, 10000, .4, .1, 1.0), .3)

# ============================================================ SCENE 3 (18–25) BRAKE
s = SB[3]
pops_title(s + .28)
# spinning disc: fast whirr that slows after clamp
spin = np.zeros(int(7 * SR)); tw = tt(7); om = np.clip(1 - (np.clip((tw - 2.35) / 1.95, 0, 1) ** 2 * (3 - 2 * np.clip((tw - 2.35) / 1.95, 0, 1))), 0, 1)
ph = 2 * np.pi * np.cumsum(70 * om) / SR
spin = (np.sin(ph) * .5 + .3 * np.sin(2 * ph + 1) + bp(noise(7), 700, 2600) * (.5 + .5 * np.sin(ph * 6)) * .8) * om
spin *= np.minimum(tw / .3, 1) * np.where(tw > 4.5, 0, 1)
at(s + .15, spin[:int(4.6 * SR)], .5)
at(s + .15, whoosh(.9, 300, 2800, .5, .8), .3)
# pedal press & hydraulic
at(s + 1.0, clunk(180, .3, .7), .6, -.6); at(s + 1.0, click(.03, .9), .5)
at(s + 1.35, hiss(.3, 2000, 7000, .8, .01, .2), .5); at(s + 1.35, hit(120, .4, .6, .2), .55)
at(s + 1.35, whine(1.1, 220, 1000, 1.0, 55) * np.linspace(.4, 1, int(1.1 * SR)), .32)
at(s + 1.35, whoosh(1.1, 600, 4000, .8, .8), .3, .3)
# clamp + scrape + squeal
at(s + 2.35, clunk(260, .5, 1.0), 1.0, .5); at(s + 2.35, hit(90, .6, 1.0, .4), .9)
scr = hp(noise(2.0), 2500) * (.5 + .5 * lp(noise(2.0), 30) * 3) * np.linspace(1, .25, int(2.0 * SR))
at(s + 2.35, edge(scr, .02, .5), .38, .3)
at(s + 2.4, crackle(1.9, 45, 1.0, 5000) * np.linspace(1, .2, int(1.9 * SR)), .35, .4)
at(s + 2.5, squeal(3300, 1.5, 1.0, 17), .38)
at(s + 3.5, squeal(2300, .9, .8, 11), .18, -.3)
# stop slam
at(s + 4.3, hit(70, 1.2, 1.0, .6), 1.15); at(s + 4.3, whoosh(.4, 600, 3000, .4, .8), .5)
at(s + 4.32, clunk(140, .8, .9), .8)
at(s + 4.35, hiss(.9, 3000, 9000, 1.0, .01, .7), .35)               # air/pressure release
at(s + 4.35, sparkle(5, .05, 900, 1.0), .25)
at(s + 4.85, click(.03, .8), .5); at(s + 5.0, whoosh(.6, 400, 2800, .5, .9), .4)
at(s + 5.05, pop(620, .2, 1.0), .6); at(s + 5.1, ding(1050, 1.8, 1.0), .5); at(s + 5.2, tink(3200, .3, .7), .2)

# ============================================================ SCENE 4 (25–32) POWER STEERING
s = SB[4]
pops_title(s + .28)
at(s + .1, whoosh(.6, 300, 2200, .5, .9), .45)
for k in range(5): at(s + .45 + k * .25, creak(.28, 310 - k * 20, 250 - k * 18, 1.0, 26), .42 - k * .02, -.2)
at(s + .5, rumble(1.2, 44, 1.0, 5, .4), .3)
at(s + 1.6, boing(160, .7, 1.0), .6); at(s + 1.6, hit(80, .8, 1.0, .4), 1.0); at(s + 1.62, ding(880, 1.8, .8), .4)
at(s + 1.6, sparkle(5, .06, 1000, 1.0), .35); at(s + 1.65, whoosh(.9, 300, 3200, .5, 1.0), .55)
pump = whine(4.7, 380, 560, 1.0, 38)
pump = pump * np.concatenate([np.linspace(0, 1, int(.8 * SR)), np.ones(int(3.2 * SR)), np.linspace(1, .6, len(pump) - int(4.0 * SR))])
at(s + 1.6, pump, .25, -.3)
at(s + 1.6, rumble(4.8, 66, .8, 9, .15), .18)
at(s + 1.7, whoosh(1.3, 1600, 350, .5, .8), .35, .4)
for k, tc in enumerate([1.5 + 1.4 * j for j in range(4)]):
    at(s + tc - .35 + 0.0, whoosh(.7, 500, 2200, .5, .8), .3 + .05 * (k % 2), -.5 if k % 2 else .5)
for k in range(10): at(s + 2.6 + k * .31 + rng.random() * .1, plink(700 + 700 * rng.random(), .15, .8), .16, -.8 + rng.random() * 1.6)

# ============================================================ SCENE 5 (32–39) GEARBOX
s = SB[5]
pops_title(s + .28)
at(s + .2, whoosh(.7, 400, 3000, .5, .9), .5); at(s + .5, clunk(320, .4, .8), .5); at(s + .62, clunk(250, .4, .7), .4)
SH = [1.3, 2.2, 3.1, 4.0, 4.9]
def whir(d, f, amp=1.0):
    t = tt(d); ph = 2 * np.pi * np.cumsum(np.full(len(t), f)) / SR
    saw = 2 * ((ph / (2 * np.pi)) % 1) - 1
    return lp(saw, 1400, 3) * (.7 + .3 * np.sin(2 * np.pi * 9 * t)) * amp
seg = [0] + SH + [6.5]
for i in range(len(seg) - 1):
    d = seg[i + 1] - seg[i]; f0 = 70 + 18 * i
    w = whir(d + .05, f0, 1.0) * np.linspace(.7, 1.0, int((d + .05) * SR))
    at(s + seg[i] + .25 if i == 0 else s + seg[i], edge(w, .04, .06), .22)
for k, sh in enumerate(SH):
    at(s + sh - .26, whoosh(.3, 500, 1800, .5, .7), .25, -.3 + k * .15)   # knob slide
    at(s + sh - .02, clunk(300 - k * 22, .5, 1.0), .95, .1)
    at(s + sh, hit(100, .35, .6, .4), .55); at(s + sh + .02, pop(500 + k * 80, .12, .7), .35)
for k in range(12): at(s + .9 + k * .42 + rng.random() * .15, plink(1100 + 900 * rng.random(), .18, .8), .12, -.6 + rng.random() * 1.2)
at(s + 5.5, hit(90, .9, 1.0, .4), .9); at(s + 5.52, ding(1245, 2.0, 1.0), .55)
at(s + 5.55, sparkle(7, .06, 1500, 1.0), .45); at(s + 5.85, tink(3000, .3, .8), .22); at(s + 6.0, whoosh(.5, 800, 3600, .4, .8), .3)

# ============================================================ SCENE 6 (39–46) WASHER
s = SB[6]
pops_title(s + .28)
at(s + .1, whoosh(.7, 350, 2600, .5, .9), .5)
for i in range(16): at(s + .45 + i * .05, splat(1.0), .34, -.7 + 1.4 * rng.random())
at(s + .5, whoosh(.9, 500, 1500, .5, .6), .15)
for j, (tj, pj) in enumerate([(1.62, -.7), (1.7, 0), (1.66, .7)]):
    at(s + tj, (lambda sp: sp * np.concatenate([np.ones(int(.8 * SR)), np.linspace(1, 0, len(sp) - int(.8 * SR))]))(spray(1.3, 1.0)), .27, pj)
at(s + 1.6, click(.03, 1.0), .5)
motor = rumble(3.9, 140, 1.0, 24, .1) * .5 + bp(noise(3.9), 400, 1200) * .15
at(s + 2.15, edge(motor, .1, .2), .22)
for k, t0 in enumerate([2.2, 3.1, 4.0, 4.9]):
    at(s + t0, swish(.95, 1.0), .5 if k < 3 else .4, -.4 if k % 2 == 0 else .4)
    at(s + t0 + .05, squeak(2000 + 150 * k, .1, 1.0), .22)
    at(s + t0 + .5, squeak(2600 - 100 * k, .12, .9), .18)
    at(s + t0 + .85, clunk(380, .2, .5), .22)
for i in range(9):
    at(s + 5.0 + i * .12, tink(1800 + 400 * (i % 5), .5, 1.0), .38, -.8 + i * .2)
    at(s + 5.0 + i * .12, ding(1500 + 250 * (i % 4), .9, .6), .18, -.8 + i * .2)
at(s + 5.0, whoosh(.9, 1000, 5200, .5, .9), .35)
at(s + 5.18, pop(700, .2, 1.0), .55); at(s + 5.2, boing(420, .5, .8), .35)
at(s + 5.2, hit(110, .5, .6, .2), .45)

# ============================================================ SCENE 7 (46–55) FINALE
s = SB[7]
for i in range(6):
    t0 = s + i * .5
    at(t0, hit(150 + 14 * i, .5, 1.0, .9), .85)
    at(t0 - .02, whoosh(.3, 600 + 90 * i, 4000, .55, .9), .5, -.5 + i * .2)
    at(t0 + .0, click(.03, 1.0, 1800), .6)
    at(t0 + .06, pop(430 + 55 * i, .18, .9), .45)
    at(t0 + .15, tink(1400 + 200 * i, .5, .6), .22, -.5 + i * .2)
at(s + 2.45, riser(.6, 400, 5000, 1.0), .45)
at(s + 3.0, whoosh(.7, 1500, 300, .4, 1.0), .5)
at(s + 3.0, hit(60, 1.0, 1.0, .5), 1.0)
for i in range(6):
    t0 = s + 3.45 + i * .5
    at(t0 - .05, whoosh(.45, 400, 3200 - 200 * i, .55, 1.0), .55, -.6 if i % 2 == 0 else .6)
    at(t0 + .32, hit(110 - 6 * i, .45, 1.0, .6), .8); at(t0 + .33, click(.03, 1.0, 2000), .5)
    at(t0 + .36, pop(360 + 40 * i, .15, .8), .32)
at(s + 3.0, tink(2600, .6, 1.0), .25)
for i in range(6):
    at(s + 6.5 + i * .12, plink(900 * 1.122 ** i * 1.2, .35, 1.0), .38, -.6 + i * .24)
    at(s + 6.5 + i * .12, tink(1800 * 1.122 ** i, .45, .9), .24, -.6 + i * .24)
at(s + 7.15, whoosh(.5, 500, 3400, .5, .9), .5)
at(s + 7.28, boing(330, .7, 1.0), .6); at(s + 7.3, hit(100, .7, 1.0, .5), .8)
at(s + 7.3, sparkle(8, .045, 1400, 1.0), .5)
for k in range(8): at(s + 7.32 + k * .05 + rng.random() * .05, pop(500 + 700 * rng.random(), .12, .8), .3, -.9 + 1.8 * rng.random())
at(s + 7.35, ding(1760, 2.3, 1.0), .35)

# ---------------------------------------------------------------- master
n = int(DUR * SR)
L, R = L[:n], R[:n]
fade_out = np.ones(n); k = int(.9 * SR); fade_out[-k:] = np.linspace(1, 0, k) ** 1.5
L *= fade_out; R *= fade_out
# gentle reverb-ish tail: short delays
def room(x):
    y = x.copy()
    for ms, g in [(23, .18), (41, .12), (67, .08), (97, .05)]:
        k = int(ms / 1000 * SR); y[k:] += x[:-k] * g
    return y
L, R = room(L), room(R)
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = np.tanh(L / peak * 1.5) / np.tanh(1.5) * .9, np.tanh(R / peak * 1.5) / np.tanh(1.5) * .9
st = np.stack([L, R], 1)
pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
out = sys.argv[1] if len(sys.argv) > 1 else 'sfx.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
rms = [float(np.sqrt(np.mean(st[int(a * SR):int((a + 1) * SR)] ** 2))) for a in range(int(DUR))]
print('peak', float(np.abs(st).max()), 'rms/sec', ' '.join(f'{r:.2f}' for r in rms))
