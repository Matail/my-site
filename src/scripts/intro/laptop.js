import * as THREE from 'three';
import { lerp, clamp01 } from '../anim.js';
import { createScreenCanvas, SCREEN_W, SCREEN_H } from './screen.js';

/* 노트북 — 전부 코드로 만든다.
   원점 = 힌지 중심(바닥 높이). 본체는 +Z(앞) 방향으로 뻗는다. */

const BASE_W = 0.34;
const BASE_D = 0.238;
const BASE_H = 0.015;

const LID_L = 0.218;
const LID_T = 0.01;

export const SCREEN_PLANE_W = 0.316;
export const SCREEN_PLANE_H = SCREEN_PLANE_W * (SCREEN_H / SCREEN_W); // 16:10

const OPEN_ANGLE = -1.85; // 약 106도

/** 모서리 둥근 상자 — 얇은 판에 빛이 예쁘게 걸린다 */
function roundedBox(w, d, h, r, segments = 3) {
	const shape = new THREE.Shape();
	const x = -w / 2;
	const y = 0;
	shape.moveTo(x + r, y);
	shape.lineTo(x + w - r, y);
	shape.quadraticCurveTo(x + w, y, x + w, y + r);
	shape.lineTo(x + w, y + d - r);
	shape.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
	shape.lineTo(x + r, y + d);
	shape.quadraticCurveTo(x, y + d, x, y + d - r);
	shape.lineTo(x, y + r);
	shape.quadraticCurveTo(x, y, x + r, y);

	const geo = new THREE.ExtrudeGeometry(shape, {
		depth: h,
		bevelEnabled: true,
		bevelThickness: h * 0.28,
		bevelSize: h * 0.28,
		bevelSegments: segments,
		curveSegments: 8,
	});
	// shape: XY 평면 → XZ 평면으로 눕히고, 두께를 +Y로
	geo.rotateX(-Math.PI / 2);
	geo.translate(0, h, 0);
	geo.computeVertexNormals();
	return geo;
}

