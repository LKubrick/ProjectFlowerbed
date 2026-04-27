/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as THREE from 'three';
import {
	COLLISION_LAYERS,
	DEBUG_CONSTANTS,
	LOCOMOTION_CONSTANTS,
} from '../../Constants';
import { AssetDatabaseComponent } from '../../components/AssetDatabaseComponent';
import { EnvironmentProp } from '../../components/GameObjectTagComponents';
import { FaunaClusterComponent } from '../../components/FaunaClusterComponent';
import { FaunaMaterial } from 'src/js/lib/shaders/WoodlandFaunaShader';
import { FullRoughMaterial } from '../../lib/shaders/WoodlandFullRoughShader';
import { GameStateComponent } from '../../components/GameStateComponent';
import { GaussianSplatLoaderComponent } from '../../components/GaussianSplatLoaderComponent';
import { GroundMaterial } from '../../lib/shaders/WoodlandGroundShader.js';
import { InstancedMeshInstanceComponent } from '../../components/InstancedMeshComponent';
import { MainEnvironment } from '../../components/GameObjectTagComponents';
import { MatteMaterial } from '../../lib/shaders/WoodlandMatteShader';
import { MeshIdComponent } from '../../components/AssetReplacementComponents';
import { MorphTargetAnimationComponent } from '../../components/MorphTargetAnimationComponent';
import { MovableFaunaComponent } from '../../components/MovableFaunaComponent';
import { Object3DComponent } from '../../components/Object3DComponent';
import { OptimizedModelComponent } from '../../components/OptimizedModelComponent';
import { PlantMaterial } from '../../lib/shaders/WoodlandPlantShader.js';
import { PlayerStateComponent } from '../../components/PlayerStateComponent';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { SceneLightingComponent } from '../../components/SceneLightingComponent';
import { ScreenshotCameraComponent } from '../../components/ScreenshotCameraComponent';
import { SkeletonAnimationComponent } from '../../components/SkeletonAnimationComponent';
import { SkyMaterial } from '../../lib/shaders/WoodlandSkyShader.js';
import { StaticColliderComponent } from '../../components/ColliderComponents';
import { StationaryFaunaComponent } from '../../components/StationaryFaunaComponent';
import { System } from 'ecsy';
import { THREEGlobalComponent } from '../../components/THREEGlobalComponent';
import { UIPanelMaterial } from '../../lib/shaders/WoodlandUIPanelShader';
import { UnderwaterDirtMaterial } from '../../lib/shaders/WoodlandUnderwaterDirtShader.js';
import { WaterMaterial } from '../../lib/shaders/WoodlandWaterShader.js';
import { copyTransforms } from '../../utils/transformUtils';
import { deleteEntity } from '../../utils/entityUtils';
import { getOnlyEntity } from '../../utils/entityUtils';
import { updateMatrixRecursively } from '../../utils/object3dUtils';

const USE_CHEAP_MATERIAL = false;
const IGNORE_MATERIAL_TEXTURES = false;
const IGNORE_METAL_ROUGHNESS = true;
const IGNORE_NORMALS = false;
const IGNORE_ENVMAPS = true;
const OPTIMIZE_MODEL = true;
const cubeLoader = new THREE.CubeTextureLoader();
const hdriLoader = new RGBELoader();
const textureLoader = new THREE.TextureLoader();
const MINIMAL_SCENE_HDRI_URL = 'assets/HDRI/satara_night_no_lamps_4k.hdr';
const MINIMAL_SCENE_GROUND_TEXTURE_ROOT =
	'assets/images/ground_textures/forest_leaves_03_2k/textures';

function setupRepeatedTexture(texture, renderer, isColorTexture = false) {
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(6, 10);
	if (isColorTexture) {
		texture.encoding = THREE.sRGBEncoding;
	}
	if (renderer?.capabilities?.getMaxAnisotropy) {
		texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
	}
	return texture;
}

function createSoftFogTexture() {
	const size = 256;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d');
	const gradient = context.createRadialGradient(
		size * 0.5,
		size * 0.5,
		size * 0.08,
		size * 0.5,
		size * 0.5,
		size * 0.5,
	);
	gradient.addColorStop(0, 'rgba(255,255,255,1)');
	gradient.addColorStop(0.45, 'rgba(255,255,255,0.72)');
	gradient.addColorStop(0.8, 'rgba(255,255,255,0.18)');
	gradient.addColorStop(1, 'rgba(255,255,255,0)');
	context.fillStyle = gradient;
	context.fillRect(0, 0, size, size);

	const texture = new THREE.CanvasTexture(canvas);
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	return texture;
}

export class SceneCreationSystem extends System {
	init() {
		this.renderer = undefined;
		this.viewerTransform = undefined;
		this.hasCreatedControllers = false;
		this.hasCreatedMinimalScene = false;
		this.hdriTexture = null;
		this.hdriEnvironment = null;
		this.minimalSceneHdriSphere = null;
		this.clock = new THREE.Clock();
		this.materialOverrides = {};
		this.tunnelFogTexture = createSoftFogTexture();
		RectAreaLightUniformsLib.init();

		this.queries.gameManager.results.forEach((entity) => {
			this.renderer = entity.getComponent(THREEGlobalComponent).renderer;
		});

		const _this = this;
		this.envMap = cubeLoader
			.setPath('assets/images/cloud_env_cube/')
			.load(
				['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png'],
				function (texture) {
					texture.encoding = THREE.sRGBEncoding;
					// force generate the PMREM envmap texture!
					_this.renderer.cubeuvmaps.get(texture);
					_this.queries.screenShotCameras.results.forEach((ent) => {
						ent
							.getComponent(ScreenshotCameraComponent)
							.photoRenderer.cubeuvmaps.get(texture);
					});
				},
			);

		hdriLoader.load(
			MINIMAL_SCENE_HDRI_URL,
			(texture) => {
				const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
				if (pmremGenerator.compileEquirectangularShader) {
					pmremGenerator.compileEquirectangularShader();
				}

				this.hdriTexture = texture;
				this.hdriEnvironment = pmremGenerator.fromEquirectangular(texture).texture;
				pmremGenerator.dispose();

				this.applyMinimalSceneBackground();
			},
			undefined,
			() => {
				// Keep the cube texture fallback if the HDRI fails to load.
			},
		);

		this.queries.gameManager.results.forEach((entity) => {
			this.renderer = entity.getComponent(THREEGlobalComponent).renderer;

			let scene = entity.getComponent(THREEGlobalComponent).scene;
			scene.fog = new THREE.FogExp2(0xead1d2, 0.0042);

			entity.addComponent(SceneLightingComponent, {
				camera: this.renderer.xr.getCamera(),
				renderer: this.renderer,
				scene: scene,
			});

			let lightingComponent = entity.getComponent(SceneLightingComponent);

			this.setupMaterialOverrides(lightingComponent);
		});
	}

