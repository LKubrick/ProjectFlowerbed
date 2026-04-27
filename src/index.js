/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable sort-imports */

import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap';
import './styles/index.css';
import './styles/about.css';
import './styles/overlay.css';

import * as THREE from 'three';
import * as TWEEN from '@tweenjs/tween.js';
import {
	acceleratedRaycast,
	computeBoundsTree,
	disposeBoundsTree,
} from 'three-mesh-bvh';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { CapsuleColliderComponent } from './js/components/ColliderComponents';
import {
	createPlayerTransform,
	PlayerColliderComponent,
	PlayerStateComponent,
} from './js/components/PlayerStateComponent';
import { DEBUG_CONSTANTS, THREEJS_LAYERS } from './js/Constants';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { GameStateComponent } from './js/components/GameStateComponent';
import {
	initializeCache,
	setupFetchWithCache,
} from './js/lib/caching/fetchWithCache';
import { LoopingAudioComponent } from './js/components/AudioComponents';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SessionComponent } from './js/components/SessionComponent';
import { setupECSY } from './js/ECSYConfig';
import { setupRouter } from './js/LandingPage';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { THREEGlobalComponent } from './js/components/THREEGlobalComponent';
import { XPlatControlSystem } from './js/systems/xplat/xplat';
import { XRDevice, metaQuest3 } from 'iwer';
import ThreeMeshUI from 'three-mesh-ui';

/* eslint-enable sort-imports */

const prepare = async () => {
	let xrdevice;
	const nativeVRSupport = navigator.xr
		? await navigator.xr.isSessionSupported('immersive-vr')
		: false;
	if (!nativeVRSupport) {
		xrdevice = new XRDevice(metaQuest3);
		xrdevice.ipd = 0;
		xrdevice.fovy = Math.PI / 3;
		xrdevice.installRuntime();
	}
	window.xrdevice = xrdevice;
	return xrdevice;
};

const MAX_RENDER_PIXEL_RATIO = 2;

function getClampedPixelRatio() {
	return Math.min(window.devicePixelRatio || 1, MAX_RENDER_PIXEL_RATIO);
}

function updatePostProcessingSize(postProcessing, width, height, pixelRatio) {
	if (!postProcessing) {
		return;
	}

	if (postProcessing.composer.setPixelRatio) {
		postProcessing.composer.setPixelRatio(pixelRatio);
	}
	postProcessing.composer.setSize(width, height);

	postProcessing.fxaaPass.material.uniforms.resolution.value.set(
		1 / (width * pixelRatio),
		1 / (height * pixelRatio),
	);

	if (postProcessing.bokehPass?.setSize) {
		postProcessing.bokehPass.setSize(width, height);
	} else if (postProcessing.bokehPass) {
		postProcessing.bokehPass.renderTargetDepth.setSize(
			width * pixelRatio,
			height * pixelRatio,
		);
		postProcessing.bokehPass.uniforms.aspect.value = width / height;
	}
}

function createPostProcessing(renderer, scene, camera, width, height) {
	const composer = new EffectComposer(renderer);
	const renderPass = new RenderPass(scene, camera);
	composer.addPass(renderPass);

	const ssaoPass = new SSAOPass(scene, camera, width, height);
	ssaoPass.kernelRadius = 0.1;
	ssaoPass.minDistance = 0.001;
	ssaoPass.maxDistance = 0.02;
	composer.addPass(ssaoPass);

	const bloomPass = new UnrealBloomPass(
		new THREE.Vector2(width, height),
		0.4,
		0.6,
		0.85,
	);
	bloomPass.threshold = 0.85;
	bloomPass.strength = 0.4;
	bloomPass.radius = 0.6;
	composer.addPass(bloomPass);

	let bokehPass = null;
	let focusTarget = null;
	if (DEBUG_CONSTANTS.USE_MINIMAL_PLANT_BED_SCENE) {
		focusTarget = new THREE.Vector3(0, 0.8, -19.5);
		bokehPass = new BokehPass(scene, camera, {
			focus: focusTarget.distanceTo(camera.position),
			aperture: 0.00002,
			maxblur: 0.01,
			width,
			height,
		});
		composer.addPass(bokehPass);
	}

	const filmPass = new FilmPass(0.15, 0, 0, false);
	composer.addPass(filmPass);

	const fxaaPass = new ShaderPass(FXAAShader);
	composer.addPass(fxaaPass);

	const postProcessing = {
		composer,
		ssaoPass,
		bloomPass,
		filmPass,
		fxaaPass,
		bokehPass,
		focusTarget,
	};

	updatePostProcessingSize(
		postProcessing,
		width,
		height,
		getClampedPixelRatio(),
	);

	return postProcessing;
}

