/* 커서에 반응하는 덱.
 *
 * 핵심은 "층마다 따라오는 속도가 다르다"는 것 하나다.
 * 키아트는 1.15초, 캡션은 0.72초, 레터링은 0.52초로 커서를 쫓아가므로
 * 마우스를 빠르게 움직이면 층이 갈라졌다가 멈추면 다시 한 장으로 모인다.
 * 이게 카드가 평면이 아니라 두께를 가진 물건처럼 보이게 만든다.
 *
 * 그래서 이 파일은 anime.js 의 `createAnimatable` 만 쓴다 —
 * 값이 초당 수십 번 바뀌는 자리에서 `animate()` 를 매번 새로 만들면 안 된다.
 * 여기서 잡은 요소의 transform 은 이 파일이 독점한다. render() 는 건드리지 않는다.
 */
import { createAnimatable } from 'animejs';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 커서가 카드 한가운데에서 얼마나 벗어났는지에 따라 판이 기우는 정도 */
const TILT_X = 7.5;
const TILT_Y = 9.5;
/** 커서 쪽으로 판이 끌려가는 양 (px) */
const PULL_X = 15;
const PULL_Y = 10;
/** 화살표가 커서에 끌리기 시작하는 거리 */
const MAGNET_R = 140;
/** 독에서 옆 타일까지 확대가 번지는 거리 */
const DOCK_R = 116;