	applyMinimalSceneBackground() {
		if (!DEBUG_CONSTANTS.USE_MINIMAL_PLANT_BED_SCENE) {
			return;
		}

		this.queries.gameManager.results.forEach((entity) => {
			const scene = entity.getComponent(THREEGlobalComponent)?.scene;
			if (!scene) {
				return;
			}

			this.ensureMinimalSceneHdriSphere(scene);

			scene.background =
				this.minimalSceneHdriSphere
					? null
					: this.envMap || new THREE.Color(0x000000);
			scene.environment = this.hdriEnvironment || this.envMap || null;
		});
	}

	ensureMinimalSceneHdriSphere(scene) {
		if (!this.hdriTexture || this.minimalSceneHdriSphere) {
			return;
		}

		const hdriSphereGeometry = new THREE.SphereGeometry(120, 64, 40);
		hdriSphereGeometry.scale(-1, 1, 1);

		const hdriSphereMaterial = new THREE.MeshBasicMaterial({
			map: this.hdriTexture,
			fog: false,
			depthWrite: false,
		});

		const hdriSphere = new THREE.Mesh(hdriSphereGeometry, hdriSphereMaterial);
		hdriSphere.name = 'MinimalSceneHDRISphere';
		hdriSphere.matrixAutoUpdate = true;
		hdriSphere.renderOrder = -1000;
		scene.add(hdriSphere);
		this.minimalSceneHdriSphere = hdriSphere;
	}

	execute(_delta, time) {
		this.queries.gameManager.changed.forEach(() => {
			this.checkEnvironmentChange();
		});

		this.queries.player.results.forEach((entity) => {
			this.viewerTransform = entity.getComponent(
				PlayerStateComponent,
			).viewerTransform;
			if (!this.renderer) {
				console.warn('Player was created before THREE.JS state');
			}
		});

		this.queries.gameManager.results.forEach((entity) => {
			if (entity.hasComponent(SceneLightingComponent)) {
				entity.getMutableComponent(SceneLightingComponent).update(time);
			}
		});

		if (this.minimalSceneHdriSphere && this.viewerTransform) {
			this.minimalSceneHdriSphere.position.copy(this.viewerTransform.position);
			this.minimalSceneHdriSphere.updateMatrix();
		}

		if (this.waterMaterial) {
			const config = this.waterMaterial.wave_config;
			const flowSpeed = 0.015;
			config.x += flowSpeed * _delta; // flowMapOffset0
		}
		if (this.fountainWaterMaterial) {
			const config = this.fountainWaterMaterial.wave_config;
			const flowSpeed = 0.02;
			config.x += flowSpeed * _delta; // flowMapOffset0
		}
	}

