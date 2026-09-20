import * as THREE from 'three';
import { createStage } from './stage.js';
import { createLaptop } from './laptop.js';
import { loadActor, poseArmsDown, reachTo } from './actor.js';
import { footState, footPitch, hipBob, pelvis, armSwing, GAIT } from './gait.js';
import { span, ease, clamp01, lerp } from '../anim.js';

/* 인트로 연출 전체.
   장면의 모든 상태는 시간 t의 함수로만 결정된다 → 스킵 = t 점프. */

const T = {
	dark: [0.0, 0.25],
	lampOn: [0.25, 1.05], // 전등 점등 (플리커 포함)
	walk: [1.0, 3.95], // 왼쪽에서 걸어 들어옴
	turn: [3.95, 4.7], // 정면으로 돌아섬
	raise: [4.7, 5.55], // 노트북을 앞으로 들어올림
	open: [5.35, 6.35], // 뚜껑 열기
	boot: [5.7, 7.2], // 화면 부팅 → 사이트
	dolly: [6.65, 8.35], // 화면 속으로 들어감
	handoff: [8.35, 8.95], // 진짜 사이트로 교체
};
export const INTRO_END = T.handoff[1];

/* 무대 배치 */
const WALK_FROM = -1.45;
const STAND_X = -0.04;
const STAND_Z = 0.04;
const TURN_LIFT = 0.042; // 돌아설 때 발이 뜨는 높이

/* 캐릭터가 노트북을 드는 위치 (캐릭터 로컬) */
const HOLD = new THREE.Vector3(0, 0.38, 0.29);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _fwd = new THREE.Vector3();
const _rgt = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _footL = new THREE.Vector3();
const _footR = new THREE.Vector3();
const _stance = new THREE.Vector3();

/* ===== 몸의 궤적 — 전부 t의 순수 함수 =====
   순수 함수라서 앞뒤 시점을 샘플링할 수 있고,
   그 차이로 예비동작(앞을 미리 봄)과 관성(뒤늦게 따라옴)을 만든다. */

// 거의 등속으로 걷다가 끝에서만 감속한다
const easeWalk = (u) => u * u * (3 - 2 * u) * 0.22 + u * 0.78;

function bodyX(t) {
	return lerp(WALK_FROM, STAND_X, span(t, T.walk[0], T.walk[1], easeWalk));
}

function bodyYaw(t) {
	// 걸을 땐 +X를 보고, 돌아서면 카메라(+Z)를 본다
	return (Math.PI / 2) * (1 - span(t, T.turn[0], T.turn[1], ease.outBack));
}

/** 걷기가 풀리는 정도 — 돌아서기 시작하면 1 */
function turnFade(t) {
	return span(t, T.turn[0] - 0.2, T.turn[0] + 0.1, ease.inOut);
}

/** 골반 높이: 걸음 상하동 + 정지 후 출렁임 + 들어올리기 전 예비동작 + 호흡 */
function bodyY(t, distance, walkAmt) {
	let y = hipBob(distance) * walkAmt;

	// 멈춘 직후 무게가 실렸다 풀린다
	if (t > T.turn[1]) {
		y += Math.exp(-(t - T.turn[1]) * 5.5) * Math.sin((t - T.turn[1]) * 13) * 0.015;
	}
	// 노트북을 들어올리기 직전에 살짝 가라앉는다 (예비동작)
	y -= 0.017 * Math.sin(Math.PI * span(t, T.raise[0] - 0.26, T.raise[0] + 0.14, ease.inOut));
	// 가만히 서 있어도 숨은 쉰다
	y += 0.0045 * Math.sin(t * 2.1) * span(t, T.turn[1] - 0.2, T.turn[1] + 0.5, ease.out);

	return y;
}

/** 점등 순간의 깜빡임 — 오래된 형광등 느낌 */
function flicker(dt) {
	if (dt < 0.03) return 0.85;
	if (dt < 0.07) return 0.06;
	if (dt < 0.11) return 0.75;
	if (dt < 0.17) return 0.12;
	if (dt < 0.23) return 1.0;
	if (dt < 0.27) return 0.4;
	return 1;
}

