import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp01, lerp } from '../anim.js';

/* 캐릭터 — Tripo에서 뽑은 리깅된 GLB를 불러와 절차적으로 움직인다.
   본 이름 규칙(mixamo/tripo)에 덜 의존하도록 "이름 후보 + 위치"로 뼈를 찾고,
   포즈는 전부 '이 뼈가 이 방향을 보게' 식의 aim으로 만든다.
   → 리그의 rest 자세가 T포즈든 A포즈든 같은 결과가 나온다. */

const BONES = {
	hips: ['hips', 'pelvis', 'root_hips'],
	spine: ['spine2', 'spine1', 'spine', 'chest'],
	neck: ['neck'],
	head: ['head'],
	leftArm: ['leftarm', 'left_arm', 'upperarm_l', 'arm_l', 'shoulder_l'],
	rightArm: ['rightarm', 'right_arm', 'upperarm_r', 'arm_r', 'shoulder_r'],
	leftForeArm: ['leftforearm', 'lowerarm_l', 'forearm_l', 'elbow_l'],
	rightForeArm: ['rightforearm', 'lowerarm_r', 'forearm_r', 'elbow_r'],
	leftHand: ['lefthand', 'hand_l'],
	rightHand: ['righthand', 'hand_r'],
	leftUpLeg: ['leftupleg', 'upleg_l', 'thigh_l', 'leg_l_upper'],
	rightUpLeg: ['rightupleg', 'upleg_r', 'thigh_r', 'leg_r_upper'],
	leftLeg: ['leftleg', 'lowerleg_l', 'calf_l', 'knee_l'],
	rightLeg: ['rightleg', 'lowerleg_r', 'calf_r', 'knee_r'],
	leftFoot: ['leftfoot', 'foot_l'],
	rightFoot: ['rightfoot', 'foot_r'],
};

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m0 = new THREE.Matrix4();

function norm(name) {
	return name.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');
}

function pickBone(bones, candidates) {
	for (const c of candidates) {
		const key = c.replace(/[^a-z0-9]/g, '');
		const hit = bones.find((b) => norm(b.name) === key);
		if (hit) return hit;
	}
	for (const c of candidates) {
		const key = c.replace(/[^a-z0-9]/g, '');
		const hit = bones.find((b) => norm(b.name).includes(key));
		if (hit) return hit;
	}
	return null;
}

