"""두 포즈 사이를 "조각을 옮겨서" 이어 붙인다.

PixelLab 의 v3 보간은 가늘고 빈 곳이 많은 그림(크로스헤어 같은)에서 자주 무너진다 —
프레임마다 획이 통째로 사라지거나 모양이 바뀐다. 그런 그림은 보간에 맡기지 말고,
원본 픽셀을 그대로 옮겨서 조립하는 편이 빠르고 결과가 보장된다.

전제: 두 포즈가 같은 중심을 기준으로 대칭이고, 바깥 조각들이 중심 쪽으로 이동할 뿐이라는 것.
  - 중심에서 가까운 조각(중심부)은 두 포즈를 알파로 교차시킨다.
  - 나머지 조각은 방향별로 묶어, 실측한 거리만큼 정수 픽셀로 민다.
    정수로 밀기 때문에 리샘플링이 없고 도트가 뭉개지지 않는다.

    python tools/emblem-slide.py <wide.png> <lock.png> <out.png> [frames]
"""

import sys
import numpy as np
from PIL import Image
from scipy import ndimage

CENTER_R = 5.0  # 이 안쪽은 "중심부"로 보고 교차시킨다
DEADZONE = 2.5  # 이 정도 어긋남은 "가운데 줄"로 본다


def groups_of(rgba):
    """중심부 마스크와, 방향(부호)별로 묶은 바깥 조각 마스크들을 돌려준다."""
    alpha = rgba[..., 3] > 8
    lab, n = ndimage.label(alpha)
    h, w = alpha.shape
    # 캔버스 한가운데가 아니라 그림 자신의 무게중심을 쓴다.
    # 그림이 1px 만 치우쳐 있어도 캔버스 기준으로는 가로팔이 대각선 조각으로 분류된다.
    ys0, xs0 = np.where(alpha)
    cx, cy = xs0.mean(), ys0.mean()

    center = np.zeros_like(alpha)
    outer = {}
    for i in range(1, n + 1):
        m = lab == i
        ys, xs = np.where(m)
        dx, dy = xs.mean() - cx, ys.mean() - cy
        if max(abs(dx), abs(dy)) < CENTER_R:
            center |= m
            continue
        key = (
            0 if abs(dx) < DEADZONE else int(np.sign(dx)),
            0 if abs(dy) < DEADZONE else int(np.sign(dy)),
        )
        outer.setdefault(key, np.zeros_like(alpha))
        outer[key] |= m
    return center, outer


def travel(a_groups, b_groups):
    """같은 방향 그룹이 두 포즈 사이에서 몇 픽셀 움직였는지 실측한다."""
    out = {}
    for key, ma in a_groups.items():
        mb = b_groups.get(key)
        if mb is None or not mb.any():
            out[key] = (0, 0)
            continue
        ay, ax = np.where(ma)
        by, bx = np.where(mb)
        out[key] = (round(bx.mean() - ax.mean()), round(by.mean() - ay.mean()))
    return out


def over(dst, src):
    """src 를 dst 위에 알파 합성 (둘 다 float RGBA 0..1)"""
    sa = src[..., 3:4]
    da = dst[..., 3:4]
    oa = sa + da * (1 - sa)
    safe = np.where(oa > 0, oa, 1)
    rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / safe
    return np.concatenate([rgb, oa], axis=-1)


def main(wide_path, lock_path, out_path, frames=9):
    wide = np.array(Image.open(wide_path).convert("RGBA"))
    lock = np.array(Image.open(lock_path).convert("RGBA"))
    if wide.shape != lock.shape:
        sys.exit(f"두 포즈의 크기가 다르다: {wide.shape} vs {lock.shape}")

    h, w = wide.shape[:2]
    wc, wo = groups_of(wide)
    lc, lo = groups_of(lock)
    moves = travel(wo, lo)
    print("방향별 이동량:", {f"{k}": v for k, v in sorted(moves.items())})

    wf, lf = wide / 255.0, lock / 255.0
    sheet = Image.new("RGBA", (w * frames, h), (0, 0, 0, 0))

    for t in range(frames):
        u = t / (frames - 1)
        buf = np.zeros((h, w, 4), dtype=float)

        # 바깥 조각: 실측한 만큼 중심 쪽으로 민다 (정수 픽셀)
        for key, mask in wo.items():
            dx, dy = moves[key]
            sx, sy = round(dx * u), round(dy * u)
            layer = np.zeros_like(buf)
            src = np.where(mask[..., None], wf, 0)
            ys, xs = np.where(mask)
            ny, nx = np.clip(ys + sy, 0, h - 1), np.clip(xs + sx, 0, w - 1)
            layer[ny, nx] = src[ys, xs]
            buf = over(buf, layer)

        # 중심부: 작은 점 → 밝은 덩어리로 교차
        a = np.where(wc[..., None], wf, 0).copy()
        a[..., 3] *= 1 - u
        b = np.where(lc[..., None], lf, 0).copy()
        b[..., 3] *= u
        buf = over(over(buf, a), b)

        frame = Image.fromarray((np.clip(buf, 0, 1) * 255).astype(np.uint8), "RGBA")
        sheet.paste(frame, (t * w, 0))

    sheet.save(out_path)
    print(f"{out_path}: {frames} frames, {w}x{h} each, sheet {sheet.size[0]}x{sheet.size[1]}")

    # 검사: 빈 프레임이 있으면 재생 중에 깜빡인다
    arr = np.array(sheet)
    for t in range(frames):
        px = (arr[:, t * w:(t + 1) * w, 3] > 8).sum()
        if px < 30:
            print(f"  주의: 프레임 {t} 의 불투명 픽셀이 {px}개뿐이다")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 9)
