// === 게임 상태 ===
const state = {
	playing: false,
	startTime: 0,
	elapsed: 0,
	hits: 0,
	misses: 0,
	nextSpawnIn: 0,
	targets: [], // 현재 화면에 떠있는 과녁
};

// === DOM 요소 ===
const arena = document.getElementById('arena');
const startScreen = document.getElementById('start-screen');
const endScreen = document.getElementById('end-screen');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');

const timeEl = document.getElementById('time');
const scoreEl = document.getElementById('score');
const missEl = document.getElementById('miss');
const finalTimeEl = document.getElementById('final-time');
const finalScoreEl = document.getElementById('final-score');

// === 설정 ===
const TARGET_SIZE = 80; // 과녁 크기 (px)
const TARGET_LIFETIME = 2000; // 과녁 수명 (ms)
const MARGIN = 60; // 화면 가장자리 여백

// 시간에 따라 스폰 간격이 짧아짐
function getSpawnInterval(elapsedSec) {
	// 시작: 1.2초마다 / 30초 후: 0.4초마다
	const min = 400;
	const max = 1200;
	const ratio = Math.min(elapsedSec / 30, 1);
	return max - (max - min) * ratio;
}

// === 게임 시작 ===
function startGame() {
	state.playing = true;
	state.startTime = performance.now();
	state.elapsed = 0;
	state.hits = 0;
	state.misses = 0;
	state.nextSpawnIn = 600; // 첫 과녁은 0.6초 후
	state.targets = [];

	startScreen.classList.add('hidden');
	endScreen.classList.add('hidden');

	updateUI();
	requestAnimationFrame(gameLoop);
}

// === 게임 종료 ===
function endGame() {
	state.playing = false;

	// 남은 과녁 다 제거
	state.targets.forEach(t => t.el.remove());
	state.targets = [];

	// 종료 화면 표시
	finalTimeEl.textContent = state.elapsed.toFixed(1);
	finalScoreEl.textContent = state.hits;
	endScreen.classList.remove('hidden');
}

// === UI 업데이트 ===
function updateUI() {
	timeEl.textContent = state.elapsed.toFixed(1);
	scoreEl.textContent = state.hits;
	missEl.textContent = `${state.misses} / 3`;
}

// === 과녁 생성 ===
function spawnTarget() {
	const arenaRect = arena.getBoundingClientRect();
	const x = MARGIN + Math.random() * (arenaRect.width - MARGIN * 2);
	const y = MARGIN + Math.random() * (arenaRect.height - MARGIN * 2);

	const el = document.createElement('div');
	el.className = 'target';
	el.style.left = `${x}px`;
	el.style.top = `${y}px`;

	const target = {
		el,
		spawnedAt: performance.now(),
		hit: false,
	};

	el.addEventListener('click', (e) => {
		e.stopPropagation();
		if (target.hit) return;
		target.hit = true;
		el.classList.add('hit');
		state.hits++;
		updateUI();
		// 애니메이션 끝나면 제거
		setTimeout(() => {
			el.remove();
			state.targets = state.targets.filter(t => t !== target);
		}, 200);
	});

	arena.appendChild(el);
	state.targets.push(target);
}

// === 게임 루프 ===
let lastFrame = 0;
function gameLoop(now) {
	if (!state.playing) return;

	const delta = lastFrame ? now - lastFrame : 0;
	lastFrame = now;

	state.elapsed = (now - state.startTime) / 1000;

	// 새 과녁 생성 타이머
	state.nextSpawnIn -= delta;
	if (state.nextSpawnIn <= 0) {
		spawnTarget();
		state.nextSpawnIn = getSpawnInterval(state.elapsed);
	}

	// 수명 다 된 과녁 처리 (놓침)
	const expired = state.targets.filter(
		t => !t.hit && now - t.spawnedAt > TARGET_LIFETIME
	);
	expired.forEach(t => {
		t.hit = true; // 더 이상 처리 안 하도록
		t.el.classList.add('missed');
		state.misses++;
		setTimeout(() => {
			t.el.remove();
			state.targets = state.targets.filter(x => x !== t);
		}, 300);
	});

	updateUI();

	// 게임 끝 체크
	if (state.misses >= 3) {
		endGame();
		return;
	}

	requestAnimationFrame(gameLoop);
}

// === 이벤트 리스너 ===
startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);