export async function loadActor(url, { height = 1.0, onProgress } = {}) {
	const loader = new GLTFLoader();
	const gltf = await loader.loadAsync(url, (e) => {
		if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
	});
	const model = gltf.scene;

	/* --- 크기 정규화: 키 = height --- */
	model.updateWorldMatrix(true, true);
	const box = new THREE.Box3().setFromObject(model);
	const size = box.getSize(new THREE.Vector3());
	const scale = height / (size.y || 1);
	model.scale.setScalar(scale);
	model.updateWorldMatrix(true, true);

	/* --- 정면 방향 자동 보정 ---
	   양손 뼈의 위치로 좌우축을 구하고, 거기서 정면(F = L × U)을 역산한다.
	   Tripo 출력은 +X를 보고 있는데, 씬에서는 "로컬 +Z = 정면"으로 쓰고 싶다. */
	const handBones = [];
	model.traverse((o) => {
		if (o.isBone) handBones.push(o);
	});
	const lh = handBones.find((b) => /lefthand/i.test(b.name.replace(/[^a-z]/gi, '')));
	const rh = handBones.find((b) => /righthand/i.test(b.name.replace(/[^a-z]/gi, '')));
	if (lh && rh) {
		const lp = lh.getWorldPosition(new THREE.Vector3());
		const rp = rh.getWorldPosition(new THREE.Vector3());
		const leftDir = lp.sub(rp).setY(0).normalize();
		const forward = leftDir.cross(new THREE.Vector3(0, 1, 0)).normalize();
		model.rotation.y = -Math.atan2(forward.x, forward.z);
		model.updateWorldMatrix(true, true);
	}

	/* --- 위치 정규화: 발바닥 = y0, 좌우/앞뒤 중심 = 원점 --- */
	const box2 = new THREE.Box3().setFromObject(model);
	const center = box2.getCenter(new THREE.Vector3());
	model.position.x -= center.x;
	model.position.z -= center.z;
	model.position.y -= box2.min.y;

	// 캐릭터를 통째로 회전/이동시킬 루트 (루트 기준 +Z = 캐릭터 정면)
	const root = new THREE.Group();
	root.add(model);

	const materials = [];
	model.traverse((o) => {
		if (o.isMesh || o.isSkinnedMesh) {
			o.castShadow = true;
			o.receiveShadow = true;
			o.frustumCulled = false;
			const mats = Array.isArray(o.material) ? o.material : [o.material];
			mats.forEach((m) => {
				if (!m) return;
				// 후드는 광택 없는 천이다. 거칠기를 깎으면 유리처럼 번들거린다.
				m.roughness = 1;
				m.metalness = Math.min(m.metalness ?? 0, 0.05);
				m.envMapIntensity = 0.35;
				// 마지막에 화면 속으로 들어갈 때 캐릭터를 걷어내기 위해 미리 켜둔다
				// (도중에 켜면 셰이더가 다시 컴파일되면서 한 프레임 튄다)
				m.transparent = true;
				m.depthWrite = true;
				materials.push(m);
			});
		}
	});

	/* --- 뼈 찾기 --- */
	const bones = [];
	model.traverse((o) => {
		if (o.isBone) bones.push(o);
	});

	const rig = {};
	for (const [key, candidates] of Object.entries(BONES)) {
		rig[key] = pickBone(bones, candidates);
	}

	const rest = new Map();
	bones.forEach((b) => rest.set(b, b.quaternion.clone()));

	/* --- 다리 길이 (rest 자세에서 한 번만 잰다) ---
	   IK로 발을 땅에 고정할 때 필요하다. */
	function worldOf(bone, out = new THREE.Vector3()) {
		if (!bone) return out.set(0, 0, 0);
		bone.updateWorldMatrix(true, false);
		return bone.getWorldPosition(out);
	}
	const limb = {};
	for (const side of ['left', 'right']) {
		const hip = rig[side === 'left' ? 'leftUpLeg' : 'rightUpLeg'];
		const knee = rig[side === 'left' ? 'leftLeg' : 'rightLeg'];
		const ankle = rig[side === 'left' ? 'leftFoot' : 'rightFoot'];
		if (!hip || !knee || !ankle) continue;
		const h = worldOf(hip, new THREE.Vector3());
		const k = worldOf(knee, new THREE.Vector3());
		const a = worldOf(ankle, new THREE.Vector3());
		limb[side] = {
			hip,
			knee,
			ankle,
			foot: rig[side === 'left' ? 'leftFoot' : 'rightFoot'],
			upper: h.distanceTo(k),
			lower: k.distanceTo(a),
			hipHeight: h.y, // 서 있을 때 골반 높이 = 다리가 뻗을 수 있는 한계의 기준
			ankleHeight: a.y, // 발목 뼈는 바닥보다 조금 위에 있다 (IK 목표 높이의 기준)
			// rest 자세의 발 위치(루트 기준). 이 모델은 고관절이 몸 중심보다 앞/옆에 있어서
			// 이 값을 무시하고 발을 놓으면 다리가 닿지 않아 발이 뜬다.
			restAnkle: a.clone(),
			hipForward: h.z, // 고관절이 몸 중심보다 얼마나 앞에 있는지
		};
	}

	/** 뼈의 로컬 축(= 자식 방향). 자식이 없으면 +Y로 가정 */
	const axisCache = new Map();
	function boneAxis(bone) {
		if (axisCache.has(bone)) return axisCache.get(bone);
		const child = bone.children.find((c) => c.isBone);
		const axis = child
			? child.position.clone().normalize()
			: new THREE.Vector3(0, 1, 0);
		if (!Number.isFinite(axis.x) || axis.lengthSq() < 1e-8) axis.set(0, 1, 0);
		axisCache.set(bone, axis);
		return axis;
	}

	/** 캐릭터 로컬 방향 → 월드 방향 */
	function dirToWorld(v) {
		root.updateWorldMatrix(true, false);
		return _v0.copy(v).applyQuaternion(root.getWorldQuaternion(_q0)).normalize();
	}

	/** 뼈가 주어진 월드 방향을 보게 한다 (rest 자세에서 weight만큼 섞음) */
	function aim(bone, worldDir, weight = 1) {
		if (!bone || !bone.parent) return;
		const axis = boneAxis(bone);
		bone.parent.updateWorldMatrix(true, false);
		bone.parent.getWorldQuaternion(_q0).invert();
		_v1.copy(worldDir).applyQuaternion(_q0).normalize();
		_q1.setFromUnitVectors(axis, _v1);
		// 현재 포즈 위에 덧씌운다 (rest로 되돌리지 않는다 — 포즈를 레이어로 쌓기 위해)
		if (weight >= 0.999) bone.quaternion.copy(_q1);
		else bone.quaternion.slerp(_q1, weight);
		bone.updateMatrixWorld(true);
	}

	/** 캐릭터 기준 방향(로컬)으로 aim */
	function aimLocal(bone, x, y, z, weight = 1) {
		if (!bone) return;
		aim(bone, dirToWorld(_v2.set(x, y, z).normalize()), weight);
	}

	function resetPose() {
		bones.forEach((b) => {
			const r = rest.get(b);
			if (r) b.quaternion.copy(r);
		});
	}

	/** 지금 포즈 위에 "월드 축 기준" 회전을 덧바른다 (고개 돌리기, 골반 기울이기 등) */
	function rotateWorld(bone, axisWorld, angle) {
		if (!bone || !bone.parent || Math.abs(angle) < 1e-5) return;
		bone.parent.updateWorldMatrix(true, false);
		bone.parent.getWorldQuaternion(_q0).invert();
		_v1.copy(axisWorld).applyQuaternion(_q0).normalize();
		_q1.setFromAxisAngle(_v1, angle);
		bone.quaternion.premultiply(_q1);
		bone.updateMatrixWorld(true);
	}

	/** 캐릭터 기준 축으로 회전 (+Z 앞, +Y 위, +X 왼쪽) */
	function rotateLocal(bone, x, y, z, angle) {
		rotateWorld(bone, dirToWorld(_v2.set(x, y, z)), angle);
	}

	/* --- 2본 IK ---
	   발목을 목표 지점에 두고 무릎이 pole 방향으로 접히게 허벅지/정강이를 푼다.
	   걷는 동안 지지발이 땅에 붙어 있으려면 이게 필요하다. */
	const _hip = new THREE.Vector3();
	const _dir = new THREE.Vector3();
	const _axis = new THREE.Vector3();
	const _knee = new THREE.Vector3();

	function solveLegIK(side, targetWorld, poleWorld) {
		const L = limb[side];
		if (!L) return;

		worldOf(L.hip, _hip);
		_dir.copy(targetWorld).sub(_hip);
		const dist = THREE.MathUtils.clamp(_dir.length(), 1e-4, (L.upper + L.lower) * 0.998);
		_dir.normalize();

		// 코사인 법칙으로 허벅지가 목표 방향에서 얼마나 벌어져야 하는지 구한다
		const cos = (L.upper * L.upper + dist * dist - L.lower * L.lower) / (2 * L.upper * dist);
		const bend = Math.acos(THREE.MathUtils.clamp(cos, -1, 1));

		_axis.crossVectors(poleWorld, _dir);
		if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0);
		_axis.normalize();

		const upperDir = _v1.copy(_dir).applyAxisAngle(_axis, -bend);
		aim(L.hip, upperDir, 1);

		_knee.copy(_hip).addScaledVector(upperDir, L.upper);
		aim(L.knee, _v2.copy(targetWorld).sub(_knee).normalize(), 1);
	}

	/** 발바닥 각도 — pitch>0이면 발끝이 내려간다 */
	function setFootPitch(side, pitch, forwardWorld, weight = 1) {
		const L = limb[side];
		if (!L || !L.foot) return;
		_v1.copy(forwardWorld).normalize();
		_v2.set(0, -1, 0).multiplyScalar(Math.sin(pitch));
		_v1.multiplyScalar(Math.cos(pitch)).add(_v2).normalize();
		aim(L.foot, _v1, weight);
	}

	function handWorld(side, target = new THREE.Vector3()) {
		const bone = side === 'left' ? rig.leftHand : rig.rightHand;
		if (!bone) return target.set(0, height * 0.45, 0).applyMatrix4(root.matrixWorld);
		bone.updateWorldMatrix(true, false);
		return bone.getWorldPosition(target);
	}

	function bonePos(bone, target = new THREE.Vector3()) {
		if (!bone) return target.set(0, 0, 0);
		bone.updateWorldMatrix(true, false);
		return bone.getWorldPosition(target);
	}

	/** 0이면 완전히 사라진다 — 화면 속으로 들어가는 마지막 구간에서 쓴다 */
	function setOpacity(v) {
		const o = clamp01(v);
		root.visible = o > 0.003;
		materials.forEach((m) => {
			m.opacity = o;
		});
	}

	return {
		root,
		model,
		rig,
		bones,
		height,
		scale,
		limb,
		setOpacity,
		aim,
		aimLocal,
		rotateWorld,
		rotateLocal,
		solveLegIK,
		setFootPitch,
		resetPose,
		dirToWorld,
		handWorld,
		bonePos,
		found: Object.fromEntries(Object.entries(rig).map(([k, v]) => [k, !!v])),
	};
}

