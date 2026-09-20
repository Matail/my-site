import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clamp01, lerp, snoise } from '../anim.js';

/* 무대: 아무것도 없는 어두운 방 + 천장에 매달린 전등 하나.
   캐릭터와 노트북은 별도 모듈에서 이 무대 위에 올린다. */

const BG = 0x050508;

function radialSprite() {
	const c = document.createElement('canvas');
	c.width = c.height = 128;
	const g = c.getContext('2d');
	const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
	grad.addColorStop(0, 'rgba(255,224,176,1)');
	grad.addColorStop(0.35, 'rgba(255,190,110,0.55)');
	grad.addColorStop(1, 'rgba(255,170,60,0)');
	g.fillStyle = grad;
	g.fillRect(0, 0, 128, 128);
	const tex = new THREE.CanvasTexture(c);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

/** 전등 불빛 원뿔 — 공기 중 먼지에 빛이 걸린 느낌 */
function makeLightCone(height, radius) {
	const geo = new THREE.ConeGeometry(radius, height, 64, 1, true);
	geo.translate(0, -height / 2, 0); // 꼭짓점이 원점(전구)에 오도록
	const mat = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide,
		uniforms: {
			uOpacity: { value: 0 },
			uColor: { value: new THREE.Color(0xffb44a) },
		},
		vertexShader: `
			varying vec2 vUv;
			varying vec3 vNormalW;
			varying vec3 vViewDir;
			void main() {
				vUv = uv;
				vec4 world = modelMatrix * vec4(position, 1.0);
				vNormalW = normalize(mat3(modelMatrix) * normal);
				vViewDir = normalize(cameraPosition - world.xyz);
				gl_Position = projectionMatrix * viewMatrix * world;
			}
		`,
		fragmentShader: `
			uniform float uOpacity;
			uniform vec3 uColor;
			varying vec2 vUv;
			varying vec3 vNormalW;
			varying vec3 vViewDir;
			void main() {
				// 옆면을 비스듬히 볼수록 밝게 — 부피감
				float rim = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir)));
				float body = pow(rim, 2.4);
				// 전구에서 멀어질수록 옅어짐
				float fall = pow(1.0 - vUv.y, 1.4);
				float a = body * fall * uOpacity;
				if (a < 0.002) discard;
				gl_FragColor = vec4(uColor, a * 0.075);
			}
		`,
	});
	return new THREE.Mesh(geo, mat);
}

/** 빛 속을 떠다니는 먼지 */
function makeDust(count, radius, height) {
	const pos = new Float32Array(count * 3);
	const seed = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		const r = Math.sqrt(Math.random()) * radius;
		const a = Math.random() * Math.PI * 2;
		pos[i * 3] = Math.cos(a) * r;
		pos[i * 3 + 1] = Math.random() * height;
		pos[i * 3 + 2] = Math.sin(a) * r;
		seed[i] = Math.random() * 100;
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
	const mat = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		uniforms: {
			uTime: { value: 0 },
			uOpacity: { value: 0 },
			uSize: { value: 15 * Math.min(window.devicePixelRatio || 1, 2) },
		},
		vertexShader: `
			attribute float aSeed;
			uniform float uTime;
			uniform float uSize;
			varying float vFade;
			void main() {
				vec3 p = position;
				p.y += mod(uTime * 0.045 + aSeed * 0.37, 1.0) * 2.2 - 1.1;
				p.x += sin(uTime * 0.28 + aSeed) * 0.06;
				p.z += cos(uTime * 0.22 + aSeed * 1.7) * 0.06;
				vec4 mv = modelViewMatrix * vec4(p, 1.0);
				gl_PointSize = uSize / max(-mv.z, 0.35);
				gl_Position = projectionMatrix * mv;
				vFade = 0.35 + 0.65 * abs(sin(uTime * 0.7 + aSeed * 2.1));
			}
		`,
		fragmentShader: `
			uniform float uOpacity;
			varying float vFade;
			void main() {
				vec2 d = gl_PointCoord - vec2(0.5);
				float a = smoothstep(0.5, 0.0, length(d));
				gl_FragColor = vec4(1.0, 0.86, 0.66, a * a * vFade * uOpacity * 0.3);
			}
		`,
	});
	return new THREE.Points(geo, mat);
}

