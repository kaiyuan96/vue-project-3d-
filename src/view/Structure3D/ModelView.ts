import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface PartInfo {
    id: string;
    name: string;
    mesh: THREE.Object3D; // 改为 Object3D 以支持 Group 整体爆炸
    originalPos: THREE.Vector3;
    direction: THREE.Vector3;
    offset: THREE.Vector3;
    // 动画相关
    animStartTime: number;  // -1 表示无动画
    animFromFactor: number; // 动画起始系数
    animToFactor: number;   // 动画目标系数
    // 虚线连接线（展开时显示在当前位置→原始位置之间）
    dashedLine?: THREE.Line;
}

export interface ModeViewOptions {
    backgroundColor?: number;
    ambientLightIntensity?: number;
    directionalLightIntensity?: number;
    enableShadows?: boolean;
    autoRotate?: boolean;
}

export class ModeView {
    private container: HTMLElement;
    private options: ModeViewOptions;

    private scene: THREE.Scene | null = null;
    private camera: THREE.PerspectiveCamera | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private controls: OrbitControls | null = null;
    private model: THREE.Group | null = null;
    private animationId: number | null = null;
    private explodeGroup: THREE.Group = new THREE.Group();

    private parts: PartInfo[] = [];
    private center: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
    private explodeValue: number = 0;
    private activeAnimPartId: string | null = null; // 当前正在展开动画的部件ID
    private expandedPartIds: Set<string> = new Set(); // 已展开显示线条的板卡ID集合
    // 记录哪些板卡在展开动画完成后需要显示线条（延迟显示）
    private pendingLinesShow: Set<string> = new Set();
    // 每个板卡线条组的淡入动画开始时间（-1 表示非淡入状态）
    private fadeInStartTimes: Map<string, number> = new Map();
    // 淡入动画时长
    private readonly FADE_IN_DURATION = 400; // 0.4秒

    private loading: boolean = false;
    private loadingProgress: number = 0;
    private modelLoaded: boolean = false;
    private autoRotate: boolean = false;
    private wireframe: boolean = false;

    private onLoadingProgress?: (progress: number) => void;
    private onModelLoaded?: () => void;
    private onError?: (error: any) => void;

    constructor(container: HTMLElement, options: ModeViewOptions = {}) {
        this.container = container;
        this.options = {
            backgroundColor: 0x1a1a2e,
            ambientLightIntensity: 0.6,
            directionalLightIntensity: 1,
            enableShadows: true,
            autoRotate: false,
            ...options
        };
        this.autoRotate = this.options.autoRotate ?? false;
    }

    private techParticles: THREE.Points | null = null;
    private techGrid: THREE.LineSegments | null = null;
    // 板卡内部物体发散线条相关（每个板卡独立线条组）
    private partLinesGroups: Map<string, THREE.Group> = new Map();
    private boardMeshList: { 
        partId: string; 
        mesh: THREE.Mesh; 
        originalPos: THREE.Vector3;
        dirOffset: THREE.Vector3;  // 线条方向（YZ平面的偏移方向，单位向量*长度）
        dotOffset: THREE.Vector3;  // 圆点相对Mesh的偏移
        origColor: THREE.Color | null;  // 原始颜色（用于恢复）
        lineColor: THREE.Color | null;  // 线条颜色（爆炸时应用于物体）
        randomNum: number;  // 随机数，用于标签显示
    }[] = [];

