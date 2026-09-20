// (이 파일은 이제 anim.js 헬퍼를 쓰지 않는다 — 전부 정수 픽셀 계산이다)

/* 픽셀아트 방을 그리는 도구들.
   좌표는 전부 "씬 단위"(= 스프라이트 1픽셀). 카메라가 화면 픽셀로 변환한다. */

/* 씬 단위 = 스프라이트 1픽셀.
   기준은 "캐릭터 키 65픽셀"이고, 실제 스프라이트가 그보다 크면 U배로 늘린다.
   → 스프라이트를 더 큰 것으로 갈아끼워도 구도가 그대로 유지된다. */
const BASE_CHAR_H = 65;
export let U = 1;

export const SCENE = {
	floorY: 152, // 바닥선
	lampX: 0, // 전등은 무대 중앙(원점) 위에
	lampTopY: -60, // 전선이 시작되는 높이 (화면 밖)
	bulbY: 44, // 전구 높이
};

/** 캐릭터 실제 높이(픽셀)에 맞춰 무대 치수를 다시 잡는다 */
export function setCharHeight(charH) {
	U = Math.max(0.2, charH / BASE_CHAR_H);
	SCENE.floorY = 152 * U;
	SCENE.lampTopY = -60 * U;
	SCENE.bulbY = 44 * U;
	return U;
}

const C = {
	bg: '#05050a',
	floor: '#0d0d14',
	floorLit: '#2a2016',
	cord: '#1b1b22',
	socket: '#2a2a33',
	bulbOn: '#ffd38a',
	bulbOff: '#2a2620',
	glow: 'rgba(255,180,70,',
	shadow: 'rgba(0,0,0,0.55)',
};

/** 정수 픽셀에 맞춰 칠한다 — 픽셀아트는 반 픽셀이 생기면 바로 지저분해진다 */
export function px(ctx, x, y, w, h, color) {
	ctx.fillStyle = color;
	ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/** 배경 + 바닥 */
export function drawRoom(ctx, cam, vw, vh, lampV) {
	ctx.fillStyle = C.bg;
	ctx.fillRect(0, 0, vw, vh);

	const floorScreenY = cam.toScreenY(SCENE.floorY);

	// 바닥 (전등이 켜져 있으면 빛 웅덩이가 생긴다)
	ctx.fillStyle = C.floor;
	ctx.fillRect(0, floorScreenY, vw, vh - floorScreenY);

	if (lampV > 0.01) {
		const cx = cam.toScreenX(SCENE.lampX);
		const r = 150 * U * cam.zoom;
		const g = ctx.createRadialGradient(cx, floorScreenY, 0, cx, floorScreenY, r);
		g.addColorStop(0, `rgba(255,176,80,${0.34 * lampV})`);
		g.addColorStop(0.45, `rgba(255,150,60,${0.12 * lampV})`);
		g.addColorStop(1, 'rgba(255,140,50,0)');
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, floorScreenY, vw, vh - floorScreenY);
		ctx.clip();
		ctx.fillStyle = g;
		ctx.fillRect(0, floorScreenY - r * 0.2, vw, r * 1.2);
		ctx.restore();

		// 벽에도 빛이 조금 걸린다
		const wall = ctx.createRadialGradient(cx, cam.toScreenY(SCENE.bulbY), 0, cx, cam.toScreenY(SCENE.bulbY), r * 1.5);
		wall.addColorStop(0, `rgba(255,170,70,${0.16 * lampV})`);
		wall.addColorStop(1, 'rgba(255,140,50,0)');
		ctx.fillStyle = wall;
		ctx.fillRect(0, 0, vw, floorScreenY);
	}

	// 바닥선
	px(ctx, 0, floorScreenY, vw, Math.max(1, cam.zoom * 0.5), 'rgba(255,190,120,0.10)');
}