export function createPointerRig({ root, stage, tilt, parts, arrows, dock, dockItems = [] }) {
	// 커서가 없는 기계에서는 아무것도 하지 않는다 (터치는 드래그가 맡는다)
	if (!window.matchMedia('(pointer: fine)').matches) return null;
	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

	/* 판 전체 — 기울기는 빠르게, 끌려가는 건 느리게, 기우뚱하는 건 제일 느리게.
	   셋의 속도가 다른 덕에 커서를 휙 그으면 판이 한 박자 늦게 따라와 흔들린다. */
	const rig = createAnimatable(tilt, {
		rotateX: { duration: 620, ease: 'out(3)' },
		rotateY: { duration: 620, ease: 'out(3)' },
		rotateZ: { duration: 1000, ease: 'out(2)' },
		x: { duration: 1000, ease: 'out(3)' },
		y: { duration: 1000, ease: 'out(3)' },
		scale: { duration: 800, ease: 'out(3)' },
	});

	/* 카드 안쪽 층위. [요소, 가로 이동량, 세로 이동량, 따라오는 시간]
	   키아트는 커서와 반대로 움직인다 — 그래야 뒤에 있는 것처럼 보인다. */
	const cardRigs = parts.map((p) => {
		const layers = [];
		const add = (el, ax, ay, duration) => {
			if (!el) return;
			layers.push({
				ax,
				ay,
				a: createAnimatable(el, {
					x: { duration, ease: 'out(3)' },
					y: { duration, ease: 'out(3)' },
				}),
			});
		};
		add(p.artBox, -28, -16, 1150);
		add(p.cta, 14, 9, 720);
		add(p.lettering, 26, 16, 520);

		const spot = p.spot
			? createAnimatable(p.spot, {
					x: { duration: 260, ease: 'out(3)' },
					y: { duration: 260, ease: 'out(3)' },
					opacity: { duration: 420, ease: 'out(2)' },
				})
			: null;

		return { layers, spot };
	});

	/* 화살표는 커서가 가까이 오면 끌려온다 */
	const arrowRigs = arrows.filter(Boolean).map((el) => ({
		el,
		a: createAnimatable(el, {
			x: { duration: 420, ease: 'out(3)' },
			y: { duration: 420, ease: 'out(3)' },
			scale: { duration: 420, ease: 'out(3)' },
			opacity: { duration: 300, ease: 'out(2)' },
		}),
	}));

	/* 카드 고르개(독). 커서와의 거리로 타일이 부풀고 옆 타일이 따라 부푼다. */
	const dockRigs = dockItems
		.map((el) => {
			const lift = el.querySelector('.dock-lift');
			if (!lift) return null;
			return {
				el,
				a: createAnimatable(lift, {
					scale: { duration: 380, ease: 'out(3)' },
					y: { duration: 380, ease: 'out(3)' },
				}),
			};
		})
		.filter(Boolean);

	let dockOpen = false;
	function setDockOpen(on) {
		if (on === dockOpen) return; // 매 프레임 쓰면 CSS 트랜지션이 계속 다시 시작된다
		dockOpen = on;
		dock?.style.setProperty('--open', on ? '1' : '0');
		if (!on) {
			for (const r of dockRigs) {
				r.a.scale(1);
				r.a.y(0);
				r.el.classList.remove('is-peak');
			}
		}
	}

	const state = { active: 0, dragging: false };

	let lastX = 0;
	let lastT = 0;
	let vx = 0;
	let settleTimer = 0;

	/** 커서가 멈추면 기우뚱한 것도 제자리로 */
	function scheduleSettle() {
		clearTimeout(settleTimer);
		settleTimer = window.setTimeout(() => {
			vx = 0;
			rig.rotateZ(0);
		}, 110);
	}

	function move(e) {
		if (e.pointerType === 'touch' || e.pointerType === 'pen') return;

		// 기울어진 요소의 rect 를 읽으면 그 값이 다시 기울기를 바꿔 되먹임이 생긴다.
		// 변형이 걸리지 않는 stage 에서 읽고, 판의 크기는 레이아웃 값(offset*)으로 구한다.
		const r = stage.getBoundingClientRect();
		const hw = tilt.offsetWidth / 2 || 1;
		const hh = tilt.offsetHeight / 2 || 1;
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;

		// 카드 반폭을 1 로 본 좌표. 카드 밖으로 나가도 조금 더 먹히되 금방 포화한다.
		const nx = clamp((e.clientX - cx) / hw, -1.2, 1.2);
		const ny = clamp((e.clientY - cy) / hh, -1.2, 1.2);

		// 커서 가로 속도 → 판이 진행 방향으로 기우뚱한다 (코너를 도는 것처럼)
		const now = performance.now();
		const dt = Math.max(now - lastT, 8);
		const speed = (e.clientX - lastX) / dt;
		lastX = e.clientX;
		lastT = now;
		vx += (speed - vx) * 0.3;
		scheduleSettle();

		// 카드 위에 커서가 얼마나 가까이 있나 (0 바깥 ~ 1 한가운데)
		const near = 1 - clamp(Math.hypot(nx, ny), 0, 1);
		root.style.setProperty('--wash-strength', (0.55 + near * 0.45).toFixed(3));

		if (!state.dragging) {
			rig.rotateY(nx * TILT_Y);
			rig.rotateX(-ny * TILT_X);
			rig.rotateZ(clamp(-vx * 1.5, -4.5, 4.5));
			rig.x(nx * PULL_X);
			rig.y(ny * PULL_Y);
			rig.scale(1 + near * 0.014);

			const card = cardRigs[state.active];
			if (card) {
				for (const l of card.layers) {
					l.a.x(nx * l.ax);
					l.a.y(ny * l.ay);
				}
			}
		}

		// 반사광은 언제나 커서를 따라간다 (끄는 중에도)
		const card = cardRigs[state.active];
		if (card?.spot) {
			card.spot.x(e.clientX - (cx - hw));
			card.spot.y(e.clientY - (cy - hh));
			card.spot.opacity(clamp(1.45 - Math.hypot(nx, ny) * 0.75, 0, 1));
		}

		// 독 — 커서가 근처에 오면 점이 타일로 피어나고, 가장 가까운 타일이 제일 높이 솟는다
		if (dock && dockRigs.length) {
			const d = dock.getBoundingClientRect();
			const inZone =
				e.clientY > d.top - 96 &&
				e.clientY < d.bottom + 64 &&
				e.clientX > d.left - 80 &&
				e.clientX < d.right + 80;
			setDockOpen(inZone);

			if (inZone) {
				let peak = -1;
				let peakMag = 0;
				for (let i = 0; i < dockRigs.length; i++) {
					const r = dockRigs[i];
					const cx = d.left + r.el.offsetLeft + r.el.offsetWidth / 2;
					const t = clamp(1 - Math.abs(e.clientX - cx) / DOCK_R, 0, 1);
					const m = t * t * (3 - 2 * t); // smoothstep — 가장자리에서 각지지 않게
					// 이름표가 앉을 자리를 남겨야 하므로 확대는 여기까지만
					r.a.scale(1 + m * 0.45);
					r.a.y(-m * 10);
					if (m > peakMag) {
						peakMag = m;
						peak = i;
					}
				}
				for (let i = 0; i < dockRigs.length; i++) {
					dockRigs[i].el.classList.toggle('is-peak', i === peak && peakMag > 0.45);
				}
			}
		}

		// 화살표 자석
		for (const { el, a } of arrowRigs) {
			const ax = r.left + el.offsetLeft + el.offsetWidth / 2;
			const ay = r.top + el.offsetTop + el.offsetHeight / 2;
			const dx = e.clientX - ax;
			const dy = e.clientY - ay;
			const pull = 1 - clamp(Math.hypot(dx, dy) / MAGNET_R, 0, 1);
			a.x(dx * pull * 0.34);
			a.y(dy * pull * 0.34);
			a.scale(1 + pull * 0.2);
			a.opacity(el.disabled ? 0.1 : 0.34 + pull * 0.66);
		}
	}

	function rest() {
		clearTimeout(settleTimer);
		vx = 0;
		root.style.setProperty('--wash-strength', '1');
		// 돌아올 땐 더 느리게 — 놓아준 느낌이 나야 한다
		rig.rotateX(0, 1100, 'out(3)');
		rig.rotateY(0, 1100, 'out(3)');
		rig.rotateZ(0, 1100, 'out(2)');
		rig.x(0, 1100, 'out(3)');
		rig.y(0, 1100, 'out(3)');
		rig.scale(1, 900, 'out(3)');
		for (const card of cardRigs) {
			for (const l of card.layers) {
				l.a.x(0, 1100, 'out(3)');
				l.a.y(0, 1100, 'out(3)');
			}
			card.spot?.opacity(0);
		}
		for (const { el, a } of arrowRigs) {
			a.x(0);
			a.y(0);
			a.scale(1);
			a.opacity(el.disabled ? 0.1 : 0.34);
		}
		setDockOpen(false);
	}

	window.addEventListener('pointermove', move, { passive: true });
	document.addEventListener('pointerleave', rest);
	window.addEventListener('blur', rest);

	return {
		/** 지금 앞에 있는 카드에만 층위 시차를 준다 */
		setActive(i) {
			if (i === state.active) return;
			const prev = cardRigs[state.active];
			if (prev) {
				for (const l of prev.layers) {
					l.a.x(0, 600, 'out(3)');
					l.a.y(0, 600, 'out(3)');
				}
				prev.spot?.opacity(0);
			}
			state.active = i;
		},
		setDragging(on) {
			state.dragging = on;
			if (on) {
				// 끄는 동안엔 판이 손을 따라야 하므로 기울기를 풀어 준다
				rig.rotateX(0, 420, 'out(3)');
				rig.rotateY(0, 420, 'out(3)');
				rig.x(0, 420, 'out(3)');
				rig.y(0, 420, 'out(3)');
			}
		},
		rest,
		destroy() {
			clearTimeout(settleTimer);
			window.removeEventListener('pointermove', move);
			document.removeEventListener('pointerleave', rest);
			window.removeEventListener('blur', rest);
		},
	};
}