	setupMaterialOverrides(lightingComponent) {
		let scs = this;
		let skyCloudNode = null;
		let skyBaseNode = null;
		let simpleMaterialOverride = (node) => {
			if (node.material) {
				let newMaterial = this.materialOverrides[node.material.uuid];
				if (!newMaterial) {
					if (
						IGNORE_METAL_ROUGHNESS &&
						!node.material.name.match(/bench/i) &&
						!node.material.name.match(/camera/i) &&
						!node.material.name.match(/watering/i)
					) {
						node.material.occlusionMetalRoughnessMap = null;
						node.material.aoMap = null;
						node.material.roughnessMap = null;
						node.material.metalnessMap = null;
						node.material.metalness = 0.0;
						node.material.roughness = 1.0;
					}

					if (IGNORE_NORMALS) {
						node.material.normalMap = null;
					}

					if (node.material.map) {
						node.material.map.anisotropy = 4;
					}

					if (node.material.name.match(/SkinnedPlant/i)) {
						PlantMaterial.setupNode(node);
						newMaterial = node.material;
						if (lightingComponent.csm) {
							lightingComponent.csm.setupMaterial(newMaterial);
						}

						// Set env map on plants to provide omni-directional lighting.
						if (IGNORE_ENVMAPS !== true) {
							newMaterial.envMap = scs.envMap;
							newMaterial.envMapIntensity = 0.5;
						}
						node.renderOrder = 900;
					} else if (node.material.name.match(/road/i)) {
						node.castShadow = false;
						newMaterial = node.material;
						newMaterial.alphaTest = 0.0;
						newMaterial.transparent = false;
						FullRoughMaterial.setupMaterial(newMaterial);

						if (lightingComponent.csm) {
							lightingComponent.csm.setupMaterial(newMaterial);
						}
					} else if (
						node.material.name.match(/fish/i) ||
						node.material.name.match(/duck/i) ||
						node.material.name.match(/seagull/i)
					) {
						node.castShadow = false;
						FaunaMaterial.setupNode(node);
						newMaterial = node.material;

						if (lightingComponent.csm) {
							lightingComponent.csm.setupMaterial(newMaterial);
						}
					} else if (node.material.name.match(/(\b|_)water(\b|_)/i)) {
						node.renderOrder = 900;
						newMaterial = new THREE.MeshPhongMaterial({
							color: node.material.color,
							map: node.material.map,
						});

						WaterMaterial.setupMaterial(newMaterial);
						newMaterial.envMap = scs.envMap;

						if (lightingComponent.csm) {
							lightingComponent.csm.setupMaterial(newMaterial);
						}

						if (node.material.name.match(/M_Prop_Fountain_Water/i)) {
							scs.waterMaterial = newMaterial;
						} else {
							newMaterial.customProgramCacheKey = function () {
								return 'fountain_water';
							};
							newMaterial.reflectivity = 0.6;
							scs.fountainWaterMaterial = newMaterial;
						}
					} else if (node.material.name.match(/material_has_been_cut/i)) {
						newMaterial = node.material.clone();
						GroundMaterial.setupMaterial(newMaterial);

						if (lightingComponent.csm) {
							lightingComponent.csm.setupMaterial(newMaterial);
						}
					} else if (
						node.material.name.match(/UIPanel/i) ||
						node.material.name.match(/Tooltip/i)
					) {
						newMaterial = node.material.clone();
						UIPanelMaterial.setupMaterial(newMaterial);
						newMaterial.emissive.setHex(0xffffff);
						newMaterial.emissiveIntensity = 0.3;
					} else if (node.material.name.match(/sky/i)) {
						// use a custom shader that takes in both sky textures
						// so we don't have to render two meshes
						newMaterial = new THREE.MeshBasicMaterial({
							map: node.material.map,
							fog: false,
							transparent: false,
						});

						if (node.material.name.match(/base/i)) {
							skyBaseNode = node;
						} else if (node.material.name.match(/cloud/i)) {
							skyCloudNode = node;
						}
					} else if (
						node.material.name.match(/underwater/i) ||
						node.material.name.match(/sand/i)
					) {
						newMaterial = new THREE.MeshPhongMaterial({
							color: node.material.color,
							map: node.material.map,
							reflectivity: Math.max(1.0 - node.material.roughness, 0.0),
							shininess: Math.max(1.0 - node.material.roughness, 0.0) * 64.0,
						});
						UnderwaterDirtMaterial.setupMaterial(newMaterial);

						if (lightingComponent.csm) {
							lightingComponent.csm.setupMaterial(newMaterial);
						}
					} else if (node.material.name.match(/matte_mountain/i)) {
						node.renderOrder = -900;
						newMaterial = node.material.clone();
						MatteMaterial.setupMaterial(newMaterial);
						newMaterial.fog_config.x = 20.0; // start of fade
						newMaterial.fog_config.y = 0.0125; // fade factor - 1/fog_config.y is where this hits zero
					} else if (node.material.name.match(/herotree/i)) {
						newMaterial = node.material.clone();
						if (IGNORE_ENVMAPS !== true) {
							newMaterial.envMap = scs.envMap;
							newMaterial.envMapIntensity = 0.75;
						}
						if (lightingComponent.csm) {
							lightingComponent.csm.setupMaterial(newMaterial);
						}
					} else {
						if (USE_CHEAP_MATERIAL) {
							newMaterial = new THREE.MeshPhongMaterial({
								color: node.material.color,
								reflectivity: Math.max(1.0 - node.material.roughness, 0.0),
								shininess: Math.max(1.0 - node.material.roughness, 0.0) * 64.0,
							});
						} else if (IGNORE_MATERIAL_TEXTURES) {
							newMaterial = new THREE.MeshStandardMaterial({
								color: node.material.color,
								roughness: node.material.roughness,
								metalness: node.material.metalness,
							});
						} else {
							newMaterial = node.material.clone();
						}

						// Assign environment map to specific materials here.
						if (
							node.material.name.match(/watering/i) ||
							node.material.name.match(/camera/i)
						) {
							newMaterial.metalness = 1.0;
							newMaterial.roughness = 0.4;
							node.renderOrder = -10;
							newMaterial.envMap = scs.envMap;
						} else if (!node.material.name.match(/bench/i)) {
							FullRoughMaterial.setupMaterial(newMaterial);
						}

						if (node.material.name.match(/Prop_SeedPacket_Decal/i)) {
							newMaterial.side = THREE.FrontSide;
						}

						if (lightingComponent.csm) {
							lightingComponent.csm.setupMaterial(newMaterial);
						}
					}

					newMaterial.name = 'OVERRIDDEN_' + node.material.name;

					// set the shadowside to the same as the material side
					newMaterial.shadowSide = node.material.side;

					if (newMaterial.alphaTest > 0.0) {
						newMaterial.alphaToCoverage = true;
						newMaterial.transparent = true;
						newMaterial.alphaTest = 0.0;
					}
					this.materialOverrides[node.material.uuid] = newMaterial;
				}

				node.material = newMaterial;

				if (node.name.match(/terrain_underwater/i)) {
					node.renderOrder = 800;
				}

				// if we have both a sky base and cloud, combine them
				if (skyBaseNode && skyCloudNode) {
					SkyMaterial.setupMaterial(
						skyBaseNode.material,
						skyCloudNode.material.map,
					);
					skyCloudNode.visible = false;

					skyBaseNode.renderOrder = 1001;
					scs.skyMaterial = skyBaseNode.material;
				}
			}
		};

		let assetDatabaseComponent = getOnlyEntity(
			this.queries.assetDatabase,
		).getComponent(AssetDatabaseComponent);
		assetDatabaseComponent.meshes.setMaterialOverride(simpleMaterialOverride);
	}

	getSceneNodeLabels(node, includeAncestors = true) {
		const labels = [];

		if (node.name) {
			labels.push(node.name);
		}
		if (node.userData?.link) {
			labels.push(node.userData.link);
		}
		if (node.material?.name) {
			labels.push(node.material.name);
		}

		if (!includeAncestors) {
			return labels;
		}

		let currentNode = node.parent;

		while (currentNode) {
			if (currentNode.name) {
				labels.push(currentNode.name);
			}
			if (currentNode.userData?.link) {
				labels.push(currentNode.userData.link);
			}
			currentNode = currentNode.parent;
		}

		return labels;
	}

