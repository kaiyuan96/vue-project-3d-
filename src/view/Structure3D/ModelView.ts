import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface PartInfo {
    id: string;
    name: string;
    mesh: THREE.Mesh;
    originalPos: THREE.Vector3;
    direction: THREE.Vector3;
    offset: THREE.Vector3;
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

    public init(): void {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(this.options.backgroundColor!);

        // Camera
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        this.camera.position.set(5, 5, 5);

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

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, this.options.ambientLightIntensity);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, this.options.directionalLightIntensity);
        directionalLight.position.set(5, 10, 7);
        directionalLight.castShadow = true;
        this.scene.add(directionalLight);

        const pointLight = new THREE.PointLight(0x00ff00, 0.5);
        pointLight.position.set(-5, 5, -5);
        this.scene.add(pointLight);

        // Helpers
        const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
        this.scene.add(gridHelper);

        const axesHelper = new THREE.AxesHelper(3);
        this.scene.add(axesHelper);

        // Explode group
        this.scene.add(this.explodeGroup);

        // Start animation loop
        this.animate();

        // Resize listener
        window.addEventListener('resize', this.handleResize.bind(this));
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
                const meshes: THREE.Mesh[] = [];
                this.model.traverse(child => {
                    if (child instanceof THREE.Mesh) {
                        meshes.push(child);
                    }
                });

                if (meshes.length === 0) {
                    console.warn('No mesh parts found in the model, cannot create explosion effect.');
                    return;
                }

                console.log(`Found ${meshes.length} mesh parts`);

                // Calculate world positions and center
                const worldPositions: THREE.Vector3[] = [];
                const tempPos = new THREE.Vector3();
                const tempQuat = new THREE.Quaternion();
                const tempScale = new THREE.Vector3();

                meshes.forEach(mesh => {
                    mesh.getWorldPosition(tempPos);
                    worldPositions.push(tempPos.clone());
                    this.center.add(tempPos);
                });

                this.center.divideScalar(meshes.length);
                this.controls?.target.set(this.center.x, this.center.y, this.center.z);
                this.camera?.lookAt(this.center.x, this.center.y, this.center.z);

                // Move each mesh to explodeGroup and keep world transform
                meshes.forEach((mesh, index) => {
                    mesh.getWorldPosition(tempPos);
                    mesh.getWorldQuaternion(tempQuat);
                    mesh.getWorldScale(tempScale);

                    if (mesh.parent) {
                        mesh.parent.remove(mesh);
                    }
                    this.explodeGroup.add(mesh);

                    mesh.position.copy(tempPos);
                    mesh.quaternion.copy(tempQuat);
                    mesh.scale.copy(tempScale);

                    mesh.castShadow = true;
                    mesh.receiveShadow = true;

                    // Calculate radial direction
                    const originalPos = tempPos.clone();
                    const dir = new THREE.Vector3().subVectors(originalPos, this.center).normalize();
                    if (dir.length() < 0.001) {
                        dir.set(0, 1, 0);
                    }

                    this.parts.push({
                        id: mesh.name || `part_${index}`,
                        name: mesh.name || `Part ${index}`,
                        mesh: mesh,
                        originalPos: originalPos,
                        direction: dir,
                        offset: new THREE.Vector3(0, 0, 0)
                    });
                });

                // Initialize explosion factor to 0
                this.updateExplode(0);

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
    }

    public getExplodeValue(): number {
        return this.explodeValue;
    }

    private updateExplode(factor: number): void {
        this.parts.forEach(item => {
            const globalOffset = item.direction.clone().multiplyScalar(factor);
            const newPos = item.originalPos.clone()
                .add(globalOffset)
                .add(item.offset);
            item.mesh.position.copy(newPos);
        });
    }

    public setPartColorByName(name: string, color: number): void {
        const part = this.parts.find(p => p.id === name || p.name === name);
        if (!part) {
            console.warn(`Part with name "${name}" not found.`);
            return;
        }

        const colorObj = new THREE.Color(color);
        const mesh = part.mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(mat => {
            if (mat instanceof THREE.Material && (mat as any).color) {
                (mat as any).color.copy(colorObj);
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

    private animate = (): void => {
        this.animationId = requestAnimationFrame(this.animate);
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