/** 천장에 매달린 전구 */
export function drawLamp(ctx, cam, lampV) {
	const z = cam.zoom;
	const x = cam.toScreenX(SCENE.lampX);
	const bulbTop = cam.toScreenY(SCENE.bulbY);

	// 전선
	px(ctx, x - z * U * 0.5, cam.toScreenY(SCENE.lampTopY), Math.max(1, z * U), bulbTop - cam.toScreenY(SCENE.lampTopY), C.cord);
	// 소켓
	px(ctx, x - z * U * 2, bulbTop - z * U * 3, z * U * 4, z * U * 3, C.socket);

	// 전구 (픽셀 덩어리 3단)
	const on = lampV > 0.02;
	const body = on ? C.bulbOn : C.bulbOff;
	px(ctx, x - z * U * 2, bulbTop, z * U * 4, z * U * 2, body);
	px(ctx, x - z * U * 3, bulbTop + z * U * 2, z * U * 6, z * U * 4, body);
	px(ctx, x - z * U * 2, bulbTop + z * U * 6, z * U * 4, z * U * 2, body);
	if (on) {
		px(ctx, x - z * U, bulbTop + z * U * 3, z * U * 2, z * U * 2, '#fff6e0'); // 필라멘트
	}

	// 번짐
	if (on) {
		const r = z * U * 34;
		const g = ctx.createRadialGradient(x, bulbTop + z * U * 4, 0, x, bulbTop + z * U * 4, r);
		g.addColorStop(0, `${C.glow}${0.5 * lampV})`);
		g.addColorStop(0.35, `${C.glow}${0.16 * lampV})`);
		g.addColorStop(1, 'rgba(255,180,70,0)');
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(x, bulbTop + z * U * 4, r, 0, Math.PI * 2);
		ctx.fill();

		// 빛 원뿔 (아래로 갈수록 옅어진다)
		const floorY = cam.toScreenY(SCENE.floorY);
		const cone = ctx.createLinearGradient(0, bulbTop + z * U * 6, 0, floorY);
		cone.addColorStop(0, `rgba(255,190,110,${0.14 * lampV})`);
		cone.addColorStop(0.55, `rgba(255,170,80,${0.05 * lampV})`);
		cone.addColorStop(1, 'rgba(255,160,70,0)');
		ctx.save();
		ctx.fillStyle = cone;
		ctx.beginPath();
		ctx.moveTo(x - z * U * 3, bulbTop + z * U * 6);
		ctx.lineTo(x + z * U * 3, bulbTop + z * U * 6);
		ctx.lineTo(x + z * U * 58, floorY);
		ctx.lineTo(x - z * U * 58, floorY);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}
}