	matchesSceneNodePatterns(node, patterns, includeAncestors = true) {
		if (!patterns?.length) {
			return false;
		}

		const labels = this.getSceneNodeLabels(node, includeAncestors);
		return patterns.some((pattern) => {
			if (pattern instanceof RegExp) {
				return labels.some((label) => {
					pattern.lastIndex = 0;
					return pattern.test(label);
				});
			}

			return labels.some((label) => label.includes(pattern));
		});
	}

	shouldDisableSceneNode(node) {
		if (DEBUG_CONSTANTS.USE_MINIMAL_PLANT_BED_SCENE) {
			return true;
		}

		if (
			DEBUG_CONSTANTS.KEEP_ONLY_FLOOR &&
			!this.matchesSceneNodePatterns(
				node,
				DEBUG_CONSTANTS.FLOOR_SCENE_OBJECT_PATTERNS,
				false,
			)
		) {
			return true;
		}

		return this.matchesSceneNodePatterns(
			node,
			DEBUG_CONSTANTS.DISABLED_SCENE_OBJECT_PATTERNS,
		);
	}

	createMinimalSceneAsset(scene, meshId, position, rotationY = 0, scale = 1) {
		const entity = this.world.createEntity();
		const placeholder = new THREE.Object3D();
		placeholder.position.copy(position);
		placeholder.rotation.y = rotationY;
		placeholder.scale.setScalar(scale);
		scene.add(placeholder);

		entity.addComponent(Object3DComponent, {
			value: placeholder,
		});
		entity.addComponent(MeshIdComponent, {
			id: meshId,
		});

		return entity;
	}

	createMinimalStationaryFauna(
		scene,
		meshId,
		position,
		rotationY,
		scale,
		idleAnimations,
		engagedAnimations = [],
	) {
		const entity = this.createMinimalSceneAsset(
			scene,
			meshId,
			position,
			rotationY,
			scale,
		);

		entity.addComponent(StationaryFaunaComponent, {
			spawnLocations: [position.clone()],
		});
		entity.addComponent(SkeletonAnimationComponent, {
			idleAnimations,
			engagedAnimations,
			animationActions: [],
		});

		return entity;
	}

	createMinimalFaunaCluster(center, outerDimensions, options = {}) {
		const innerDimensions = outerDimensions.clone().multiplyScalar(0.8);
		const halfInner = innerDimensions.clone().multiplyScalar(0.5);

		const cluster = this.world.createEntity();
		cluster.addComponent(FaunaClusterComponent, {
			boundingBoxCenter: center.clone(),
			boundingBoxOuterDimensions: outerDimensions.clone(),
			boundingBoxInnerDimensions: innerDimensions,
			boundingBoxInnerMin: center.clone().sub(halfInner),
			boundingBoxInnerMax: center.clone().add(halfInner),
			meshObservationPoints: [],
			minSpeed: options.minSpeed,
			maxSpeed: options.maxSpeed,
			minYRadian: options.minYRadian,
			maxYRadian: options.maxYRadian,
			avoidanceDistance: options.avoidanceDistance,
			avoidanceFactor: options.avoidanceFactor,
			turnDegreesRadian: options.turnDegreesRadian,
			negateDirection: options.negateDirection,
			verticalPathVariationFrequency: options.verticalPathVariationFrequency,
			verticalPathVariationFactor: options.verticalPathVariationFactor,
			horizontalPathVariationFrequency:
				options.horizontalPathVariationFrequency,
			horizontalPathVariationFactor: options.horizontalPathVariationFactor,
			faunas: [],
		});

		return cluster;
	}

	createMinimalMovableFauna(
		scene,
		meshId,
		position,
		rotationY,
		scale,
		clusterComponent,
		morphTargetSequence,
	) {
		const entity = this.createMinimalSceneAsset(
			scene,
			meshId,
			position,
			rotationY,
			scale,
		);

		const direction = new THREE.Vector3(
			Math.sin(rotationY),
			0,
			Math.cos(rotationY),
		).normalize();
		const speedRange = clusterComponent.maxSpeed - clusterComponent.minSpeed;

		entity.addComponent(MovableFaunaComponent, {
			direction,
			speed: clusterComponent.minSpeed + Math.random() * speedRange,
			verticalVariationOffset:
				clusterComponent.verticalPathVariationFactor === 0
					? 0
					: Math.random() /
						clusterComponent.verticalPathVariationFrequency,
			horizontalVariationOffset:
				clusterComponent.horizontalPathVariationFactor === 0
					? 0
					: Math.random() /
						clusterComponent.horizontalPathVariationFrequency,
		});
		entity.addComponent(MorphTargetAnimationComponent, {
			morphTargetSequence,
		});

		clusterComponent.faunas.push(entity);
		return entity;
	}

	createMinimalSceneSplat(scene, splatPosition) {
		if (!DEBUG_CONSTANTS.MINIMAL_SCENE_SPLAT_URL) {
			return;
		}

		const splatAnchor = new THREE.Object3D();
		splatAnchor.position.copy(splatPosition);
		splatAnchor.rotation.y = THREE.MathUtils.degToRad(60);
		splatAnchor.scale.setScalar(DEBUG_CONSTANTS.MINIMAL_SCENE_SPLAT_SCALE);
		scene.add(splatAnchor);

		const splatEntity = this.world.createEntity();
		splatEntity.addComponent(Object3DComponent, {
			value: splatAnchor,
		});
		splatEntity.addComponent(GaussianSplatLoaderComponent, {
			splatUrl: DEBUG_CONSTANTS.MINIMAL_SCENE_SPLAT_URL,
			autoLoad: true,
			enableLod: DEBUG_CONSTANTS.MINIMAL_SCENE_SPLAT_ENABLE_LOD,
			lodSplatScale: DEBUG_CONSTANTS.MINIMAL_SCENE_SPLAT_LOD_SCALE,
		});
	}

