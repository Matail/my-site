/* 게임 덱 — 카드 한 장씩 넘기기.
 *
 * 원칙은 인트로와 같다: 화면에 보이는 모든 것은 "상태의 순수 함수"다.
 * 핵심 상태는 덱 위치 `pos` 하나 — 정수가 아니라 실수여서 드래그 중이든
 * 스프링으로 되돌아오는 중이든 같은 render() 한 개가 전부를 그린다. (0.5 면 반쯤 넘어간 상태)
 *
 * anime.js v4 에서는 스프링 감속과 stagger 만 빌려 쓰고, 매 프레임 그리는 일은 여기서 직접 한다.
 * 카드 자체에는 절대 opacity 를 걸지 않는다 — preserve-3d 가 납작해지면서
 * 뒤집힌 순간 뒷면 대신 거울상 앞면이 보이기 때문. 투명도는 앞/뒷면에만 준다.
 */
import { animate, createTimeline, spring, stagger, utils } from 'animejs';
import { createPointerRig } from './pointer.js';

/** 완전히 넘어간 카드의 회전각. 180 이 아니라 조금 못 미쳐야 두께가 보인다 */
const TURN_DEG = 162;
/** 뒤에 깔린 카드 한 장당 깊이 / 아래로 밀리는 양 */
const BEHIND_Z = 64;
const BEHIND_Y = 15;
/** 뒤로 몇 장까지 그릴지 */
const BEHIND_MAX = 3;
/** 드래그로 한 장을 완전히 넘기는 데 필요한 거리 (카드 폭 대비) */
const DRAG_SPAN = 0.62;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, v) => {
	const t = clamp((v - a) / (b - a), 0, 1);
	return t * t * (3 - 2 * t);
};
/** '#F32BC8' → [243, 43, 200] */
function hexRgb(hex) {
	const n = parseInt(hex.replace('#', ''), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function initDeck(root) {
	const scene = root.querySelector('[data-scene]');
	const stage = root.querySelector('[data-stage]');
	const tilt = root.querySelector('[data-tilt]');
	const cards = [...root.querySelectorAll('[data-card]')];
	const dots = [...root.querySelectorAll('[data-dot]')];
	const prevBtn = root.querySelector('[data-prev]');
	const nextBtn = root.querySelector('[data-next]');
	if (!scene || !stage || cards.length === 0) return;

	const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const last = cards.length - 1;

	/* 카드마다 한 번만 찾아두는 조각들. `enter` 는 등장 진행도(0→1)로, render 가 읽는다. */
	const parts = cards.map((el) => ({
		el,
		inner: el.querySelector('[data-inner]'),
		front: el.querySelector('.gcard-front'),
		back: el.querySelector('.gcard-back'),
		slab: el.querySelector('.gcard-slab'),
		dim: el.querySelector('.gcard-dim'),
		sheen: el.querySelector('.gcard-sheen'),
		art: el.querySelector('[data-art] img'),
		// 커서 시차용 층위 — pointer.js 가 이 요소들의 transform 을 가져간다
		artBox: el.querySelector('[data-art]'),
		lettering: el.querySelector('.gcard-lettering'),
		cta: el.querySelector('[data-cta]'),
		spot: el.querySelector('[data-spot]'),
		chars: [...el.querySelectorAll('.gcard-lettering .ch')],
		caps: [...el.querySelectorAll('[data-cap]')],
		accent: hexRgb(el.dataset.accent || '#FFB446'),
		enter: 0,
	}));

	const state = {
		pos: 0, // 실수 — 0.5 면 첫 장이 반쯤 넘어간 상태
		settled: 0, // 마지막으로 자리를 잡은 카드 번호
		dragging: false,
		justDragged: false,
	};

	/* 무대에 번지는 빛 색 — 카드가 바뀌면 이 값이 그 카드 색으로 흘러간다 */
	const wash = { r: 255, g: 180, b: 70 };

	/** 덱이 화면에 충분히 들어와 있나 — 휠/키보드를 가로챌지 판단한다 */
	function inView() {
		const r = stage.getBoundingClientRect();
		const overlap = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
		return overlap > Math.min(r.height, window.innerHeight) * 0.5;
	}

	// ────────────────────────────────────────────────────────────── 그리기
	function render(time) {
		const pos = state.pos;

		for (let i = 0; i < parts.length; i++) {
			const p = parts[i];
			const d = i - pos;

			let rotY = 0;
			let rotZ = 0;
			let tx = 0;
			let tz = 0;
			let ty = 0;
			let faceOp = 1;
			let dim = 0;
			let sheen = 0;
			let show = true;

			if (d < 0) {
				// 넘어가는 중 / 이미 넘어간 카드.
				// 90도를 넘어서면 뒷면이 보이고, 그때부터 왼쪽 아래로 빠지며 어둠에 녹는다.
				// 너무 오래 남겨두면 카드가 화면을 가로질러 섹션 제목까지 덮는다.
				const t = clamp(-d, 0, 1);
				const s = Math.sin(t * Math.PI); // 회전 한가운데서 최대
				rotY = -TURN_DEG * t;
				rotZ = -5 * t;
				tx = -t * t * 110;
				tz = s * 42; // 넘기는 동안 살짝 들린다
				ty = t * t * 46; // 그리고 아래로 떨어진다
				faceOp = 1 - smoothstep(0.6, 0.94, t);
				sheen = Math.pow(s, 1.6) * 0.9;
				show = -d < 1.02;
			} else {
				// 뒤에 깔려 차례를 기다리는 카드
				const k = Math.min(d, BEHIND_MAX);
				tz = -BEHIND_Z * k;
				ty = BEHIND_Y * k;
				dim = Math.min(k * 0.3, 0.76);
				show = d < BEHIND_MAX + 0.5;
			}

			// 처음 등장할 때: 위쪽 뒤에서 내려와 덱에 얹힌다
			const e = p.enter;
			if (e < 1) {
				const k = 1 - e;
				ty -= k * 54;
				tz -= k * 150;
				rotZ += k * 3;
				faceOp *= e;
				show = show && e > 0.001;
			}

			if (!show) {
				if (p.el.style.visibility !== 'hidden') p.el.style.visibility = 'hidden';
				continue;
			}
			if (p.el.style.visibility === 'hidden') p.el.style.visibility = '';

			p.el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, ${tz.toFixed(2)}px)`;
			p.inner.style.transform = `rotateY(${rotY.toFixed(2)}deg) rotateZ(${rotZ.toFixed(2)}deg)`;
			p.front.style.opacity = faceOp.toFixed(3);
			p.back.style.opacity = faceOp.toFixed(3);
			if (p.slab) p.slab.style.opacity = faceOp.toFixed(3);
			p.dim.style.opacity = dim.toFixed(3);
			if (p.sheen) p.sheen.style.opacity = sheen.toFixed(3);
			// 맨 앞에 자리잡은 카드만 클릭을 받는다 (뒤에 깔린 카드의 링크가 눌리면 안 된다)
			p.el.style.pointerEvents = i === state.settled && !state.dragging ? '' : 'none';
		}

		// 무대 빛
		root.style.setProperty('--wash', `${wash.r | 0}, ${wash.g | 0}, ${wash.b | 0}`);

		// 가만히 떠 있는 숨. 커서에 반응하는 기울기는 pointer.js 가 바깥 판에서 따로 준다.
		if (!reduce) {
			const t = time / 1000;
			const damp = state.dragging ? 0.3 : 1;
			const fy = Math.sin(t * 0.53) * 5 * damp;
			const rz = Math.sin(t * 0.31) * 0.35 * damp;
			scene.style.transform = `translateY(${fy.toFixed(2)}px) rotateZ(${rz.toFixed(2)}deg)`;
		}
	}

	let raf = 0;
	function loop(t) {
		render(t);
		raf = requestAnimationFrame(loop);
	}

	// ────────────────────────────────────────── 카드가 자리를 잡을 때의 등장 연출
	function playEnter(index, opts = {}) {
		const p = parts[index];
		if (!p) return;

		// 점 / 화살표 상태
		dots.forEach((dot, i) => {
			if (i === index) dot.setAttribute('aria-current', 'true');
			else dot.removeAttribute('aria-current');
		});
		if (prevBtn) prevBtn.disabled = index <= 0;
		if (nextBtn) nextBtn.disabled = index >= last;

		rig?.setActive(index);

		// 무대 빛을 이 카드 색으로 흘려보낸다
		const [r, g, b] = p.accent;
		animate(wash, { r, g, b, duration: reduce ? 10 : 700, ease: 'outQuad' });

		if (reduce) {
			if (p.chars.length) utils.set(p.chars, { opacity: 1, y: 0, rotate: 0, scale: 1 });
			if (p.caps.length) utils.set(p.caps, { opacity: 1, y: 0 });
			if (p.art) utils.set(p.art, { scale: 1.02 });
			return;
		}

		const at = opts.delay || 0;
		const tl = createTimeline({ defaults: { ease: 'out(3)' } });

		// 1. 키아트가 아주 천천히 제자리로 — 카드가 "숨 쉬는" 느낌
		if (p.art) {
			tl.add(p.art, { scale: [1.14, 1.02], duration: 1400, ease: 'out(4)' }, at);
		}

		// 2. 레터링이 글자 단위로 아래에서 튀어 올라온다 (지금은 글씨가 없어 비어 있다)
		if (p.chars.length) tl.add(
			p.chars,
			{
				opacity: [0, 1],
				y: [30, 0],
				rotate: [-7, 0],
				scale: [0.86, 1],
				delay: stagger(34),
				ease: spring({ bounce: 0.22, duration: 620 }),
			},
			at + 60
		);

		// 3. 캡션 줄이 차례로 들어온다 (지금은 캡션이 없어 비어 있다)
		if (p.caps.length) tl.add(
			p.caps,
			{
				opacity: [0, 1],
				y: [18, 0],
				duration: 700,
				delay: stagger(70),
				ease: 'out(3)',
			},
			at + 190
		);

		return tl;
	}

	/** 아직 차례가 아닌 카드의 글자·캡션은 미리 감춰둔다 */
	function resetEnter(index) {
		const p = parts[index];
		if (!p || reduce) return;
		if (p.chars.length) utils.set(p.chars, { opacity: 0, y: 30, rotate: -7, scale: 0.86 });
		if (p.caps.length) utils.set(p.caps, { opacity: 0, y: 18 });
	}

	// ────────────────────────────────────────────────────────────── 넘기기
	let posAnim = null;

	function goTo(index, opts = {}) {
		const target = clamp(Math.round(index), 0, last);
		if (posAnim) posAnim.pause();

		const changed = target !== state.settled;
		if (changed) resetEnter(target);

		const proxy = { p: state.pos };
		const params = {
			p: target,
			onUpdate: () => {
				state.pos = proxy.p;
			},
		};
		if (reduce) {
			params.duration = 1;
			params.ease = 'linear';
		} else {
			params.ease = spring({
				bounce: opts.soft ? 0.12 : 0.2,
				duration: opts.soft ? 420 : 620,
			});
		}
		posAnim = animate(proxy, params);

		if (changed) {
			state.settled = target;
			// 카드가 절반쯤 돌아갔을 때 글자가 올라오기 시작해야 자연스럽다
			playEnter(target, { delay: reduce ? 0 : 130 });
		}
	}

	const next = () => goTo(state.settled + 1);
	const prev = () => goTo(state.settled - 1);

	// ────────────────────────────────────────────────────────────── 드래그
	let drag = null;

	scene.addEventListener('pointerdown', (e) => {
		if (e.button !== 0) return;
		state.justDragged = false;
		// 버튼(화살표·독) 위에서 시작한 건 드래그가 아니다.
		// 카드 앞면은 링크지만 거기서도 끌 수 있어야 한다 — 끌고 난 뒤의 클릭은 아래에서 삼킨다.
		if (e.target.closest('button')) return;
		drag = {
			id: e.pointerId,
			x: e.clientX,
			y: e.clientY,
			from: state.settled,
			moved: false,
			t: performance.now(),
			vx: 0,
			lastX: e.clientX,
			captured: false,
		};
		if (posAnim) posAnim.pause();
	});

	/* 실제로 움직이기 시작한 순간에만 "끄는 중"으로 바꾼다.
	   누르자마자 포인터를 캡처하면 그 뒤의 click 이 캡처 대상(무대)으로 가 버려서
	   카드 링크에 닿지 않는다 — 즉 카드를 눌러도 게임이 안 열린다. */
	function beginDrag() {
		if (!drag || drag.captured) return;
		drag.captured = true;
		state.dragging = true;
		rig?.setDragging(true);
		scene.classList.add('is-grabbing');
		try {
			scene.setPointerCapture(drag.id);
		} catch {}
	}

	scene.addEventListener('pointermove', (e) => {
		if (!drag || e.pointerId !== drag.id) return;
		const dx = e.clientX - drag.x;
		const dy = e.clientY - drag.y;
		if (!drag.moved) {
			// 세로로 먼저 움직였으면 페이지 스크롤이다 — 덱은 손을 뗀다
			if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
				endDrag(true);
				return;
			}
			if (Math.abs(dx) < 4) return;
			drag.moved = true;
			beginDrag();
		}
		const now = performance.now();
		drag.vx = (e.clientX - drag.lastX) / Math.max(now - drag.t, 1);
		drag.lastX = e.clientX;
		drag.t = now;

		const span = scene.getBoundingClientRect().width * DRAG_SPAN;
		// 왼쪽으로 끌면 다음 장
		let p = drag.from - dx / span;
		// 양 끝에서는 고무줄처럼 버틴다
		if (p < 0) p *= 0.28;
		else if (p > last) p = last + (p - last) * 0.28;
		state.pos = clamp(p, -0.5, last + 0.5);
		e.preventDefault();
	});

	function endDrag(cancel) {
		if (!drag) return;
		const { moved, vx, from, id, captured } = drag;
		if (captured) {
			try {
				scene.releasePointerCapture(id);
			} catch {}
			state.dragging = false;
			rig?.setDragging(false);
			scene.classList.remove('is-grabbing');
		}
		drag = null;
		state.justDragged = moved;

		if (cancel || !moved) {
			goTo(from, { soft: true });
			return;
		}
		const delta = state.pos - from;
		// 충분히 끌었거나, 짧아도 빠르게 튕겼으면 넘어간다
		const flick = Math.abs(vx) > 0.55;
		const dir = Math.sign(delta || -vx);
		const target = Math.abs(delta) > 0.24 || (flick && dir === Math.sign(-vx)) ? from + dir : from;
		goTo(target, { soft: target === from });
	}

	scene.addEventListener('pointerup', () => endDrag(false));
	scene.addEventListener('pointercancel', () => endDrag(true));

	// 끌고 난 직후의 클릭은 삼킨다 (카드를 넘겼을 뿐인데 게임이 열리면 곤란)
	scene.addEventListener(
		'click',
		(e) => {
			if (state.justDragged) {
				e.preventDefault();
				e.stopPropagation();
				state.justDragged = false;
			}
		},
		true
	);

	// ────────────────────────────────────────────────────────────── 휠
	let wheelAcc = 0;
	let wheelLock = 0;

	stage.addEventListener(
		'wheel',
		(e) => {
			if (!inView()) return;
			const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
			const dir = Math.sign(delta);
			// 끝에 닿았으면 페이지 스크롤에 넘겨준다 — 붙잡지 않는다
			if ((dir > 0 && state.settled >= last) || (dir < 0 && state.settled <= 0)) return;

			e.preventDefault();
			const now = performance.now();
			if (now < wheelLock) return;
			wheelAcc += delta;
			if (Math.abs(wheelAcc) > 48) {
				wheelAcc = 0;
				wheelLock = now + 520;
				if (dir > 0) next();
				else prev();
			}
		},
		{ passive: false }
	);

	// ────────────────────────────────────────────────────────── 키보드 / 버튼
	nextBtn?.addEventListener('click', next);
	prevBtn?.addEventListener('click', prev);
	dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

	window.addEventListener('keydown', (e) => {
		if (!inView()) return;
		const t = e.target;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			next();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			prev();
		}
	});

	/* 커서에 반응하는 부분은 전부 여기 — 층마다 다른 속도로 따라온다 */
	const rig = tilt
		? createPointerRig({
				root,
				stage,
				tilt,
				parts,
				arrows: [prevBtn, nextBtn],
				dock: root.querySelector('[data-dock]'),
				dockItems: dots,
			})
		: null;

	// ─────────────────────────────────────────────── 처음 화면에 들어올 때 한 번
	parts.forEach((_, i) => resetEnter(i));
	if (reduce) parts.forEach((p) => (p.enter = 1));

	/* 덱이 화면에 들어올 때마다 지금 카드의 등장 연출을 다시 튼다.
	   처음 한 번은 카드를 깔아 놓는 dealIn, 그 뒤로는 화면 밖으로 완전히 나갔다가
	   돌아왔을 때만 다시 — 스크롤을 조금 흔든다고 매번 다시 돌면 산만하다. */
	/* 인트로가 도는 동안엔 깔지 않는다.
	   인트로의 노트북 화면 안에는 히어로까지만 들어 있어서, 미리 깔아 두면
	   화면이 사이트로 넘어가는 순간 카드가 이미 놓여 있다가 툭 나타난다.
	   인트로가 끝나는 바로 그 프레임에 깔리면 그게 곧 등장 연출이 된다. */
	const root$ = document.documentElement;
	let gated = root$.dataset.intro === 'on' && !root$.classList.contains('site-revealed');
	let pending = false;

	if (gated) {
		const mo = new MutationObserver(() => {
			if (root$.dataset.intro === 'on' && !root$.classList.contains('site-revealed')) return;
			mo.disconnect();
			gated = false;
			if (pending) {
				pending = false;
				dealt = true;
				away = false;
				dealIn();
			}
		});
		mo.observe(root$, { attributes: true, attributeFilter: ['class', 'data-intro'] });
	}

	let dealt = false;
	let away = true;
	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) {
					if (entry.intersectionRatio === 0) away = true;
					continue;
				}
				if (entry.intersectionRatio < 0.25) continue;
				if (gated) {
					pending = true;
					continue;
				}
				if (!dealt) {
					dealt = true;
					away = false;
					dealIn();
				} else if (away) {
					away = false;
					resetEnter(state.settled);
					playEnter(state.settled, { delay: 60 });
				}
			}
		},
		{ threshold: [0, 0.25] }
	);
	io.observe(stage);

	/** 덱이 처음 등장하는 연출 — 카드가 한 장씩 위에서 내려와 쌓인다 */
	function dealIn() {
		// 숨은 탭에서는 rAF 가 멈춰 있어서 연출이 중간에 굳는다 (카드가 안 보인 채로 남는다).
		// 새 탭으로 열어 둔 경우가 그렇다 — 보이게 될 때까지 미뤘다가 그때 깔기 시작한다.
		if (document.visibilityState !== 'visible') {
			document.addEventListener(
				'visibilitychange',
				() => {
					if (document.visibilityState === 'visible') dealIn();
				},
				{ once: true }
			);
			return;
		}
		if (reduce) {
			playEnter(0);
			return;
		}
		// 맨 뒤 카드부터 깔리고 1번 카드가 마지막에 얹힌다
		[...parts].reverse().forEach((p, n) => {
			animate(p, {
				enter: 1,
				delay: n * 130,
				ease: spring({ bounce: 0.18, duration: 720 }),
			});
		});
		playEnter(0, { delay: parts.length * 130 + 120 });
	}

	loop(performance.now());

	return {
		destroy() {
			cancelAnimationFrame(raf);
			io.disconnect();
			rig?.destroy();
		},
	};
}