prepare().then((xrdevice) => {
	// need to load the pages before we load any 3D stuff
	setupRouter();

	const world = setupECSY();
	const clock = new THREE.Clock();
	let global_scene = null;
	const AUDIT_MATRIX_UPDATES = false;
	window.__flowerbedDebug = {
		world,
		get scene() {
			return global_scene;
		},
		renderer: null,
		camera: null,
	};

	// three-mesh-bvh initialization
	THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
	THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
	THREE.Mesh.prototype.raycast = acceleratedRaycast;

	initializeCache()
		.then(() => {
			setupFetchWithCache();
			init();
		})
		.catch((e) => {
			console.warn(e);
			// no cache, but we should still initialize the rest of the experience
			init();
		});

	function init() {
		let container = document.getElementById('scene-container');

		// set autoupdate to false! we'll set autoupdate on stuff that needs it, and manually update other things
		THREE.Object3D.DefaultMatrixAutoUpdate = false;

		let scene = new THREE.Scene();
		scene.background = null;

		global_scene = scene;

		let renderer = new THREE.WebGLRenderer({
			antialias: false,
			multiviewStereo: true,
			// precision: "mediump",
		});
		renderer.setPixelRatio(getClampedPixelRatio());
		renderer.setSize(container.offsetWidth, container.offsetHeight);
		renderer.outputEncoding = THREE.sRGBEncoding;
		renderer.xr.enabled = true;
		const xrCamera = renderer.xr.getCamera();
		xrCamera.matrixAutoUpdate = true;
		xrCamera.layers.enable(THREEJS_LAYERS.VIEWER_ONLY);
		renderer.debug.checkShaderErrors = false;
		renderer.domElement.style.width = '100%';
		renderer.domElement.style.height = '100%';

		const opaqueSort = (a, b) => {
			if (a.groupOrder !== b.groupOrder) {
				return a.groupOrder - b.groupOrder;
			} else if (a.renderOrder !== b.renderOrder) {
				return a.renderOrder - b.renderOrder;
			} else if (a.material.id !== b.material.id) {
				if (a.material.sort_z === b.material.sort_z) {
					return a.material.id - b.material.id;
				}
				return a.material.sort_z - b.material.sort_z;
			} else if (a.z !== b.z) {
				return a.z - b.z;
			} else {
				return a.id - b.id;
			}
		};

		const transparentSort = (a, b) => {
			if (a.groupOrder !== b.groupOrder) {
				return a.groupOrder - b.groupOrder;
			} else if (a.renderOrder !== b.renderOrder) {
				return a.renderOrder - b.renderOrder;
			} else if (a.z !== b.z) {
				return b.z - a.z;
			} else {
				return a.id - b.id;
			}
		};

		renderer.setOpaqueSort(opaqueSort);
		renderer.setTransparentSort(transparentSort);

		// turn autoClear back on temporarily - requires a browser that has D38378146
		// or else this line causes a black screen
		// renderer.autoClear = false;
		container.appendChild(renderer.domElement);

		let camera = new THREE.PerspectiveCamera(
			50,
			container.offsetWidth / container.offsetHeight,
			0.1,
			800,
		);
		const postProcessing = createPostProcessing(
			renderer,
			scene,
			camera,
			container.offsetWidth,
			container.offsetHeight,
		);

		window.__flowerbedDebug.renderer = renderer;
		window.__flowerbedDebug.camera = camera;
		window.__flowerbedDebug.postProcessing = postProcessing;

		camera.position.set(0, 1.6, 0);
		camera.layers.enable(THREEJS_LAYERS.VIEWER_ONLY);
		camera.matrixAutoUpdate = true;

		let gameManager = world.createEntity();

		gameManager.addComponent(GameStateComponent, {
			allAssetsLoaded: false,
		});

		gameManager.addComponent(SessionComponent);

		gameManager.addComponent(THREEGlobalComponent, {
			renderer: renderer,
			scene: scene,
			camera: camera,
			postProcessing,
		});

		if (xrdevice) {
			world.registerSystem(XPlatControlSystem, { xrdevice });
		}

		const player = world.createEntity();
		const playerHead = new THREE.Group();
		playerHead.frustumCulled = false;
		const viewerTransform = createPlayerTransform(scene, camera);
		viewerTransform.add(playerHead);
		player.addComponent(PlayerStateComponent, {
			viewerTransform: viewerTransform,
			playerHead: playerHead,
			expectedMovement: new THREE.Vector3(),
			deltaMovement: new THREE.Vector3(),
		});
		player.addComponent(PlayerColliderComponent, {
			velocity: new THREE.Vector3(),
			lastSlopeNormal: new THREE.Vector3(),
		});
		player.addComponent(CapsuleColliderComponent, {
			radius: 0.5,

			// this creates a capsule of height 2, since the line segment
			// of a capsule is the height of the cylinder portion, and we add the
			// two sphere halves on either end.
			lineSegment: new THREE.Line3(
				new THREE.Vector3(0, 0.5),
				new THREE.Vector3(0, 1.5, 0),
			),
		});

		renderer.xr.addEventListener('sessionstart', function () {
			const xrSession = renderer.xr.getSession();

			let targetFrameRate = 72;
			if (xrSession.updateTargetFrameRate) {
				xrSession.updateTargetFrameRate(targetFrameRate);
				console.log('Frame rate updated to ' + targetFrameRate);
			} else {
				console.log('Update target frame not supported');
			}
		});

		window.addEventListener('experienceend', function () {
			gameManager.removeComponent(LoopingAudioComponent);
			document.body.style.overflow = 'auto';
		});

		window.addEventListener('experiencestart', function () {
			// hide scrollbars on body
			document.body.style.overflow = 'hidden';
		});

		function onWindowResize() {
			camera.aspect = container.offsetWidth / container.offsetHeight;
			camera.updateProjectionMatrix();

			renderer.setPixelRatio(getClampedPixelRatio());
			renderer.setSize(container.offsetWidth, container.offsetHeight);
			updatePostProcessingSize(
				postProcessing,
				container.offsetWidth,
				container.offsetHeight,
				getClampedPixelRatio(),
			);
		}

		window.addEventListener('resize', onWindowResize, false);
		window.goFullScreen = () => {
			const vw = Math.max(
				document.documentElement.clientWidth || 0,
				window.innerWidth || 0,
			);
			const vh = Math.max(
				document.documentElement.clientHeight || 0,
				window.innerHeight || 0,
			);

			camera.aspect = vw / vh;
			camera.updateProjectionMatrix();

			renderer.setPixelRatio(getClampedPixelRatio());
			renderer.setSize(vw, vh);
			updatePostProcessingSize(
				postProcessing,
				vw,
				vh,
				getClampedPixelRatio(),
			);
		};

		renderer.setAnimationLoop(render);
	}

	function render() {
		// cap delta at 0.1 to avoid the player falling through the floor on big framerate gaps.
		// This is the solution that is used in three-mesh-bvh's physics example, and is good enough
		// to keep physics from making massive jumps as a result of slow frames.
		// However, this also means that the physics themselves will slow down during those slow frames.
		// TODO: implement a way to separate rendering and physics logic.
		// See https://gafferongames.com/post/fix_your_timestep/ for some principles around this.
		const delta = Math.min(clock.getDelta(), 0.1);
		const elapsedTime = clock.elapsedTime;

		if (AUDIT_MATRIX_UPDATES) {
			global_scene.traverse((node) => {
				node.numMatrixUpdates = 0;
			});

			THREE.Object3D.prototype.updateMatrix = function () {
				this.matrix.compose(this.position, this.quaternion, this.scale);
				this.matrixWorldNeedsUpdate = true;
				this.numMatrixUpdates += 1;
				if (this.numMatrixUpdates > 1) {
					console.log(`multi update!`);
				}
			};
		}

		world.execute(delta, elapsedTime);
		ThreeMeshUI.update();
		TWEEN.update();

		if (AUDIT_MATRIX_UPDATES) {
			let matrixUpdateCounts = [0, 0, 0, 0, 0, 0, 0];
			global_scene.traverse((node) => {
				if (node.numMatrixUpdates < matrixUpdateCounts.length) {
					matrixUpdateCounts[node.numMatrixUpdates] += 1;
				} else {
					matrixUpdateCounts[matrixUpdateCounts.length - 1] += 1;
				}
			});
			console.log(`matrix update counts: `);
			console.log(matrixUpdateCounts);
		}
	}
});
