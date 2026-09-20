import { span, ease, clamp01, lerp } from '../anim.js';
import { loadSprites, loadImages, drawSprite, drawHandCut } from './sprites.js';
import {
	SCENE,
	drawRoom,
	drawLamp,
	drawShadow,
	drawLaptop,
	laptopScreenRect,
	laptopScreenOffset,
	drawLaptopClosed,
	drawVignette,
	drawGrain,
	makeDust,
	drawDust,
	LAPTOP_SPRITE,
	eraseToRoom,
	eraseToColor,
	setCharHeight,
} from './draw.js';

/* 2D 픽셀아트 인트로.
   1) 어둠 → 전등이 켜진다
   2) 캐릭터가 화면 밖에서 걸어 들어온다
   3) 가운데 서서 정면을 본다
   4) 들고 있던 노트북을 열고, 그 화면이 이 사이트가 된다

   3D판과 마찬가지로 모든 상태는 시간 t의 순수 함수다. */

/* 타임라인은 화면 크기에 따라 다시 계산된다.
   캐릭터는 항상 화면 "밖"에서 출발해야 하는데, 그 거리는 뷰포트 너비에 달렸다.
   걸음 속도를 고정하고 걷는 시간을 조절해야 어느 화면에서든 같은 걸음걸이가 나온다. */
/* 아래 값은 buildTimeline()이 화면 크기에 맞춰 곧바로 덮어쓴다 (걷는 거리가 달라지므로).
   여기 적힌 건 1280x800에서 나오는 값 — 구간 순서와 길이를 한눈에 보기 위한 것이다. */
export const T = {
	dark: [0, 0.22],
	lampOn: [0.22, 0.95],
	walk: [0.75, 4.0],
	turn: [4.0, 4.4],
	hold: [4.4, 4.9], // 정면으로 서서 잠깐 멈춤
	raise: [4.9, 5.26],
	open: [5.5, 6.1],
	boot: [5.6, 6.6], // [불 들어옴, 사이트가 뜸]
	zoom: [6.85, 8.15],
	handoff: [8.15, 8.65],
};

/** 걷기 거리에 맞춰 타임라인을 다시 잡는다 (T 객체를 그대로 갱신) */
function buildTimeline(distance) {
	// 3.9초 상한 — 아주 넓은 화면에서 인트로가 한없이 길어지지 않게.
	// 상한에 걸리면 걸음이 조금 빨라질 뿐, 프레임이 거리에 묶여 있어 발은 여전히 안 미끄러진다.
	const walkDur = Math.min(3.9, Math.max(1.5, distance / WALK_SPEED));
	const set = (key, a, b) => {
		T[key][0] = a;
		T[key][1] = b;
	};
	set('dark', 0, 0.22);
	set('lampOn', 0.22, 0.95);

	// 전등 깜빡임이 잦아드는 순간(0.55초쯤)부터 걸어 들어온다
	const w0 = 0.75;
	const w1 = w0 + walkDur;
	set('walk', w0, w1);
	set('turn', w1, w1 + 0.5); // 회전 9프레임 = 18fps
	set('hold', w1 + 0.5, w1 + 0.85); // 정면으로 0.35초 정지
	// 노트북을 두 손으로 들어 올리는 구간 — 캐릭터 12프레임, 노트북 9프레임이 같이 돈다 (24fps)
	set('raise', w1 + 0.85, w1 + 1.35);
	set('open', w1 + 1.5, w1 + 2.1);
	/* boot[0] = 뚜껑이 열리는 중에 화면에 불이 들어오는 순간,
	   boot[1] = 부팅이 끝나 화면 안에 사이트가 뜨는 순간.
	   사이트가 뜨고 잠깐(0.25초) 그대로 보여 준 다음에 카메라가 들어가야
	   "다 뜬 화면 속으로 들어간다"로 읽힌다 — 줌 도중에 뜨면 무엇이 떴는지 못 본다. */
	set('boot', w1 + 1.6, w1 + 2.6);
	set('zoom', w1 + 2.85, w1 + 4.15);
	set('handoff', w1 + 4.15, w1 + 4.65);
	return T;
}

/* 무대 배치 — 전부 캐릭터 키(65 기준)에 비례한다. 스프라이트를 갈아끼워도 구도가 유지된다. */
const STAND_X = 0;
let U = 1; // 캐릭터 키 / 65
let HAND_FALLBACK = 0; // 손을 못 찾았을 때 쓸 높이
let WALK_SPEED = 58; // 씬 단위/초 — 화면이 넓으면 더 오래 걸을 뿐, 속도는 같다
let WALK_STEP = 4.67; // 한 프레임당 이동 거리 (발 미끄러짐을 막는 값)
/* 4.67은 스프라이트를 다시 실측해서 나온 값이다.
   가장 벌어진 프레임(2·6번)에서 두 발 "중심" 사이가 68.5px = 한 걸음이고,
   8프레임에 두 걸음 나아가므로 프레임당 68.5*2/8 = 17.1px = 4.67*U.
   예전 값 6.2(=22.8px)는 발끝에서 발끝까지(99px)를 보폭으로 잰 것이라
   실제보다 33% 많이 나아갔고, 그만큼 디딘 발이 뒤로 미끄러졌다. */

/* 걷기 진행 곡선 — 등속으로 오다가 마지막 구간에서만 속도를 0까지 떨군다.
   예전 곡선은 끝에서도 평균 속도의 75%로 오다 그 자리에 딱 멈춰서,
   마지막 한 걸음이 미끄러지며 끊겼다. */