/* ===== 포즈 프리셋 =====
   전부 "캐릭터 로컬 좌표" 기준. +Z = 캐릭터가 보는 앞쪽, +Y = 위. */

/** 팔 내리기 (몸통 옆) */
export function poseArmsDown(actor, weight = 1, spread = 0.26) {
	const { rig } = actor;
	actor.aimLocal(rig.leftArm, -spread, -0.96, 0.05, weight);
	actor.aimLocal(rig.rightArm, spread, -0.96, 0.05, weight);
	actor.aimLocal(rig.leftForeArm, -spread * 0.6, -0.97, 0.12, weight);
	actor.aimLocal(rig.rightForeArm, spread * 0.6, -0.97, 0.12, weight);
}

/** 한 팔을 목표 지점으로 뻗기 (어깨 → 팔꿈치 2단 근사) */
export function reachTo(actor, side, worldTarget, weight = 1) {
	const { rig } = actor;
	const arm = side === 'left' ? rig.leftArm : rig.rightArm;
	const fore = side === 'left' ? rig.leftForeArm : rig.rightForeArm;
	if (!arm) return;

	const shoulder = actor.bonePos(arm, _v1.clone());
	const dir = worldTarget.clone().sub(shoulder).normalize();
	actor.aim(arm, dir, weight);

	if (!fore) return;
	const elbow = actor.bonePos(fore, _v1.clone());
	const dir2 = worldTarget.clone().sub(elbow).normalize();
	actor.aim(fore, dir2, weight);
}