export function createStage(canvas) {
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		powerPreference: 'high-performance',
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.08;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	renderer.setClearColor(BG, 1);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(BG);
	scene.fog = new THREE.FogExp2(BG, 0.2);

	const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 80);
	camera.position.set(1.05, 0.92, 3.15);
	camera.lookAt(0, 0.62, 0);

	/* --- 바닥 --- */
	const floorGeo = new THREE.CircleGeometry(16, 64);
	floorGeo.rotateX(-Math.PI / 2);
	const floor = new THREE.Mesh(
		floorGeo,
		new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.82, metalness: 0.06 })
	);
	floor.receiveShadow = true;
	scene.add(floor);

	/* --- 전등 --- */
	const LAMP_Y = 2.45;
	const lamp = new THREE.Group();
	lamp.position.set(0, LAMP_Y, 0.15);
	scene.add(lamp);

	const cord = new THREE.Mesh(
		new THREE.CylinderGeometry(0.006, 0.006, 3.2, 6),
		new THREE.MeshStandardMaterial({ color: 0x17171d, roughness: 1 })
	);
	cord.position.y = 1.6;
	lamp.add(cord);

	const socket = new THREE.Mesh(
		new THREE.CylinderGeometry(0.045, 0.038, 0.1, 16),
		new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.6, metalness: 0.4 })
	);
	socket.position.y = 0.055;
	lamp.add(socket);

	// 전구 유리
	const bulbMat = new THREE.MeshStandardMaterial({
		color: 0x2b2116,
		emissive: new THREE.Color(0xffb44a),
		emissiveIntensity: 0,
		roughness: 0.25,
		metalness: 0,
		transparent: true,
		opacity: 0.96,
	});
	const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.062, 24, 18), bulbMat);
	bulb.position.y = -0.03;
	bulb.scale.y = 1.25;
	lamp.add(bulb);

	// 필라멘트
	const filamentMat = new THREE.MeshBasicMaterial({
		color: 0xffd9a0,
		transparent: true,
		opacity: 0,
	});
	const filament = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0045, 6, 14), filamentMat);
	filament.position.y = -0.03;
	filament.rotation.x = Math.PI / 2;
	lamp.add(filament);

	// 전구 번짐
	const halo = new THREE.Sprite(
		new THREE.SpriteMaterial({
			map: radialSprite(),
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			transparent: true,
			opacity: 0,
		})
	);
	halo.scale.setScalar(1.1);
	halo.position.y = -0.03;
	lamp.add(halo);

	// 실제 조명
	const spot = new THREE.SpotLight(0xffc071, 0, 9, 0.66, 0.85, 1.6);
	spot.position.set(0, -0.03, 0);
	spot.target.position.set(0, -LAMP_Y, -0.15);
	spot.castShadow = true;
	spot.shadow.mapSize.set(1024, 1024);
	spot.shadow.camera.near = 0.3;
	spot.shadow.camera.far = 8;
	spot.shadow.bias = -0.0012;
	spot.shadow.radius = 3;
	lamp.add(spot);
	lamp.add(spot.target);

	const cone = makeLightCone(2.9, 1.35);
	cone.position.y = -0.03;
	lamp.add(cone);

	const dust = makeDust(150, 0.95, 2.1);
	dust.position.set(0, 0.15, 0.15);
	scene.add(dust);

	/* --- 보조광 --- */
	// 검은 후드가 배경에 묻히지 않게 뒤에서 윤곽을 살짝 준다
	const rimCool = new THREE.PointLight(0x6f86c9, 0, 12, 2);
	rimCool.position.set(-2.4, 1.5, -2.2);
	scene.add(rimCool);

	const rimWarm = new THREE.PointLight(0xffa552, 0, 12, 2);
	rimWarm.position.set(2.6, 1.2, -1.9);
	scene.add(rimWarm);

	const ambient = new THREE.HemisphereLight(0x2a2e46, 0x050507, 0);
	scene.add(ambient);

	// 후드 속 얼굴이 완전히 죽지 않게 앞에서 아주 약하게 받쳐준다
	const faceFill = new THREE.PointLight(0xffd9b0, 0, 4, 2);
	faceFill.position.set(0.55, 1.15, 1.5);
	scene.add(faceFill);

	// 노트북 화면이 켜지면 얼굴을 비추는 빛
	const screenLight = new THREE.PointLight(0xbfd6ff, 0, 2.4, 2);
	scene.add(screenLight);

	/* --- 환경맵 ---
	   빛이 하나뿐이면 검은 후드와 금속 표면이 형태를 잃는다.
	   아주 약한 실내 환경을 깔아 반사로 실루엣을 살린다. */
	const pmrem = new THREE.PMREMGenerator(renderer);
	const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
	scene.environment = envRT.texture;
	scene.environmentIntensity = 0.035;
	pmrem.dispose();

	/* --- 포스트 프로세싱 ---
	   블룸(전구/화면이 진짜 빛나 보이게) → 톤매핑 → 비네트·그레인·색수차 */
	const msaa = renderer.capabilities.isWebGL2 ? 4 : 0;
	const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
		type: THREE.HalfFloatType,
		samples: msaa,
	});
	const composer = new EffectComposer(renderer, composerTarget);

	composer.addPass(new RenderPass(scene, camera));

	// 얕은 심도 — 피사체만 또렷하고 배경은 풀어진다
	const bokeh = new BokehPass(scene, camera, {
		focus: 2.6,
		aperture: 0.0012,
		maxblur: 0.006,
	});
	composer.addPass(bokeh);

	const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.42, 0.92);
	composer.addPass(bloom);

	composer.addPass(new OutputPass());

	const gradePass = new ShaderPass({
		uniforms: {
			tDiffuse: { value: null },
			uTime: { value: 0 },
			uVignette: { value: 1.35 },
			uGrain: { value: 0.05 },
			uAberration: { value: 0.5 },
		},
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform sampler2D tDiffuse;
			uniform float uTime;
			uniform float uVignette;
			uniform float uGrain;
			uniform float uAberration;
			varying vec2 vUv;

			void main() {
				vec2 d = vUv - 0.5;
				float r2 = dot(d, d);

				// 가장자리로 갈수록 채널이 아주 살짝 어긋난다 (렌즈 느낌)
				float ab = uAberration * r2 * 0.02;
				vec4 c;
				c.r = texture2D(tDiffuse, vUv + d * ab).r;
				c.g = texture2D(tDiffuse, vUv).g;
				c.b = texture2D(tDiffuse, vUv - d * ab).b;
				c.a = 1.0;

				// 비네트
				float vig = smoothstep(0.75, 0.05, r2 * uVignette);
				c.rgb *= mix(1.0, vig, 0.9);

				// 필름 그레인 — 어두운 부분의 밴딩도 같이 감춘다
				float n = fract(sin(dot(vUv * 937.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
				c.rgb += (n - 0.5) * uGrain;

				gl_FragColor = c;
			}
		`,
	});
	composer.addPass(gradePass);

	/* --- 상태 적용 --- */
	const state = { lamp: 0, cone: 0, dust: 0 };

	function setLamp(v) {
		state.lamp = v;
		spot.intensity = 30 * v;
		bulbMat.emissiveIntensity = 3.4 * v;
		filamentMat.opacity = clamp01(v * 1.4);
		halo.material.opacity = 0.9 * v;
		halo.scale.setScalar(lerp(0.7, 1.25, clamp01(v)));
		rimCool.intensity = 2.6 * v;
		rimWarm.intensity = 2.0 * v;
		ambient.intensity = 0.55 * v;
		faceFill.intensity = 1.1 * v;
		cone.material.uniforms.uOpacity.value = state.cone * v;
		dust.material.uniforms.uOpacity.value = state.dust * v;
	}

	function setAtmosphere(coneOpacity, dustOpacity) {
		state.cone = coneOpacity;
		state.dust = dustOpacity;
		cone.material.uniforms.uOpacity.value = coneOpacity * state.lamp;
		dust.material.uniforms.uOpacity.value = dustOpacity * state.lamp;
	}

	function setScreenLight(v, position) {
		screenLight.intensity = 0.3 * v;
		if (position) screenLight.position.copy(position);
	}

	/** 초점 거리(월드 단위)와 흐림 정도 */
	function setFocus(distance, blur = 1) {
		bokeh.uniforms.focus.value = Math.max(0.05, distance);
		bokeh.uniforms.maxblur.value = 0.0075 * blur;
		bokeh.uniforms.aperture.value = 0.0016 * blur;
	}

	function setBloom(strength) {
		bloom.strength = strength;
	}

	/** 비네트/그레인 — 화면 속으로 들어갈 땐 걷어내야 진짜 사이트와 이질감이 없다 */
	function setGrade(vignette, grain) {
		gradePass.uniforms.uVignette.value = vignette;
		gradePass.uniforms.uGrain.value = grain;
	}

	function tick(time) {
		dust.material.uniforms.uTime.value = time;
		gradePass.uniforms.uTime.value = time;
	}

	function render() {
		composer.render();
	}

	function resize() {
		const w = Math.max(1, canvas.clientWidth || window.innerWidth || 1);
		const h = Math.max(1, canvas.clientHeight || window.innerHeight || 1);
		renderer.setSize(w, h, false);
		composer.setSize(w, h);
		bloom.setSize(w, h);
		camera.aspect = w / h;
		// 세로로 긴 화면(모바일)에서는 시야를 넓혀야 인물과 노트북이 프레임에 들어온다
		camera.fov = camera.aspect < 1 ? lerp(38, 64, clamp01((1 - camera.aspect) / 0.55)) : 38;
		camera.updateProjectionMatrix();
		return { w, h };
	}

	/** 아주 미세한 손떨림 — 카메라가 살아 있는 느낌 */
	function handheld(time, amount = 1) {
		return {
			x: snoise(time * 0.55) * 0.012 * amount,
			y: snoise(time * 0.47 + 31.4) * 0.009 * amount,
		};
	}

	function dispose() {
		scene.traverse((o) => {
			if (o.geometry) o.geometry.dispose();
			if (o.material) {
				const mats = Array.isArray(o.material) ? o.material : [o.material];
				mats.forEach((m) => {
					for (const key of Object.keys(m)) {
						const v = m[key];
						if (v && v.isTexture) v.dispose();
					}
					m.dispose();
				});
			}
		});
		composer.dispose();
		composerTarget.dispose();
		envRT.dispose();
		renderer.dispose();
	}

	setLamp(0);
	setAtmosphere(0, 0);

	return {
		renderer,
		scene,
		camera,
		lamp,
		spot,
		floor,
		setLamp,
		setAtmosphere,
		setScreenLight,
		setFocus,
		setBloom,
		setGrade,
		handheld,
		tick,
		render,
		resize,
		dispose,
	};
}
