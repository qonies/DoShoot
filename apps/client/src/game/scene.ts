/** Three.js 场景：正交俯视角相机、地面/墙体渲染、灯光阴影、坐标投影与镜头震动（FR-U1/C2） */

import * as THREE from 'three';
import {
  DEFAULT_MAP,
  WALL_HEIGHT,
  isWall,
  type GameMap,
} from '@DoShoot/shared';

export class GameScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;

  private readonly viewSize = 20;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly canvas: HTMLCanvasElement;
  /** 镜头震动幅度（由开火后坐力触发，随时间衰减） */
  private shake = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly hitPoint = new THREE.Vector3();
  private readonly proj = new THREE.Vector3();
  private readonly onResize = (): void => this.handleResize();

  constructor(canvas: HTMLCanvasElement, map: GameMap = DEFAULT_MAP) {
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

    this.handleResize();
    window.addEventListener('resize', this.onResize);
  }

  private buildGround(map: GameMap): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(map.width, map.height),
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

  /** 鼠标 NDC → 地面 y=0 平面世界坐标（FR-C2 瞄准） */
  screenToGround(ndcX: number, ndcY: number, out: THREE.Vector2): void {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint)) {
      out.set(this.hitPoint.x, this.hitPoint.z);
    }
  }

  /** 世界坐标 → 屏幕像素坐标（伤害飘字定位用） */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    this.proj.set(x, 0, y).project(this.camera);
    return {
      x: (this.proj.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.proj.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  /** 开火后坐力镜头震动（FR-W2 表现） */
  addShake(amount: number): void {
    this.shake = Math.min(0.6, this.shake + amount);
  }

  /** 画质分档（FR-L5，M4）：高 = 原生 DPR（≤2）+ 阴影；中 = DPR 1 + 阴影；低 = DPR 1 + 无阴影 */
  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    const shadows = q !== 'low';
    if (this.dirLight.castShadow !== shadows) {
      this.dirLight.castShadow = shadows;
      // 阴影开关变化需重编译材质程序
      this.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.Material | THREE.Material[];
          if (Array.isArray(m)) m.forEach((mat) => (mat.needsUpdate = true));
          else m.needsUpdate = true;
        }
      });
    }
  }

  /** 每帧推进震动衰减 */
  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  /** 相机跟随玩家（正交框随窗口比例更新；叠加震动抖动） */
  follow(x: number, y: number): void {
    const j = this.shake;
    this.camera.position.set(
      x + (Math.random() - 0.5) * j,
      22,
      y + 12 + (Math.random() - 0.5) * j,
    );
    this.camera.lookAt(x, 0, y);
    this.dirLight.position.set(x + 8, 30, y + 6);
    this.dirLight.target.position.set(x, 0, y);
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

  /** 释放 GPU 资源与窗口监听（对局销毁时调用） */
  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    // 深度释放场景内全部网格资源（含 InstancedMesh/Line：墙体、地面、实体、曳光）
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((mat) => mat.dispose());
        else m.dispose();
      }
    });
    this.renderer.dispose();
    // 注意：这里不调用 forceContextLoss()——同一 canvas 上重建 renderer 时 getContext
    // 返回的仍是已丢失的上下文（除非显式 restoreContext），会导致第二次进局黑屏。
    // renderer.dispose() 已释放 GPU 资源，上下文可跨对局安全复用。
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}