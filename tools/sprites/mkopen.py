# 뚜껑을 여는 오른팔(open-0~8.png)을 "raise 가 끝난 자세" 한 장에서 조립한다.
#
#   python tools/sprites/mkopen.py   →  public/sprites/open-0..8.png 를 다시 만들고 검사한다
#
# 바탕은 raise-11(= base/raise-end.png) 이다. hold.png 로 만들면 raise 가 끝난 자세와
# 손 높이가 6px 어긋나서 #359 → #360 에서 노트북이 툭 떨어진다.
#
# 팔은 새로 "그리지" 않는다. 원본 소매 픽셀을 곡선을 따라 **구부린다**.
# 캡슐로 새로 칠하면 두께·윤곽선·접힘선·어깨 주름이 전부 사라져서 팔이 뭉개져 보인다.
#
# 필요한 것: pillow, numpy, scipy
import io
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'base')                            # 원본 (건드리지 않는다)
DST = os.path.join(HERE, '..', '..', 'public', 'sprites')   # 결과

MID = (35, 36, 35)   # 후드 본색
DARK = (19, 17, 25)  # 후드 그늘

# ── 뼈대 ────────────────────────────────────────────────────────────────────
N = 9                        # 노트북 뚜껑 스프라이트와 같은 장수 (손과 뚜껑이 같이 움직인다)
S = (153.5, 101.0)           # 어깨 관절 (raise-end 의 팔 중심선을 실측해 맞춘 값)
LY_TOP = [35, 34, 33, 29, 23, 17, 13, 11, 9]   # laptop/open-*.png 의 뚜껑 윗변 y (실측)
CY = [t + 100.6 for t in LY_TOP]               # 손 중심 y (CY[0] = 135.6 = raise-end 의 손 자리)
HX0, HX1 = 155.8, 150.0      # 손 중심 x — 뚜껑 오른쪽 모서리를 따라 조금 안쪽으로
WOFF = (4.7, 0.0)            # 손 중심 → 손목
FORESHORTEN = 0.18           # 팔이 접힐수록 화면상 길이가 준다 (아래팔이 카메라 쪽을 향하므로)
UPPER_RATIO = 0.63           # 위팔이 아래팔보다 길어야 팔꿈치가 어깨 아래로 내려온다
BEND_MAX = 5.0               # 팔꿈치가 옆으로 부푸는 최대치 (더 크면 소매가 고리처럼 겹친다)
EXT = 14.0                   # 손목 너머로 소매가 조금 더 이어진다 (원본 소매 끝이 손목보다 아래)
ARM_Y0 = 100                 # 이 위는 후드라 건드리지 않는다

SKIN_COLORS = [(246, 213, 177), (232, 169, 139), (213, 134, 115),
               (182, 102, 91), (145, 74, 67), (100, 43, 41)]


def _orig(name):
    """원본은 반드시 base/ 에서 읽는다 — public/ 을 읽으면 자기 출력을 다시 먹어서
    돌릴 때마다 팔이 1~2px 씩 부푼다."""
    return np.array(Image.open(os.path.join(SRC, name + '.png')).convert('RGBA')).astype(np.int16)


def save(a, path):
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA').save(path, optimize=True)


base = _orig('raise-end')   # raise 가 끝난 자세 (= public/sprites/raise-11.png)
H, Wd = base.shape[:2]
YY, XX = np.mgrid[0:H, 0:Wd]


def ik(shoulder, wrist, l1, l2, bend):
    """팔꿈치 자리. 옆으로 부푸는 양(bend)은 직접 준다 —
    역기구학의 h 는 곧게 편 상태에서 sqrt 라 0에서 갑자기 튀어오르고,
    그러면 한 프레임 만에 팔이 3px 뚱뚱해진다."""
    dx, dy = wrist[0] - shoulder[0], wrist[1] - shoulder[1]
    d = max(1e-6, min(math.hypot(dx, dy), l1 + l2 - 1e-6))
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    ux, uy = dx / d, dy / d
    return (shoulder[0] + a * ux + bend * uy, shoulder[1] + a * uy - bend * ux)


