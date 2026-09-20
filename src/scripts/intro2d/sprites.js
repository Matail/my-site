/* 스프라이트 로더.
   PixelLab에서 뽑은 PNG들을 불러오고, 캔버스 안에서 캐릭터가 실제로 차지하는
   영역(발바닥 위치)을 한 번 재둔다 — 프레임마다 재면 걸을 때 덜컥거린다. */

function loadImage(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('스프라이트를 불러오지 못했습니다: ' + src));
		img.src = src;
	});
}

/** 피부색인가 — 얼굴·손이 같은 색이라 영역으로 구분한다 */
function isSkin(d, i) {
	const r = d[i];
	const g = d[i + 1];
	const b = d[i + 2];
	return d[i + 3] > 16 && r > 150 && g > 115 && b > 100 && r >= g && g >= b && r - b < 90;
}

/** 살 계열인가 — 밝은 살색 + 그 둘레의 붉은 그늘·윤곽까지.
    손을 오려낼 때 밝은 살색만 가져오면 음영진 가장자리가 통째로 떨어져 나가,
    노트북 위에 손이 아니라 밝은 점 몇 개만 남는다(= 잔상처럼 보이던 것). */
function isFlesh(d, i) {
	if (d[i + 3] <= 16) return false;
	if (isSkin(d, i)) return true;
	const r = d[i];
	const g = d[i + 1];
	const b = d[i + 2];
	return r > 60 && r > g + 12 && r - b > 15;
}

/**
 * 아래쪽 55%에서 이어진 피부 덩어리(= 손 후보)를 전부 찾는다.
 * 어느 것을 쓸지는 프레임 순서를 봐야 정할 수 있으므로 여기서는 고르지 않는다.
 */
function findHand(data, w, b) {
	const y0 = b.y + Math.floor(b.h * 0.42);
	// 아래 12%는 신발 — 밝은 밑창이 피부로 잡혀 손 후보에 끼어든다
	const y1 = b.y + b.h - Math.floor(b.h * 0.12);
	const seen = new Uint8Array(w * (y1 - y0));
	const idx = (x, y) => (y - y0) * w + x;
	const minSize = Math.max(6, Math.round(b.h * 0.06));
	const groups = [];

	for (let y = y0; y < y1; y++) {
		for (let x = b.x; x < b.x + b.w; x++) {
			if (seen[idx(x, y)] || !isSkin(data, (y * w + x) * 4)) continue;
			// 이어진 덩어리 하나를 통째로 걷어낸다
			let minX = x;
			let maxX = x;
			let minY = y;
			let maxY = y;
			let n = 0;
			const stack = [x, y];
			seen[idx(x, y)] = 1;
			while (stack.length) {
				const cy = stack.pop();
				const cx = stack.pop();
				n++;
				if (cx < minX) minX = cx;
				if (cx > maxX) maxX = cx;
				if (cy < minY) minY = cy;
				if (cy > maxY) maxY = cy;
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						const nx = cx + dx;
						const ny = cy + dy;
						if (nx < 0 || nx >= w || ny < y0 || ny >= y1) continue;
						if (seen[idx(nx, ny)] || !isSkin(data, (ny * w + nx) * 4)) continue;
						seen[idx(nx, ny)] = 1;
						stack.push(nx, ny);
					}
				}
			}
			if (n >= minSize) groups.push({ n, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, minX, maxX, minY, maxY });
		}
	}
	groups.sort((p, q) => q.n - p.n);
	return groups;
}

