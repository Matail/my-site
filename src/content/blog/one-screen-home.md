---
title: '스크롤이 없는 홈 — 한 화면에 다 넣기'
description: '홈은 100dvh 안에서 끝납니다. 히어로에서 아낀 픽셀이 그대로 카드 크기가 되고, 카드 크기는 컨테이너 쿼리 단위로 잽니다.'
pubDate: '2026-09-19'
category: 'devlog'
cover: '/art/blog/one-screen.png'
tags: ['레이아웃', 'CSS', '홈']
---

홈은 스크롤이 없어요. 히어로 한 줄과 카드 덱, 구석의 아이콘 줄. 이 셋이 `100dvh` 안에서 끝납니다. 스크롤이 생기는 순간 "아래에 뭔가 더 있다"는 뜻이 되는데, 홈에는 더 있는 게 없거든요.

## 남은 높이를 물려주는 구조

`<Layout fit>`을 켜면 `<html>`에 `data-fit`이 붙고, `#page`가 3단 그리드가 됩니다.

```css
html[data-fit] #page {
  height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr auto; /* 헤더 / 본문 / 구석 푸터 */
}
```

본문은 다시 2단(히어로 / 덱)이라, **덱은 "남은 높이"를 그대로 물려받아요.** 히어로에서 한 줄 아끼면 그 픽셀이 그대로 카드 크기가 됩니다. 그래서 홈의 문장은 딱 한 줄이에요.

`100vh`가 아니라 `100dvh`인 것도 중요해요. 모바일에서 주소창이 접히고 펴질 때 `vh`는 안 따라옵니다.

## 카드 크기는 컨테이너 쿼리 단위로

무대(`.deck-stage`)에 `container-type: size`를 걸면 가로·세로를 둘 다 잴 수 있어요.

```css
.gcard {
  width: min(880px, 100cqw, calc(100cqh * var(--ar)));
  aspect-ratio: var(--ar);
}
```

`aspect-ratio` + `height: 100%` + `max-width` 조합은 **쓰면 안 됩니다.** 폭만 잘리고 높이는 그대로 남아서 비율이 깨지거나, 좁은 화면에서 카드가 무대 밖으로 삐져나가요.

## 억지로 맞추지 않는 구간

가로로 누운 폰이나 작은 노트북처럼 세로가 560px도 안 되는 화면에서는 그냥 스크롤을 돌려줍니다. 억지로 한 화면에 맞추면 카드가 우표만 해져요.

```css
@media (max-height: 560px) {
  html[data-fit] { overflow: visible; }
  html[data-fit] #page { height: auto; display: block; }
}
```

이때 무대는 부모에게서 높이를 못 받으므로 `.deck-stage`에 직접 높이를 줘야 해요. 안 주면 `100cqh`가 0이 돼서 **카드가 통째로 사라집니다.**

## `ch`로 한글 줄바꿈을 잡지 마세요

`ch`는 "0" 한 글자의 폭이에요. 한글에서는 실제 폭의 절반쯤으로 잡힙니다. 한 줄로 끝내야 하는 문장의 폭은 `rem`으로 재세요.

## 스크롤바 자리는 미리 비워 둡니다

인트로가 도는 동안엔 `overflow: hidden`이라 스크롤바가 없어요. 끝나면서 스크롤바가 생기면 본문 폭이 15px 줄고, 가운데 정렬된 내용이 7.5px 옆으로 튑니다. 하필 노트북 화면 속 사이트가 진짜 사이트로 넘어가는 그 순간에요.

```css
html { scrollbar-gutter: stable; }
```

한 줄이면 됩니다. 이런 건 알고 나면 싱거운데, 모르면 "왜 화면이 한 번 덜컥거리지"로 한참을 헤매요.