def curve(s, e, w, n=481):
    """어깨-팔꿈치-손목을 지나는 2차 베지어 + 손목 너머 직선 연장.
    반환: 점열, 호길이 0~1, 단위 접선."""
    ctrl = (2 * e[0] - (s[0] + w[0]) / 2, 2 * e[1] - (s[1] + w[1]) / 2)
    t = np.linspace(0, 1, n)
    px = (1 - t) ** 2 * s[0] + 2 * (1 - t) * t * ctrl[0] + t ** 2 * w[0]
    py = (1 - t) ** 2 * s[1] + 2 * (1 - t) * t * ctrl[1] + t ** 2 * w[1]
    ex, ey = px[-1] - px[-2], py[-1] - py[-2]
    el = math.hypot(ex, ey) or 1.0
    k = np.arange(1, 61) * (EXT / 60)
    px = np.concatenate([px, px[-1] + k * ex / el])
    py = np.concatenate([py, py[-1] + k * ey / el])
    u = np.concatenate([[0], np.cumsum(np.hypot(np.diff(px), np.diff(py)))])
    u /= u[-1]
    tx, ty = np.gradient(px), np.gradient(py)
    tl = np.hypot(tx, ty)
    tl[tl == 0] = 1
    return px, py, u, tx / tl, ty / tl


def hand_piece(im, grow=2):
    """오른손을 살색 덩어리 + 둘레 2px 만큼 오려 낸다. (마스크, 중심)"""
    r, g, b, a = [im[:, :, i] for i in range(4)]
    skin = (a > 16) & (r > 150) & (g > 110) & (b > 90) & (r >= g) & (g >= b)
    skin[:100, :] = False                      # 얼굴은 뺀다
    lab, n = ndimage.label(skin)
    best = None
    for i in range(1, n + 1):
        ys, xs = np.nonzero(lab == i)
        if xs.mean() < 126:                    # 몸 중심보다 왼쪽이면 왼손
            continue
        if best is None or len(ys) > best[0]:
            best = (len(ys), lab == i, xs.mean(), ys.mean())
    _, sel, cx, cy = best
    m = ndimage.binary_dilation(sel, np.ones((3, 3), bool), iterations=grow) & (a > 16)
    return m, (cx, cy)


hmask, hc = hand_piece(base)
hys, hxs = np.nonzero(hmask)
hand_px = base[hmask]
hand_off = np.stack([hxs - hc[0], hys - hc[1]], 1)

# 원본에서 "소매만". 손은 따로 붙이므로 구부릴 대상에서 빼되, 손이 있던 자리를 비워 두면
# 구부린 소매에 1px 틈이 생긴다. 가장 가까운 소매 색으로 메운다 (손 뒤에 가려져 있던 소매다).
HOLE = ndimage.binary_dilation(hmask, np.ones((3, 3), bool), iterations=1)
SLEEVE = (base[:, :, 3] > 16) & ~HOLE
SRCIMG = base.copy()
_, _idx = ndimage.distance_transform_edt(~SLEEVE, return_indices=True)
_hy, _hx = np.nonzero(HOLE & (base[:, :, 3] > 16))
SRCIMG[_hy, _hx] = base[_idx[0][_hy, _hx], _idx[1][_hy, _hx]]
SLEEVE = SLEEVE | (HOLE & (base[:, :, 3] > 16))

# 팔 없는 몸통 판.
#   raise-end 의 오른팔·주먹은 x147 까지 걸쳐 있으므로 거기부터 지운다.
#   남겨 두면 손이 올라간 프레임에서 옛 주먹이 노트북 모서리에 얼룩으로 남는다.
plate = base.copy()
plate[ARM_Y0:182, 147:] = 0
for y in range(ARM_Y0, 146):
    plate[y, 147:149] = (*DARK, 255)
    plate[y, 149:155] = (*MID, 255)
    plate[y, 155:157] = (*DARK, 255)