/** 투명 여백을 뺀 실제 그림 영역 + 손 위치 */
function measure(img) {
	const c = document.createElement('canvas');
	c.width = img.width;
	c.height = img.height;
	const g = c.getContext('2d', { willReadFrequently: true });
	g.drawImage(img, 0, 0);
	const { data } = g.getImageData(0, 0, c.width, c.height);

	let minX = c.width;
	let minY = c.height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < c.height; y++) {
		for (let x = 0; x < c.width; x++) {
			if (data[(y * c.width + x) * 4 + 3] > 16) {
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}
	if (maxX < 0) {
		const b0 = { x: 0, y: 0, w: c.width, h: c.height, ax: c.width / 2 };
		return { bounds: b0, hands: [], source: c };
	}
	const bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

	/* 좌우 기준점(앵커).
	   그림 영역의 한가운데를 쓰면 팔다리가 벌어질 때마다 bbox가 넓어져
	   중심이 따라 움직인다 — 걷기 8프레임에서 그 폭이 13px이나 돼서
	   몸이 앞뒤로 흔들리며 걷는 것처럼 보였다.
	   머리는 어느 프레임에서든 거의 제자리(1.5px 이내)라 머리 중심을 앵커로 쓴다. */
	const headBottom = bounds.y + Math.max(4, Math.round(bounds.h * 0.22));
	let hx0 = Infinity;
	let hx1 = -Infinity;
	for (let y = bounds.y; y < headBottom; y++) {
		for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
			if (data[(y * c.width + x) * 4 + 3] > 16) {
				if (x < hx0) hx0 = x;
				if (x > hx1) hx1 = x;
			}
		}
	}
	bounds.ax = hx1 >= hx0 ? (hx0 + hx1 + 1) / 2 : bounds.x + bounds.w / 2;

	/* 손 좌표는 "발바닥 기준 앵커"와 같은 계로 바꿔둔다.
	   스프라이트 1픽셀 = 씬 1단위이므로 그대로 쓸 수 있다.

	   grip: 이 덩어리가 "손 모양"으로 보이는가.
	   포즈에 따라 손이 몸에 거의 가려져 손날만 3~4px 폭으로 남는 프레임이 있다
	   (raise-1이 그렇다). 그건 위치를 잡는 데는 써도 되지만, 노트북 위에 다시
	   오려 붙이면 손이 아니라 살색 막대 두 개가 붙어 있는 것처럼 보인다.
	   제대로 그려진 손은 폭이 10px 이상(키의 4% 이상)이라 이 선으로 갈린다. */
	const minGripW = Math.max(5, Math.round(bounds.h * 0.035));
	const hands = findHand(data, c.width, bounds).map((g) => ({
		dx: g.cx - bounds.ax, // 앵커(머리 중심)에서 좌우로
		up: bounds.y + bounds.h - g.cy, // 발바닥에서 위로
		n: g.n,
		grip: g.maxX - g.minX + 1 >= minGripW,
		box: { x: g.minX, y: g.minY, w: g.maxX - g.minX + 1, h: g.maxY - g.minY + 1 },
	}));
	return { bounds, hands, source: c };
}

/**
 * 손 하나를 스프라이트에서 오려낸다.
 * 사각형째 베끼면 손 옆의 소매·배경 픽셀까지 딸려와 노트북 위에 네모 자국이 남는다.
 * 그래서 손(피부) 덩어리만 남기고, 그 테두리 1칸(손 자체의 윤곽선)까지만 함께 가져온다.
 * @returns { canvas, x, y, w, h } — x,y 는 스프라이트 캔버스 안에서의 원점
 */
