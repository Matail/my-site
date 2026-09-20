import { clamp01, ease } from '../anim.js';

/* 노트북 화면 안에 그려지는 내용.
   꺼짐 → 부팅 로그 → 사이트 첫 화면 순서로 바뀐다.
   마지막 프레임의 구도를 실제 홈 화면과 비슷하게 맞춰서
   캔버스 → 진짜 DOM 전환이 튀지 않게 한다. */

export const SCREEN_W = 1280;
export const SCREEN_H = 800;

const SANS = "'Pretendard Variable', Pretendard, system-ui, sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const BOOT_LINES = [
	'> studio.init()',
	'> loading games ......... ok',
	'> loading notes ......... ok',
	'> lamp: on',
];

function roundRect(g, x, y, w, h, r) {
	g.beginPath();
	g.moveTo(x + r, y);
	g.arcTo(x + w, y, x + w, y + h, r);
	g.arcTo(x + w, y + h, x, y + h, r);
	g.arcTo(x, y + h, x, y, r);
	g.arcTo(x, y, x + w, y, r);
	g.closePath();
}

/** 글자 일부만 보여주는 타이핑 효과 */
function typed(text, p) {
	const n = Math.round(clamp01(p) * text.length);
	return text.slice(0, n);
}

export function createScreenCanvas() {
	const canvas = document.createElement('canvas');
	canvas.width = SCREEN_W;
	canvas.height = SCREEN_H;
	const g = canvas.getContext('2d');

	/** state: { power, boot, site, time } — 전부 0~1 */
	function draw(state) {
		const { power = 0, boot = 0, site = 0, time = 0 } = state;

		// 꺼진 패널: 완전한 검정이 아니라 아주 살짝 푸른 유리
		g.fillStyle = '#05050A';
		g.fillRect(0, 0, SCREEN_W, SCREEN_H);

		if (power <= 0.001) return;

		g.save();
		g.globalAlpha = clamp01(power);

		// 배경 (사이트와 동일한 색)
		g.fillStyle = '#0A0A0F';
		g.fillRect(0, 0, SCREEN_W, SCREEN_H);

		// 위쪽에서 내려오는 전등 빛
		const glow = g.createRadialGradient(SCREEN_W / 2, -180, 40, SCREEN_W / 2, -180, 900);
		glow.addColorStop(0, 'rgba(255,180,70,0.20)');
		glow.addColorStop(0.45, 'rgba(255,180,70,0.06)');
		glow.addColorStop(1, 'rgba(255,180,70,0)');
		g.fillStyle = glow;
		g.fillRect(0, 0, SCREEN_W, SCREEN_H);

		drawBoot(g, boot, site, time);
		drawSite(g, site, time);

		// 패널 반사 — 화면이 유리라는 걸 알려주는 얇은 사선
		const sheen = g.createLinearGradient(0, SCREEN_H, SCREEN_W * 0.75, 0);
		sheen.addColorStop(0, 'rgba(255,255,255,0)');
		sheen.addColorStop(0.62, 'rgba(255,255,255,0.028)');
		sheen.addColorStop(0.78, 'rgba(255,255,255,0)');
		g.fillStyle = sheen;
		g.fillRect(0, 0, SCREEN_W, SCREEN_H);

		g.restore();
	}

	function drawBoot(g, boot, site, time) {
		const a = clamp01(boot) * (1 - clamp01(site * 1.6));
		if (a <= 0.002) return;

		g.save();
		g.globalAlpha *= a;

		// 가운데 램프 점 + 워드마크
		const cx = SCREEN_W / 2;
		const cy = SCREEN_H / 2 - 40;
		const pulse = 0.75 + 0.25 * Math.sin(time * 5);

		g.fillStyle = 'rgba(255,180,70,' + (0.9 * pulse) + ')';
		g.shadowColor = 'rgba(255,180,70,0.85)';
		g.shadowBlur = 40;
		g.beginPath();
		g.arc(cx, cy - 46, 9, 0, Math.PI * 2);
		g.fill();
		g.shadowBlur = 0;

		g.fillStyle = '#EDEBE6';
		g.font = '700 34px ' + SANS;
		g.textAlign = 'center';
		g.fillText('my·site', cx, cy + 18);

		// 부팅 로그
		g.font = '400 15px ' + MONO;
		g.textAlign = 'left';
		const lineP = clamp01((boot - 0.2) / 0.62) * BOOT_LINES.length;
		for (let i = 0; i < BOOT_LINES.length; i++) {
			const p = clamp01(lineP - i);
			if (p <= 0) break;
			g.fillStyle = i === BOOT_LINES.length - 1 ? 'rgba(255,180,70,0.95)' : 'rgba(155,153,163,0.9)';
			g.fillText(typed(BOOT_LINES[i], p * 1.6), cx - 150, cy + 76 + i * 26);
		}

		// 진행 바
		const barW = 300;
		const barX = cx - barW / 2;
		const barY = cy + 190;
		g.fillStyle = 'rgba(255,255,255,0.08)';
		roundRect(g, barX, barY, barW, 3, 2);
		g.fill();
		g.fillStyle = 'rgba(255,180,70,0.95)';
		roundRect(g, barX, barY, barW * ease.out(clamp01(boot * 1.05)), 3, 2);
		g.fill();

		g.restore();
	}

	function drawSite(g, site, time) {
		const a = ease.out(clamp01(site));
		if (a <= 0.002) return;

		g.save();
		g.globalAlpha *= a;

		const M = 118; // 좌우 여백 — 실제 페이지의 본문 시작 위치와 맞춤
		const rise = (1 - a) * 26; // 아래에서 살짝 올라오며 나타남

		// --- 헤더 ---
		g.strokeStyle = 'rgba(255,255,255,0.05)';
		g.lineWidth = 1;
		g.beginPath();
		g.moveTo(0, 68.5);
		g.lineTo(SCREEN_W, 68.5);
		g.stroke();

		g.fillStyle = 'rgba(255,180,70,1)';
		g.shadowColor = 'rgba(255,180,70,0.8)';
		g.shadowBlur = 16;
		g.beginPath();
		g.arc(M + 9, 36, 5.5, 0, Math.PI * 2);
		g.fill();
		g.shadowBlur = 0;
		g.strokeStyle = 'rgba(52,52,63,0.9)';
		g.beginPath();
		g.moveTo(M + 9, 16);
		g.lineTo(M + 9, 28);
		g.stroke();

		g.fillStyle = '#EDEBE6';
		g.font = '700 17px ' + SANS;
		g.textAlign = 'left';
		g.fillText('my·site', M + 26, 42);

		g.font = '500 15px ' + SANS;
		g.fillStyle = '#9B99A3';
		const nav = ['게임', '블로그', '소개'];
		let nx = SCREEN_W - M - 92;
		for (let i = nav.length - 1; i >= 0; i--) {
			const w = g.measureText(nav[i]).width;
			nx -= w + 30;
			g.fillText(nav[i], nx, 42);
		}
		g.fillStyle = 'rgba(255,180,70,1)';
		roundRect(g, SCREEN_W - M - 78, 21, 78, 30, 15);
		g.fill();
		g.fillStyle = '#2A1703';
		g.font = '600 12px ' + MONO;
		g.fillText('PLAY ▶', SCREEN_W - M - 62, 41);

		// --- 히어로 ---
		const top = 188 + rise;

		g.fillStyle = 'rgba(255,180,70,1)';
		g.beginPath();
		g.arc(M + 4, top - 5, 4, 0, Math.PI * 2);
		g.fill();
		g.fillStyle = '#65646F';
		g.font = '500 12px ' + MONO;
		g.fillText('I N D I E   G A M E   S T U D I O', M + 18, top);

		g.font = '900 74px ' + SANS;
		g.fillStyle = '#EDEBE6';
		g.fillText('새벽 세 시,', M, top + 84);
		g.fillStyle = '#FFB446';
		g.fillText('불은 아직 켜져 있다.', M, top + 168);

		g.font = '400 17px ' + SANS;
		g.fillStyle = '#9B99A3';
		g.fillText('한 명이 만드는 작은 게임 스튜디오.', M, top + 224);
		g.fillText('브라우저에서 바로 즐기는 게임을 만들고, 만드는 과정을 남깁니다.', M, top + 252);

		// 버튼 두 개
		const by = top + 288;
		g.fillStyle = '#FFB446';
		roundRect(g, M, by, 148, 44, 22);
		g.fill();
		g.fillStyle = '#2A1703';
		g.font = '600 15px ' + SANS;
		g.fillText('게임 플레이', M + 30, by + 28);

		g.strokeStyle = 'rgba(52,52,63,1)';
		g.lineWidth = 1;
		roundRect(g, M + 160, by, 148, 44, 22);
		g.stroke();
		g.fillStyle = '#EDEBE6';
		g.fillText('작업 기록', M + 197, by + 28);

		// --- 카드 세 장 (살짝 늦게 올라옴) ---
		const cardA = ease.out(clamp01((site - 0.35) / 0.65));
		if (cardA > 0.002) {
			g.save();
			g.globalAlpha *= cardA;
			const cw = (SCREEN_W - M * 2 - 40) / 3;
			const cy2 = top + 372 + (1 - cardA) * 18;
			const accents = ['#FFB446', '#C8F45C', '#57C7F5'];
			const titles = ['Aimbooster', 'Coming Soon', 'Devlog'];
			for (let i = 0; i < 3; i++) {
				const x = M + i * (cw + 20);
				g.fillStyle = '#101017';
				roundRect(g, x, cy2, cw, 132, 14);
				g.fill();
				g.strokeStyle = 'rgba(34,34,46,1)';
				g.lineWidth = 1;
				g.stroke();

				g.fillStyle = accents[i];
				g.globalAlpha *= 0.22;
				roundRect(g, x + 1, cy2 + 1, cw - 2, 44, 13);
				g.fill();
				g.globalAlpha /= 0.22;

				g.fillStyle = '#EDEBE6';
				g.font = '700 16px ' + SANS;
				g.fillText(titles[i], x + 18, cy2 + 76);
				g.fillStyle = '#65646F';
				g.font = '400 13px ' + SANS;
				g.fillText('바로 플레이 →', x + 18, cy2 + 100);
			}
			g.restore();
		}

		g.restore();
	}

	return { canvas, draw };
}
