#!/usr/bin/env python3
"""Gold Dash v1: backtest demand/supply zone filters on the existing momentum signal.

Offline. Does not touch the live site. Uses Yahoo GC=F 15m/5m/1h already on disk.

v1's live signal is a 30s–10m mid-price momentum blend on 1.5s ticks.
We do not have ticks, so the mid path is linear close-to-close inside each 5m bar
at 1.5s steps. Zone birth/break uses closed 15m bars (v3 order-block rules).
Touches use 5m wicks. Exits walk the 5m path, stop first if both are hit.
"""
from __future__ import annotations
import json, datetime, math, sys
from pathlib import Path
from collections import deque

DATA = Path('/workspace/gd2build/backtest')
OUT = DATA
SPREAD = 0.30
LOT = 0.01   # $1 P/L per $1 move
SL_PCT = 0.0005  # v1 paper SL: 0.05% of entry
ATR_N = 14
SW_K = 1
SW_LOOK = 3
SW_N = 2
AROON_N = 14
TICK_MS = 1500
SIG_THR = 1.0
SIG_CONF = 3
# v1 hardcoded Nov 19 key levels, used only for TP2 when they sit beyond TP1
LV = [3805.0, 3780.0, 3720.0, 3650.0]
SIG_W = [(30000, 0.4), (60000, 0.2), (120000, 0.15), (300000, 0.15), (600000, 0.1)]