function cutHand(source, hand) {
	const pad = 4; // 살색 덩어리 바깥 3~5px까지 그늘이 이어진다 (실측)
	const x = Math.max(0, hand.box.x - pad);
	const y = Math.max(0, hand.box.y - pad);
	const w = Math.min(source.width - x, hand.box.w + pad * 2);
	const h = Math.min(source.height - y, hand.box.h + pad * 2);

	const c = document.createElement('canvas');
	c.width = w;
	c.height = h;
	const g = c.getContext('2d', { willReadFrequently: true });
	g.drawImage(source, x, y, w, h, 0, 0, w, h);

	const img = g.getImageData(0, 0, w, h);
	const d = img.data;
	const keep = new Uint8Array(w * h);

	// 손을 이루는 픽셀 (밝은 살색 + 그늘)
	for (let yy = 0; yy < h; yy++) {
		for (let xx = 0; xx < w; xx++) {
			if (isFlesh(d, (yy * w + xx) * 4)) keep[yy * w + xx] = 1;
		}
	}
	/* 손 둘레의 어두운 픽셀 중 "손 안쪽"만 함께 가져온다 — 손가락 사이 그늘 같은 것.
	   바깥 윤곽선까지 가져오면 밝은 노트북 위에 까만 네모 조각이 몇 개 얹힌 것처럼 보인다.
	   스프라이트에서 그 픽셀들은 손이 아니라 손 뒤의 어두운 옷이기 때문이다.
	   노트북 바깥에서는 스프라이트 원본이 그대로 보이므로 윤곽선이 사라지지도 않는다.

	   안쪽 판정: 같은 줄에 좌우로, 또는 같은 칸에 위아래로 살색이 있으면 손 안이다. */
	const rowMin = new Int16Array(h).fill(-1);
	const rowMax = new Int16Array(h).fill(-1);
	const colMin = new Int16Array(w).fill(-1);
	const colMax = new Int16Array(w).fill(-1);
	for (let yy = 0; yy < h; yy++) {
		for (let xx = 0; xx < w; xx++) {
			if (!keep[yy * w + xx]) continue;
			if (rowMin[yy] < 0) rowMin[yy] = xx;
			rowMax[yy] = xx;
			if (colMin[xx] < 0) colMin[xx] = yy;
			colMax[xx] = yy;
		}
	}
	const inside = [];
	for (let yy = 0; yy < h; yy++) {
		for (let xx = 0; xx < w; xx++) {
			if (keep[yy * w + xx]) continue;
			const i = (yy * w + xx) * 4;
			if (!(d[i + 3] > 16 && d[i] + d[i + 1] + d[i + 2] < 210)) continue;
			const betweenX = rowMin[yy] >= 0 && xx > rowMin[yy] && xx < rowMax[yy];
			const betweenY = colMin[xx] >= 0 && yy > colMin[xx] && yy < colMax[xx];
			if (betweenX || betweenY) inside.push(yy * w + xx);
		}
	}
	for (const k of inside) keep[k] = 1;

	for (let k = 0; k < w * h; k++) {
		if (!keep[k]) d[k * 4 + 3] = 0;
	}
	g.putImageData(img, 0, 0);
	return { canvas: c, x, y, w, h };
}

/**
 * @param manifest { [키]: 경로 또는 경로 배열 }
 * @param optionalKeys 없어도 되는 키들 — 못 불러오면 그 키를 지우고 넘어간다.
 *   (아직 뽑지 않은 포즈가 있어도 인트로 전체가 죽지 않게)
 * @returns { [키]: Image 또는 Image[], bounds, size }
 */
/** 잴 것 없이 그림만 필요한 PNG 묶음 (노트북 같은 소품) */
export async function loadImages(srcs) {
	return Promise.all(srcs.map(loadImage));
}

