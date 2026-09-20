import { lerp, ease, clamp01 } from '../anim.js';

/* 걸음 해석기.
   "시간"이 아니라 "이동 거리"로 걸음을 계산한다.
   → 발이 딛고 있는 동안 그 발은 땅의 한 점에 고정되고, 몸만 지나간다.
     (발 미끄러짐이 생기지 않는 유일한 방법)

   모든 값은 캐릭터 키를 1.0으로 본 단위. */

export const GAIT = {
	stride: 0.175, // 한 걸음(반 사이클) 이동 거리 — 다리 길이(0.2)로 닿는 한계 안에서
	duty: 0.62, // 한 발이 땅에 붙어 있는 비율 (0.5보다 크면 양발 지지 구간이 생긴다)
	lift: 0.052, // 스윙할 때 발이 뜨는 최대 높이
	spacing: 0.098, // 좌우 발 간격 (중심선에서) — 이 모델의 고관절이 ±0.10에 있어서 그만큼 벌려야 다리가 수직으로 선다
	dip: 0.033, // 접지 순간 골반이 내려앉는 깊이 (이만큼 낮춰야 다리가 앞뒤로 닿는다)
	pelvisYaw: 0.15, // 골반이 앞으로 나가는 다리를 따라 도는 양
	pelvisRoll: 0.08, // 스윙하는 쪽 골반이 떨어지는 양
	chestYaw: 0.1, // 상체는 골반과 반대로 돈다
	armSwing: 0.42,
};

/**
 * 한 발의 상태.
 * @param distance 지금까지 이동한 거리
 * @param offset   0이면 왼발, 0.5면 오른발 (반 사이클 어긋남)
 * @returns { s: 발의 이동거리 좌표, lift: 높이, phase: 구간 내 진행도, planted: 접지 여부 }
 */
export function footState(distance, offset, g = GAIT) {
	const cycle = g.stride * 2;
	const u = distance / cycle + offset;
	const k = Math.floor(u);
	const p = u - k;

	// 이번 사이클에 이 발이 딛고 있는 지점 (몸보다 반걸음 앞에 착지한다)
	const plant = (k - offset) * cycle + g.stride * 0.5;

	if (p < g.duty) {
		return { s: plant, lift: 0, phase: p / g.duty, planted: true };
	}

	const q = (p - g.duty) / (1 - g.duty);
	return {
		s: lerp(plant, plant + cycle, ease.inOut(q)),
		lift: Math.sin(q * Math.PI) * g.lift,
		phase: q,
		planted: false,
	};
}

/** 발바닥 각도 (+면 발끝이 내려감). 뒤꿈치 접지 → 평평 → 발끝으로 밀기 */
export function footPitch(st) {
	const p = st.phase;
	if (st.planted) {
		if (p < 0.16) return lerp(-0.3, 0, p / 0.16); // 뒤꿈치부터 닿는다
		if (p < 0.68) return 0; // 발바닥 전체가 땅에
		return lerp(0, 0.5, (p - 0.68) / 0.32); // 발끝으로 밀어낸다
	}
	if (p < 0.5) return lerp(0.5, -0.12, p / 0.5); // 차올린 발끝이 돌아온다
	return lerp(-0.12, -0.3, (p - 0.5) / 0.5); // 착지 준비 (뒤꿈치 들기)
}

/** 골반 높이 — 양발 지지(접지 순간)에서 가장 낮고, 한 발로 지날 때 가장 높다 */
export function hipBob(distance, g = GAIT) {
	const cycle = g.stride * 2;
	const p = (distance / cycle) % 1;
	return -g.dip * (0.5 + 0.5 * Math.cos(4 * Math.PI * p));
}

/** 골반의 좌우 흔들림 — 지지발 쪽으로 무게가 실린다 */
export function hipSway(distance, g = GAIT) {
	const cycle = g.stride * 2;
	const p = (distance / cycle) % 1;
	return Math.sin(2 * Math.PI * p) * g.spacing * 0.55;
}

/** 골반 회전(yaw)과 기울기(roll) */
export function pelvis(distance, g = GAIT) {
	const cycle = g.stride * 2;
	const p = (distance / cycle) % 1;
	const a = 2 * Math.PI * p;
	return {
		yaw: Math.sin(a) * g.pelvisYaw,
		roll: -Math.sin(a) * g.pelvisRoll,
	};
}

/** 팔 스윙 각도 (다리와 반대). lag를 주면 팔꿈치가 조금 늦게 따라온다 */
export function armSwing(distance, lag = 0, g = GAIT) {
	const cycle = g.stride * 2;
	const p = ((distance - lag) / cycle) % 1;
	return -Math.sin(2 * Math.PI * p) * g.armSwing;
}

/** 걸음 사이클 안에서의 위치 (0~1) — 다른 연출과 박자를 맞출 때 */
export function cyclePhase(distance, g = GAIT) {
	return clamp01(((distance / (g.stride * 2)) % 1 + 1) % 1);
}