/** +Z가 zDir, +Y가 yDir 쪽을 보는 회전 */
function orientFrom(zDir, yDir, out = new THREE.Quaternion()) {
	const z = _v.copy(zDir).normalize();
	const y = _v2.copy(yDir);
	const x = _v3.crossVectors(y, z).normalize();
	y.crossVectors(z, x).normalize();
	_m.makeBasis(x, y, z);
	return out.setFromRotationMatrix(_m);
}

export async function createIntro({ canvas, modelUrl, onProgress }) {
	const stage = createStage(canvas);
	const laptop = createLaptop();
	stage.scene.add(laptop.group);

	const actor = await loadActor(modelUrl, { height: 1.0, onProgress });
	stage.scene.add(actor.root);
	actor.root.rotation.y = Math.PI / 2;
	actor.root.position.set(WALK_FROM, 0, STAND_Z);

	/* 카메라 키프레임 — [시간, 위치, 바라보는 곳]
	   전구 클로즈업으로 시작해서 아래로 내려오며 캐릭터를 찾는다. */
	const CAM = [
		{ t: 0.0, pos: [0.42, 2.12, 1.55], look: [0, 2.42, 0.15] },
		{ t: 1.2, pos: [0.42, 2.12, 1.55], look: [0, 2.42, 0.15] },
		{ t: 2.4, pos: [1.0, 0.95, 2.55], look: [-0.35, 0.58, 0] },
		{ t: 4.7, pos: [0.72, 0.84, 2.1], look: [0, 0.56, 0.03] },
		{ t: 6.65, pos: [0.3, 0.68, 1.6], look: [-0.02, 0.48, 0.16] },
	];
	const camPos = new THREE.Vector3();
	const camLook = new THREE.Vector3();

	function camAt(t) {
		let i = 0;
		while (i < CAM.length - 2 && t > CAM[i + 1].t) i++;
		const a = CAM[i];
		const b = CAM[i + 1];
		const p = ease.inOut(clamp01((t - a.t) / (b.t - a.t)));
		camPos.set(
			lerp(a.pos[0], b.pos[0], p),
			lerp(a.pos[1], b.pos[1], p),
			lerp(a.pos[2], b.pos[2], p)
		);
		camLook.set(
			lerp(a.look[0], b.look[0], p),
			lerp(a.look[1], b.look[1], p),
			lerp(a.look[2], b.look[2], p)
		);
	}

	/** 발이 있어야 할 월드 위치.
	    걷는 중엔 걸음 해석기가 준 접지점, 돌아설 땐 한 발씩 시차를 두고 제자리 스탠스로. */
	function footTarget(t, distance, side, out) {
		const L = actor.limb[side];
		const st = footState(distance, side === 'left' ? 0 : 0.5);
		const ankle = L ? L.ankleHeight : 0.03;
		// rest 자세에서의 발 위치를 기준으로 삼는다 (캐릭터 로컬: +X 왼쪽, +Z 앞)
		const lateral = L ? L.restAnkle.x : (side === 'left' ? 0.1 : -0.1);
		const fwdRest = L ? L.restAnkle.z : 0.02;
		// 고관절이 몸 중심보다 앞에 있으므로, 걸음도 고관절 기준으로 앞뒤 대칭이어야 닿는다
		const hipFwd = L ? L.hipForward : 0;

		// 걷는 중(+X를 봄): 캐릭터의 왼쪽은 -Z, 앞은 +X
		out.set(WALK_FROM + st.s + hipFwd, ankle + st.lift, STAND_Z - lateral);

		// 돌아서기: 오른발이 먼저 축을 잡고, 왼발이 뒤따라 돌아온다
		const dur = T.turn[1] - T.turn[0];
		const p =
			side === 'right'
				? span(t, T.turn[0], T.turn[0] + dur * 0.62, ease.inOut)
				: span(t, T.turn[0] + dur * 0.32, T.turn[1], ease.inOut);

		if (p > 0) {
			// 정면(+Z)을 볼 때 캐릭터의 왼쪽은 +X — rest 자세 그대로 서는 게 가장 안정적이다
			_stance.set(STAND_X + lateral, ankle, STAND_Z + fwdRest);
			out.lerp(_stance, p);
			out.y = ankle + Math.sin(p * Math.PI) * TURN_LIFT;
		}
		return out;
	}

	const carryQuat = new THREE.Quaternion();
	const holdQuat = new THREE.Quaternion();
	const screenPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };

	/** 화면이 뷰포트를 꽉 채우는 카메라 위치/방향 */
	function screenFillPose(out) {
		const f = laptop.screenFrame();
		const vFov = THREE.MathUtils.degToRad(stage.camera.fov);
		const tan = Math.tan(vFov / 2);
		const distH = f.height / 2 / tan;
		const distW = f.width / 2 / (tan * stage.camera.aspect);
		// 가로 화면: 화면이 뷰포트를 덮도록 (베젤과 손은 프레임 밖으로)
		// 세로 화면: 덮으려 들면 글자 한 조각만 보이므로 '가로 폭 채우기'로 맞춘다
		const d = stage.camera.aspect >= 1 ? Math.min(distH, distW) * 0.86 : distW * 0.95;
		out.position.copy(f.normal).multiplyScalar(d).add(f.position);
		const up = _v3.set(0, 1, 0).applyQuaternion(f.quaternion); // 화면의 위쪽
		_m.lookAt(out.position, f.position, up);
		out.quaternion.setFromRotationMatrix(_m);
		return out;
	}

	function apply(t, time) {
		/* ---------- 전등 ---------- */
		// 화면 속으로 들어갈수록 방은 어둠에 잠긴다
		const dive = span(t, T.dolly[0] + 0.35, T.dolly[1], ease.inOut);
		const lampRamp = span(t, T.lampOn[0], T.lampOn[1], ease.out);
		const lampV = t <= T.lampOn[0] ? 0 : lampRamp * flicker(t - T.lampOn[0]);
		stage.setAtmosphere(
			0.85 * span(t, T.lampOn[0] + 0.1, T.lampOn[1] + 0.6, ease.out) * (1 - dive),
			1 - dive
		);

		/* ---------- 몸통 ---------- */
		const x = bodyX(t);
		const yaw = bodyYaw(t);
		const distance = x - WALK_FROM;
		const walkAmt = span(t, T.walk[0], T.walk[0] + 0.3, ease.out) * (1 - turnFade(t));

		// 앞/오른쪽 축 (yaw에 따라 돈다)
		const fwd = _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
		const rightDir = _rgt.set(Math.cos(yaw), 0, -Math.sin(yaw));

		actor.root.rotation.y = yaw;
		actor.root.position.set(x, bodyY(t, distance, walkAmt), STAND_Z);
		actor.resetPose();

		/* 골반 — 나가는 다리를 따라 돌고, 뜨는 쪽이 살짝 내려앉는다 */
		const pel = pelvis(distance);
		actor.rotateWorld(actor.rig.hips, _up, pel.yaw * walkAmt);
		actor.rotateWorld(actor.rig.hips, fwd, pel.roll * walkAmt);

		/* 상체는 골반과 반대로 — 이게 없으면 통나무가 걷는 것처럼 보인다 */
		actor.rotateWorld(actor.rig.spine, _up, -pel.yaw * 0.85 * walkAmt);
		actor.rotateWorld(actor.rig.spine, fwd, -pel.roll * 0.5 * walkAmt);

		/* 다리 — 발을 땅에 고정하고 무릎을 IK로 푼다 */
		footTarget(t, distance, 'left', _footL);
		footTarget(t, distance, 'right', _footR);
		actor.solveLegIK('left', _footL, fwd);
		actor.solveLegIK('right', _footR, fwd);

		const stL = footState(distance, 0);
		const stR = footState(distance, 0.5);
		actor.setFootPitch('left', footPitch(stL) * walkAmt, fwd);
		actor.setFootPitch('right', footPitch(stR) * walkAmt, fwd);

		/* ---------- 팔 ---------- */
		poseArmsDown(actor, 1, 0.28);
		if (walkAmt > 0.01) {
			// 왼팔은 다리와 반대로 흔들리고, 팔꿈치는 조금 늦게 따라온다 (오버랩)
			const sw = armSwing(distance) * walkAmt;
			const swLag = armSwing(distance, 0.055) * walkAmt;
			actor.aimLocal(actor.rig.leftArm, -0.26, -Math.cos(sw), Math.sin(sw), 1);
			actor.aimLocal(actor.rig.leftForeArm, -0.18, -Math.cos(swLag * 0.7), Math.sin(swLag * 0.7) + 0.12, 1);
			// 오른팔은 노트북 무게로 거의 붙어 있고 아주 조금만 흔들린다
			const rs = -sw * 0.22;
			actor.aimLocal(actor.rig.rightArm, 0.24, -Math.cos(rs), Math.sin(rs), 1);
			actor.aimLocal(actor.rig.rightForeArm, 0.18, -0.97, 0.08, 1);
		}

		/* ---------- 머리 ----------
		   도는 쪽을 몸보다 먼저 본다(예비동작). 걸을 땐 상체가 흔들려도 머리는 수평을 지킨다. */
		const yawLead = bodyYaw(t + 0.15) - yaw;
		actor.rotateWorld(actor.rig.head, _up, yawLead * 0.6);
		actor.rotateWorld(actor.rig.neck, _up, yawLead * 0.3);
		actor.rotateWorld(actor.rig.head, _up, -pel.yaw * 0.35 * walkAmt);
		// 노트북을 들어올리면 화면을 내려다본다
		const lookDown =
			0.34 * span(t, T.raise[0] - 0.15, T.raise[0] + 0.55, ease.inOut) -
			0.12 * span(t, T.open[1] - 0.1, T.open[1] + 0.6, ease.inOut);
		actor.rotateWorld(actor.rig.head, rightDir, lookDown);
		actor.rotateWorld(actor.rig.neck, rightDir, lookDown * 0.45);

		/* ---------- 노트북 ---------- */
		// 들어올릴 때 살짝 지나쳤다 자리를 잡는다
		const raiseP = span(t, T.raise[0], T.raise[1], (u) => {
			const c = 1.05;
			return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2);
		});

		// 1) 들고 걷는 동안: 오른손에 매달려 관성으로 뒤로 끌린다
		actor.handWorld('right', _v);
		const carryPos = _v.clone();
		carryPos.y -= 0.03;
		const speed = (bodyX(t) - bodyX(t - 0.07)) / 0.07;
		const carryTilt = THREE.MathUtils.clamp(-speed * 0.16, -0.32, 0.32);
		orientFrom(
			actor.dirToWorld(new THREE.Vector3(0.1, -1, 0.05 + carryTilt)).clone(), // 본체가 아래로 늘어짐
			actor.dirToWorld(new THREE.Vector3(1, 0, 0)).clone(), // 납작한 면이 옆을 봄
			carryQuat
		);

		// 2) 다 들어올린 뒤: 몸 앞 가슴께, 화면이 카메라를 봄
		const holdPos = HOLD.clone().applyQuaternion(actor.root.quaternion).add(actor.root.position);
		orientFrom(
			actor.dirToWorld(new THREE.Vector3(0, 0.05, 1)).clone(), // 본체가 앞으로(카메라 쪽)
			actor.dirToWorld(new THREE.Vector3(0, 1, -0.05)).clone(),
			holdQuat
		);

		laptop.group.position.lerpVectors(carryPos, holdPos, raiseP);
		laptop.group.quaternion.copy(carryQuat).slerp(holdQuat, raiseP);
		// 들어올리는 중엔 살짝 위로 튀었다 내려온다
		laptop.group.position.y += Math.sin(raiseP * Math.PI) * 0.05;

		/* ---------- 뚜껑 열기 ---------- */
		const openP = span(t, T.open[0], T.open[1], ease.outBack);
		laptop.setLid(clamp01(openP));

		/* ---------- 손 위치 ---------- */
		if (raiseP > 0.02) {
			// 양손이 본체 좌우 모서리를 잡는다.
			// 화면 속으로 들어갈 땐 손이 화면 밖으로 빠지도록 앞쪽 모서리로 미끄러진다.
			const half = laptop.size.w * lerp(0.46, 0.56, dive);
			const depth = laptop.size.d * lerp(0.55, 1.05, dive);
			const baseMid = laptop.group.localToWorld(_v.set(0, -0.01 * dive, depth));
			const right = _v2.set(1, 0, 0).applyQuaternion(laptop.group.quaternion);
			const leftGrip = baseMid.clone().add(right.clone().multiplyScalar(half));
			const rightGrip = baseMid.clone().add(right.clone().multiplyScalar(-half));
			reachTo(actor, 'left', leftGrip, raiseP);
			reachTo(actor, 'right', rightGrip, raiseP);

			// 뚜껑은 저절로 열리지 않는다 — 오른손이 앞 모서리를 밀어 올렸다가 내려온다
			const push =
				span(t, T.open[0] - 0.14, T.open[0] + 0.1, ease.out) *
				(1 - span(t, T.open[1] - 0.3, T.open[1] + 0.12, ease.inOut));
			if (push > 0.01) {
				reachTo(actor, 'right', laptop.lidEdge(-0.3).clone(), push);
			}
		}

		/* ---------- 화면 ---------- */
		const bootP = span(t, T.boot[0], T.boot[0] + 0.9, ease.out);
		const siteP = span(t, T.boot[0] + 0.75, T.boot[1], ease.inOut);
		const power = span(t, T.open[0] + 0.15, T.open[0] + 0.55, ease.out);
		laptop.setScreen({ power, boot: bootP, site: siteP });

		// 전환 순간 화면이 하얗게 타오른다
		const burn = span(t, T.handoff[0], T.handoff[1], ease.in);
		laptop.setBrightness(power * (0.55 + 0.45 * span(t, T.boot[0], T.boot[0] + 0.5, ease.out)), burn);
		laptop.update(time);

		// 화면이 얼굴을 비춘다
		const f = laptop.screenFrame();
		stage.setScreenLight(power * 0.9, _v.copy(f.position).addScaledVector(f.normal, 0.24));

		// 전등: 화면이 켜지면 살짝 줄고, 화면 속으로 들어갈 땐 방이 어두워진다
		stage.setLamp(lampV * lerp(1, 0.7, power) * (1 - 0.92 * dive));

		// 화면이 시야를 채우기 직전, 손과 몸통은 조용히 사라진다
		const vanish = 1 - span(t, T.dolly[0] + 0.45, T.dolly[1] - 0.25, ease.inOut);
		actor.setOpacity(vanish);
		laptop.setShellOpacity(vanish);

		/* ---------- 카메라 ---------- */
		const shake = stage.handheld(time, 1 - span(t, T.dolly[0], T.dolly[1], ease.out));
		camAt(t);
		// 걷는 동안엔 카메라가 캐릭터를 살짝 따라간다 (패닝)
		const follow =
			span(t, T.walk[0] - 0.2, T.walk[0] + 0.8, ease.out) *
			(1 - span(t, T.turn[0] - 0.2, T.turn[1], ease.inOut));
		camLook.x += (x - camLook.x) * 0.5 * follow;
		camPos.x += (x - camPos.x) * 0.18 * follow;
		stage.camera.position.copy(camPos);
		stage.camera.position.x += shake.x;
		stage.camera.position.y += shake.y;
		stage.camera.lookAt(camLook);

		const dollyP = span(t, T.dolly[0], T.dolly[1], ease.inOutQuint);
		if (dollyP > 0) {
			screenFillPose(screenPose);
			stage.camera.position.lerp(screenPose.position, dollyP);
			stage.camera.quaternion.slerp(screenPose.quaternion, dollyP);
		}

		/* ---------- 초점 ----------
		   전구 → 캐릭터 → 노트북 화면 순으로 초점이 옮겨간다.
		   마지막엔 흐림을 0에 가깝게 줄여서 사이트 글자가 또렷하게 남는다. */
		_v.set(0, 2.42, 0.15) // 전구
			.lerp(_v2.set(x, 0.56, STAND_Z), span(t, T.walk[0] + 0.15, T.walk[0] + 1.1, ease.inOut))
			.lerp(f.position, span(t, T.open[0] - 0.25, T.open[1], ease.inOut));
		stage.setFocus(
			stage.camera.position.distanceTo(_v),
			lerp(1, 0.12, span(t, T.dolly[0] + 0.2, T.dolly[1] - 0.35, ease.inOut))
		);
		stage.setBloom(0.34 + burn * 1.2);
		// 화면이 시야를 채울수록 비네트/그레인을 걷어낸다 (진짜 사이트와 톤을 맞추려고)
		stage.setGrade(lerp(1.35, 0.25, dive), lerp(0.05, 0.015, dive));

		stage.tick(time);
	}

	function render() {
		stage.render();
	}

	return {
		stage,
		actor,
		laptop,
		apply,
		render,
		resize: stage.resize,
		dispose() {
			stage.dispose();
		},
		T,
		END: INTRO_END,
	};
}