export async function loadSprites(manifest, onProgress, optionalKeys = []) {
	const entries = Object.entries(manifest);
	const total = entries.reduce((n, [, v]) => n + (Array.isArray(v) ? v.length : 1), 0);
	let done = 0;

	const step = async (src) => {
		const img = await loadImage(src);
		done++;
		onProgress?.(done / total);
		return img;
	};

	const out = {};
	for (const [key, value] of entries) {
		try {
			out[key] = Array.isArray(value)
				? await Promise.all(value.map(step))
				: await step(value);
		} catch (err) {
			if (!optionalKeys.includes(key)) throw err;
			delete out[key];
			console.info('[intro] 선택 스프라이트 없음 — 건너뜁니다:', key);
		}
	}

	// 프레임마다 캔버스 안에서의 발 위치가 다르다 (걷기 프레임은 다리를 벌려서 더 낮다).
	// 각자 제 발바닥을 기준으로 놓아야 바닥에 붙어서 걷는다.
	const measured = new Map();
	const all = [];
	for (const v of Object.values(out)) {
		if (Array.isArray(v)) all.push(...v);
		else if (v instanceof Image) all.push(v);
	}
	const ref = Array.isArray(out.front) ? out.front[0] : out.front;

	/* 손.
	   옆모습·걷기: 가장 큰 피부 덩어리가 앞쪽 손 = 캐릭터의 오른손 (동쪽을 보면 오른쪽이 앞이다).
	   정면: 화면 왼쪽 손이 캐릭터의 오른손.
	   노트북은 오른손에 들고 들어오므로, 프레임마다 그 손을 따라간다. */
	const handList = new Map();
	const sources = new Map();
	all.forEach((img) => {
		const m = measure(img);
		measured.set(img, m.bounds);
		handList.set(img, m.hands);
		sources.set(img, m.source);
	});
	// measure()를 두 번 부르지 않도록 위에서 candidates 대신 handList를 쓴다
	const cuts = new Map();
	const cutOf = (img, hand) => {
		const key = img.src + ':' + hand.box.x + ',' + hand.box.y;
		if (!cuts.has(key)) cuts.set(key, cutHand(sources.get(img), hand));
		return cuts.get(key);
	};

	out.bounds = measured.get(ref);
	out.boundsOf = (img) => measured.get(img) || out.bounds;
	out.handsOf = (img) => handList.get(img) || [];
	/** 캐릭터의 오른손 (옆·걷기: 가장 큰 덩어리, 정면: 화면 왼쪽) */
	out.rightHand = (img) => {
		const list = out.handsOf(img);
		if (!list.length) return null;
		const big = list[0];
		const other = list[1];
		if (other && other.n > big.n * 0.6 && other.dx < big.dx) return other;
		return big;
	};
	/** 반대쪽 손 — 없으면 null.
	    뚜껑을 여는 손은 뚜껑에 가려 작게 잡히므로 문턱을 낮게 잡는다. */
	out.leftHand = (img) => {
		const list = out.handsOf(img);
		const r = out.rightHand(img);
		const cand = list.filter((h) => h !== r && h.n > (r ? r.n * 0.2 : 0));
		return cand.length ? cand.reduce((a, b) => (b.dx > a.dx ? b : a)) : null;
	};
	out.cutOf = cutOf;

	/* 손날만 남은 살색 조각을 덮을 "덧칠판".
	   그 프레임에서 손은 대부분 몸에 가려 있고, 남은 건 살색 몇 픽셀과 그 둘레의
	   붉은 그늘이다. 사각형으로 덮으면 실루엣 밖(배경)까지 칠해져 네모가 생기고,
	   엄격한 살색만 덮으면 붉은 그늘이 점점이 남는다.
	   그래서 "따뜻한 색(붉은 기가 도는 픽셀)"만 골라 그 모양 그대로 칠한다. */
	const warmPatches = new Map();
	out.stubPatch = (img, hand, color) => {
		const key = img.src + ':' + hand.box.x + ',' + hand.box.y + ':' + color;
		if (!warmPatches.has(key)) {
			const src = sources.get(img);
			const pad = 6; // 살색 둘레의 그늘까지 넉넉히 (실측 5px)
			const x = Math.max(0, hand.box.x - pad);
			const y = Math.max(0, hand.box.y - pad);
			const w = Math.min(src.width - x, hand.box.w + pad * 2);
			const h = Math.min(src.height - y, hand.box.h + pad * 2);
			const c = document.createElement('canvas');
			c.width = w;
			c.height = h;
			const g = c.getContext('2d', { willReadFrequently: true });
			g.drawImage(src, x, y, w, h, 0, 0, w, h);
			const im = g.getImageData(0, 0, w, h);
			const d = im.data;
			for (let i = 0; i < d.length; i += 4) {
				if (!isFlesh(d, i)) d[i + 3] = 0;
			}
			g.putImageData(im, 0, 0);
			g.globalCompositeOperation = 'source-in';
			g.fillStyle = color;
			g.fillRect(0, 0, w, h);
			warmPatches.set(key, { canvas: c, x, y, w, h });
		}
		return warmPatches.get(key);
	};

	// 스프라이트 픽셀 읽기 — 손을 지울 때 그 뒤가 옷인지 배경인지 알아야 한다
	const pixelCache = new Map();
	out.pixelAt = (img, x, y) => {
		const src = sources.get(img);
		if (!src) return null;
		if (!pixelCache.has(img)) {
			const g = src.getContext('2d', { willReadFrequently: true });
			pixelCache.set(img, g.getImageData(0, 0, src.width, src.height).data);
		}
		const xi = Math.round(x);
		const yi = Math.round(y);
		if (xi < 0 || yi < 0 || xi >= src.width || yi >= src.height) return null;
		const d = pixelCache.get(img);
		const i = (yi * src.width + xi) * 4;
		return [d[i], d[i + 1], d[i + 2], d[i + 3]];
	};

	out.size = { w: ref.width, h: ref.height };
	return out;
}