	createMinimalSceneBackdrop(scene, playerStart, floorCenter, splatGroundCenter) {
		this.applyMinimalSceneBackground();
		scene.fog = null;

		const tunnelStart = playerStart.clone().setY(0);
		const tunnelDirection = splatGroundCenter
			.clone()
			.sub(tunnelStart)
			.setY(0)
			.normalize();
		const tunnelLength = 13.5;
		const tunnelRearInset = 0.8;
		const tunnelHalfWidth = 3.15;
		const tunnelHeight = 5.6;
		const tunnelShoulderHeight = 1.2;
		const tunnelShoulderInset = 0.95;
		const tunnelCenter = tunnelStart
			.clone()
			.addScaledVector(tunnelDirection, (tunnelLength * 0.5) - tunnelRearInset)
			.add(new THREE.Vector3(0, tunnelHeight * 0.5, 0));
		const tunnelWallMaterial = new THREE.MeshLambertMaterial({
			color: 0x141414,
			fog: false,
			side: THREE.DoubleSide,
		});
		const tunnelShoulderMaterial = new THREE.MeshLambertMaterial({
			color: 0x1a1a1a,
			fog: false,
			side: THREE.DoubleSide,
		});
		const tunnelShell = new THREE.Group();
		tunnelShell.name = 'MinimalSceneTunnelShell';
		tunnelShell.position.copy(tunnelCenter);
		tunnelShell.quaternion.setFromUnitVectors(
			new THREE.Vector3(1, 0, 0),
			tunnelDirection,
		);
		const tunnelLeftWall = new THREE.Mesh(
			new THREE.BoxGeometry(tunnelLength, tunnelHeight, 0.42),
			tunnelWallMaterial,
		);
		tunnelLeftWall.position.set(0, 0, -tunnelHalfWidth);
		tunnelShell.add(tunnelLeftWall);

		const tunnelRightWall = new THREE.Mesh(
			new THREE.BoxGeometry(tunnelLength, tunnelHeight, 0.42),
			tunnelWallMaterial,
		);
		tunnelRightWall.position.set(0, 0, tunnelHalfWidth);
		tunnelShell.add(tunnelRightWall);

		const tunnelLeftShoulder = new THREE.Mesh(
			new THREE.BoxGeometry(tunnelLength, 0.34, 2.1),
			tunnelShoulderMaterial,
		);
		tunnelLeftShoulder.position.set(
			0,
			(tunnelHeight * 0.5) - tunnelShoulderHeight,
			-(tunnelHalfWidth - tunnelShoulderInset),
		);
		tunnelLeftShoulder.rotation.x = -THREE.MathUtils.degToRad(32);
		tunnelShell.add(tunnelLeftShoulder);

		const tunnelRightShoulder = new THREE.Mesh(
			new THREE.BoxGeometry(tunnelLength, 0.34, 2.1),
			tunnelShoulderMaterial,
		);
		tunnelRightShoulder.position.set(
			0,
			(tunnelHeight * 0.5) - tunnelShoulderHeight,
			(tunnelHalfWidth - tunnelShoulderInset),
		);
		tunnelRightShoulder.rotation.x = THREE.MathUtils.degToRad(32);
		tunnelShell.add(tunnelRightShoulder);

		const tunnelCeiling = new THREE.Mesh(
			new THREE.BoxGeometry(
				tunnelLength,
				0.38,
				((tunnelHalfWidth - tunnelShoulderInset) * 2) + 0.4,
			),
			tunnelShoulderMaterial,
		);
		tunnelCeiling.position.set(0, (tunnelHeight * 0.5) - 0.19, 0);
		tunnelShell.add(tunnelCeiling);

		const tunnelBackWall = new THREE.Mesh(
			new THREE.BoxGeometry(0.42, tunnelHeight, (tunnelHalfWidth * 2) + 0.42),
			tunnelWallMaterial,
		);
		tunnelBackWall.position.set(-(tunnelLength * 0.5) + 0.21, 0, 0);
		tunnelShell.add(tunnelBackWall);
		scene.add(tunnelShell);
		updateMatrixRecursively(tunnelShell);

		const tunnelFloorShade = new THREE.Mesh(
			new THREE.PlaneGeometry(tunnelLength, (tunnelHalfWidth * 2) - 0.15),
			new THREE.MeshPhongMaterial({
				color: 0x0b0b0b,
				shininess: 12,
				side: THREE.DoubleSide,
				fog: false,
			}),
		);
		tunnelFloorShade.name = 'MinimalSceneTunnelFloorShade';
		tunnelFloorShade.rotation.x = -Math.PI / 2;
		tunnelFloorShade.position.set(0, -(tunnelHeight * 0.5) + 0.02, 0);
		tunnelShell.add(tunnelFloorShade);
		updateMatrixRecursively(tunnelFloorShade);

		const tunnelLeftGuide = new THREE.Mesh(
			new THREE.BoxGeometry(tunnelLength, 0.12, 0.18),
			new THREE.MeshBasicMaterial({
				color: 0x2a2a2a,
				fog: false,
			}),
		);
		tunnelLeftGuide.position.set(0, -(tunnelHeight * 0.5) + 0.12, -(tunnelHalfWidth - 0.34));
		tunnelShell.add(tunnelLeftGuide);

		const tunnelRightGuide = new THREE.Mesh(
			new THREE.BoxGeometry(tunnelLength, 0.12, 0.18),
			new THREE.MeshBasicMaterial({
				color: 0x2a2a2a,
				fog: false,
			}),
		);
		tunnelRightGuide.position.set(0, -(tunnelHeight * 0.5) + 0.12, tunnelHalfWidth - 0.34);
		tunnelShell.add(tunnelRightGuide);

		const tunnelFogVolume = new THREE.Group();
		tunnelFogVolume.name = 'MinimalSceneTunnelFogVolume';
		const fogFloorY = -(tunnelHeight * 0.5) + 0.18;
		const fogParticleCount = 1800;
		const fogPositions = new Float32Array(fogParticleCount * 3);

		for (let index = 0; index < fogParticleCount; index += 1) {
			const baseIndex = index * 3;
			const lengthT = (Math.random() * 2) - 1;
			const widthT = (Math.random() * 2) - 1;
			const heightT = Math.pow(Math.random(), 1.85);
			fogPositions[baseIndex] = (lengthT * tunnelLength * 0.42) + (tunnelLength * 0.12);
			fogPositions[baseIndex + 1] = fogFloorY + 0.2 + (heightT * 2.2);
			fogPositions[baseIndex + 2] = widthT * tunnelHalfWidth * (0.38 + (Math.random() * 0.34));
		}

		const tunnelFogGeometry = new THREE.BufferGeometry();
		tunnelFogGeometry.setAttribute(
			'position',
			new THREE.BufferAttribute(fogPositions, 3),
		);

		const tunnelFogBlob = new THREE.Points(
			tunnelFogGeometry,
			new THREE.PointsMaterial({
				color: 0xe8dfcf,
				map: this.tunnelFogTexture,
				alphaMap: this.tunnelFogTexture,
				size: 1.55,
				sizeAttenuation: true,
				transparent: true,
				opacity: 0.16,
				depthWrite: false,
				fog: false,
			}),
		);
		tunnelFogBlob.name = 'MinimalSceneTunnelFogBlob';
		tunnelFogVolume.add(tunnelFogBlob);

		tunnelShell.add(tunnelFogVolume);
		updateMatrixRecursively(tunnelFogVolume);

		const splatSpotLight = new THREE.SpotLight(
			0xffefc8,
			8,
			24,
			THREE.MathUtils.degToRad(30),
			0.45,
			1,
		);
		splatSpotLight.name = 'MinimalSceneSplatSpotLight';
		splatSpotLight.position.copy(splatGroundCenter).add(new THREE.Vector3(0, 4.2, 1.3));
		splatSpotLight.target.position.copy(
			splatGroundCenter.clone().add(new THREE.Vector3(0, 0.8, 0)),
		);
		scene.add(splatSpotLight);
		scene.add(splatSpotLight.target);
		updateMatrixRecursively(splatSpotLight);
		updateMatrixRecursively(splatSpotLight.target);

		const splatTunnelSpotLight = new THREE.SpotLight(
			0xffefcf,
			4.5,
			34,
			THREE.MathUtils.degToRad(26),
			0.92,
			1.15,
		);
		splatTunnelSpotLight.name = 'MinimalSceneSplatTunnelSpotLight';
		splatTunnelSpotLight.position.copy(splatGroundCenter).add(new THREE.Vector3(0, 4.8, 2.8));
		splatTunnelSpotLight.target.position
			.copy(tunnelStart)
			.addScaledVector(tunnelDirection, tunnelLength * 0.18)
			.add(new THREE.Vector3(0, 1.45, 0));
		scene.add(splatTunnelSpotLight);
		scene.add(splatTunnelSpotLight.target);

		if (!this.hdriTexture && !this.envMap) {
			const domeGeometry = new THREE.SphereGeometry(42, 40, 24);
			const domeColors = [];
			const topColor = new THREE.Color(0x000000);
			const horizonColor = new THREE.Color(0x000000);
			const bottomColor = new THREE.Color(0x010101);
			const domeColor = new THREE.Color();
			const domeRadius = 42;
			const positionAttribute = domeGeometry.getAttribute('position');

			for (let index = 0; index < positionAttribute.count; index += 1) {
				const heightT = THREE.MathUtils.clamp(
					(positionAttribute.getY(index) + domeRadius) / (domeRadius * 2),
					0,
					1,
				);

				if (heightT < 0.45) {
					domeColor.copy(bottomColor).lerp(horizonColor, heightT / 0.45);
				} else {
					domeColor
						.copy(horizonColor)
						.lerp(topColor, (heightT - 0.45) / 0.55);
				}

				domeColors.push(domeColor.r, domeColor.g, domeColor.b);
			}

			domeGeometry.setAttribute(
				'color',
				new THREE.Float32BufferAttribute(domeColors, 3),
			);

			const backdropDome = new THREE.Mesh(
				domeGeometry,
				new THREE.MeshBasicMaterial({
					vertexColors: true,
					side: THREE.BackSide,
					fog: false,
					depthWrite: false,
				}),
			);
			backdropDome.name = 'MinimalSceneBackdropDome';
			backdropDome.position.copy(floorCenter).add(new THREE.Vector3(0, 8, 0));
			backdropDome.renderOrder = -1000;
			scene.add(backdropDome);
			updateMatrixRecursively(backdropDome);
		}
	}