    public init(): void {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        // Scene — 深空蓝黑背景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x05080f);

        // Camera
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        this.camera.position.set(-1, 0.8, -2);//x,y,z

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = this.options.enableShadows!;
        this.container.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.autoRotate = this.autoRotate;

        // ========== 加载 HDR 环境贴图 ==========
        this.loadHdrEnvironment('/relax_inn_seaview_suite_4k.hdr');

        // ========== 灯光系统 ==========
        // 环境光（提供基础照明）
        const ambientLight = new THREE.AmbientLight(0x4466ff, 0.6);
        this.scene.add(ambientLight);

        // 主光 - 暖色点光源（从右上前方）
        const mainLight = new THREE.PointLight(0xffeedd, 2.0, 20);
        mainLight.position.set(5, 8, 5);
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.width = 1024;
        mainLight.shadow.mapSize.height = 1024;
        this.scene.add(mainLight);
        // 主光辅助显示
        const mainLightHelper = new THREE.PointLightHelper(mainLight, 0.5);
        this.scene.add(mainLightHelper);

        // 补光 - 冷色点光源（从左下后方补充轮廓）
        const fillLight = new THREE.PointLight(0x4488ff, 1.2, 20);
        fillLight.position.set(-4, 2, -4);
        this.scene.add(fillLight);
        // 补光辅助显示
        const fillLightHelper = new THREE.PointLightHelper(fillLight, 0.5);
        this.scene.add(fillLightHelper);

        // 背光 - 紫色/蓝色逆光（从背后打亮轮廓）
        const backLight = new THREE.PointLight(0x8844ff, 1.0, 20);
        backLight.position.set(-2, 1, -6);
        this.scene.add(backLight);
        // 背光辅助显示
        const backLightHelper = new THREE.PointLightHelper(backLight, 0.5);
        this.scene.add(backLightHelper);

        // 底光 - 青色（从下方打亮底部细节）
        const bottomLight = new THREE.PointLight(0x00ccff, 0.6, 20);
        bottomLight.position.set(0, -4, 0);
        this.scene.add(bottomLight);
        // 底光辅助显示
        const bottomLightHelper = new THREE.PointLightHelper(bottomLight, 0.5);
        this.scene.add(bottomLightHelper);

        // 板卡光
        const boardLight = new THREE.PointLight(0xfcfcfc,35,20)
        boardLight.position.set(-2,0,-2)
        this.scene.add(boardLight)
       
        // 板卡光辅助显示
        const boardLightHelper =  new THREE.PointLightHelper(boardLight, 0.5);
        // this.scene.add(boardLightHelper)
        // ========== 辅助显示 ==========
        // 坐标轴辅助（红色X, 绿色Y, 蓝色Z），长度4
        const axesHelper = new THREE.AxesHelper(4);
        // this.scene.add(axesHelper);

        // 地面网格辅助
        // const gridHelper = new THREE.GridHelper(10, 20, 0x4488ff, 0x3366aa);
        // gridHelper.position.y = -2.5;
        // this.scene.add(gridHelper);

        // ========== 粒子星空 ==========
        const starCount = 2000;
        const starGeo = new THREE.BufferGeometry();
        const starPos = new Float32Array(starCount * 3);
        const starSizes = new Float32Array(starCount);
        for (let i = 0; i < starCount; i++) {
            starPos[i * 3] = (Math.random() - 0.5) * 80;
            starPos[i * 3 + 1] = (Math.random() - 0.5) * 80;
            starPos[i * 3 + 2] = (Math.random() - 0.5) * 80 - 20;
            starSizes[i] = 0.3 + Math.random() * 0.8;
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

        const starMat = new THREE.PointsMaterial({
            color: 0x88ccff,
            size: 0.08,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
        });
        this.techParticles = new THREE.Points(starGeo, starMat);
        this.scene!.add(this.techParticles);

        // Explode group
        this.scene.add(this.explodeGroup);

        // Start animation loop
        this.animate();

        // Resize listener
        window.addEventListener('resize', this.handleResize.bind(this));
    }

    /**
     * 加载 HDR 环境贴图作为场景的环境和背景
     */
    private loadHdrEnvironment(hdrUrl: string): void {
        if (!this.scene || !this.renderer) return;

        const rgbeLoader = new RGBELoader();
        rgbeLoader.load(
            hdrUrl,
            (texture) => {
                texture.mapping = THREE.EquirectangularReflectionMapping;

                // 使用 PMREMGenerator 生成环境贴图（支持粗糙/金属材质的正确反射）
                const pmremGenerator = new THREE.PMREMGenerator(this.renderer!);
                pmremGenerator.compileEquirectangularShader();

                const envMap = pmremGenerator.fromEquirectangular(texture).texture;
                pmremGenerator.dispose();

                // 设置场景的环境贴图（影响材质的反射/折射效果）
                this.scene!.environment = envMap;
                // 保持深空蓝黑科技风背景
                this.scene!.background = new THREE.Color(0x05080f);
                // this.scene!.environment.intensity = 0.5;  // 关键！
                console.log('✅ HDR 环境贴图加载成功:', hdrUrl);
            },
            (progress) => {
                console.log(`HDR 加载进度: ${Math.round((progress.loaded / progress.total) * 100)}%`);
            },
            (error) => {
                console.error('HDR 环境贴图加载失败:', error);
                // 加载失败时使用 RoomEnvironment 作为备用环境贴图
                const pmremGenerator = new THREE.PMREMGenerator(this.renderer!);
                const envMap = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
                this.scene!.environment = envMap;
                pmremGenerator.dispose();
                console.log('✅ 使用备用 RoomEnvironment 环境贴图');
            }
        );
    }

    public loadModel(url: string): void {
        if (!this.scene) {
            console.error('Scene not initialized. Call init() first.');
            return;
        }

        this.loading = true;
        this.loadingProgress = 0;
        const loader = new GLTFLoader();

        loader.load(
            url,
            (gltf) => {
                this.model = gltf.scene;

                // ==================== 🔍 查找所有名字包含 group_board 的分组 ====================
                // 先将整个模型居中到原点
                const fullModelBox = new THREE.Box3().setFromObject(this.model);
                const fullModelCenter = fullModelBox.getCenter(new THREE.Vector3());
                console.log('模型原始中心位置:', fullModelCenter);
                this.model.position.sub(fullModelCenter);

                // 遍历查找所有名字包含 group_board 的 Object3D
                const boardGroups: THREE.Object3D[] = [];
                this.model.traverse(child => {
                    // console.log('child', child.name, child.type);
                    if (child.name.includes('group_board')) {
                        boardGroups.push(child);
                    }
                });
                console.log('板卡分组',boardGroups)
                if (boardGroups.length === 0) {
                    console.warn('未找到包含 group_board 的分组，无法创建爆炸效果。将直接显示模型。');
                    this.scene!.add(this.model);
                    this.loading = false;
                    this.modelLoaded = true;
                    if (this.onModelLoaded) this.onModelLoaded();
                    return;
                }

                console.log(`✅ 找到 ${boardGroups.length} 个包含 group_board 的分组`);

                // ==================== 🔧 将每个 group_board 分组作为一个整体爆炸单元 ====================
                const tempPos = new THREE.Vector3();
                const tempQuat = new THREE.Quaternion();
                const tempScale = new THREE.Vector3();

                boardGroups.forEach((boardGroup, index) => {
                    // 获取当前分组的全局变换（此时模型已居中）
                    boardGroup.getWorldPosition(tempPos);
                    boardGroup.getWorldQuaternion(tempQuat);
                    boardGroup.getWorldScale(tempScale);

                    // 从模型中移除
                    if (boardGroup.parent) {
                        boardGroup.parent.remove(boardGroup);
                    }

                    // 添加到爆炸分组，保持世界变换
                    this.explodeGroup.add(boardGroup);
                    boardGroup.position.copy(tempPos);
                    boardGroup.quaternion.copy(tempQuat);
                    boardGroup.scale.copy(tempScale);

                    boardGroup.castShadow = true;
                    boardGroup.receiveShadow = true;

                    // 计算爆炸方向：整体朝 -Z，但按板卡序号做扇形发散
                    // 每块板卡基于索引分配不同的发散角度（-24° ~ +24°），保证相邻板卡错开
                    const fanRange = 0.4; // ±0.4 弧度 ≈ ±23°
                    const fanAngle = boardGroups.length > 1
                        ? (index / (boardGroups.length - 1) - 0.5) * fanRange * 2
                        : 0;
                    const dir = new THREE.Vector3(Math.sin(fanAngle) * 0.3, Math.sin(fanAngle) * 0.5, -1).normalize();

                    // 注册部件信息（含动画字段）
                    this.parts.push({
                        id: `group_board_${index}`,
                        name: boardGroup.name,
                        mesh: boardGroup,
                        originalPos: tempPos.clone(),
                        direction: dir,
                        offset: new THREE.Vector3(0, 0, 0),
                        animStartTime: -1,
                        animFromFactor: 0,
                        animToFactor: 0
                    });

                    // 递归设置子 Mesh 的阴影
                    boardGroup.traverse(child => {
                        if (child instanceof THREE.Mesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                        }
                    });
                });

                // ==================== 🏗️ 将模型其他部分添加到场景 ====================
                this.scene!.add(this.model);

                console.log(`✅ 模型已居中到世界原点 (0,0,0)，共处理 ${boardGroups.length} 个 group_board 分组`);
                this.controls?.target.set(0, 0, 0);
                this.camera?.lookAt(0, 0, 0);

                // 初始化爆炸系数为 0
                this.updateExplode(0);

                // ==================== 收集板卡内部 Mesh 并创建发散线条 ====================
                this.collectBoardMeshes();
                this.createBoardRadiatingLines();

                this.loading = false;
                this.modelLoaded = true;
                if (this.onModelLoaded) {
                    this.onModelLoaded();
                }
            },
            (progress) => {
                if (progress.lengthComputable) {
                    this.loadingProgress = Math.round((progress.loaded / progress.total) * 100);
                    if (this.onLoadingProgress) {
                        this.onLoadingProgress(this.loadingProgress);
                    }
                }
            },
            (error) => {
                console.error('Failed to load model:', error);
                this.loading = false;
                if (this.onError) {
                    this.onError(error);
                }
            }
        );
    }

    public setExplodeValue(value: number): void {
        this.explodeValue = value;
        this.updateExplode(value);

        // 爆炸系数超过阈值时，镜头聚焦到爆炸物体上
        const focusThreshold = 0.4;
        if (value >= focusThreshold) {
            this.focusOnExplodedParts();
        } else {
            // 恢复镜头对准原点
            if (this.controls) {
                this.controls.target.set(0, 0, 0);
            }
        }
    }

    public getExplodeValue(): number {
        return this.explodeValue;
    }

    private updateExplode(factor: number): void {
        this.parts.forEach(item => {
            // 全局偏移 = 方向 * 全局因子
            const globalOffset = item.direction.clone().multiplyScalar(factor);
            // 最终位置 = 原始位置 + 全局偏移 + 动画偏移
            const newPos = item.originalPos.clone()
                .add(globalOffset)
                .add(item.offset);
            item.mesh.position.copy(newPos);
        });
    }

    /**
     * 聚焦到所有爆炸部件的中心，并自动调整相机距离以容纳所有爆炸物体
     */
    private focusOnExplodedParts(): void {
        if (!this.camera || !this.controls || this.parts.length === 0) return;

        // 计算所有爆炸部件的包围盒
        const box = new THREE.Box3();
        this.parts.forEach(part => {
            box.expandByObject(part.mesh);
        });

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // 设置 OrbitControls 的目标点为包围盒中心
        this.controls.target.copy(center);

        // 计算合适的相机距离：包围盒对角线长度 + 一定的余量
        const diagonal = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
        const cameraDistance = Math.max(diagonal * 0.6, 1);

        // 从当前相机位置到目标点的方向，保持相机的角度，但调整距离
        const cameraPos = this.camera.position.clone();
        const dir = cameraPos.clone().sub(this.controls.target).normalize();
        const newCameraPos = this.controls.target.clone().add(dir.multiplyScalar(cameraDistance));
        this.camera.position.copy(newCameraPos);

        // 更新相机
        this.camera.lookAt(this.controls.target);
        this.controls.update();
    }

    public setPartColorByName(name: string, color: number): void {
        const part = this.parts.find(p => p.id === name || p.name === name);
        if (!part) {
            console.warn(`Part with name "${name}" not found.`);
            return;
        }

        const colorObj = new THREE.Color(color);

        // 如果是一个 Group，递归遍历其所有子 Mesh 设置颜色
        if (part.mesh instanceof THREE.Group) {
            part.mesh.traverse(child => {
                if (child instanceof THREE.Mesh) {
                    this.setMeshColor(child, colorObj);
                }
            });
        } else if (part.mesh instanceof THREE.Mesh) {
            this.setMeshColor(part.mesh, colorObj);
        }
    }

    private setMeshColor(mesh: THREE.Mesh, color: THREE.Color): void {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(mat => {
            if (mat instanceof THREE.Material && (mat as any).color) {
                (mat as any).color.copy(color);
            }
        });
    }

   

    public resetView(): void {
        if (!this.camera || !this.controls) return;
        this.camera.position.set(5, 5, 5);
        this.camera.lookAt(0, 0, 0);
        this.controls.reset();
    }

    public toggleAutoRotate(): void {
        this.autoRotate = !this.autoRotate;
        if (this.controls) {
            this.controls.autoRotate = this.autoRotate;
        }
    }

    public setAutoRotate(enabled: boolean): void {
        this.autoRotate = enabled;
        if (this.controls) {
            this.controls.autoRotate = enabled;
        }
    }

    public toggleWireframe(): void {
        this.wireframe = !this.wireframe;
        if (this.model) {
            this.model.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    const mesh = child;
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach((mat) => {
                            if (mat instanceof THREE.MeshStandardMaterial) {
                                mat.wireframe = this.wireframe;
                            }
                        });
                    } else if (mesh.material instanceof THREE.MeshStandardMaterial) {
                        mesh.material.wireframe = this.wireframe;
                    }
                }
            });
        }
    }

    public takeScreenshot(): string {
        if (!this.renderer) return '';
        this.renderer.render(this.scene!, this.camera!);
        return this.renderer.domElement.toDataURL('image/png');
    }

    public dispose(): void {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        window.removeEventListener('resize', this.handleResize.bind(this));
        this.renderer?.dispose();
        this.scene?.clear();
        this.container.removeChild(this.renderer!.domElement);
    }

    /** 动画时长（毫秒） */
    private readonly ANIM_DURATION = 2000; // 2秒

    /**
     * 收集所有板卡分组内部的 Mesh，记录原始世界位置
     */
    private collectBoardMeshes(): void {
        this.boardMeshList = [];
        for (const part of this.parts) {
            part.mesh.traverse(child => {
                if (!(child instanceof THREE.Mesh)) return;
                const worldPos = new THREE.Vector3();
                child.getWorldPosition(worldPos);
                
                // 暂时先收集，方向在 createBoardRadiatingLines 时再计算
                // 这里只存原始位置，dirOffset/dotOffset 先赋默认值
                this.boardMeshList.push({
                    partId: part.id,
                    mesh: child,
                    originalPos: worldPos.clone(),
                    dirOffset: new THREE.Vector3(0, 1, 0),
                    dotOffset: new THREE.Vector3(0, 1, 0),
                    origColor: null,
                    lineColor: null,
                    randomNum: Math.floor(Math.random() * 9000) + 1000,
                });
            });
        }
        console.log(`✅ 收集到 ${this.boardMeshList.length} 个板卡内部 Mesh`);
    }

    /**
     * 分配线条方向：先计算每个物体从板卡中心出发的"自然方向"，
     * 然后检测相邻物体之间的角度间隙，如果间隙小于最小间距(20°)，
     * 则在保留物体大致方向的前提下均匀展开，避免线条过于接近或交叉。
     * 
     * 算法步骤：
     * 1. 计算每个物体的自然角度 atan2(relZ, relY)
     * 2. 按角度排序
     * 3. 计算相邻间隙（含首尾环绕）
     * 4. 找到最大间隙作为"断点"（线条在此处断开不跨过）
     * 5. 在断点之外的范围均匀分布，保证最小间距
     */
    private computeSpreadDirections(items: { originalPos: THREE.Vector3 }[], partCenter: THREE.Vector3): THREE.Vector3[] {
        const n = items.length;
        if (n <= 1) {
            if (n === 0) return [];
            return [new THREE.Vector3(0, 1, 0).multiplyScalar(0.4)];
        }

        // 1. 计算自然角度 atan2(z, y)
        const entries: { index: number; angle: number }[] = items.map((item, idx) => {
            const rel = item.originalPos.clone().sub(partCenter);
            let angle = Math.atan2(rel.z, rel.y);
            // 如果正好在中心，均匀散布
            if (rel.length() < 0.001) {
                angle = (idx / n) * Math.PI * 2;
            }
            return { index: idx, angle };
        });

        // 2. 按角度排序
        entries.sort((a, b) => a.angle - b.angle);
    const sortedAngles = entries.map(e => e.angle);

    // 3. 计算相邻间隙（含首尾环绕）
    const gaps: number[] = [];
    for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        const curAngle = sortedAngles[i] ?? 0;
        const nextAngle = sortedAngles[next] ?? 0;
        let gap = nextAngle - curAngle;
        if (i === n - 1) gap += 2 * Math.PI; // 首尾环绕
        gaps.push(gap);
    }

        // 4. 最小允许间隙 = 20° (0.349 rad)，确保线条不会过于接近
        const minGap = 0.349; // 20°
        const needsSpread = gaps.some(g => g < minGap);

        const result: THREE.Vector3[] = new Array(n);
        const lineLen = 0.4; // 发散线段长度

        if (!needsSpread) {
            // 间隙都足够大，直接使用自然角度
            entries.forEach(e => {
                result[e.index] = new THREE.Vector3(0, Math.cos(e.angle), Math.sin(e.angle)).multiplyScalar(lineLen);
            });
            return result;
        }

        // 5. 找到最大间隙作为断点
        let maxGapIdx = 0;
        let maxGap = gaps[0] || 0;
        for (let i = 1; i < n; i++) {
            const g = gaps[i] || 0;
            if (g > maxGap) {
                maxGap = g;
                maxGapIdx = i;
            }
        }

        // 6. 从断点之后开始，在剩余角度内均匀分布
        const startIdx = (maxGapIdx + 1) % n;
        const remainingAngle = 2 * Math.PI - maxGap;
        
        // 在剩余范围内均匀分配，保证顺序（从断点后顺时针排列）
        const startAngle = sortedAngles[startIdx] ?? 0;
        for (let i = 0; i < n; i++) {
            const entryIdx = (startIdx + i) % n;
            const t = i / (n - 1); // 0 ~ 1
            const entry = entries[entryIdx];
            if (!entry) continue;
            const newAngle = startAngle + t * remainingAngle;
            result[entry.index] = new THREE.Vector3(0, Math.cos(newAngle), Math.sin(newAngle)).multiplyScalar(lineLen);
        }

        return result;
    }

    /**
     * 创建文本标签 Sprite（Canvas 纹理 + 透明度背景）
     * 使用高分辨率 Canvas 渲染清晰文字，再通过 Sprite scale 控制显示大小
     */
    private createTextSprite(text: string, color: THREE.Color): THREE.Sprite {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        
        // 背景（半透明暗色圆角矩形）
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.roundRect(4, 4, 248, 56, 8);
        ctx.fill();
        
        // 文字 — 大字号高分辨率渲染
        ctx.font = 'bold 24px "Microsoft YaHei", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
        ctx.fillText(text, 128, 32);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        
        const spriteMat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        });
        const sprite = new THREE.Sprite(spriteMat);
        // 显示大小保持小巧，但纹理分辨率高所以文字清晰
        sprite.scale.set(0.5, 0.14, 1);
        return sprite;
    }

    /**
     * 创建折线几何体：物体 → 发散线段(沿方向到终点) → Z方向短线段
     * p0=物体, p1=发散线终点(=p0+dirOffset), p2=从p1向Z方向走一小段
     * 拐线方向取决于线条的 Z 方向符号
     */
    private createPolylineGeometry(start: THREE.Vector3, dirOffset: THREE.Vector3): { geometry: THREE.BufferGeometry; labelPos: THREE.Vector3 } {
        const targetZ = Math.abs(dirOffset.z) < 0.1 ? 1 : Math.sign(dirOffset.z);
        const zBend = 0.25; // Z方向线段长度
        
        const p0 = start.clone();
        const p1 = start.clone().add(dirOffset); // 发散线段终点
        const p2 = p1.clone().add(new THREE.Vector3(0, 0, targetZ * zBend)); // Z方向线段终点
        
        return {
            geometry: new THREE.BufferGeometry().setFromPoints([p0, p1, p2]),
            labelPos: p2,
        };
    }

    /**
     * 为所有板卡创建独立线条组（每个 partId 一个 Group，包含折线+圆点+标签）
     * 每块板卡最多创建 10 条折线
     */
    private createBoardRadiatingLines(): void {
        if (!this.scene) return;

        // 清除旧的线条组
        for (const [pid, group] of this.partLinesGroups) {
            this.scene!.remove(group);
        }
        this.partLinesGroups.clear();

        const partMap = new Map<string, THREE.Vector3>();
        for (const p of this.parts) {
            partMap.set(p.id, p.originalPos);
        }

        const partIds = [...new Set(this.boardMeshList.map(item => item.partId))];
        let totalLines = 0;

        for (const partId of partIds) {
            const partItems = this.boardMeshList.filter(item => item.partId === partId).slice(0, 10);
            if (partItems.length === 0) continue;

            const partCenter = partMap.get(partId) || new THREE.Vector3(0, 0, 0);
            const dirs = this.computeSpreadDirections(partItems, partCenter);

            // 每个板卡独立 Group
            const pg = new THREE.Group();
            pg.name = `PartLines_${partId}`;

            partItems.forEach((item, localIndex) => {
                const dirOffset = dirs[localIndex] || new THREE.Vector3(0, 1, 0);

                item.dirOffset.copy(dirOffset);
                item.dotOffset.copy(dirOffset);

                const worldPos = new THREE.Vector3();
                item.mesh.getWorldPosition(worldPos);

                const hue = ((totalLines + localIndex) * 0.618033988749895) % 1.0;
                const color = new THREE.Color().setHSL(hue, 0.8, 0.6);

                const { geometry: polyGeo, labelPos } = this.createPolylineGeometry(worldPos, dirOffset);
                const mat = new THREE.LineBasicMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.7,
                });
                const line = new THREE.Line(polyGeo, mat);
                line.name = `radiate_line_${item.partId}_${localIndex}`;
                pg.add(line);

                item.lineColor = color.clone();
                if (item.origColor === null) {
                    const m = Array.isArray(item.mesh.material) ? item.mesh.material[0] : item.mesh.material;
                    if (m && (m as any).color) {
                        item.origColor = (m as any).color.clone();
                    } else {
                        item.origColor = new THREE.Color(0xffffff);
                    }
                }

                const dotGeo = new THREE.SphereGeometry(0.04, 6, 6);
                const dotMat = new THREE.MeshBasicMaterial({
                    color: color,
                    transparent: true,
                    opacity: 0.9,
                });
                const dot = new THREE.Mesh(dotGeo, dotMat);
                dot.position.copy(labelPos);
                dot.name = `radiate_dot_${item.partId}_${localIndex}`;
                pg.add(dot);

                const labelText = `${item.mesh.name || 'Mesh'} ${item.randomNum}`;
                const label = this.createTextSprite(labelText, color);
                label.position.copy(labelPos);
                label.name = `radiate_label_${item.partId}_${localIndex}`;
                pg.add(label);
            });

            pg.visible = false;
            this.scene!.add(pg);
            this.partLinesGroups.set(partId, pg);
            totalLines += partItems.length;
        }

        console.log(`✅ 创建了 ${totalLines} 条发散折线，${this.partLinesGroups.size} 个独立板卡线条组`);
    }

    /**
     * 更新指定板卡的发散线条到展开后的位置
     * 直接用板卡分组的世界位置（part.mesh.position 已包含所有偏移）
     */
    private updateBoardRadiatingLines(partId: string, factor: number): void {
        if (!this.scene || this.boardMeshList.length === 0) return;

        const part = this.parts.find(p => p.id === partId);
        if (!part) return;

        // 直接使用板卡分组当前的世界位置（已经包含全局偏移+动画偏移）
        const finalGroupPos = part.mesh.position.clone();

        const partItems = this.getPartMeshes(partId);
        if (partItems.length === 0) return;

        // 计算子 Mesh 相对于板卡分组的偏移位置
        const dirs = this.computeSpreadDirections(
            partItems.map(item => ({
                originalPos: finalGroupPos.clone().add(item.originalPos.clone().sub(part.originalPos))
            })),
            finalGroupPos
        );

        const linesGroup = this.partLinesGroups.get(partId);
        if (!linesGroup) return;

        partItems.forEach((item, localIndex) => {
            const relOffset = item.originalPos.clone().sub(part.originalPos);
            const worldPos = finalGroupPos.clone().add(relOffset);
            const dirOffset = dirs[localIndex] || new THREE.Vector3(0, 1, 0);

            const lineName = `radiate_line_${item.partId}_${localIndex}`;
            const dotName = `radiate_dot_${item.partId}_${localIndex}`;
            const labelName = `radiate_label_${item.partId}_${localIndex}`;

            const line = linesGroup.getObjectByName(lineName) as THREE.Line | null;
            const dot = linesGroup.getObjectByName(dotName) as THREE.Mesh | null;
            const label = linesGroup.getObjectByName(labelName) as THREE.Sprite | null;

            if (line) {
                const { geometry: newGeo, labelPos } = this.createPolylineGeometry(worldPos, dirOffset);
                line.geometry.dispose();
                line.geometry = newGeo;
                if (dot) dot.position.copy(labelPos);
                if (label) label.position.copy(labelPos);
            } else {
                if (dot) {
                    dot.position.copy(worldPos.clone().add(dirOffset));
                }
                if (label) {
                    const lp = worldPos.clone().add(dirOffset).add(new THREE.Vector3(0, 0.25, dirOffset.z * 0.15));
                    label.position.copy(lp);
                }
            }
        });
    }

    private animate = (): void => {
        this.animationId = requestAnimationFrame(this.animate);

        const now = performance.now();
        let hasActiveAnim = false;

        // ===== 淡入动画更新（每个板卡独立） =====
        for (const [fadePartId, startTime] of this.fadeInStartTimes) {
            const elapsed = now - startTime;
            const t = Math.min(elapsed / this.FADE_IN_DURATION, 1);
            // ease-out cubic
            const eased = 1 - Math.pow(1 - t, 3);
            
            const linesGroup = this.partLinesGroups.get(fadePartId);
            if (!linesGroup) {
                this.fadeInStartTimes.delete(fadePartId);
                continue;
            }

            // 透明度淡入
            linesGroup.traverse(child => {
                if (child instanceof THREE.Line) {
                    (child.material as THREE.LineBasicMaterial).opacity = eased * 0.7; // 原始0.7
                }
                if (child instanceof THREE.Mesh) {
                    (child.material as THREE.MeshBasicMaterial).opacity = eased * 0.9; // 原始0.9
                }
                if (child instanceof THREE.Sprite) {
                    (child.material as THREE.SpriteMaterial).opacity = eased;
                }
            });

            // 缩放弹入：从0.8 → 1.0 再轻微 overshoot 到 1.05 后回到 1.0
            const scaleT = Math.min(t * 1.5, 1); // 缩放更快完成
            const scale = scaleT < 1
                ? 0.8 + (1.0 - 0.8) * (1 - Math.pow(1 - scaleT, 3)) // ease-out
                : 1.0 + 0.05 * Math.sin((scaleT - 1) * Math.PI); // 轻微弹性
            linesGroup.scale.set(scale, scale, scale);

            // 虚线透明度淡入
            const part = this.parts.find(p => p.id === fadePartId);
            if (part && part.dashedLine) {
                const mat = part.dashedLine.material as THREE.LineDashedMaterial;
                mat.opacity = eased * 0.6; // 原始0.6
            }

            if (t >= 1) {
                // 恢复原始缩放
                linesGroup.scale.set(1, 1, 1);
                this.fadeInStartTimes.delete(fadePartId);
            } else {
                hasActiveAnim = true;
            }
        }

        // 更新所有正在动画中的部件
        this.parts.forEach(item => {
            if (item.animStartTime < 0) return; // 无动画

            const elapsed = now - item.animStartTime;
            const t = Math.min(elapsed / this.ANIM_DURATION, 1);

            // 缓动函数：ease-out cubic -> 先快后慢更自然
            const eased = 1 - Math.pow(1 - t, 3);
            const currentLen = item.animFromFactor + (item.animToFactor - item.animFromFactor) * eased;

            // 更新 offset 为当前帧的目标长度（沿原方向）
            const dirNorm = item.direction.clone().normalize();
            item.offset.copy(dirNorm.multiplyScalar(currentLen));

            if (t >= 1) {
                // 动画结束
                item.animStartTime = -1;
                // 确保最终位置精确
                const finalOffset = item.direction.clone().normalize().multiplyScalar(item.animToFactor);
                item.offset.copy(finalOffset);

                // 立即更新 mesh 位置，确保后续 showPartLines 能拿到正确位置
                const globalOffset = item.direction.clone().multiplyScalar(this.explodeValue);
                const newPos = item.originalPos.clone().add(globalOffset).add(item.offset);
                item.mesh.position.copy(newPos);

                // 如果该板卡有延迟显示的标记 → 显示线条、颜色和虚线
                if (this.pendingLinesShow.has(item.id)) {
                    this.pendingLinesShow.delete(item.id);
                    this.showPartLines(item.id, item.animToFactor);
                }
            } else {
                hasActiveAnim = true;
            }

            // 更新虚线连接线位置（如果存在）
            if (item.dashedLine) {
                const currentPos = item.mesh.position.clone();
                const origPos = item.originalPos.clone();
                const geo = new THREE.BufferGeometry().setFromPoints([currentPos, origPos]);
                item.dashedLine.geometry.dispose();
                item.dashedLine.geometry = geo;
                item.dashedLine.computeLineDistances();
            }
        });

        // 更新位置（只要有动画中部件就更新）
        const activeFollowId = this.activeAnimPartId;
        if (hasActiveAnim || activeFollowId) {
            this.updateExplode(this.explodeValue);

            // 镜头始终跟随当前动画中的部件（固定相机位置，仅旋转角度）
            if (activeFollowId && this.controls) {
                const activePart = this.parts.find(p => p.id === activeFollowId);
                if (activePart) {
                    const box = new THREE.Box3().setFromObject(activePart.mesh);
                    const center = box.getCenter(new THREE.Vector3());
                    // 固定相机位置不变，只更新目标点让相机旋转朝向部件
                    this.controls.target.copy(center);
                }
            }
        }

        this.controls?.update();
        this.renderer?.render(this.scene!, this.camera!);
    };

    private handleResize = (): void => {
        if (!this.camera || !this.renderer) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    };

    // Getters and setters
    public getLoading(): boolean { return this.loading; }
    public getLoadingProgress(): number { return this.loadingProgress; }
    public isModelLoaded(): boolean { return this.modelLoaded; }
    public getAutoRotate(): boolean { return this.autoRotate; }
    public getWireframe(): boolean { return this.wireframe; }

    public setOnLoadingProgress(callback: (progress: number) => void): void {
        this.onLoadingProgress = callback;
    }

    public setOnModelLoaded(callback: () => void): void {
        this.onModelLoaded = callback;
    }

    public setOnError(callback: (error: any) => void): void {
        this.onError = callback;
    }

    /**
     * 为指定板卡创建或更新虚线连接线（当前位置 → 原始位置）
     */
    private updateDashedLine(part: PartInfo): void {
        if (!this.scene) return;

        const currentPos = part.mesh.position.clone();
        const origPos = part.originalPos.clone();

        // 如果虚线已存在，更新几何体
        if (part.dashedLine) {
            const geo = new THREE.BufferGeometry().setFromPoints([currentPos, origPos]);
            part.dashedLine.geometry.dispose();
            part.dashedLine.geometry = geo;
            part.dashedLine.computeLineDistances();
            return;
        }

        // 创建新的虚线
        const geo = new THREE.BufferGeometry().setFromPoints([currentPos, origPos]);
        const mat = new THREE.LineDashedMaterial({
            color: 0x88ccff,
            dashSize: 0.03,
            gapSize: 0.03,
            transparent: true,
            opacity: 0.6,
        });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        line.name = `dashed_line_${part.id}`;
        this.scene.add(line);
        part.dashedLine = line;
    }

    /**
     * 移除指定板卡的虚线连接线
     */
    private removeDashedLine(part: PartInfo): void {
        if (part.dashedLine) {
            if (this.scene) {
                this.scene.remove(part.dashedLine);
            }
            part.dashedLine.geometry.dispose();
            part.dashedLine = undefined;
        }
    }

    /**
     * 获取指定板卡的前 N 个 Mesh（每个板卡独立获取，互不干扰）
     */
    private getPartMeshes(partId: string, maxCount: number = 10): typeof this.boardMeshList {
        return this.boardMeshList.filter(item => item.partId === partId).slice(0, maxCount);
    }

    /**
     * 隐藏指定板卡的发散线条和颜色，移除虚线
     */
    private hidePartLines(partId: string): void {
        if (!this.expandedPartIds.has(partId)) return;
        this.expandedPartIds.delete(partId);

        // 恢复该板卡下所有 Mesh 的原始颜色（按板卡独立获取）
        this.getPartMeshes(partId).forEach(item => {
            if (item.origColor) {
                this.setMeshColor(item.mesh, item.origColor);
            }
        });

        // 隐藏该板卡的独立线条组
        const linesGroup = this.partLinesGroups.get(partId);
        if (linesGroup) {
            linesGroup.visible = false;
        }

        // 移除虚线连接线
        const part = this.parts.find(p => p.id === partId);
        if (part) {
            this.removeDashedLine(part);
        }
    }

    /**
     * 显示指定板卡的发散线条和颜色，创建虚线
     * 带动画效果：渐变淡入 + 小幅度缩放弹入
     */
    private showPartLines(partId: string, factor: number): void {
        if (!this.partLinesGroups.has(partId)) return;
        this.expandedPartIds.add(partId);

        // 获取该板卡的线条组
        const linesGroup = this.partLinesGroups.get(partId)!;
        linesGroup.visible = true;

        // 更新该板卡对应的发散线条位置
        this.updateBoardRadiatingLines(partId, factor);

        // 将该板卡下所有 Mesh 涂成线条颜色（按板卡独立获取）
        this.getPartMeshes(partId).forEach(item => {
            if (item.lineColor) {
                this.setMeshColor(item.mesh, item.lineColor);
            }
        });

        // 创建虚线连接线
        const part = this.parts.find(p => p.id === partId);
        if (part) {
            this.updateDashedLine(part);
        }

        // === 启动淡入+弹入动画 ===

        // 设置虚线初始透明度
        if (part && part.dashedLine) {
            (part.dashedLine.material as THREE.LineDashedMaterial).opacity = 0;
        }

        // 线条组内所有材质透明度归零
        linesGroup.traverse(child => {
            if (child instanceof THREE.Line) {
                (child.material as THREE.LineBasicMaterial).opacity = 0;
            }
            if (child instanceof THREE.Mesh) {
                (child.material as THREE.MeshBasicMaterial).opacity = 0;
            }
            if (child instanceof THREE.Sprite) {
                (child.material as THREE.SpriteMaterial).opacity = 0;
            }
        });

        // 初始缩放为 80%，从稍小开始弹入
        linesGroup.scale.set(0.8, 0.8, 0.8);

        // 记录淡入开始时间
        this.fadeInStartTimes.set(partId, performance.now());
    }

    /**
     * 切换指定分组的爆炸偏移（点击板卡时触发，带2秒平滑动画）
     * 
     * 规则：
     * - 任何时候最多只有一个板卡显示线条和文字
     * - 展开新板卡时，先取消旧板卡的线条，再显示新板卡的
     * - 关闭板卡时，清除线条和文字
     * 
     * @param partId 分组ID
     * @param factor 爆炸系数，默认1.8
     * @returns true=已展开，false=已收回
     */
    public toggleGroupExplode(partId: string, factor: number = 1.8): boolean {
        const part = this.parts.find(p => p.id === partId);
        if (!part) {
            console.warn(`Part with id "${partId}" not found.`);
            return false;
        }

        // 检查当前是否已展开（offset长度>0表示已展开）
        const currentOffsetLen = part.offset.length();
        if (currentOffsetLen > 0.01) {
            // 已展开 → 启动收回动画（从当前长度到0）
            part.animStartTime = performance.now();
            part.animFromFactor = currentOffsetLen;
            part.animToFactor = 0;

            // 隐藏该板卡的发散线条和颜色，移除虚线
            this.hidePartLines(partId);

            // 镜头对准：如果有其他已展开的板卡（offset>0），对准它；否则对准收回的板卡
            const otherExpandedPart = this.parts.find(p => p.id !== partId && p.offset.length() > 0.01);
            if (otherExpandedPart) {
                this.activeAnimPartId = otherExpandedPart.id;
            } else {
                this.activeAnimPartId = partId;
            }
            return false;
            
        } else {
            // 未展开 → 展开动画
            part.animStartTime = performance.now();
            part.animFromFactor = 0;
            part.animToFactor = factor;
            // 设置镜头跟随此部件
            this.activeAnimPartId = partId;

            // 标记此板卡：动画完成后显示线条
            this.pendingLinesShow.add(partId);
          
            return true;
        }
    }

    public getParts(): PartInfo[] {
        return this.parts;
    }

    public getScene(): THREE.Scene | null {
        return this.scene;
    }

    public getCamera(): THREE.PerspectiveCamera | null {
        return this.camera;
    }

    public getRenderer(): THREE.WebGLRenderer | null {
        return this.renderer;
    }

    public getControls(): OrbitControls | null {
        return this.controls;
    }
}