plate[146:182, 147:] = base[146:182, 147:]   # 팔이 지나가지 않는 아래쪽은 원본 그대로


def stray_skin(im, x0=138, y0=100):
    """몸 오른쪽 아래에 남은 살색 — 지금 그린 손이 아니면 전부 옛 주먹의 잔상이다."""
    m = np.zeros(im.shape[:2], bool)
    for c in SKIN_COLORS:
        m |= np.all(im[:, :, :3] == c, 2)
    m &= im[:, :, 3] > 16
    m[:y0, :] = False
    m[:, :x0] = False
    return m


_n = int(stray_skin(plate).sum())
assert _n == 0, f'판에 옛 주먹 살색이 {_n}px 남아 있다'

W0 = (HX0 + WOFF[0], CY[0] + WOFF[1])
L_STRAIGHT = math.hypot(W0[0] - S[0], W0[1] - S[1])
E0 = ik(S, W0, L_STRAIGHT * UPPER_RATIO, L_STRAIGHT * (1 - UPPER_RATIO), 0.0)
OPX, OPY, OU, OTX, OTY = curve(S, E0, W0)


def measure_profile(nb=64):
    """원본 소매가 중심선에서 바깥/안쪽으로 얼마나 뻗어 있는지 u 마다 잰다.
    구부린 팔도 이 폭을 그대로 쓴다 — 그래야 반대쪽 팔과 두께가 같다."""
    dx = XX[..., None] - OPX
    dy = YY[..., None] - OPY
    i = np.argmin(dx * dx + dy * dy, axis=2)
    u = OU[i]
    off = OTX[i] * (YY - OPY[i]) - OTY[i] * (XX - OPX[i])    # + = 몸통 쪽
    m = SLEEVE & (np.abs(off) < 16) & (YY >= ARM_Y0) & (XX >= 138)
    lo = np.full(nb, -6.0)
    hi = np.full(nb, 6.0)
    b = np.clip((u * nb).astype(int), 0, nb - 1)
    for k in range(nb):
        sel = m & (b == k)
        if sel.sum() < 3:
            continue
        v = off[sel]
        lo[k] = v.min() - 0.5
        hi[k] = v.max() + 0.5
    ker = np.array([1, 2, 3, 2, 1], float)
    ker /= ker.sum()
    lo = np.convolve(np.pad(lo, 2, mode='edge'), ker, 'valid')
    hi = np.convolve(np.pad(hi, 2, mode='edge'), ker, 'valid')
    return np.linspace(0, 1, nb), lo, hi


PU, POUT, PIN = measure_profile()


def close_gaps(im, lim=6):
    """몸통과 팔 사이에 남는 좁은 틈은 겨드랑이 그늘로 메운다.
    한 줄이 두 조각으로 갈라져 보이면 그 자체로 팔이 떨어져 나간 것처럼 읽힌다.
    반대쪽 팔의 겨드랑이보다 두꺼워지지 않게 좁게 잡는다."""
    op = im[:, :, 3] > 16
    for y in range(ARM_Y0, 168):
        xs = np.flatnonzero(op[y])
        if xs.size == 0:
            continue
        for c in np.flatnonzero(np.diff(xs) > 1):
            a0, b0 = int(xs[c]) + 1, int(xs[c + 1])
            if b0 - a0 <= lim:
                im[y, a0:b0] = (*DARK, 255)