const WALK_DECEL_AT = 0.82;
function walkEase(u) {
	const a = WALK_DECEL_AT;
	const k = (1 + a) / 2; // 총 이동량을 1로 맞추는 정규화 계수
	if (u <= a) return u / k;
	const d = u - a;
	return (a + d - (d * d) / (2 * (1 - a))) / k;
}

/** 전등이 켜질 때의 깜빡임 */
function flicker(dt) {
	if (dt < 0.04) return 0.9;
	if (dt < 0.09) return 0.05;
	if (dt < 0.14) return 0.8;
	if (dt < 0.2) return 0.1;
	if (dt < 0.27) return 1;
	if (dt < 0.31) return 0.35;
	return 1;
}

export async function createIntro2D({ canvas, screenClip, screenInner, onProgress }) {
	const ctx = canvas.getContext('2d', { alpha: false });

	/* 노트북은 캐릭터와 별개의 PixelLab 오브젝트다.
	   손 위치는 캐릭터 스프라이트에서 재고, 노트북 그림은 여기서 따로 불러와
	   그 손자리에 얹는다 — 그래서 "따로 만든 물건이 손을 따라 움직이는" 것으로 보인다. */
	const lap = {
		yaw: await loadImages(Array.from({ length: 9 }, (_, i) => `/sprites/laptop/yaw-${i}.png`)),
		tilt: await loadImages(Array.from({ length: 9 }, (_, i) => `/sprites/laptop/tilt-${i}.png`)),
		open: await loadImages(Array.from({ length: 9 }, (_, i) => `/sprites/laptop/open-${i}.png`)),
	};

	const sprites = await loadSprites(
		{
			front: '/sprites/south.png',
			side: '/sprites/east.png',
			turn45: '/sprites/south-east.png',
			walk: [
				'/sprites/walk-0.png',
				'/sprites/walk-1.png',
				'/sprites/walk-2.png',
				'/sprites/walk-3.png',
				'/sprites/walk-4.png',
				'/sprites/walk-5.png',
				'/sprites/walk-6.png',
				'/sprites/walk-7.png',
			],
			// 옆모습에서 정면으로 몸을 돌리는 프레임 (PixelLab, east → south 보간).
			// 첫 프레임은 east, 마지막은 south 와 같아서 앞뒤 포즈와 정확히 이어진다.
			turn: [
				'/sprites/turn-0.png',
				'/sprites/turn-1.png',
				'/sprites/turn-2.png',
				'/sprites/turn-3.png',
				'/sprites/turn-4.png',
				'/sprites/turn-5.png',
				'/sprites/turn-6.png',
				'/sprites/turn-7.png',
				'/sprites/turn-8.png',
			],
			// 노트북을 가슴 앞에 든 포즈와, 팔 내린 정면에서 그 포즈로 가는 중간 프레임.
			hold: '/sprites/hold.png',
			/* 팔을 들어 올리는 12프레임.
			   뼈대는 PixelLab v3 보간 한 번(south → hold)으로 뽑은 7장이다.
			   그 중 손이 한 프레임에 15~20px씩 뛰던 두 구간(3→4, 4→5번)은
			   그 두 장을 다시 양끝으로 물려 사이를 채워 넣었다 — 양끝이 기존 장 그대로라
			   이어 붙여도 튀지 않는다. 손 높이가 164 → 118 로 한 방향으로만 올라가고
			   한 프레임 최대 이동이 20px에서 8px로 줄었다.
			   (256px 캐릭터는 v3 보간이 한 번에 8프레임까지라 이렇게 나눠 뽑아야 한다.) */
			raise: [
				'/sprites/raise-0.png',
				'/sprites/raise-1.png',
				'/sprites/raise-2.png',
				'/sprites/raise-3.png',
				'/sprites/raise-4.png',
				'/sprites/raise-5.png',
				'/sprites/raise-6.png',
				'/sprites/raise-7.png',
				'/sprites/raise-8.png',
				'/sprites/raise-9.png',
				'/sprites/raise-10.png',
				'/sprites/raise-11.png',
			],
			// 뚜껑을 여는 동안 팔이 실제로 굽는 프레임들
			openArm: [
				'/sprites/open-0.png',
				'/sprites/open-1.png',
				'/sprites/open-2.png',
				'/sprites/open-3.png',
				'/sprites/open-4.png',
				'/sprites/open-5.png',
				'/sprites/open-6.png',
				'/sprites/open-7.png',
				'/sprites/open-8.png',
			],
		},
		onProgress,
		['hold', 'raise', 'openArm', 'turn']
	);

	// 스프라이트 실제 높이에 맞춰 무대 치수를 정한다
	U = setCharHeight(sprites.bounds.h);
	HAND_FALLBACK = 21 * U;
	WALK_SPEED = 58 * U;
	WALK_STEP = 4.67 * U;

	/* 뚜껑을 여는 동안 "본체를 잡고 있는" 손이 화면 어느 쪽인지 한 번만 정해 둔다.
	   마지막 프레임에서는 두 손 높이가 확실히 갈리므로(잡은 손이 아래) 거기서 읽는다. */
	let openBaseSide = 0; // -1 = 화면 왼쪽, +1 = 오른쪽, 0 = 못 정함
	if (sprites.openArm && sprites.openArm.length) {
		const last = sprites.openArm[sprites.openArm.length - 1];
		const a = sprites.rightHand(last);
		const b = sprites.leftHand(last);
		if (a && b) openBaseSide = Math.sign((a.up <= b.up ? a : b).dx) || -1;
	}

	/* 걷기 8프레임에서 손 높이(발바닥 기준)의 평균.
	   팔이 앞뒤로 흔들리면 손은 진자처럼 호를 그려 최대 13px 오르내리는데,
	   그 폭을 노트북이 그대로 따라가면 걸을 때마다 노트북을 들었다 놨다 하는 것처럼 보인다.
	   실제로 무거운 물건을 들고 걸으면 그 팔은 거의 흔들지 않는다. */
	const walkHandUp =
		sprites.walk.reduce((sum, img) => {
			const h = sprites.rightHand(img);
			return sum + (h ? h.up : 0);
		}, 0) / sprites.walk.length;

	// 걸음이 끝나는 프레임(0번)의 손과, 서 있는 옆모습의 손 — 그 사이를 짧게 섞는다
	const lastWalkHand = sprites.rightHand(sprites.walk[0]);
	const restHand = sprites.rightHand(sprites.side);

	const dust = makeDust(46);

	const cam = {
		cx: 0,
		cy: 100,
		zoom: 4,
		vw: 1,
		vh: 1,
		toScreenX(wx) {
			return (wx - this.cx) * this.zoom + this.vw / 2;
		},
		toScreenY(wy) {
			return (wy - this.cy) * this.zoom + this.vh / 2;
		},
	};

	let baseZoom = 4;
	let walkFrom = -120;
	let dpr = 1;

	function resize() {
		const vw = Math.max(1, canvas.clientWidth || window.innerWidth);
		const vh = Math.max(1, canvas.clientHeight || window.innerHeight);
		dpr = Math.min(window.devicePixelRatio || 1, 2);
		canvas.width = Math.round(vw * dpr);
		canvas.height = Math.round(vh * dpr);

		// 픽셀아트는 배율이 깔끔해야 도트가 고르게 보인다.
		// 캐릭터가 화면 높이의 약 34%를 차지하는 배율을 후보 중에서 고른다.
		// 원화가 256px이라 짧은 화면에서는 1배도 너무 크다 — 정확히 2:1로 줄이는 0.5를 허용한다
		// (홀수 배율로 줄이면 픽셀 줄이 들쭉날쭉해지지만, 2:1은 고르게 떨어진다).
		const target = vh * 0.34;
		const spriteH = sprites.bounds.h;
		baseZoom = [0.5, 1, 2, 3, 4, 5, 6, 7].reduce((best, z) =>
			Math.abs(spriteH * z - target) < Math.abs(spriteH * best - target) ? z : best
		);
		cam.vw = vw;
		cam.vh = vh;
		/* 캐릭터는 반드시 화면 "밖"에서 출발한다 (스프라이트 폭 + 여유).
		   거리는 걷기 0번 프레임에서 딱 끝나도록 한 주기 단위로 올림한다.
		   0번은 두 발을 모은 자세라 서 있는 옆모습(east)과 발 위치가 2px 안쪽으로 맞는다 —
		   그래서 걸음을 멈추고 포즈를 갈아끼워도 발이 튀지 않는다.
		   (4번도 발을 모으지만 뒷발이 8px 앞에 있어서 갈아끼울 때 눈에 띈다.) */
		const need = vw / 2 / baseZoom + 30 * U;
		const cycle = sprites.walk.length * WALK_STEP;
		const laps = Math.max(1, Math.ceil((need - WALK_STEP * 0.25) / cycle));
		walkFrom = -(laps * cycle + WALK_STEP * 0.25);
		buildTimeline(Math.abs(walkFrom - STAND_X));
		return { vw, vh };
	}

	/* ---------- 상태 ---------- */
	const state = {
		lamp: 0,
		charX: walkFrom,
		sprite: 'side',
		walkFrame: 0,
		turnFrame: 0,
		raiseFrame: 0,
		openFrame: 0,
		bob: 0,
		laptopOpen: 0,
		laptopCX: 0, // 노트북 중심 (월드)
		laptopCY: 0,
		laptopAngle: Math.PI / 2, // 긴 변의 방향: +90도 = 손에 늘어뜨림(화면 아래), 0 = 수평
		laptopFlat: 0, // 0 = 세로로 들림, 1 = 눕혀서 두께만 보임
		laptopYaw: 1, // 노트북이 돌아간 정도 — 1 = 넓은 면(옆모습일 때), 0 = 옆면(정면일 때)
		handR: null, // 지금 프레임의 오른손 (스프라이트에서 잰 것)
		handL: null,
		openHand: { active: false, x: 0, y: 0 }, // 뚜껑을 여는 오른손의 월드 위치
		baseHandIsR: true, // 여는 동안 본체를 잡고 있는 쪽 (다른 손은 뚜껑 뒤로 간다)
		carried: true,
		screenOn: 0,
		canvasAlpha: 1,
		vignette: 1,
		fill: 0, // 노트북 화면이 뷰포트를 채우는 정도
		charAlpha: 1,
	};

	/** 지금 t에서 실제로 그려질 스프라이트 */
	function currentImage() {
		if (state.sprite === 'walk') return sprites.walk[state.walkFrame] || sprites.side;
		if (state.sprite === 'turn') return (sprites.turn && sprites.turn[state.turnFrame]) || sprites.turn45;
		if (state.sprite === 'raise') {
			return (sprites.raise && sprites.raise[state.raiseFrame]) || sprites.hold || sprites.front;
		}
		if (state.sprite === 'openArm') {
			return (sprites.openArm && sprites.openArm[state.openFrame]) || sprites.hold || sprites.front;
		}
		if (state.sprite === 'hold') return sprites.hold || sprites.front;
		return sprites[state.sprite];
	}

	function apply(t) {
		/* 전등 */
		const ramp = span(t, T.lampOn[0], T.lampOn[1], ease.out);
		state.lamp = t <= T.lampOn[0] ? 0 : ramp * flicker(t - T.lampOn[0]);

		/* 걷기 — 등속으로 오다 마지막 한 걸음에서 속도를 0까지 떨군다.
		   프레임은 시간이 아니라 이동 거리에 묶여 있어서, 느려지면 걸음도 같이 느려진다. */
		const walkP = span(t, T.walk[0], T.walk[1], walkEase);
		state.charX = lerp(walkFrom, STAND_X, walkP);
		const walked = state.charX - walkFrom;
		state.walkFrame = Math.floor(walked / WALK_STEP) % sprites.walk.length;

		/* 걷기 프레임은 스프라이트 안에 이미 상하동이 있으므로 따로 흔들지 않는다 */
		const walking = t > T.walk[0] && t < T.walk[1];
		state.bob = 0;

		/* 돌아서기.
		   PixelLab으로 뽑은 회전 프레임(옆 → 정면)이 있으면 그걸 순서대로 돌린다.
		   첫 프레임은 서 있는 옆모습, 마지막은 정면과 같은 그림이라 앞뒤가 그대로 이어진다.
		   프레임이 없으면 예전처럼 옆 → 45도 → 정면 세 장으로 대체한다. */
		// 회전은 등속으로 — 가감속을 주면 가운데 프레임이 통째로 건너뛰어진다
		const turnP = span(t, T.turn[0], T.turn[1], ease.linear);
		/* 손에 든 노트북도 몸을 따라 돈다.
		   옆구리에 낀 노트북은 넓은 면이 몸과 나란하다 — 옆에서 보면 그 면이 그대로 보이고,
		   몸이 정면으로 돌아서면 같은 면이 옆으로 돌아가 얇은 옆면만 남는다.
		   그 상태에서 두 손으로 눕히면 그 얇은 판이 화면 안에서 90도 돌아 가로로 눕는다. */
		state.laptopYaw = 1 - turnP;
		const turnFrames = sprites.turn ? sprites.turn.length : 0;
		if (t < T.turn[0]) {
			state.sprite = walking ? 'walk' : 'side';
		} else if (turnFrames) {
			state.turnFrame = Math.min(turnFrames - 1, Math.floor(turnP * turnFrames));
			state.sprite = turnP >= 1 ? 'front' : 'turn';
		} else if (turnP < 0.45) {
			state.sprite = 'side';
		} else if (turnP < 0.8) {
			state.sprite = 'turn45';
		} else {
			state.sprite = 'front';
		}

		// 노트북을 수평으로 든 뒤 팔을 굽혀 가슴 앞으로 올린다.
		// raise 프레임(팔 내린 정면 → 든 포즈 보간)이 있으면 차례로, 없으면 바로 든 포즈.
		if (t >= T.raise[0]) {
			const n = sprites.raise ? sprites.raise.length : 0;
			const p = span(t, T.raise[0], T.raise[1], ease.linear);
			if (n && p < 1) {
				state.sprite = 'raise';
				state.raiseFrame = Math.min(n - 1, Math.floor(p * n));
			} else {
				state.sprite = 'hold';
			}
		}
		/* 뚜껑 여는 느낌 — 붙어 있다 떨어지듯 느리게 시작해서 한 번에 열리고,
		   끝에서 경첩이 작게 흔들리다 멎는다. draw.js가 이 값을 경첩 각도로 바꿔 쓰므로
		   1을 살짝 넘기면 수직을 지나쳤다 되돌아오는 움직임이 그대로 나온다. */
		state.laptopOpen = span(t, T.open[0], T.open[1], (u) => {
			const main = u * u * (3 - 2 * u);
			const k = (u - 0.6) / 0.4;
			const settle = u < 0.6 ? 0 : Math.sin(k * Math.PI * 2) * 0.05 * (1 - k);
			return main + settle;
		});

		/* 뚜껑이 열리는 동안에는 팔이 굽는 프레임으로 바꾼다.
		   프레임 번호를 시간이 아니라 "뚜껑이 열린 정도"에 묶어야
		   손과 뚜껑 가장자리가 항상 같은 높이에 있다.

		   raise 가 끝나는 순간 바로 넘어간다. 사이에 hold 를 한 번 끼우면
		   raise 가 올려 놓은 손(높이 135)이 hold 의 손(141)으로 6px 떨어져
		   노트북이 툭 내려앉는다. open-0 은 raise 의 마지막 프레임에서
		   만들었으므로 여기서 바꿔도 그림이 그대로 이어진다. */
		const armFrames = sprites.openArm ? sprites.openArm.length : 0;
		if (armFrames && t >= T.raise[1]) {
			const k = clamp01(state.laptopOpen);
			state.openFrame = Math.min(armFrames - 1, Math.round(k * (armFrames - 1)));
			state.sprite = 'openArm';
		}

		/* 멈춘 뒤 숨쉬기 — 3.3초에 한 번 0 → -1 → -2 → -1 → 0픽셀.
		   예전에는 sin > 0.6 을 켰다 껐다 해서 1픽셀이 툭 튀었다 제자리로 돌아왔다. */
		if (t > T.turn[1]) {
			state.bob = -Math.round(1 - Math.cos((t - T.turn[1]) * 1.9));
		}

		/* 노트북 — 오른손에 들고 다리 옆에 늘어뜨린 채 걸어 들어온다 (가방 없이 들고 다닐 때 자세).
		   돌아서면 오른손을 축으로 왼손이 반대쪽 끝을 들어 올려 수평으로 눕히고,
		   오른손이 뚜껑 가장자리로 올라가 연다. 손 위치는 프레임마다 스프라이트에서 잰다. */
		const img = currentImage();
		const rh = sprites.rightHand(img) || sprites.rightHand(sprites.front);
		state.handR = rh;
		state.handL = sprites.leftHand(img);
		const handX = state.charX + (rh ? rh.dx : 0);
		const handY = SCENE.floorY - (rh ? rh.up : HAND_FALLBACK) + state.bob;
		const grip = rh ? rh.box.h * 0.3 : 0; // 손가락이 윗변을 넘어 쥔다 — 윗변은 손 중심보다 조금 아래

		/* 노트북 위치는 시간이 아니라 "지금 프레임에서 실제로 잰 손"이 정한다.
		   시간으로 보간하면 스프라이트의 손은 벌써 가슴에 올라갔는데 노트북만 허리에 남는다. */
		const w = LAPTOP_SPRITE.hangH; // 세로로 들었을 때의 길이 (손에서 중심까지가 절반)
		const lh = state.handL;
		/* 노트북을 세로에서 가로로 돌리는 구간.
		   회전축이 "그 프레임에서 실제로 잰 오른손"이라, 팔이 굽어 손이 올라가면
		   노트북도 손을 따라 올라가며 같이 눕는다. 팔이 아직 내려가 있는 동안 미리 돌려 두면
		   노트북만 배 앞에 떠 있는 것처럼 보여서, 팔이 움직이는 구간과 같은 구간에서 돌린다. */
		const swingFrom = T.raise[0];
		const twoHanded =
			state.sprite === 'hold' ||
			state.sprite === 'raise' ||
			state.sprite === 'openArm' ||
			t >= swingFrom;

		if (state.sprite === 'openArm' && lh && rh) {
			/* 뚜껑을 여는 동안에는 한 손이 뚜껑을 들어 올린다.
			   두 손 한가운데를 쓰면 본체까지 같이 떠오르므로,
			   가만히 있는 손(본체를 잡은 쪽)에 본체를 붙여 둔다.
			   "낮은 쪽"으로 매 프레임 고르면 두 손 높이가 비슷한 초반 프레임에서
			   2px 차이로 좌우가 뒤집히고, 그때마다 노트북이 12px씩 튄다.
			   그래서 잡는 손을 마지막 프레임에서 한 번 정해 두고 쭉 그 쪽을 따라간다. */
			const base =
				openBaseSide !== 0
					? (Math.sign(rh.dx) === openBaseSide ? rh : lh)
					: rh.up <= lh.up
						? rh
						: lh;
			state.baseHandIsR = base === rh;
			const bx = state.charX + base.dx;
			const by = SCENE.floorY - base.up + state.bob;
			state.laptopAngle = 0;
			state.laptopFlat = 1;
			state.laptopCX = bx + (base.dx <= 0 ? 1 : -1) * (LAPTOP_SPRITE.flatW / 2);
			state.laptopCY = by;
		} else if (twoHanded && lh && rh) {
			/* 오른손을 축으로 돌려 올린다.
			   매달린 자세(아래로 90도)에서 왼손 쪽으로 회전하면, 다 돌았을 때
			   노트북 중심이 정확히 두 손 한가운데에 온다 — 기하가 통째로 바뀌지 않으므로
			   프레임 사이가 튀지 않는다. */
			const lhX = state.charX + lh.dx;
			const lhY = SCENE.floorY - lh.up + state.bob;
			const toL = Math.atan2(lhY - handY, lhX - handX);
			const half = Math.hypot(lhX - handX, lhY - handY) / 2;
			const swingP = span(t, swingFrom, T.raise[1], ease.inOut);
			const ang = lerp(Math.PI / 2, toL, swingP);
			const rad = lerp(w / 2, half, swingP);
			state.laptopAngle = ang;
			state.laptopFlat = swingP;
			state.laptopCX = handX + rad * Math.cos(ang);
			state.laptopCY = handY + rad * Math.sin(ang);
		} else {
			/* 오른손이 윗변을 쥐고 아래로 늘어뜨린다 (+90도 = 화면 아래).
			   팔이 앞뒤로 흔들리는 만큼 노트북도 같이 흔들리지만, 멈춰 서면 중력대로
			   똑바로 내려와야 한다 — 서 있는데 12도 기울어 있으면 다리에 기대 놓은 것처럼 보인다. */
			const moving = 1 - span(t, T.walk[1] - 0.45, T.walk[1], ease.inOut);

			/* 걷기를 멈추는 순간 팔이 제자리로 돌아온다.
			   마지막 걷기 프레임의 손(dx +13)과 서 있는 옆모습의 손(dx -0.5)이 13px 떨어져 있어
			   그대로 두면 노트북이 한 프레임에 13px 휙 움직인다.
			   교체 시점을 가운데 두고 ±0.08초 동안만 두 위치를 섞는다 (그 밖에서는 손 그대로). */
			let dxNow = rh ? rh.dx : 0;
			let upRaw = rh ? rh.up : HAND_FALLBACK;
			if (t > T.walk[1] - 0.08 && t < T.walk[1] + 0.08 && lastWalkHand && restHand) {
				const settle = span(t, T.walk[1] - 0.08, T.walk[1] + 0.08, ease.inOut);
				dxNow = lerp(lastWalkHand.dx, restHand.dx, settle);
				upRaw = lerp(lastWalkHand.up, restHand.up, settle);
			}

			const swing = dxNow * 0.006 * moving;
			const hangAngle = Math.PI / 2 + swing;
			/* 위아래 흔들림은 3분의 1만 따라간다.
			   손은 제 자리에 그대로 그리므로 노트북 윗변과 최대 3px밖에 어긋나지 않는다 —
			   손이 윗변에 걸친 건 그대로 보이면서 출렁임만 사라진다. */
			const upHang = lerp(upRaw, walkHandUp + (upRaw - walkHandUp) * 0.35, moving);
			const hangX = state.charX + dxNow;
			const hangY = SCENE.floorY - upHang + state.bob;
			state.laptopAngle = hangAngle;
			state.laptopFlat = 0;
			state.laptopCX = hangX + (w / 2) * Math.cos(hangAngle);
			state.laptopCY = hangY + grip + (w / 2) * Math.sin(hangAngle);
		}
		state.carried = t < T.open[0];


		// 뚜껑을 떼는 순간 손끝이 눌려 노트북이 살짝 내려갔다 올라온다
		const press = span(t, T.open[0] - 0.12, T.open[0] + 0.22, ease.inOut);
		state.laptopCY += Math.sin(press * Math.PI) * 1.2 * U;


		/* 뚜껑을 여는 오른손.
		   스프라이트의 팔뚝은 그림이라 같이 굽힐 수 없다. 손만 멀리 보내면 팔은 가만한데
		   손만 떠다니는 꼴이 되므로, 손목을 살짝 드는 정도(소매 길이 안)로만 움직인다.
		   빈 자리는 소매 색으로 메워 손목이 늘어난 것처럼 이어붙인다. */
		// 팔이 굽는 프레임이 있으면 손을 따로 옮길 필요가 없다 (그림이 직접 움직인다).
		// 프레임이 없을 때만 손목을 살짝 드는 예전 방식으로 돌아간다.
		if (armFrames) {
			state.openHand.active = false;
		} else {
			const reachP = span(t, T.open[0] - 0.18, T.open[0] + 0.1, ease.inOut);
			const backP = span(t, T.open[1] - 0.15, T.open[1] + 0.2, ease.inOut);
			const handActive = t > T.open[0] - 0.18 && t < T.open[1] + 0.2;
			state.openHand.active = handActive && !!rh && twoHanded;
			if (state.openHand.active) {
				const side = Math.sign(rh.dx) || -1;
				const k = reachP * (1 - backP);
				state.openHand.x = handX + side * 1.5 * U * k;
				state.openHand.y = handY - 3.5 * U * k;
			}
		}

		/* 화면 켜짐 — 뚜껑이 열리는 중에 백라이트가 들어온다.
		   이 값 하나가 캔버스의 화면 발광과 DOM 오버레이(진짜 사이트)의 불투명도를 함께 몬다. */
		state.screenOn = span(t, T.boot[0], T.boot[0] + 0.3, ease.out);

		/* 카메라 — 화면 속으로.
		   배율을 1배에서 20배까지 "직선으로" 키우면 눈에는 끝에서 폭발하듯 보인다.
		   사람이 느끼는 접근 속도는 배율의 변화량이 아니라 변화 "비율"이라서,
		   지수로 키워야 처음부터 끝까지 같은 속도로 다가가는 것처럼 보인다. */
		const zoomP = span(t, T.zoom[0], T.zoom[1], ease.inOut);

		const screenW = LAPTOP_SPRITE.screenW;
		const targetZoom = cam.vw / screenW;
		cam.zoom = baseZoom * Math.pow(targetZoom / baseZoom, zoomP);

		/* DOM 화면이 뷰포트를 채워 가는 정도.
		   카메라가 그리는 노트북 화면 자리(r)와 뷰포트 사이를 이 값으로 섞는데,
		   노트북이 아직 보이는 동안 섞기 시작하면 사이트 화면만 노트북 베젤보다
		   크게 자라 어긋나 보인다. 그래서 캐릭터·노트북이 다 지워지는 시점부터 올린다. */
		state.fill = span(t, T.zoom[0] + 0.45, T.zoom[1], ease.inOut);

		const so = laptopScreenOffset(state.laptopOpen);
		cam.cx = lerp(0, state.laptopCX + so.dx, zoomP);
		cam.cy = lerp(100 * U, state.laptopCY + so.dy, zoomP);

		/* 캔버스는 화면이 커지는 동안 조용히 사라진다.
		   캐릭터·노트북은 그보다 먼저 지운다 — 배율이 3배만 넘어가도 256px 원화가
		   수천 픽셀로 늘어나 얼굴과 손이 거대한 색 덩어리로 화면을 뒤덮기 때문이다.
		   대신 비네트를 점점 조여서 화면 가장자리를 어둠으로 덮는다. */
		state.canvasAlpha = 1 - span(t, T.zoom[0] + 0.5, T.zoom[1] - 0.15, ease.inOut);
		state.charAlpha = 1 - span(t, T.zoom[0] + 0.15, T.zoom[0] + 0.6, ease.inOut);
		state.vignette = 1 + zoomP * 0.5;
	}

	/* ---------- 그리기 ---------- */
	let lastScreenRect = null;

	/** 스프라이트 안의 사각형(픽셀)을 화면 좌표로 — drawSprite 와 같은 앵커 규칙 */
	function spriteRect(img, box) {
		const z = cam.zoom;
		const b = sprites.boundsOf(img);
		const baseX = Math.round(cam.toScreenX(state.charX) - b.ax * z);
		const baseY = Math.round(cam.toScreenY(SCENE.floorY) - (b.y + b.h) * z + state.bob * z);
		return { x: baseX + (box.x - 1) * z, y: baseY + (box.y - 1) * z, w: (box.w + 2) * z, h: (box.h + 2) * z };
	}

	function render(time) {
		const { vw, vh } = cam;
		canvas.style.opacity = String(clamp01(state.canvasAlpha));

		/* 노트북 화면 자리는 그리기와 상관없이 늘 먼저 계산한다 —
		   줌 막바지엔 캔버스가 이미 비어 있어도 DOM 화면은 그 자리를 따라가야 한다. */
		lastScreenRect = state.carried
			? null
			: laptopScreenRect(cam, state.laptopCX, state.laptopCY, state.laptopOpen);

		// 캔버스가 다 사라진 뒤(=화면이 뷰포트를 채우는 마지막 구간)에는 아무것도 그리지 않는다
		if (state.canvasAlpha < 0.01) {
			layoutScreen();
			return;
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.globalAlpha = 1;

		drawRoom(ctx, cam, vw, vh, state.lamp);
		drawLamp(ctx, cam, state.lamp);
		/* 그레인은 "배경에만" 얹는다.
		   화면 좌표에 고정된 잡티라, 캐릭터와 노트북 위에까지 깔면 그것들이 움직일 때마다
		   같은 자리의 잡티가 다른 픽셀을 덮는다 — 윤곽선과 평평한 면이 프레임마다
		   지글거려서 "잔상"이나 "디테일이 갑자기 바뀌는" 것처럼 보인다.
		   벽 그라데이션의 밴딩을 감추는 목적은 배경에만 깔아도 그대로 달성된다. */
		drawGrain(ctx, vw, vh);
		drawDust(ctx, cam, dust, time, state.lamp * 0.8 * state.canvasAlpha);

		ctx.globalAlpha = state.charAlpha;

		/* 캐릭터가 다 사라진 뒤에는 아예 그리지 않는다.
		   알파가 0이어도 drawImage는 그대로 일을 하는데, 이때 배율이 5배를 넘어서
		   256px 원화를 수천 픽셀로 늘리는 중이라 그 한 번이 프레임을 통째로 잡아먹는다. */
		const charVisible = state.charAlpha > 0.01;

		// 발밑 그림자
		if (charVisible && state.lamp > 0.05) {
			const near = 1 - Math.min(1, Math.abs(state.charX) / (90 * U));
			drawShadow(ctx, cam, state.charX, 0.8 + near * 0.4, state.lamp * (0.4 + near * 0.6));
		}

		const img = currentImage();
		if (charVisible) drawSprite(ctx, cam, img, sprites, state.charX, SCENE.floorY, { bobPx: state.bob });

		/* 손은 스프라이트에서 오려내 노트북 위에 다시 그린다 — 그래야 쥔 것으로 보인다.
		   단 손 모양이 제대로 보이는 프레임에서만 (grip). 손이 몸에 가려 손날만 남은
		   프레임까지 붙이면, 얇은 노트북 위아래로 삐져나온 살색 막대가 된다. */
		const rh = state.handR;
		const lh = state.handL;
		const cutR = rh && rh.grip ? sprites.cutOf(img, rh) : null;
		const cutL = lh && lh.grip ? sprites.cutOf(img, lh) : null;
		const restCut = (cut) =>
			drawHandCut(ctx, cam, img, cut, sprites, state.charX, SCENE.floorY, 0, 0, state.bob);

		// 뚜껑을 여는 오른손은 제자리를 떠난다 — 열리기 전 뻗는 동안(carried)에도 마찬가지다.
		// 원래 손은 방 배경으로 지우고, 소매 끝에서 새 위치까지 팔뚝을 잇는다.
		const handMoving = state.openHand.active && rh && cutR;

		// 손이 제자리를 떠나면 원래 자리는 소매 색으로 메운다 (손목이 이어진 것처럼)
		const handX2 = rh ? state.charX + rh.dx : 0;
		const handY2 = rh ? SCENE.floorY - rh.up + state.bob : 0;
		if (handMoving) {
			const rect = spriteRect(img, rh.box);
			const behind = sprites.pixelAt(img, rh.box.x + rh.box.w / 2, rh.box.y - 3);
			if (behind && behind[3] > 16) {
				eraseToColor(ctx, rect, `rgb(${behind[0]},${behind[1]},${behind[2]})`);
			} else {
				eraseToRoom(ctx, cam, vw, vh, state.lamp, rect);
			}
		}

		/* 노트북을 두 손으로 눕혀 들기 시작하면, 손 모양이 아닌 살색 조각은 아예 지운다.
		   raise-1 프레임은 손이 몸에 가려 손날만 3~4px 폭으로 남는데, 그 조각이
		   얇은 노트북 위아래로 삐져나와 양끝에 살색 막대가 선 것처럼 보인다.
		   소매 색으로 그 모양 그대로 덮으면 팔이 노트북 뒤로 들어간 것처럼 이어진다. */
		if (charVisible && state.laptopFlat > 0.6) {
			for (const h of [rh, lh]) {
				if (!h || h.grip) continue;
				const behind = sprites.pixelAt(img, h.box.x + h.box.w / 2, h.box.y - 3);
				if (!behind || behind[3] < 16) continue;
				const patch = sprites.stubPatch(img, h, `rgb(${behind[0]},${behind[1]},${behind[2]})`);
				drawHandCut(ctx, cam, img, patch, sprites, state.charX, SCENE.floorY, 0, 0, state.bob);
			}
		}

		if (charVisible) {
			if (state.carried) {
				drawLaptopClosed(ctx, cam, lap, state.laptopCX, state.laptopCY, state.laptopFlat, state.laptopYaw);
			} else {
				// 화면이 뷰포트를 채우기 시작하면 캔버스 발광은 끈다 (DOM 화면이 대신한다)
				const glow = state.screenOn * (1 - state.fill);
				drawLaptop(ctx, cam, lap.open, state.laptopCX, state.laptopCY, state.laptopOpen, state.screenOn, glow);
			}
		}

		/* 손은 노트북 위에 다시 그려야 쥔 것으로 보인다. 뚜껑을 여는 손도 마찬가지다 —
		   뚜껑 가장자리를 잡고 있으니 뚜껑 "앞"이 맞다.
		   예전에는 이 손을 뚜껑 뒤로 넘겼는데(손이 화면 한가운데 떠 보여서),
		   그러면 뚜껑의 들쭉날쭉한 모서리에 주먹 왼쪽 열이 한 줄 걸렀다 말았다 해서
		   화면 테두리에 붉은 점선 같은 잔상이 생겼다. 지금은 주먹이 화면칸(DOM 오버레이)
		   바깥, 뚜껑 오른쪽 모서리에만 걸치도록 스프라이트에서 자리를 잡아 뒀으므로
		   그냥 앞에 그리면 된다. */
		const opening = state.sprite === 'openArm';
		if (!charVisible) {
			/* 손도 같이 사라진 상태 */
		} else if (cutL && (state.laptopFlat > 0.6 || opening)) restCut(cutL);
		if (charVisible && cutR) {
			if (handMoving) {
				drawHandCut(
					ctx, cam, img, cutR, sprites, state.charX, SCENE.floorY,
					state.openHand.x - handX2, state.openHand.y - handY2, state.bob
				);
			} else {
				restCut(cutR);
			}
		}

		ctx.globalAlpha = 1;
		drawVignette(ctx, vw, vh, state.vignette);

		layoutScreen();
	}

	/** 노트북 화면 자리에 DOM 오버레이를 맞춘다 (끝에는 뷰포트 전체) */
	function layoutScreen() {
		if (!screenClip || !screenInner) return;
		const { vw, vh } = cam;
		const r = lastScreenRect;

		let x = 0;
		let y = 0;
		let w = vw;
		let h = vh;

		if (r && state.fill < 1) {
			x = lerp(r.x, 0, state.fill);
			y = lerp(r.y, 0, state.fill);
			w = lerp(r.w, vw, state.fill);
			h = lerp(r.h, vh, state.fill);
		} else if (!r) {
			// 아직 화면이 열리지 않았다
			screenClip.style.opacity = '0';
			return;
		}

		screenClip.style.opacity = String(clamp01(state.screenOn));
		screenClip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
		screenClip.style.width = `${Math.max(0, w)}px`;
		screenClip.style.height = `${Math.max(0, h)}px`;

		const s = w / vw;
		screenInner.style.transform = `scale(${s})`;
		screenInner.style.top = `${(h - vh * s) / 2}px`;

		/* 부팅 화면만 따로 키운다.
		   노트북 화면은 이 시점에 60px 남짓이라, 사이트와 같은 배율로 줄이면
		   로고도 진행 막대도 1px 아래로 뭉개져 "켜지긴 했는데 뭔지 모를 사각형"이 된다.
		   막대가 화면 폭의 40% 정도로 보이게 키워 두면 멀리서도 부팅 중인 게 읽힌다.
		   (화면이 커질수록 1배로 돌아오고, 좁은 모바일에서는 원래 크기 그대로다.) */
		screenInner.style.setProperty(
			'--boot-scale',
			String(Math.max(1, Math.min(3.2, (0.42 * vw) / 190)))
		);
	}

	function dispose() {
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
	}

	resize();
	apply(0);

	return {
		apply: (t, time) => {
			apply(t);
			render(time ?? t);
		},
		render: () => {},
		resize,
		dispose,
		state,
		T,
		// 타임라인이 화면 크기에 따라 달라지므로 끝 시각도 그때그때 읽는다
		get END() {
			return T.handoff[1];
		},
	};
}