export function createLaptop() {
	const group = new THREE.Group();

	// 어두운 방에서도 형태가 보이도록 — 금속기를 높이면 반사할 환경이 없어서 새까맣게 나온다
	const shellMat = new THREE.MeshStandardMaterial({
		color: 0x2f2f39,
		roughness: 0.38,
		metalness: 0.25,
	});
	const darkMat = new THREE.MeshStandardMaterial({
		color: 0x0b0b10,
		roughness: 0.65,
		metalness: 0.3,
	});

	/* --- 본체 --- */
	const base = new THREE.Mesh(roundedBox(BASE_W, BASE_D, BASE_H, 0.012), shellMat);
	base.castShadow = true;
	base.receiveShadow = true;
	group.add(base);

	// 키보드 자리
	const keyboard = new THREE.Mesh(
		new THREE.PlaneGeometry(BASE_W - 0.05, BASE_D * 0.52),
		new THREE.MeshStandardMaterial({ color: 0x08080c, roughness: 0.9, metalness: 0.1 })
	);
	keyboard.rotation.x = -Math.PI / 2;
	keyboard.position.set(0, BASE_H + 0.0012, BASE_D * 0.33);
	group.add(keyboard);

	// 트랙패드
	const pad = new THREE.Mesh(
		new THREE.PlaneGeometry(BASE_W * 0.3, BASE_D * 0.22),
		new THREE.MeshStandardMaterial({ color: 0x101016, roughness: 0.5, metalness: 0.4 })
	);
	pad.rotation.x = -Math.PI / 2;
	pad.position.set(0, BASE_H + 0.0014, BASE_D * 0.79);
	group.add(pad);

	/* --- 뚜껑 --- */
	const lidPivot = new THREE.Group();
	lidPivot.position.set(0, BASE_H, 0.007);
	group.add(lidPivot);

	const lid = new THREE.Mesh(roundedBox(BASE_W, LID_L, LID_T, 0.012), shellMat);
	lid.castShadow = true;
	lid.receiveShadow = true;
	lidPivot.add(lid);

	// 화면 주변 베젤 (뚜껑 안쪽 면)
	const bezel = new THREE.Mesh(new THREE.PlaneGeometry(BASE_W - 0.012, LID_L - 0.012), darkMat);
	bezel.rotation.x = Math.PI / 2; // 아래(-Y)를 향함 = 닫으면 키보드 쪽
	bezel.position.set(0, -0.0004, LID_L / 2);
	lidPivot.add(bezel);

	/* --- 화면 --- */
	const screenPainter = createScreenCanvas();
	const screenTex = new THREE.CanvasTexture(screenPainter.canvas);
	screenTex.colorSpace = THREE.SRGBColorSpace;
	screenTex.anisotropy = 8;
	screenTex.minFilter = THREE.LinearFilter;
	screenTex.generateMipmaps = false;

	const screenMat = new THREE.MeshBasicMaterial({
		map: screenTex,
		toneMapped: false,
		color: new THREE.Color(0x000000),
	});
	const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_PLANE_W, SCREEN_PLANE_H), screenMat);
	screen.rotation.x = Math.PI / 2;
	screen.position.set(0, -0.0012, LID_L / 2);
	lidPivot.add(screen);

	/* --- 제어 --- */
	let screenState = { power: 0, boot: 0, site: 0, time: 0 };
	let dirty = true;

	function setLid(t) {
		lidPivot.rotation.x = lerp(0, OPEN_ANGLE, clamp01(t));
	}

	function setScreen(next) {
		screenState = { ...screenState, ...next };
		dirty = true;
	}

	/** 화면 밝기. v=1이 정상, burn은 사이트로 넘어갈 때의 화이트아웃.
	    번짐은 포스트 프로세싱 블룸이 알아서 만든다 (가짜 글로우 판을 덧대면 화면이 뿌예진다) */
	function setBrightness(v, burn = 0) {
		// ACES 톤매핑에서 눌리는 만큼 미리 올려둔다
		screenMat.color.setScalar(Math.max(0, v) * 1.5 + burn * 4);
	}

	/** 껍데기만 사라지게 한다 (화면은 그대로) — 화면 속으로 들어가는 구간용 */
	const shellMats = [shellMat, darkMat, keyboard.material, pad.material];
	shellMats.forEach((m) => {
		m.transparent = true;
		m.depthWrite = true;
	});
	function setShellOpacity(v) {
		const o = clamp01(v);
		shellMats.forEach((m) => {
			m.opacity = o;
		});
	}

	function update(time) {
		if (!dirty && screenState.power <= 0) return;
		screenPainter.draw({ ...screenState, time });
		screenTex.needsUpdate = true;
	}

	/** 화면 평면의 월드 위치/방향 — 카메라가 화면을 꽉 채울 때 쓴다 */
	const _pos = new THREE.Vector3();
	const _quat = new THREE.Quaternion();
	const _normal = new THREE.Vector3();
	function screenFrame() {
		screen.updateWorldMatrix(true, false);
		screen.getWorldPosition(_pos);
		screen.getWorldQuaternion(_quat);
		// PlaneGeometry의 법선은 로컬 +Z
		_normal.set(0, 0, 1).applyQuaternion(_quat);
		return { position: _pos, quaternion: _quat, normal: _normal, width: SCREEN_PLANE_W, height: SCREEN_PLANE_H };
	}

	/** 뚜껑 앞 모서리의 월드 위치 — 여는 손이 따라갈 지점 */
	const _edge = new THREE.Vector3();
	function lidEdge(sideOffset = 0) {
		lidPivot.updateWorldMatrix(true, false);
		return lidPivot.localToWorld(_edge.set(BASE_W * sideOffset, -0.004, LID_L * 0.92));
	}

	setLid(0);
	setBrightness(0);

	return {
		group,
		lidPivot,
		screen,
		setLid,
		setScreen,
		setBrightness,
		setShellOpacity,
		lidEdge,
		update,
		screenFrame,
		size: { w: BASE_W, d: BASE_D, h: BASE_H },
	};
}
