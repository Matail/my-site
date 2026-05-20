import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		pubDate: z.coerce.date(),
		updatedDate: z.coerce.date().optional(),
		tags: z.array(z.string()).optional(),
	}),
});

const games = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/games' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		// 카드에 보여줄 짧은 설명
		shortDescription: z.string().optional(),
		// 게임 URL: 내부면 /games/xxx/, 외부면 https://...
		url: z.string(),
		// 'internal' (같은 사이트) / 'external' (서브도메인 등)
		type: z.enum(['internal', 'external']).default('internal'),
		// 게임 엔진: html, unity, unreal, godot 등
		engine: z.string().optional(),
		// 색상 (카드 썸네일 배경) — 'lime', 'pink', 'cyan' 중 하나
		color: z.enum(['lime', 'pink', 'cyan']).default('lime'),
		// 이모지 또는 짧은 텍스트 (썸네일에 표시)
		thumb: z.string().default('🎮'),
		// 태그
		tags: z.array(z.string()).optional(),
		// 출시일
		releaseDate: z.coerce.date(),
		// 상태: published(공개), wip(작업중), planned(계획중)
		status: z.enum(['published', 'wip', 'planned']).default('published'),
	}),
});

export const collections = { blog, games };