	createMinimalSceneFloor(scene, splatGroundCenter) {
		const groundSurfaceRadius = 12;
		const floorDepth = 40;
		const floorCenter = splatGroundCenter.clone();
		const groundSurfaceGeometry = new THREE.CircleGeometry(
			groundSurfaceRadius,
			64,
		);
		groundSurfaceGeometry.setAttribute(
			'uv2',
			new THREE.BufferAttribute(
				groundSurfaceGeometry.attributes.uv.array.slice(),
				2,
			),
		);
		const groundColorMap = setupRepeatedTexture(
			textureLoader.load(
				`${MINIMAL_SCENE_GROUND_TEXTURE_ROOT}/forest_leaves_03_diff_2k.jpg`,
			),
			this.renderer,
			true,
		);
		const groundArmMap = setupRepeatedTexture(
			textureLoader.load(
				`${MINIMAL_SCENE_GROUND_TEXTURE_ROOT}/forest_leaves_03_arm_2k.jpg`,
			),
			this.renderer,
		);
		const groundHeightMap = setupRepeatedTexture(
			textureLoader.load(
				`${MINIMAL_SCENE_GROUND_TEXTURE_ROOT}/forest_leaves_03_disp_2k.png`,
			),
			this.renderer,
		);
		const groundSurface = new THREE.Mesh(
			groundSurfaceGeometry,
			new THREE.MeshStandardMaterial({
				map: groundColorMap,
				aoMap: groundArmMap,
				roughnessMap: groundArmMap,
				metalnessMap: groundArmMap,
				bumpMap: groundHeightMap,
				bumpScale: 0.08,
				roughness: 1,
				metalness: 0.05,
				aoMapIntensity: 0.75,
				side: THREE.DoubleSide,
			}),
		);
		groundSurface.name = 'MinimalSceneGroundSurface';
		groundSurface.rotation.x = -Math.PI / 2;
		groundSurface.position.copy(floorCenter).add(new THREE.Vector3(0, 0.02, 0));
		groundSurface.receiveShadow = false;
		groundSurface.castShadow = false;
		scene.add(groundSurface);
		updateMatrixRecursively(groundSurface);

		const floorMesh = new THREE.Mesh(
			new THREE.BoxGeometry(24, 1, floorDepth),
			new THREE.MeshPhongMaterial({
				color: 0x8e7556,
				transparent: true,
				opacity: 0,
			}),
		);
		floorMesh.name = 'MinimalSceneFloor';
		floorMesh.position.copy(floorCenter).add(new THREE.Vector3(0, -0.5, 0));
		floorMesh.receiveShadow = false;
		floorMesh.castShadow = false;
		floorMesh.visible = false;
		scene.add(floorMesh);
		updateMatrixRecursively(floorMesh);

		const floorCollider = this.world.createEntity();
		floorCollider.addComponent(StaticColliderComponent, {
			mesh: floorMesh,
			layers: [
				COLLISION_LAYERS.OBSTACLE,
				COLLISION_LAYERS.PLANTABLE_SURFACE,
				COLLISION_LAYERS.TELEPORT_SURFACE,
			],
		});
	}