/** 캐릭터 발밑 그림자 */
export function drawShadow(ctx, cam, worldX, scale = 1, alpha = 1) {
	const x = cam.toScreenX(worldX);
	const y = cam.toScreenY(SCENE.floorY);
	const w = 26 * U * cam.zoom * scale;
	const h = 6 * U * cam.zoom * scale;
	const g = ctx.createRadialGradient(x, y, 0, x, y, w / 2);
	g.addColorStop(0, `rgba(0,0,0,${0.55 * alpha})`);
	g.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.save();
	ctx.translate(x, y);
	ctx.scale(1, h / w);
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

/* ===== 노트북 =====
   그림은 전부 PixelLab 스프라이트다 (아래 LAP). 여기 남은 건 캔버스에서 덧칠하는
   두 가지 색뿐이다 — 아직 안 켜진 화면을 덮는 색과, 켜졌을 때 새어 나오는 빛. */
const LAPTOP = {
	screenOff: '#0a0a12',
	glow: '#8fb4ff',
};

/* ===== 노트북 스프라이트 =====
   예전에는 노트북을 코드로 직사각형을 쌓아 그렸다. 지금은 PixelLab으로 뽑은
   64x64 오브젝트 두 묶음을 쓴다 (public/sprites/laptop/).

     tilt-0~8  손에 세로로 들린 자세 → 두 손으로 눕힌 자세 (9프레임)
     open-0~8  눕힌 채로 뚜껑이 열리는 자세 (9프레임). tilt-8 과 open-0 은 같은 그림이다.

   프레임마다 "손이 잡는 자리"가 다르므로 앵커를 따로 잰다.
   - tilt: 넘어가는 동안 무게중심이 옮겨 가므로 각 프레임의 그림 중심을 쓴다
     (index.js 가 손 위치에서 계산해 주는 laptopCX/CY 가 바로 그 중심이다).
   - open: 두 손이 본체를 잡은 채 뚜껑만 열리므로 앵커가 움직이면 안 된다.
     open-0(=닫힌 판)의 중심 하나로 9프레임 전부를 고정한다.
   숫자는 스프라이트에서 실측한 값이다 (64px 캔버스 기준). */
const LAP = {
	frame: 64,
	hangH: 60, // 세로로 들었을 때의 길이 — 손에서 중심까지가 그 절반이다
	flatW: 59.5, // 눕혀 들었을 때의 가로 — 잡은 손에서 중심까지가 그 절반이다.
	// raise 끝(두 손 한가운데)과 open(잡은 손 + 절반) 이 같은 자리를 가리켜야
	// #359 → #360 에서 노트북이 옆으로 안 튄다. raise-11 의 두 손 간격이 59.5px 다.
	screenW: 40, // 다 열렸을 때 화면 폭 (줌 목표 배율을 이걸로 잡는다)
	tiltAnchor: [
		[32, 31.5], [31.5, 31], [31.5, 32], [31.5, 31.5], [31.5, 31.5],
		[31.5, 31.5], [32, 31.5], [31, 31.5], [31.5, 41],
	],
	/* yaw-0 = 옆면만 보이는 자세, yaw-8 = 넓은 면. 걸어 들어올 때(옆모습)가 8,
	   정면으로 돌아섰을 때가 0이다 — 옆구리에 낀 노트북은 몸이 돌면 옆면을 보인다. */
	yawAnchor: [
		[32, 31.5], [31.5, 31.5], [31, 31.5], [32, 31.5], [31.5, 31.5],
		[31.5, 31.5], [31.5, 31.5], [31.5, 31.5], [31.5, 31.5],
	],
	openAnchor: [31.5, 41],
	/* 프레임별 화면(패널) 자리 [x0,y0,x1,y1] — 스프라이트의 화면칸을 실측한 값이다.
	   닫혀 있는 0~2번은 화면이 보이지 않는다.
	   스프라이트의 화면칸은 "꺼진 색"으로 칠해 뒀다 — 진짜 사이트를 DOM 으로 덮는데,
	   스프라이트가 밝으면 1~2px만 어긋나도 그 틈으로 밝은 띠가 새어 나온다. */
	screen: [
		null, null, null,
		[10, 33, 53, 34], [8, 26, 54, 35], [9, 21, 54, 35],
		[10, 16, 53, 36], [11, 14, 52, 37], [12, 12, 51, 36],
	],
};

export const LAPTOP_SPRITE = LAP;

const clampFrame = (p01) => Math.max(0, Math.min(8, Math.round(Math.max(0, Math.min(1, p01)) * 8)));

/** 스프라이트 한 장을 앵커가 (worldX, worldY)에 오도록 그린다 */
function drawLapFrame(ctx, cam, img, worldX, worldY, ax, ay) {
	const z = cam.zoom;
	const x = Math.round(cam.toScreenX(worldX) - ax * z);
	const y = Math.round(cam.toScreenY(worldY) - ay * z);
	const prev = ctx.imageSmoothingEnabled;
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(img, x, y, Math.round(LAP.frame * z), Math.round(LAP.frame * z));
	ctx.imageSmoothingEnabled = prev;
}

/**
 * 닫힌 노트북.
 *   yaw01  몸이 돌아간 정도. 0 = 옆모습(노트북 옆면만 보인다), 1 = 정면(넓은 면이 보인다).
 *   flat01 눕힌 정도. 0 = 세로로 들림, 1 = 두 손으로 눕힘.
 * 세워 든 동안(flat01 = 0)에는 몸을 따라 yaw 프레임이 돌고, 눕히기 시작하면 tilt 프레임으로 넘어간다.
 * yaw 의 마지막 장과 tilt 의 첫 장은 같은 그림이라 그 경계에서 튀지 않는다.
 * (worldX, worldY)는 그 프레임에서의 노트북 중심.
 */
export function drawLaptopClosed(ctx, cam, lap, worldX, worldY, flat01 = 1, yaw01 = 1) {
	if (flat01 <= 0) {
		const i = clampFrame(yaw01);
		const a = LAP.yawAnchor[i];
		drawLapFrame(ctx, cam, lap.yaw[i], worldX, worldY, a[0], a[1]);
		return;
	}
	const i = clampFrame(flat01);
	const a = LAP.tiltAnchor[i];
	drawLapFrame(ctx, cam, lap.tilt[i], worldX, worldY, a[0], a[1]);
}

/**
 * 화면(패널) 영역의 화면 좌표 사각형 — DOM 오버레이를 여기에 맞춘다.
 * 그리기와 분리해 둔다: 줌 막바지에는 캔버스의 노트북을 이미 지운 뒤에도
 * DOM 화면은 계속 이 자리를 따라가야 한다.
 */
export function laptopScreenRect(cam, worldX, worldY, open01) {
	const s = LAP.screen[clampFrame(open01)];
	if (!s) return null;
	const z = cam.zoom;
	const ax = LAP.openAnchor[0];
	const ay = LAP.openAnchor[1];
	return {
		x: cam.toScreenX(worldX) + (s[0] - ax) * z,
		y: cam.toScreenY(worldY) + (s[1] - ay) * z,
		w: (s[2] - s[0] + 1) * z,
		h: (s[3] - s[1] + 1) * z,
	};
}

/** 화면 한가운데가 노트북 앵커에서 얼마나 떨어져 있나 (월드 단위) — 카메라가 여기로 들어간다 */
export function laptopScreenOffset(open01) {
	const s = LAP.screen[clampFrame(open01)] || LAP.screen[8];
	return {
		dx: (s[0] + s[2]) / 2 - LAP.openAnchor[0],
		dy: (s[1] + s[3]) / 2 - LAP.openAnchor[1],
	};
}

/**
 * 열리는 노트북. 앵커는 9프레임 내내 같은 자리(본체를 잡은 두 손)다.
 * 스프라이트의 화면은 켜진 그림이라, 아직 안 켜졌으면 그 위를 어둡게 덮는다.
 * @returns 화면(패널) 영역의 화면 좌표 사각형
 */
export function drawLaptop(ctx, cam, frames, worldX, worldY, open01, screenOn, glowAmt = screenOn) {
	const i = clampFrame(open01);
	drawLapFrame(ctx, cam, frames[i], worldX, worldY, LAP.openAnchor[0], LAP.openAnchor[1]);

	const r = laptopScreenRect(cam, worldX, worldY, open01);
	if (!r) return null;

	// 아직 안 켜진 화면 — 스프라이트의 밝은 패널을 어둠으로 덮었다가 서서히 걷어낸다
	if (screenOn < 0.99) {
		ctx.save();
		ctx.globalAlpha *= 1 - Math.max(0, screenOn);
		px(ctx, r.x, r.y, r.w, r.h, LAPTOP.screenOff);
		ctx.restore();
	}

	if (glowAmt > 0.01 && r.h > 2) {
		/* 화면에서 새어 나오는 빛.
		   반경이 화면 폭에 비례하므로 카메라가 클로즈업하면 거대한 후광이 된다 —
		   그래서 줌이 들어갈수록 호출부에서 glowAmt를 줄여 끈다. */
		const cx = r.x + r.w / 2;
		const cy = r.y + r.h / 2;
		ctx.save();
		ctx.globalAlpha = 0.36 * glowAmt;
		const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r.w);
		g.addColorStop(0, 'rgba(150,190,255,0.55)');
		g.addColorStop(1, 'rgba(150,190,255,0)');
		ctx.fillStyle = g;
		ctx.fillRect(cx - r.w, cy - r.h, r.w * 2, r.h * 2.4);
		ctx.restore();
	}
	return r;
}

