/* 좌우로만 움직이는 영역(선반 · 글 읽는 칸)의 공통 동작.
   하나뿐이다: 세로 휠을 가로로 돌리고, 양 끝에 닿았는지 알려준다.
   (마우스에는 가로 휠이 없다. 트랙패드의 가로 스크롤 deltaX 는 건드리지 않는다.) */
export function initHScroll(root = document) {
	root.querySelectorAll('[data-hscroll]').forEach((el) => {
		if (el.dataset.hscrollBound === '1') return;
		el.dataset.hscrollBound = '1';

		const wrap = el.closest('[data-hscroll-wrap]') ?? el.parentElement;

		const mark = () => {
			if (!wrap) return;
			const max = el.scrollWidth - el.clientWidth;
			wrap.dataset.atStart = String(el.scrollLeft <= 1);
			wrap.dataset.atEnd = String(max <= 1 || el.scrollLeft >= max - 1);
		};

		mark();
		el.addEventListener('scroll', mark, { passive: true });
		window.addEventListener('resize', mark);
		/* 글꼴이 늦게 오면 칸 수가 바뀐다 */
		if (document.fonts) document.fonts.ready.then(mark);

		el.addEventListener(
			'wheel',
			(e) => {
				if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
				const max = el.scrollWidth - el.clientWidth;
				if (max <= 1) return;
				e.preventDefault();
				el.scrollLeft += e.deltaY;
			},
			{ passive: false }
		);

		/* 탭으로 링크를 옮겨 다닐 때 그 링크가 화면 안으로 들어오게 한다 */
		el.addEventListener('focusin', (e) => {
			const target = e.target;
			if (target && target !== el && target.scrollIntoView) {
				target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			}
		});
	});
}
