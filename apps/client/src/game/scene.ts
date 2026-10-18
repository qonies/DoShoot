/** Three.js 场景：正交俯视角相机、地面/墙体渲染、灯光阴影、射击盒子（M0 验收项） */

import * as THREE from 'three';
import {
  DEFAULT_MAP,
  MAP_WIDTH,
  MAP_HEIGHT,
  WALL_HEIGHT,
  isWall,
  type AABB,
  type GameMap,
} from '@deadshot/shared';

/** 射击盒子（FR-C2：M0 用作射线命中目标） */
export class DummyTarget {
  readonly aabb: AABB;
  private readonly mat: THREE.MeshStandardMaterial;
  private flashUntil = 0;

  constructor(public readonly mesh: THREE.Mesh) {
    this.mat = mesh.material as THREE.MeshStandardMaterial;
    this.mat.emissive.setHex(0xff3333);
    this.mat.emissiveIntensity = 0;
    mesh.updateMatrixWorld();
    const p = mesh.position;
    const s = 0.45;
    this.aabb = { minX: p.x - s, minY: p.z - s, maxX: p.x + s, maxY: p.z + s };
  }

  flash(nowMs: number): void {
    this.flashUntil = nowMs + 150;
    this.mat.emissiveIntensity = 1.4;
  }

  update(nowMs: number): void {
    if (this.flashUntil !== 0 && nowMs >= this.flashUntil) {
      this.mat.emissiveIntensity = 0;
      this.flashUntil = 0;
    }
  }
}

const DUMMY_POSITIONS: Array<[number, number]> = [
  [10, 20],
  [20, 10],
  [30, 20],
  [20, 30],
];

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly dummyTargets: DummyTarget[] = [];

  private readonly viewSize = 20;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, map = DEFAULT_MAP) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.background = new THREE.Color(0x0d1116);

    // 正交俯视角相机（略带偏移以呈现伪 3D 立体感，见技术路线「渲染」）
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 120);

    // 灯光：半球环境光 + 投影平行光
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x30281e, 0.9));
    this.dirLight = new THREE.DirectionalLight(0xfff2df, 2.0);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.camera.left = -22;
    this.dirLight.shadow.camera.right = 22;
    this.dirLight.shadow.camera.top = 22;
    this.dirLight.shadow.camera.bottom = -22;
    this.dirLight.shadow.camera.near = 1;
    this.dirLight.shadow.camera.far = 80;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.buildGround(map);
    this.buildWalls(map);
    this.buildDummies();

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  private buildGround(map: GameMap): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT),
      new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(map.width / 2, 0, map.height / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private buildWalls(map: GameMap): void {
    const cells: Array<[number, number]> = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (isWall(map, x, y)) cells.push([x, y]);
      }
    }
    const geo = new THREE.BoxGeometry(1, WALL_HEIGHT, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x55606c, roughness: 0.85 });
    const walls = new THREE.InstancedMesh(geo, mat, cells.length);
    walls.castShadow = true;
    walls.receiveShadow = true;
    const m = new THREE.Matrix4();
    cells.forEach(([x, y], i) => {
      m.makeTranslation(x + 0.5, WALL_HEIGHT / 2, y + 0.5);
      walls.setMatrixAt(i, m);
    });
    walls.instanceMatrix.needsUpdate = true;
    this.scene.add(walls);
  }

  private buildDummies(): void {
    const geo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
    for (const [x, y] of DUMMY_POSITIONS) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xc2703e, roughness: 0.6 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0.45, y);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.dummyTargets.push(new DummyTarget(mesh));
    }
  }

  /** 相机跟随玩家（正交框随窗口比例更新） */
  follow(x: number, y: number): void {
    this.camera.position.set(x, 22, y + 12);
    this.camera.lookAt(x, 0, y);
    this.dirLight.position.set(x + 8, 30, y + 6);
    this.dirLight.target.position.set(x, 0, y);
  }

  updateDummies(nowMs: number): void {
    for (const d of this.dummyTargets) d.update(nowMs);
  }

  handleResize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.left = (-this.viewSize * aspect) / 2;
    this.camera.right = (this.viewSize * aspect) / 2;
    this.camera.top = this.viewSize / 2;
    this.camera.bottom = -this.viewSize / 2;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