/** 스프라이트의 한 부분을 단색으로 메운다 (손 뒤가 옷일 때 — 배경을 뚫으면 안 된다) */
export function eraseToColor(ctx, rect, color) {
	ctx.fillStyle = color;
	ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

/** 스프라이트의 한 부분을 방 배경으로 되돌린다 (손이 제자리를 떠났을 때 원래 손을 지운다) */
export function eraseToRoom(ctx, cam, vw, vh, lampV, rect) {
	ctx.save();
	ctx.beginPath();
	ctx.rect(rect.x, rect.y, rect.w, rect.h);
	ctx.clip();
	drawRoom(ctx, cam, vw, vh, lampV);
	ctx.restore();
}

export const LAPTOP_SIZE = LAPTOP; // 색만 쓴다 (화면 꺼짐 색·발광)

/* ===== 먼지 ===== */
export function makeDust(count = 40) {
	const dust = [];
	for (let i = 0; i < count; i++) {
		dust.push({
			x: (Math.random() - 0.5) * 120 * U,
			y: SCENE.bulbY + Math.random() * (SCENE.floorY - SCENE.bulbY),
			s: 0.3 + Math.random() * 0.7,
			seed: Math.random() * 100,
		});
	}
	return dust;
}

export function drawDust(ctx, cam, dust, time, alpha) {
	if (alpha <= 0.01) return;
	const z = cam.zoom;
	// 클로즈업에서 먼지가 같이 확대되면 거대한 네모가 떠다닌다 — 크기는 묶어 둔다
	const s = Math.max(1, Math.min(3, z * 0.5));
	for (const d of dust) {
		const x = cam.toScreenX(d.x + Math.sin(time * 0.3 + d.seed) * 3 * U);
		// 한 바퀴(0→1) 돌면 위로 되돌아간다. 그 순간이 "순간이동"으로 보이지 않게
		// 양 끝에서 밝기를 0으로 떨궈 사라졌다 다시 나타나게 한다.
		const u = (((time * 2 * d.s + d.seed * 10) % 60) + 60) % 60 / 60;
		const y = cam.toScreenY(d.y + (u - 0.5) * 60 * U);
		const a =
			alpha * Math.sin(u * Math.PI) * (0.35 + 0.45 * Math.abs(Math.sin(time * 0.8 + d.seed)));
		if (a <= 0.01) continue;
		px(ctx, x, y, s, s, `rgba(255,220,170,${a})`);
	}
}

/* 필름 그레인.
   방 배경은 거의 검정 위에 옅은 주황 그라데이션이라, 8비트 색 단계로 끊겨서
   벽에 가로줄(밴딩)이 생긴다. 사이트 본문이 body::after 로 그레인을 까는 것과
   같은 이유로 캔버스에도 아주 옅은 잡티를 얹어 그 줄을 흩뜨린다. */
let grainPattern = null;
export function drawGrain(ctx, vw, vh) {
	if (!grainPattern) {
		const n = document.createElement('canvas');
		n.width = 128;
		n.height = 128;
		const g = n.getContext('2d');
		const img = g.createImageData(128, 128);
		for (let i = 0; i < img.data.length; i += 4) {
			const v = Math.random() < 0.5 ? 0 : 255;
			img.data[i] = v;
			img.data[i + 1] = v;
			img.data[i + 2] = v;
			img.data[i + 3] = Math.random() * 16;
		}
		g.putImageData(img, 0, 0);
		grainPattern = ctx.createPattern(n, 'repeat');
	}
	ctx.save();
	ctx.fillStyle = grainPattern;
	ctx.fillRect(0, 0, vw, vh);
	ctx.restore();
}

/** 화면 가장자리 어둡게 */
export function drawVignette(ctx, vw, vh, amount) {
	if (amount <= 0.01) return;
	const g = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.25, vw / 2, vh / 2, Math.max(vw, vh) * 0.75);
	g.addColorStop(0, 'rgba(0,0,0,0)');
	g.addColorStop(1, `rgba(0,0,0,${0.75 * amount})`);
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, vw, vh);
}