def despeckle(im, area):
    """area 안에서 상하좌우 어느 쪽과도 색이 같지 않은 픽셀을 이웃 다수결로 덮는다."""
    rgb = im[:, :, :3]
    op = im[:, :, 3] > 16
    ys, xs = np.nonzero(area & op)
    fixes = []
    for y, x in zip(ys, xs):
        if not (0 < y < im.shape[0] - 1 and 0 < x < im.shape[1] - 1):
            continue
        c = tuple(int(v) for v in rgb[y, x])
        votes = {}
        alone = True
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            if not op[y + dy, x + dx]:
                continue
            q = tuple(int(v) for v in rgb[y + dy, x + dx])
            votes[q] = votes.get(q, 0) + 1
            if q == c:
                alone = False
        if alone and votes:
            fixes.append((y, x, max(votes, key=votes.get)))
    for y, x, q in fixes:
        im[y, x] = (*q, 255)


def build(k):
    s = (CY[0] - CY[k]) / (CY[0] - CY[N - 1])       # 0 = 닫힘, 1 = 활짝
    cx, cy = HX0 + (HX1 - HX0) * s, CY[k]
    W = (cx + WOFF[0], cy + WOFF[1])
    L = L_STRAIGHT * (1 - FORESHORTEN * s)
    bend = BEND_MAX * (3 * s * s - 2 * s * s * s)   # 0 → BEND_MAX 로 매끄럽게 (양끝 기울기 0)
    E = ik(S, W, L * UPPER_RATIO, L * (1 - UPPER_RATIO), bend)

    if k == 0:
        # 0번은 raise 의 마지막 프레임 그대로다. 여기서 한 픽셀이라도 달라지면
        # 아무것도 안 움직이는 순간에 실루엣만 바뀌어서 딸깍거린다.
        # 원본 소매 끝에 3px 짜리 끊긴 줄이 하나 있어서 그것만 메운다.
        im0 = base.copy()
        close_gaps(im0)
        return im0, E, W

    NPX, NPY, NU, NTX, NTY = curve(S, E, W)

    # 새 곡선 기준으로 각 픽셀의 (호길이 u, 옆으로 떨어진 거리 off)
    dx = XX[..., None] - NPX
    dy = YY[..., None] - NPY
    i = np.argmin(dx * dx + dy * dy, axis=2)
    u = NU[i]
    off = NTX[i] * (YY - NPY[i]) - NTY[i] * (XX - NPX[i])
    inband = (off >= np.interp(u, PU, POUT)) & (off <= np.interp(u, PU, PIN))
    # 곡선 끝 너머는 "가장 가까운 점 = 끝점"이라 u 가 1에 붙는다. 그대로 두면 쏟아진다.
    inband &= (u < 0.999) | (np.hypot(XX - NPX[-1], YY - NPY[-1]) <= 2.0)
    inband[:ARM_Y0, :] = False

    # 같은 u, 같은 거리에 있는 원본 픽셀을 가져온다.
    # cross(T, n) = +1 이 되는 법선은 n = (-ty, tx) — off 의 부호와 같은 뜻이어야 한다.
    j = np.searchsorted(OU, np.clip(u, 0, 1)).clip(0, len(OU) - 1)
    sx = np.round(OPX[j] - off * OTY[j]).astype(int)
    sy = np.round(OPY[j] + off * OTX[j]).astype(int)
    ok = inband & (sx >= 0) & (sx < Wd) & (sy >= 0) & (sy < H)
    arm = np.zeros_like(ok)
    yy, xx = np.nonzero(ok)
    arm[yy, xx] = SLEEVE[sy[yy, xx], sx[yy, xx]]

    im = plate.copy()
    ya, xa = np.nonzero(arm)
    im[ya, xa] = SRCIMG[sy[ya, xa], sx[ya, xa]]

    # 손 — 원본 주먹을 그대로 옮긴다 (raise 가 끝날 때의 손과 같은 그림)
    hx = np.round(hand_off[:, 0] + cx).astype(int)
    hy = np.round(hand_off[:, 1] + cy).astype(int)
    hand_at = np.zeros((H, Wd), bool)
    hand_at[hy, hx] = True
    im[hy, hx] = hand_px

    # 바깥 실루엣은 원본의 그 자리 색(대개 윤곽선)을 그대로 쓴다.
    # 반올림으로 한 칸씩 밀리면 윤곽선(4,3,4)이 그늘색(19,17,25)으로 바뀌어 테두리가 흐려진다.
    edge_off = np.interp(u, PU, POUT) + 0.5
    ex = np.round(OPX[j] - edge_off * OTY[j]).astype(int).clip(0, Wd - 1)
    ey = np.round(OPY[j] + edge_off * OTX[j]).astype(int).clip(0, H - 1)
    opa = im[:, :, 3] > 16
    rim = arm & ~ndimage.binary_erosion(opa, np.ones((3, 3), bool))
    ry, rx = np.nonzero(rim & SLEEVE[ey, ex])
    im[ry, rx] = SRCIMG[ey[ry, rx], ex[ry, rx]]

    # 팔이 접히며 둘러싸인 구멍은 배경이 아니라 그늘이다
    op = im[:, :, 3] > 16
    lab, _ = ndimage.label(~op)
    outside = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    holes = (~op) & ~np.isin(lab, outside)
    # 대각선으로만 바깥과 이어진 1px 바늘구멍도 메운다 (팔 구간만)
    nb = (op.astype(int) + np.roll(op, 1, 0) + np.roll(op, -1, 0)
          + np.roll(op, 1, 1) + np.roll(op, -1, 1))
    pin = (~op) & (nb >= 3)
    pin[:ARM_Y0, :] = False
    pin[182:, :] = False
    pin[:, :140] = False
    holes |= pin
    im[holes] = (*DARK, 255)

    before = im.copy()
    close_gaps(im)
    filled = np.any(im != before, 2)

    # 그린 자리 밖은 무조건 판 그대로 돌려놓는다.
    # 반올림·틈메우기가 엉뚱한 곳에 한 픽셀이라도 흘리면 그게 잔상이 된다.
    keep = arm | hand_at | holes | filled
    im[~keep] = plate[~keep]

    despeckle(im, arm & ~hand_at)
    return im, E, W