/** 스프라이트를 "발바닥이 footY에 닿도록" 그린다 */
export function drawSprite(ctx, cam, img, sprites, worldX, footY, opts = {}) {
	const { flip = false, alpha = 1, bobPx = 0 } = opts;
	const z = cam.zoom;
	const b = sprites.boundsOf ? sprites.boundsOf(img) : sprites.bounds;

	// 캔버스 안에서 발바닥(그림 영역의 아래쪽)이 footY에 오도록 맞춘다
	const drawW = img.width * z;
	const drawH = img.height * z;
	const footOffset = (b.y + b.h) * z; // 캔버스 위쪽에서 발바닥까지
	const cx = b.ax * z; // 캔버스 왼쪽에서 앵커(머리 중심)까지

	const x = Math.round(cam.toScreenX(worldX) - cx);
	const y = Math.round(cam.toScreenY(footY) - footOffset + bobPx * z);

	ctx.save();
	if (alpha < 1) ctx.globalAlpha = alpha;
	if (flip) {
		ctx.translate(x + drawW, y);
		ctx.scale(-1, 1);
		ctx.drawImage(img, 0, 0, drawW, drawH);
	} else {
		ctx.drawImage(img, x, y, drawW, drawH);
	}
	ctx.restore();
}

/**
 * 오려낸 손을 그린다. 기본은 스프라이트 안의 원래 자리 (그래서 노트북 위에 손이 다시 올라온다).
 * shiftX/shiftY 는 씬 단위로 손을 옮길 때 쓴다 (뚜껑을 여는 손).
 */
export function drawHandCut(ctx, cam, img, cut, sprites, worldX, footY, shiftX = 0, shiftY = 0, bobPx = 0) {
	const z = cam.zoom;
	const b = sprites.boundsOf(img);
	const footOffset = (b.y + b.h) * z;
	const cx = b.ax * z;
	const baseX = Math.round(cam.toScreenX(worldX) - cx);
	const baseY = Math.round(cam.toScreenY(footY) - footOffset + bobPx * z);
	ctx.drawImage(
		cut.canvas,
		Math.round(baseX + (cut.x + shiftX) * z),
		Math.round(baseY + (cut.y + shiftY) * z),
		cut.w * z,
		cut.h * z
	);
}

/** 스프라이트 좌표(픽셀)를 월드 좌표로 — 손 위치를 노트북 축으로 쓸 때 */
export function spriteToWorld(sprites, img, worldX, footY, sx, sy) {
	const b = sprites.boundsOf(img);
	return { x: worldX + (sx - b.ax), y: footY - (b.y + b.h - sy) };
}
