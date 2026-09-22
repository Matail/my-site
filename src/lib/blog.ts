/* 블로그 한 곳에서만 쓰는 상수와 계산.
   글의 줄(카테고리)·날짜 표기·읽는 시간처럼 여러 페이지가 똑같이 알아야 하는 것들이다. */
import type { CollectionEntry } from 'astro:content';

export type Category = 'devlog' | 'craft' | 'notes';

/** 블로그 첫 화면은 이 줄들로 나뉜다. 순서가 곧 화면에 쌓이는 순서다. */
export const CATEGORY_ORDER: Category[] = ['devlog', 'craft', 'notes'];

export const CATEGORIES: Record<Category, { label: string; en: string; blurb: string }> = {
	devlog: {
		label: '작업 기록',
		en: 'DEVLOG',
		blurb: '무엇을 만들었고, 왜 그렇게 만들었는지.',
	},
	craft: {
		label: '만드는 법',
		en: 'CRAFT',
		blurb: '화면 하나 만들자고 판 구덩이들. 다음에 또 빠지지 않으려고 적어둡니다.',
	},
	notes: {
		label: '딴생각',
		en: 'NOTES',
		blurb: '작업 사이에 흘린 메모.',
	},
};

/** 글 아래 붙는 이름. 인트로에 나오는 그 캐릭터가 얼굴이다. */
export const AUTHOR = { name: '심야 작업실', avatar: '/sprites/south.png' };

type Post = CollectionEntry<'blog'>;

export const byNewest = (a: Post, b: Post) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf();

/** 2026.09.18 — 자릿수가 고정이라 카드가 세로로 흔들리지 않는다 */
export function fmtDate(d: Date) {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** 한글은 분당 500자쯤 읽는다고 본다. 코드블록은 빼고 센다 */
export function readingTime(body = '') {
	const text = body.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, '');
	return Math.max(1, Math.round(text.length / 500));
}

/** 맨 위 큰 카드에 올릴 글 — featured 중 가장 최근, 없으면 그냥 가장 최근 */
export function pickFeatured(posts: Post[]) {
	const sorted = [...posts].sort(byNewest);
	return sorted.find((p) => p.data.featured) ?? sorted[0];
}