	createMinimalPlantBedScene(scene, playerStart) {
		const floorCenter = playerStart.clone().add(new THREE.Vector3(0, 0, -13.5));
		const splatGroundCenter = playerStart.clone().add(new THREE.Vector3(0, 0, -19.5));
		const splatPosition = splatGroundCenter.clone().add(new THREE.Vector3(0, 0.8, 0));
		this.createMinimalSceneBackdrop(scene, playerStart, floorCenter, splatGroundCenter);
		this.createMinimalSceneFloor(scene, splatGroundCenter);
		this.createMinimalSceneSplat(scene, splatPosition);

		const rabbitSpots = [
			new THREE.Vector3(-2.4, 0, -1.35),
			new THREE.Vector3(2.35, 0, -1.05),
		].map((offset) => ({
			position: splatGroundCenter.clone().add(offset),
			rotationY: Math.atan2(-offset.x, -offset.z),
		}));
		const rabbitIdleAnimations = [
			{ name: 'Idle_01', loop: THREE.LoopRepeat },
			{ name: 'Idle_Var_01', loop: THREE.LoopOnce },
			{ name: 'Idle_Var_02', loop: THREE.LoopRepeat },
			{ name: 'Idle_Var_03', loop: THREE.LoopOnce },
			{ name: 'Idle_Var_04', loop: THREE.LoopOnce },
		];
		const rabbitEngagedAnimations = [
			{ name: 'Engaged_01', loop: THREE.LoopRepeat },
		];
		const butterflyLeft = splatGroundCenter.clone().add(new THREE.Vector3(-0.55, 1.15, 0.15));
		const butterflyRight = splatGroundCenter.clone().add(new THREE.Vector3(0.75, 1.2, -0.1));
		const butterflyRear = splatGroundCenter.clone().add(new THREE.Vector3(0.2, 1.05, -0.7));
		const butterflyFrontLeft = splatGroundCenter.clone().add(new THREE.Vector3(-0.95, 1.1, 0.55));
		const butterflyFrontRight = splatGroundCenter.clone().add(new THREE.Vector3(1.1, 1.25, 0.35));
		const butterflyCluster = this.createMinimalFaunaCluster(
			splatGroundCenter.clone().add(new THREE.Vector3(0.1, 1.15, 0.05)),
			new THREE.Vector3(3.2, 1.35, 2.4),
			{
				minSpeed: 0.005,
				maxSpeed: 0.01,
				minYRadian: (-20 * Math.PI) / 180,
				maxYRadian: (20 * Math.PI) / 180,
				avoidanceDistance: 0.1,
				avoidanceFactor: 0.5,
				turnDegreesRadian: (5 * Math.PI) / 180,
				negateDirection: true,
				verticalPathVariationFrequency: 0.5,
				verticalPathVariationFactor: Math.PI / 180,
				horizontalPathVariationFrequency: 0.5,
				horizontalPathVariationFactor: Math.PI / 180,
			},
		).getMutableComponent(FaunaClusterComponent);
		rabbitSpots.forEach(({ position, rotationY }) => {
			this.createMinimalStationaryFauna(
				scene,
				'FAUNA_RABBIT',
				position,
				rotationY,
				1,
				rabbitIdleAnimations,
				rabbitEngagedAnimations,
			);
		});
		this.createMinimalMovableFauna(
			scene,
			'FAUNA_BLUE_BUTTERFLY',
			butterflyLeft,
			Math.PI / 3,
			1.1,
			butterflyCluster,
			[
				{ name: 'Flap_Up', duration: 0.1 },
				{ name: 'Flap_Down', duration: 0.1 },
			],
		);
		this.createMinimalMovableFauna(
			scene,
			'FAUNA_ORANGE_BUTTERFLY',
			butterflyRight,
			-Math.PI / 4,
			1.1,
			butterflyCluster,
			[
				{ name: 'Flap_Up', duration: 0.1 },
				{ name: 'Flap_Down', duration: 0.1 },
			],
		);
		this.createMinimalMovableFauna(
			scene,
			'FAUNA_BLUE_BUTTERFLY',
			butterflyRear,
			Math.PI / 2,
			1.05,
			butterflyCluster,
			[
				{ name: 'Flap_Up', duration: 0.1 },
				{ name: 'Flap_Down', duration: 0.1 },
			],
		);
		this.createMinimalMovableFauna(
			scene,
			'FAUNA_ORANGE_BUTTERFLY',
			butterflyFrontLeft,
			Math.PI / 5,
			1.08,
			butterflyCluster,
			[
				{ name: 'Flap_Up', duration: 0.1 },
				{ name: 'Flap_Down', duration: 0.1 },
			],
		);
		this.createMinimalMovableFauna(
			scene,
			'FAUNA_BLUE_BUTTERFLY',
			butterflyFrontRight,
			-Math.PI / 3,
			1.12,
			butterflyCluster,
			[
				{ name: 'Flap_Up', duration: 0.1 },
				{ name: 'Flap_Down', duration: 0.1 },
			],
		);
	}

