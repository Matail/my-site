"""PixelLab 애니메이션 프레임들을 가로 스프라이트 시트 한 장으로 잇는다.

CSS 는 background-position-x 를 0% → 100% 로 옮기며 프레임을 넘기므로,
프레임이 모두 같은 크기로 빈틈없이 이어져 있어야 한다.

    python tools/emblem-sheet.py public/art/emblem-aimbooster.png frame0.png frame1.png ...

검사까지 같이 한다:
  - 프레임 크기가 전부 같은가
  - 첫 프레임과 마지막 프레임이 서로 다른가 (같으면 alternate 재생이 한 박자 멎는다)
"""

import sys
from PIL import Image


def main(out_path, frame_paths):
    frames = [Image.open(p).convert("RGBA") for p in frame_paths]

    sizes = {f.size for f in frames}
    if len(sizes) != 1:
        sys.exit(f"프레임 크기가 제각각이다: {sizes}")

    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * w, 0))
    sheet.save(out_path)

    first, last = frames[0], frames[-1]
    same = list(first.getdata()) == list(last.getdata())
    print(f"{out_path}: {len(frames)} frames, {w}x{h} each, sheet {sheet.size[0]}x{sheet.size[1]}")
    if same:
        print("  주의: 첫 프레임과 마지막 프레임이 같다 — alternate 재생이 양 끝에서 멎어 보인다")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2:])