def verify(im, name):
    a = im[:, :, 3] > 16
    _, n = ndimage.label(a, np.ones((3, 3), bool))
    split = [y for y in range(95, 170) if a[y].any() and (np.diff(np.flatnonzero(a[y])) > 1).any()]
    pal = {tuple(int(v) for v in c) for c in np.unique(im[a][:, :3], axis=0)}

    sk = stray_skin(im)
    lab, sn = ndimage.label(sk, np.ones((3, 3), bool))
    bits = sorted(int((lab == i).sum()) for i in range(1, sn + 1))
    ghosts = bits[:-1] if bits else []

    ok = (n == 1) and not split and not ghosts
    print(f'{name}: 덩어리 {n}개, 색 {len(pal)}개, 끊긴 행 {split or "없음"}, '
          f'살색 잔상 {ghosts or "없음"}  {"OK" if ok else "FAIL"}')
    return ok


if __name__ == '__main__':
    bedge = [int(np.flatnonzero(base[y, :, 3] > 16).max()) for y in range(100, 150)]
    allok = True
    for k in range(N):
        im, E, W = build(k)
        save(im, os.path.join(DST, f'open-{k}.png'))
        allok &= verify(im, f'open-{k}')
        e = [int(np.flatnonzero(im[y, :, 3] > 16).max()) for y in range(100, 150)]
        d = [x - y for x, y in zip(e, bedge)]
        print(f'         팔꿈치=({E[0]:6.1f},{E[1]:6.1f})  손목=({W[0]:6.1f},{W[1]:6.1f})  '
              f'원본 대비 폭 {sum(d)/len(d):+.2f}px (최대 {max(d):+d} / 최소 {min(d):+d})')
    print(('전부 통과' if allok else '문제 있음') + f' ({N}프레임)')
    raise SystemExit(0 if allok else 1)
