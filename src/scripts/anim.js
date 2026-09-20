/* 인트로 전용 초경량 애니메이션 유틸.
   원칙: 씬의 모든 상태는 "시간 t의 순수 함수"다.
   → 스킵/되감기/리사이즈가 전부 t 하나로 해결된다. (타임라인 라이브러리 불필요) */

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, t) => lerp(a, b, ease.inOut(clamp01(t)));

export const ease = {
	linear: (t) => t,
	in: (t) => t * t * t,
	out: (t) => 1 - Math.pow(1 - t, 3),
	outQuint: (t) => 1 - Math.pow(1 - t, 5),
	inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
	inOutQuint: (t) => (t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2),
	// 살짝 지나쳤다 돌아오는 느낌 — 멈춤 동작에 쓴다
	outBack: (t) => {
		const c1 = 1.70158;
		const c3 = c1 + 1;
		return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
	},
	// 통통 튀는 착지
	outElastic: (t) => {
		if (t === 0 || t === 1) return t;
		const c4 = (2 * Math.PI) / 3;
		return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
	},
};

/** 구간 [a, b] 안에서의 진행도(0→1). 구간 밖이면 0 또는 1로 고정. */
export function span(t, a, b, easing = ease.inOut) {
	return easing(clamp01((t - a) / (b - a)));
}

/** 결정론적 노이즈 — 전구 깜빡임, 손떨림 카메라에 사용 */
export function noise1(x) {
	const s = Math.sin(x * 127.1) * 43758.5453;
	return s - Math.floor(s);
}

/** 부드러운 1D 노이즈 (-1 ~ 1) */
export function snoise(x) {
	const i = Math.floor(x);
	const f = x - i;
	const u = f * f * (3 - 2 * f);
	return lerp(noise1(i) * 2 - 1, noise1(i + 1) * 2 - 1, u);
}