	setupMapOverrides(scene, mapObject) {
		mapObject.traverse((node) => {
			if (this.shouldDisableSceneNode(node)) {
				node.visible = false;
				return;
			}

			if (node.userData?.link) {
				node.visible = false;
				// we hide the existing node, and then create an entity
				// that generates the new link.
				let propEntity = this.world.createEntity();
				let placeholder = new THREE.Object3D();
				copyTransforms(node, placeholder);
				node.parent.add(placeholder);
				scene.attach(placeholder);
				propEntity.addComponent(Object3DComponent, {
					value: placeholder,
				});
				propEntity.addComponent(MeshIdComponent, {
					id: node.userData.link,
				});
				propEntity.addComponent(EnvironmentProp);

				// make all the benches & fences instanced meshes
				if (node.userData.link.match(/Bench/i)) {
					propEntity.addComponent(InstancedMeshInstanceComponent, {
						meshId: node.userData.link,
					});
				}
				if (node.userData.link.match(/Fence/i)) {
					propEntity.addComponent(InstancedMeshInstanceComponent, {
						meshId: node.userData.link,
					});
				}
				if (node.userData.link.match(/Bridge/i)) {
					propEntity.addComponent(InstancedMeshInstanceComponent, {
						meshId: node.userData.link,
					});
				}
				if (node.userData.link.match(/planter/i)) {
					propEntity.addComponent(InstancedMeshInstanceComponent, {
						meshId: node.userData.link,
					});
				}
			}
		});
	}

	checkEnvironmentChange() {
		let mapId = null;
		let gameState = null;
		let scene = null;
		this.queries.gameManager.results.forEach((entity) => {
			gameState = entity.getMutableComponent(GameStateComponent);
			mapId = gameState.currentBaseMapId;
			scene = entity.getComponent(THREEGlobalComponent).scene;
		});

		let assetDatabaseComponent = getOnlyEntity(
			this.queries.assetDatabase,
		).getComponent(AssetDatabaseComponent);

		let isEnvironmentAlreadyActivated = false;

		this.queries.environmentObject.results.forEach((mainEnvironmentEntity) => {
			if (mainEnvironmentEntity) {
				if (mainEnvironmentEntity.mapId == mapId) {
					isEnvironmentAlreadyActivated = true;
				} else {
					// remove any old environments we find
					let optimizedModel = mainEnvironmentEntity.getComponent(
						OptimizedModelComponent,
					);
					if (optimizedModel) {
						optimizedModel.model.parent.remove(optimizedModel.model);
						optimizedModel.optimizedModel.parent.remove(
							optimizedModel.optimizedModel,
						);
					}
					deleteEntity(scene, mainEnvironmentEntity);
				}
			}
		});

		if (isEnvironmentAlreadyActivated) {
			return;
		}

		let environmentObject = assetDatabaseComponent.meshes.getMesh(mapId);

		if (DEBUG_CONSTANTS.USE_MINIMAL_PLANT_BED_SCENE) {
			LOCOMOTION_CONSTANTS.INITIAL_POSITION[gameState.currentBaseMapId].set(
				0,
				0,
				1,
			);

			if (!this.hasCreatedMinimalScene) {
				this.createMinimalPlantBedScene(
					scene,
					LOCOMOTION_CONSTANTS.INITIAL_POSITION[gameState.currentBaseMapId],
				);
				this.hasCreatedMinimalScene = true;
			}

			gameState.allAssetsLoaded = true;
			updateMatrixRecursively(scene);
			scene.updateMatrixWorld(true);
			return;
		}

		this.setupMapOverrides(scene, environmentObject);

		// set default player start position
		// actual player position is set in SaveDataSystem; we do the ungood thing of
		// modifying the initial position constant so that when we do load a garden
		// the player starts at a place that the map defines.
		// If the map does not define the Player_Start point, we use the default.
		const playerStart = environmentObject.getObjectByName('Player_Start');
		if (playerStart) {
			LOCOMOTION_CONSTANTS.INITIAL_POSITION[gameState.currentBaseMapId].copy(
				playerStart.position,
			);
		}

		let islandEntity = this.world.createEntity();
		islandEntity.mapId = mapId;
		if (OPTIMIZE_MODEL) {
			islandEntity.addComponent(OptimizedModelComponent, {
				model: environmentObject,
				materialOverride: null,
				shadowCastingObjects: [
					/Lantern/i,
					/Tree/i,
					/Plant/i,
					/Crystal/i,
					/Bench/i,
					/Gazebo/i,
					/Box/i,
					/Bridge/i,
					/Pergola/i,
				],
			});
		} else {
			// we're not optimizing anything, so we add it directly to the scene
			scene.add(environmentObject);
			islandEntity.addComponent(Object3DComponent, {
				value: environmentObject,
			});
		}

		// link up the object with the MainEnvironment tag component
		// so that we don't lose track of it.
		islandEntity.addComponent(MainEnvironment);

		gameState.allAssetsLoaded = true;
		updateMatrixRecursively(scene);
		scene.updateMatrixWorld(true);
	}
}

SceneCreationSystem.queries = {
	environmentObject: {
		components: [MainEnvironment],
	},
	gameManager: {
		components: [THREEGlobalComponent, GameStateComponent],
		listen: { changed: [GameStateComponent] },
	},
	player: {
		components: [PlayerStateComponent],
		listen: { added: true, removed: true },
	},
	assetDatabase: {
		components: [AssetDatabaseComponent],
	},
	screenShotCameras: {
		components: [ScreenshotCameraComponent],
	},
};