def utc(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M')

def pht(ts):
    return (datetime.datetime.fromtimestamp(ts, datetime.timezone.utc) + datetime.timedelta(hours=8)).strftime('%Y-%m-%d %H:%M')

def load(name, sec):
    d = json.loads((DATA / name).read_text())
    bars = []
    for b in d['bars']:
        t = int(b['t'])
        bars.append({
            't': t, 'tc': t + sec,
            'open': float(b['open']), 'high': float(b['high']),
            'low': float(b['low']), 'close': float(b['close']),
        })
    return bars

def tf_idx(series, t_close):
    lo, hi, ans = 0, len(series) - 1, -1
    while lo <= hi:
        m = (lo + hi) // 2
        if series[m]['tc'] <= t_close:
            ans = m
            lo = m + 1
        else:
            hi = m - 1
    return ans

def atr_series(bs, n=ATR_N):
    out = [None] * len(bs)
    trs = []
    for i, b in enumerate(bs):
        p = bs[i - 1]['close'] if i else b['close']
        tr = max(b['high'] - b['low'], abs(b['high'] - p), abs(b['low'] - p))
        trs.append(tr)
        if len(trs) > n:
            trs.pop(0)
        if len(trs) == n:
            out[i] = sum(trs) / n
    return out

def aroon_at(bars, i, n=AROON_N):
    if i < n:
        return None
    w = bars[i - n:i + 1]
    hi = lo = 0
    for j in range(1, len(w)):
        if w[j]['high'] >= w[hi]['high']:
            hi = j
        if w[j]['low'] <= w[lo]['low']:
            lo = j
    return {'up': 100.0 * hi / n, 'down': 100.0 * lo / n}

def aroon_dir(a):
    if not a:
        return None
    if a['up'] > 70 and a['down'] < 30:
        return 'BUY'
    if a['down'] > 70 and a['up'] < 30:
        return 'SELL'
    return None

# ---- v3 order-block zones (ported) ----

def sw_zones(bs, atr, k=SW_K, end_i=None, look=SW_LOOK, src='OB'):
    if end_i is None:
        end_i = len(bs) - 1
    zones = []
    for i in range(end_i):
        b = bs[i]
        a = atr[i]
        if not a or a <= 0:
            continue
        down = b['close'] < b['open']
        up = b['close'] > b['open']
        last = min(end_i, i + look)
        for j in range(i + 1, last + 1):
            disp = abs(bs[j]['close'] - bs[j]['open'])
            if disp <= k * a:
                continue
            if down and bs[j]['close'] > bs[j]['open'] and bs[j]['close'] > b['high']:
                zones.append({'k': 'DEMAND', 'lo': b['low'], 'hi': b['high'], 'i': i, 'born': j,
                              't': bs[j]['tc'], 'broken': False, 'broke_i': None, 'src': src,
                              'mitig_i': None})
                break
            if up and bs[j]['close'] < bs[j]['open'] and bs[j]['close'] < b['low']:
                zones.append({'k': 'SUPPLY', 'lo': b['low'], 'hi': b['high'], 'i': i, 'born': j,
                              't': bs[j]['tc'], 'broken': False, 'broke_i': None, 'src': src,
                              'mitig_i': None})
                break
    for z in zones:
        for j in range(z['born'] + 1, end_i + 1):
            if z['k'] == 'DEMAND' and bs[j]['close'] < z['lo']:
                z['broken'] = True
                z['broke_i'] = j
                break
            if z['k'] == 'SUPPLY' and bs[j]['close'] > z['hi']:
                z['broken'] = True
                z['broke_i'] = j
                break
    return zones

def sw_in_zone(bar, z, near=0):
    return bar['low'] <= z['hi'] + near and bar['high'] >= z['lo'] - near

def sw_flip_bars(bs, C):
    out = []
    for b in bs:
        out.append({
            't': b['t'], 'tc': b.get('tc', b['t']),
            'open': C - b['open'], 'high': C - b['low'], 'low': C - b['high'],
            'close': C - b['close'],
        })
    return out

# ---- v1 momentum (ported) ----

def sig_thr(ms):
    return 0.02 * math.sqrt(ms / 600000)

def sig_tol(ms):
    return max(10000, ms * 0.25)

def sig_raw(p, thr, cur):
    b = thr / 2
    if cur == 'BUY' and p >= b:
        return 'BUY'
    if cur == 'SELL' and p <= -b:
        return 'SELL'
    if p >= thr:
        return 'BUY'
    if p <= -thr:
        return 'SELL'
    return 'WAIT'

def sig_step(st, p, thr=SIG_THR):
    r = sig_raw(p, thr, st['s'])
    if r == st['s']:
        return {'s': st['s'], 'c': None, 'n': 0}
    n = (st['n'] + 1) if st['c'] == r else 1
    if n >= SIG_CONF:
        return {'s': r, 'c': None, 'n': 0}
    return {'s': st['s'], 'c': r, 'n': n}

class Momentum:
    """Exact v1 windows, with a walking pointer into a 15-minute tick history."""
    def __init__(self):
        self.H = deque()  # (t_ms, px)
        self.st = {'s': 'WAIT', 'c': None, 'n': 0}
        self.score = 0.0

    def push(self, t_ms, px):
        self.H.append((t_ms, px))
        cut = t_ms - 900000
        while self.H and self.H[0][0] < cut:
            self.H.popleft()
        sc = 0.0
        # H is sorted; for each window take last point with t <= now-ms, if not stale
        H = self.H
        n = len(H)
        # linear scan from the left is fine for 400 pts; cache nothing
        for ms, w in SIG_W:
            need = t_ms - ms
            b = None
            # walk from left; last <= need
            # small N, just iterate
            for i in range(n):
                if H[i][0] <= need:
                    b = H[i]
                else:
                    break
            if b and (t_ms - b[0]) <= ms + sig_tol(ms):
                p = (px / b[1] - 1) * 100
                z = p / sig_thr(ms)
                sc += w * z
        self.score = sc
        self.st = sig_step(self.st, sc, SIG_THR)
        return self.st['s'], sc

def unit_checks():
    # Port of v3 demand/supply fixture
    def bar(i, o, h, l, c):
        return {'t': i, 'tc': i, 'open': o, 'high': h, 'low': l, 'close': c}
    zbars = [bar(i, 10, 11, 9, 10) for i in range(16)]
    zbars.append(bar(16, 10, 10.2, 8, 8.5))
    zbars.append(bar(17, 8.6, 14, 8.6, 13.5))
    atr = atr_series(zbars, 14)
    zs = sw_zones(zbars, atr, 1, len(zbars) - 1)
    dem = [z for z in zs if z['k'] == 'DEMAND' and not z['broken']]
    assert dem, 'expected a demand zone'
    assert abs(dem[-1]['lo'] - 8) < 1e-12 and abs(dem[-1]['hi'] - 10.2) < 1e-12

    sbars = [bar(i, 10, 11, 9, 10) for i in range(16)]
    sbars.append(bar(16, 10, 12, 9.8, 11.5))
    sbars.append(bar(17, 11.4, 11.4, 6, 6.5))
    atr2 = atr_series(sbars, 14)
    zs2 = sw_zones(sbars, atr2, 1, len(sbars) - 1)
    sup = [z for z in zs2 if z['k'] == 'SUPPLY' and not z['broken']]
    assert sup, 'expected a supply zone'
    assert abs(sup[-1]['hi'] - 12) < 1e-12 and abs(sup[-1]['lo'] - 9.8) < 1e-12

    # BUY/SELL mirror of zones
    C = 8000.0
    fl = sw_flip_bars(zbars, C)
    atrf = atr_series(fl, 14)
    zf = sw_zones(fl, atrf, 1, len(fl) - 1)
    assert len(zs) == len(zf)
    for a, b in zip(zs, zf):
        assert b['k'] == ('SUPPLY' if a['k'] == 'DEMAND' else 'DEMAND')
        assert abs(b['lo'] - (C - a['hi'])) < 1e-9
        assert abs(b['hi'] - (C - a['lo'])) < 1e-9

    # v1 score: all windows at their trigger → score ~ 1
    now = 1_000_000
    m = 100.0
    H = []
    for ms, _ in SIG_W:
        px = m / (1 + sig_thr(ms) / 100)
        H.append((now - ms - 1000, px))
    H.sort()
    mom = Momentum()
    for t, px in H:
        mom.H.append((t, px))
    s, sc = mom.push(now, m)
    assert abs(sc - 1) < 1e-8, sc

    # 3-tick confirm
    st = {'s': 'WAIT', 'c': None, 'n': 0}
    seq = []
    for p in (2, 2, 2):
        st = sig_step(st, p)
        seq.append(st['s'])
    assert seq == ['WAIT', 'WAIT', 'BUY'], seq
    print('unit checks ok')

# ---- load data ----
unit_checks()
print('loading…')
b15 = load('gc_15m_60d_yahoo.json', 900)
b5 = load('gc_5m_60d_yahoo.json', 300)
b1h = load('gc_1h_730d_yahoo.json', 3600)
print('bars 15m', len(b15), '5m', len(b5), '1h', len(b1h),
      '15m', utc(b15[0]['t']) + 'Z', '->', utc(b15[-1]['tc']) + 'Z')
T0, T1 = b15[0]['tc'], b15[-1]['tc']
SPLIT = T0 + 0.7 * (T1 - T0)
print('split', utc(SPLIT) + 'Z', 'PHT', pht(SPLIT))

atr15 = atr_series(b15)
atr5 = atr_series(b5)
# 1H Aroon at each 1h index
aroon1h = [aroon_dir(aroon_at(b1h, i)) for i in range(len(b1h))]

# Precompute zones at every 15m close (from bars 0..i only — no look-ahead)
zones_at = []
for i in range(len(b15)):
    zones_at.append(sw_zones(b15, atr15, SW_K, i, SW_LOOK))

def live_zones(end15, t_now=None):
    """Unbroken zones born on or before 15m index end15, using break info as of end15."""
    # zones_at[end15] already only uses bars through end15
    return zones_at[end15] if end15 >= 0 else []

# Walk 5m bars and record first-touch times for each zone identity
# Zone identity: (k, i_origin, born_15, lo, hi) — born index is stable
# We'll mark mitigation on 5m index.

def zone_id(z):
    return (z['k'], z['i'], z['born'], round(z['lo'], 6), round(z['hi'], 6))

# For each 5m index, the last closed 15m index (tc <= 5m.tc)
z15_for_5 = [tf_idx(b15, b['tc']) for b in b5]

# Mitigation map: zone_id -> first 5m index that overlaps after birth
# We need to do this carefully: a zone doesn't exist until its 15m birth bar has closed.
mitig_5 = {}  # id -> 5m index
# Also, for reacting, store first touch 5m time

# We'll fill mitig as we walk, once, using the final zone list isn't enough because
# early bars shouldn't see later-born zones. Walking forward:

# For "broken as of 5m bar j": use last closed 15m, which already marks breaks on 15m closes.

# Precompute at each 5m j:
#   demands_live, supplies_live (not broken as of last 15m close)
#   fresh (not mitigated on any earlier 5m bar)
#   first_touch this 5m bar
#   atr15, nearest supply above / demand below

n5 = len(b5)
# We’ll fill mitig in one forward pass while building snapshots is heavy;
# instead compute on the fly in the main loop — 13k * maybe 50 zones is fine.

def tp_levels(side, entry, st):
    d = 1 if side == 'BUY' else -1
    tp1 = entry + d * st
    # next key level beyond TP1, else 2× st (same as v1)
    cands = [v for v in LV if (v > tp1 if d > 0 else v < tp1)]
    if d > 0:
        cands.sort()
    else:
        cands.sort(reverse=True)
    tp2 = cands[0] if cands else entry + d * 2 * st
    sl = entry * (1 - d * SL_PCT)
    return sl, tp1, tp2

def trade_exit(e, use_tp='tp1'):
    d = 1 if e['side'] == 'BUY' else -1
    p = e['px']
    sl, tp1, tp2 = e['sl'], e['tp1'], e['tp2']
    tp = tp1 if use_tp == 'tp1' else tp2
    i0 = tf_idx(b5, e['t'])
    start = i0 + 1
    prev_t = e['t']
    for i in range(max(0, start), n5):
        b = b5[i]
        if b['t'] - prev_t > 900:
            prev = b5[i - 1] if i else None
            if prev:
                return {'pl': d * (prev['close'] - p), 'res': 'gap', 'end': prev['tc']}
        prev_t = b['tc']
        hitSL = (b['low'] <= sl) if d > 0 else (b['high'] >= sl)
        hitTP = (b['high'] >= tp) if d > 0 else (b['low'] <= tp)
        if hitSL:
            return {'pl': d * (sl - p), 'res': 'SL', 'end': b['tc']}
        if hitTP:
            return {'pl': d * (tp - p), 'res': 'TP', 'end': b['tc']}
    last = b5[-1]
    return {'pl': d * (last['close'] - p), 'res': 'open', 'end': last['tc']}

# ---- run momentum along 5m close-to-close path, snapshot at each 5m close ----
print('running v1 momentum on interpolated 5m path…')
mom = Momentum()
sig_at_5 = [None] * n5  # (side, score) at 5m close
px_prev = None
t_prev = None
NSTEP = 300_000 // TICK_MS  # 200 ticks per 5m bar
assert NSTEP * TICK_MS == 300_000

for j, b in enumerate(b5):
    # start price: previous close if this bar continues (~5m), else this open
    if px_prev is None or t_prev is None or b['t'] - t_prev > 600:
        start_px = b['open']
        start_t = b['t'] * 1000
    else:
        start_px = px_prev
        start_t = t_prev * 1000
    end_px = b['close']
    end_t = b['tc'] * 1000
    # generate ticks; last tick lands on close
    for k in range(1, NSTEP + 1):
        t_ms = start_t + int((end_t - start_t) * k / NSTEP)
        px = start_px + (end_px - start_px) * k / NSTEP
        mom.push(t_ms, px)
    sig_at_5[j] = (mom.st['s'], mom.score, b['close'])
    px_prev = b['close']
    t_prev = b['tc']
    if j % 3000 == 0:
        print('  5m', j, '/', n5, 'sig', mom.st['s'], 'score', round(mom.score, 2))

# counts of raw v1 flips
raw_flips = 0
prev_s = 'WAIT'
for j in range(n5):
    s = sig_at_5[j][0]
    if s in ('BUY', 'SELL') and s != prev_s:
        raw_flips += 1
    prev_s = s
print('v1 snapshots done; BUY/SELL flips at 5m closes:', raw_flips,
      'last', sig_at_5[-1])

# ---- zone features at each 5m close (no look-ahead) ----
# Forward pass for first-touch (mitigation) using 5m wicks, only after the zone is born.

# Keep active list of zone objects from latest 15m snapshot, keyed by id,
# carrying mitig_5 index once seen.

class ZState:
    __slots__ = ('k', 'lo', 'hi', 'born15', 'orig_i', 'mitig5', 'broken15')
    def __init__(self, z):
        self.k = z['k']
        self.lo = z['lo']
        self.hi = z['hi']
        self.born15 = z['born']
        self.orig_i = z['i']
        self.mitig5 = None
        self.broken15 = z['broke_i']

# We'll rebuild "known zones" when 15m index advances, carrying mitig5 across.

feat = [None] * n5  # dict of zone features
known = {}  # id -> ZState
last15 = -1
RECENT_MS = 15 * 60  # "reacting from" window: this 15m or the previous one (~30m from first touch? use 15m after first touch)
# Definition: first touch on this 5m bar, OR first touch within the last 15 minutes,
# and price still within 1 ATR of the zone, and not broken.

for j, b in enumerate(b5):
    i15 = z15_for_5[j]
    if i15 != last15 and i15 >= 0:
        # refresh known from zones_at[i15], keep mitig
        fresh_map = {}
        for z in zones_at[i15]:
            zid = zone_id(z)
            stz = known.get(zid)
            if stz is None:
                stz = ZState(z)
            else:
                stz.broken15 = z['broke_i']
            # if this 15m close just broke it, keep that
            fresh_map[zid] = stz
        known = fresh_map
        last15 = i15
    atr = atr15[i15] if i15 >= 0 else None
    # mark first touches on this 5m bar, only if zone already born
    # (born 15m must have closed: born15 <= i15). If born15 == i15, the impulse
    # just closed at this same timestamp or earlier; the birth bar itself is not
    # a mitigation. First touch is a LATER bar (v3: after born).
    touched_now = []
    for zid, stz in known.items():
        if stz.born15 > i15:
            continue
        # broken already (15m close at or before this 5m close)
        broken = stz.broken15 is not None and stz.broken15 <= i15
        if broken:
            continue
        # birth 15m bar must have closed before this 5m bar can mitigate
        born_tc = b15[stz.born15]['tc']
        if b['tc'] <= born_tc:
            continue
        if stz.mitig5 is None and sw_in_zone(b, {'lo': stz.lo, 'hi': stz.hi}):
            stz.mitig5 = j
            touched_now.append(stz)

    def is_live(stz):
        if stz.born15 > i15:
            return False
        if b15[stz.born15]['tc'] > b['tc']:
            return False
        if stz.broken15 is not None and stz.broken15 <= i15:
            return False
        return True

    def dist_to_zone(px, stz):
        if stz.lo <= px <= stz.hi:
            return 0.0
        if px < stz.lo:
            return stz.lo - px
        return px - stz.hi

    px = b['close']
    demands, supplies = [], []
    for stz in known.values():
        if not is_live(stz):
            continue
        if stz.k == 'DEMAND':
            demands.append(stz)
        else:
            supplies.append(stz)

    def fresh_at(stz):
        # fresh coming into this bar, or first touched on this bar
        return stz.mitig5 is None or stz.mitig5 == j

    def at_or_reacting(side):
        want = 'DEMAND' if side == 'BUY' else 'SUPPLY'
        pool = demands if side == 'BUY' else supplies
        if not atr or atr <= 0:
            return None
        best = None
        for stz in pool:
            if stz.k != want:
                continue
            # must be (or have been) a first-touch recently
            if stz.mitig5 is None:
                # not touched yet — "at" only if this bar (or close) is in the zone
                in_now = sw_in_zone(b, {'lo': stz.lo, 'hi': stz.hi}) or (stz.lo <= px <= stz.hi)
                if not in_now:
                    continue
                # this will be (or is) the first touch
            else:
                if stz.mitig5 > j:
                    continue
                first_t = b5[stz.mitig5]['tc']
                # at: this bar is the first touch, or still inside on the first-touch bar
                # reacting: first touch was within the previous 15 minutes and still within 1 ATR
                if stz.mitig5 != j:
                    if b['tc'] - first_t > 900:  # more than one 15m bar after first touch
                        continue
                    if dist_to_zone(px, stz) > atr:
                        continue
            best = stz
            # prefer the closest zone
            # keep closest
        # pick closest among qualifying
        qual = []
        for stz in pool:
            if stz.k != want:
                continue
            in_now = sw_in_zone(b, {'lo': stz.lo, 'hi': stz.hi}) or (stz.lo <= px <= stz.hi)
            if stz.mitig5 is None or stz.mitig5 == j:
                if in_now:
                    qual.append(stz)
                    continue
            if stz.mitig5 is not None and stz.mitig5 <= j:
                first_t = b5[stz.mitig5]['tc']
                if stz.mitig5 != j and b['tc'] - first_t <= 900 and dist_to_zone(px, stz) <= atr:
                    qual.append(stz)
        if not qual:
            return None
        qual.sort(key=lambda z: dist_to_zone(px, z))
        return qual[0]

    # (b) block: supply within ~1 ATR above, demand within ~1 ATR below
    def blocked(side):
        if not atr or atr <= 0:
            return None
        if side == 'BUY':
            for stz in supplies:
                # at or above price, lower edge within 1 ATR, or already inside
                if stz.hi < px:
                    continue  # fully below
                if stz.lo <= px + atr:
                    return stz
        else:
            for stz in demands:
                if stz.lo > px:
                    continue  # fully above
                if stz.hi >= px - atr:
                    return stz
        return None

    feat[j] = {
        'i15': i15,
        'atr15': atr,
        'atr5': atr5[j],
        'at_buy': at_or_reacting('BUY'),
        'at_sell': at_or_reacting('SELL'),
        'block_buy': blocked('BUY'),
        'block_sell': blocked('SELL'),
        'px': px,
        'aroon1h': aroon1h[tf_idx(b1h, b['tc'])] if tf_idx(b1h, b['tc']) >= 0 else None,
        'demands': list(demands),
        'supplies': list(supplies),
    }

print('zone features ready')

# Rejection candles on 15m closes, mapped to the 5m index at that close
# A 15m bar i (i>=1) rejects if it overlaps a zone that was fresh at the start
# of the bar (not mitigated before this 15m bar) and closes back outside.

rej_at_15 = [None] * len(b15)  # 'BUY' / 'SELL' / None
for i in range(1, len(b15)):
    prev_i = i - 1
    # zones as of previous 15m close (zone must already exist)
    zs = zones_at[prev_i] if prev_i >= 0 else []
    bar = b15[i]
    # 5m index of previous 15m close, to know mitig before this bar
    j_prev = tf_idx(b5, b15[prev_i]['tc']) if prev_i >= 0 else -1
    # need features? use known mitig from a rebuild — easier: a zone is fresh at
    # start of bar i if no 5m bar with tc in (born_tc, bar.t] touched it
    # (open of this 15m is bar.t; bars strictly before this 15m)
    def fresh_before(z, side_k):
        if z['k'] != side_k:
            return False
        if z['broken'] and z['broke_i'] is not None and z['broke_i'] < i:
            return False
        if z['born'] >= i:
            return False
        born_tc = b15[z['born']]['tc']
        # any 5m strictly before this 15m open that overlapped?
        # 5m with tc <= bar['t'] (15m open) and tc > born_tc
        # Use j of last 5m with tc <= bar['t']
        j_end = tf_idx(b5, bar['t'])  # last 5m closed at or before 15m open
        for jj in range(max(0, j_end - 80), j_end + 1):  # search a window; zones can wait longer
            if b5[jj]['tc'] <= born_tc:
                continue
            if b5[jj]['tc'] > bar['t']:
                break
            if sw_in_zone(b5[jj], z):
                return False
        # also earlier 5m (if zone is old): scan all since birth via binary-ish
        # The window of 80 5m bars is ~6-7 hours; zones can be older. Do a full
        # scan from first 5m after birth — too slow if done naively 4600*zones*5m.
        # Use precomputed mitig? We have ZState only as of end of walk.
        return True  # placeholder, will replace with precomputed mitig times

# Rebuild mitig times with final knowledge is wrong (look-ahead). We already
# recorded first touch in the forward pass, but ZState objects were overwritten.
# Better: during the 5m forward pass, also log (zone_id -> first mitig 5m).
# I didn't persist it after the loop (objects mutated). Re-run a compact pass:

mitig_time = {}  # zone_id -> 5m tc of first touch
known = {}
last15 = -1
for j, b in enumerate(b5):
    i15 = z15_for_5[j]
    if i15 != last15 and i15 >= 0:
        fresh_map = {}
        for z in zones_at[i15]:
            zid = zone_id(z)
            stz = known.get(zid) or ZState(z)
            stz.broken15 = z['broke_i']
            if zid in mitig_time:
                # already have mitig in a side dict; store on state if we can map index
                pass
            fresh_map[zid] = stz
        known = fresh_map
        last15 = i15
    if i15 < 0:
        continue
    for zid, stz in known.items():
        if zid in mitig_time:
            continue
        if stz.born15 > i15:
            continue
        born_tc = b15[stz.born15]['tc']
        if b['tc'] <= born_tc:
            continue
        broken = stz.broken15 is not None and stz.broken15 <= i15
        if broken:
            continue
        if sw_in_zone(b, {'lo': stz.lo, 'hi': stz.hi}):
            mitig_time[zid] = b['tc']

print('first-touch map', len(mitig_time))

for i in range(1, len(b15)):
    zs = zones_at[i - 1]
    bar = b15[i]
    trend = aroon1h[tf_idx(b1h, bar['tc'])] if tf_idx(b1h, bar['tc']) >= 0 else None
    # bullish rejection at fresh demand
    hit = None
    for z in zs:
        zid = zone_id(z)
        if z['broken'] and z['broke_i'] is not None and z['broke_i'] < i:
            continue
        if z['born'] >= i:
            continue
        mt = mitig_time.get(zid)
        # fresh at start of this 15m bar: no touch at or before bar open
        if mt is not None and mt <= bar['t']:
            continue
        if z['k'] == 'DEMAND' and sw_in_zone(bar, z) and bar['close'] > bar['open'] and bar['close'] >= z['hi']:
            # do not allow a close through the far side (already not, close >= hi >= lo)
            if trend == 'BUY':
                hit = 'BUY'
                break
        if z['k'] == 'SUPPLY' and sw_in_zone(bar, z) and bar['close'] < bar['open'] and bar['close'] <= z['lo']:
            if trend == 'SELL':
                hit = 'SELL'
                break
    rej_at_15[i] = hit

n_rej = sum(1 for x in rej_at_15 if x)
print('rejection signals (15m, with 1H Aroon):', n_rej,
      'BUY', sum(1 for x in rej_at_15 if x == 'BUY'),
      'SELL', sum(1 for x in rej_at_15 if x == 'SELL'))

# Map rejection to 5m index (the 5m that closes with the 15m)
rej_at_5 = [None] * n5
for i, side in enumerate(rej_at_15):
    if not side:
        continue
    j = tf_idx(b5, b15[i]['tc'])
    if j >= 0:
        rej_at_5[j] = side

# ---- collect entries for each variant ----
# Enter when the *filtered* signal flips to BUY/SELL (or, for rejection, when it prints).
# One position at a time applied later.

def reason_zone(stz):
    if not stz:
        return ''
    lo, hi = stz.lo, stz.hi
    name = 'demand' if stz.k == 'DEMAND' else 'supply'
    return f"{name} {lo:.0f}–{hi:.0f}"

def events_from_filter(name, allow_fn):
    """allow_fn(j, v1_side) -> (side or None, reason str). side is BUY/SELL to fire."""
    evs = []
    last = 'WAIT'
    for j in range(n5):
        v1_side, score, px = sig_at_5[j]
        side, why = allow_fn(j, v1_side)
        if side in ('BUY', 'SELL') and side != last:
            f = feat[j]
            atr = f['atr5']
            evs.append({
                't': b5[j]['tc'], 'j': j, 'side': side, 'px': px, 'score': score,
                'atr5': atr, 'why': why, 'var': name,
            })
        last = side if side in ('BUY', 'SELL') else 'WAIT'
    return evs

def allow_base(j, v1_side):
    if v1_side in ('BUY', 'SELL'):
        return v1_side, 'v1 momentum'
    return None, ''

def allow_a(j, v1_side):
    if v1_side == 'BUY' and feat[j]['at_buy']:
        return 'BUY', 'BUY at ' + reason_zone(feat[j]['at_buy'])
    if v1_side == 'SELL' and feat[j]['at_sell']:
        return 'SELL', 'SELL at ' + reason_zone(feat[j]['at_sell'])
    return None, ''

def allow_b(j, v1_side):
    if v1_side == 'BUY':
        blk = feat[j]['block_buy']
        if blk:
            return None, ''
        return 'BUY', 'v1 momentum, no supply within 1 ATR'
    if v1_side == 'SELL':
        blk = feat[j]['block_sell']
        if blk:
            return None, ''
        return 'SELL', 'v1 momentum, no demand within 1 ATR'
    return None, ''

def allow_c(j, v1_side):
    s, why = allow_a(j, v1_side)
    if not s:
        return None, ''
    if s == 'BUY' and feat[j]['block_buy']:
        return None, ''
    if s == 'SELL' and feat[j]['block_sell']:
        return None, ''
    return s, why + ', opposite zone not within 1 ATR'

def allow_d(j, v1_side):
    # ignores v1 momentum
    side = rej_at_5[j]
    if side:
        return side, 'rejection at fresh zone, 1H Aroon agrees'
    return None, ''

VARIANTS = [
    ('base', 'Unchanged v1 momentum', allow_base),
    ('a', '(a) Confirm: v1 only at a fresh zone', allow_a),
    ('b', '(b) Block: v1, skip if opposite zone within 1 ATR', allow_b),
    ('c', '(c) Both (a) and (b)', allow_c),
    ('d', '(d) Zone rejection + 1H Aroon (no v1 momentum)', allow_d),
]

def summarize(tr):
    if not tr:
        return {'n': 0, 'small': True, 'win': None, 'avg': None, 'net': None, 'ends': {},
                'BUY': {'n': 0}, 'SELL': {'n': 0}}
    pls = [t['pl'] - SPREAD for t in tr]
    n = len(pls)
    wins = sum(1 for x in pls if x > 0)
    ends = {}
    for t in tr:
        ends[t['res']] = ends.get(t['res'], 0) + 1
    def side(tag):
        v = [t['pl'] - SPREAD for t in tr if t['side'] == tag]
        if not v:
            return {'n': 0}
        return {'n': len(v),
                'wr': round(100 * sum(1 for x in v if x > 0) / len(v), 1),
                'net': round(sum(v), 1)}
    return {
        'n': n, 'small': n < 20,
        'win': round(100 * wins / n, 1),
        'avg': round(sum(pls) / n, 2),
        'net': round(sum(pls), 1),
        'ends': ends,
        'BUY': side('BUY'), 'SELL': side('SELL'),
    }

def fmt(s):
    if not s or not s['n']:
        return 'n=0'
    fl = ' *small sample*' if s['small'] else ''
    def sb(x, lab):
        if not x or not x.get('n'):
            return f'{lab} n=0'
        return f"{lab} n={x['n']} wr={x['wr']}% net=${x['net']}"
    return (f"n={s['n']}{fl} wr={s['win']}% avg=${s['avg']} net=${s['net']} ends={s['ends']} "
            f"| {sb(s['BUY'], 'BUY')}; {sb(s['SELL'], 'SELL')}")

def run_events(evs, use_tp='tp1'):
    taken = []
    busy = -1
    skipped_no_atr = 0
    for e in evs:
        if e['t'] <= busy:
            continue
        atr = e.get('atr5')
        if not atr or atr <= 0:
            skipped_no_atr += 1
            continue
        sl, tp1, tp2 = tp_levels(e['side'], e['px'], 1.5 * atr)
        e2 = {**e, 'sl': sl, 'tp1': tp1, 'tp2': tp2}
        x = trade_exit(e2, use_tp)
        t = {**e2, **x}
        taken.append(t)
        busy = int(x['end'])
    is_ = [t for t in taken if t['t'] < SPLIT]
    oos = [t for t in taken if t['t'] >= SPLIT]
    return {'n_raw': len(evs), 'n_taken': len(taken), 'skipped_no_atr': skipped_no_atr,
            'is': summarize(is_), 'oos': summarize(oos), 'taken': taken}

rows = []
print('\n========== RESULTS ($0.30 spread, 0.01 lot, TP1=1.5×5m ATR, SL=0.05%) ==========')
for vid, label, fn in VARIANTS:
    evs = events_from_filter(vid, fn)
    r = run_events(evs, 'tp1')
    r['id'] = vid
    r['label'] = label
    rows.append(r)
    print(f"\n{label}")
    print('  raw flips', r['n_raw'], 'taken', r['n_taken'])
    print('  first 70%', fmt(r['is']))
    print('  last  30%', fmt(r['oos']))

# Sensitivity: exit at TP2 instead of TP1, for base and the filters
print('\n========== SENSITIVITY: exit at TP2 (next key level or 3×ATR) ==========')
for vid, label, fn in VARIANTS:
    evs = events_from_filter(vid, fn)
    r = run_events(evs, 'tp2')
    print(f"{label}\n  IS {fmt(r['is'])}\n  OOS {fmt(r['oos'])}")

# Pick
print('\n========== PICK ==========')
# Beat base on BOTH halves by net $ (primary) and not collapse win%.
base = next(r for r in rows if r['id'] == 'base')

def beats(r, half):
    a, b = r[half], base[half]
    if not a['n'] or a['net'] is None or b['net'] is None:
        return False
    return a['net'] > b['net']

def holds(r):
    return beats(r, 'is') and beats(r, 'oos')

cands = [r for r in rows if r['id'] != 'base' and holds(r)]
print('variants that beat unchanged v1 net $ on BOTH halves:',
      [r['id'] for r in cands] or 'none')
# least-bad: sum of nets if both exist, penalize missing/negative badly, penalize small n
def score_row(r):
    s = 0.0
    for half in ('is', 'oos'):
        h = r[half]
        if not h['n'] or h['net'] is None:
            s -= 1e6
            continue
        s += h['net']
        if h['small']:
            s -= 20
        if h['net'] < 0:
            s -= 50
    return s

best = max([r for r in rows if r['id'] != 'base'], key=score_row)
print('least-bad non-base by combined net (small/negative penalized):',
      best['id'], 'IS', fmt(best['is']), '| OOS', fmt(best['oos']))
print('base: IS', fmt(base['is']), '| OOS', fmt(base['oos']))

# 1m sensitivity note
print('\n========== DATA NOTES ==========')
print('1m Yahoo coverage is only', utc(json.loads((DATA/'gc_1m_chunked.json').read_text())['bars'][0]['t']) if False else 'see below')

# dump json
out = {
    'spread': SPREAD, 'lot': LOT, 'sl_pct': SL_PCT,
    'tp': '1.5× ATR(14) of 5m (TP1)',
    'split_utc': utc(SPLIT) + 'Z', 'split_pht': pht(SPLIT),
    'n_15m': len(b15), 'n_5m': len(b5),
    't0_utc': utc(b15[0]['t']) + 'Z', 't1_utc': utc(b15[-1]['tc']) + 'Z',
    'v1_flips_5m': raw_flips,
    'rejection_n': n_rej,
    'rows': [{k: v for k, v in r.items() if k != 'taken'} for r in rows],
}
(OUT / 'v1_zones_results.json').write_text(json.dumps(out, indent=2, default=str))
print('wrote', OUT / 'v1_zones_results.json')
