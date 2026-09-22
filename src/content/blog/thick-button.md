---
title: '두께가 있는 버튼 — 누르면 바닥까지 내려앉게'
description: '카드 위 PLAY 버튼은 바닥판과 뚜껑, 두 겹입니다. 뚜껑만 6px 떠 있다가 누르면 바닥에 앉아요. 유리처럼 비치게 만드는 데 함정이 둘 있었습니다.'
pubDate: '2026-09-16'
category: 'craft'
cover: '/art/blog/glass-button.png'
tags: ['CSS', '버튼', '인터랙션']
---

카드 왼쪽 아래 PLAY 버튼은 평평하지 않아요. **바닥판은 제자리에 있고 뚜껑만 6px 떠 있다가, 누르면 바닥까지 내려앉습니다.** 참고한 건 Collect UI의 "Confirm?" 버튼(reijowrites)이에요.

바닥판은 `::before`로 깔고, 뚜껑은 `transform: translateY(-6px)`로 띄웁니다. 높이를 바꾸지 않고 transform만 쓰니까 눌러도 레이아웃이 흔들리지 않아요.

```css
.gc-play-cap { transform: translateY(-6px); }
.gc-play:active .gc-play-cap { transform: translateY(0); }
```

## 뚜껑은 반투명 유리예요

`backdrop-filter: blur(12px)`로 뒤의 키아트가 비쳐 보입니다. 다만 글씨가 **어떤 그림 위에서도** 읽혀야 해요. 그래서 어두운 바닥 한 겹(`rgba(8,8,14,.42)`)을 깔고 그 위에 카드 색을 얹습니다. 색만 얹으면 밝은 네온 위에서 흰 글씨가 묻혀요.

## 함정 하나: 부모에 filter를 걸면 안 됩니다

`filter`는 backdrop-root를 만들어요. 그러면 자식의 `backdrop-filter`가 그 바깥(=카드 그림)을 못 봅니다. 처음에 버튼에 `drop-shadow`를 줬더니 유리가 아예 안 비쳤어요. 그림자는 바닥판의 `box-shadow`로 옮겼습니다.

## 함정 둘: transform의 주인은 한 요소에 하나

이 버튼만 세 겹이에요.

| 요소 | transform을 쓰는 이유 |
| :--- | :--- |
| `.gc-cta` | 등장 연출 |
| `.gc-play` | 커서 시차 |
| `.gc-play-cap` | 눌림 |

한 요소에 몰면 서로 덮어씁니다. 눌림이 시차를 지우거나, 등장 연출이 눌림을 되돌려요. **transform은 요소마다 주인이 하나**라고 생각하고 층을 나누는 게 편합니다.

## 버튼은 "보이는 손잡이"일 뿐이에요

카드 앞면 전체가 이미 게임으로 가는 링크라서, 버튼에는 `pointer-events: none`이 걸려 있어요. 실제로 누르는 건 카드고, 버튼은 어디를 누르면 되는지 알려주는 표시입니다. 그래서 `:active`도 버튼이 아니라 카드에서 받아요.

이렇게 두면 좋은 점이 있어요. 카드 어디를 눌러도 게임이 열리는데, 사용자는 "버튼을 눌렀다"고 느낍니다. 누를 수 있는 면적은 카드만큼 넓고, 시선은 버튼 하나로 모여요.
