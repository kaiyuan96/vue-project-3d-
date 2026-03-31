<script setup lang="ts">
import { ref, onMounted, onUnmounted,watch } from 'vue'
import * as THREE from 'three' //引入threejs
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js' //引入gltf加载器，threejs扩展库
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'//引入控制器，threejs扩展库

const containerRef = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const loadingProgress = ref(0)
const modelLoaded = ref(false)
const autoRotate = ref(false)
const wireframe = ref(false)
const explodeValue = ref(0)
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let renderer: THREE.WebGLRenderer | null = null
let controls: OrbitControls | null = null
let model: THREE.Group | null = null
let animationId: number | null = null
let center = new THREE.Vector3(0, 0, 0);        // 爆炸中心 (所有部件位置的平均值)
// 部件列表: 每个部件包含 mesh, 原始位置(世界坐标), 径向单位方向
const parts = ref([]);
// --- 核心数据结构 ---
  let explodeGroup = new THREE.Group();           // 用于容纳所有独立部件
watch(explodeValue,(oldExplodeValue,newExplodeValue)=>{
  console.log('爆炸系数',newExplodeValue)
  updateExplode(newExplodeValue)
})
// 初始化场景
const initScene = () => {
  if (!containerRef.value) return

  const container = containerRef.value
  const width = container.clientWidth
  const height = container.clientHeight

  // 创建场景
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)

  // 创建相机
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
  camera.position.set(5, 5, 5)

  // 创建渲染器
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true
  container.appendChild(renderer.domElement)

  // 添加控制器
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.autoRotate = autoRotate.value

  // 添加灯光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
  directionalLight.position.set(5, 10, 7)
  directionalLight.castShadow = true
  scene.add(directionalLight)

  const pointLight = new THREE.PointLight(0x00ff00, 0.5)
  pointLight.position.set(-5, 5, -5)
  scene.add(pointLight)

  // 添加网格辅助线
  const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222)
  scene.add(gridHelper)

  // 添加坐标轴辅助线
  const axesHelper = new THREE.AxesHelper(3)
  scene.add(axesHelper)
  
  scene.add(explodeGroup);
  // 加载模型
  loadModel()

  // 开始渲染循环
  animate()

  // 监听窗口大小变化
  window.addEventListener('resize', handleResize)
}

// 加载 GLB 模型
const loadModel = () => {
  const loader = new GLTFLoader()
  
  loader.load(
    // '/car/scene.gltf',
    // '/carae86.glb',
    '/computerModel.glb',

    (gltf) => {
      model = gltf.scene
      const meshes = []
      model.traverse(child=>{
        if(child.isMesh){
          meshes.push(child)
        }
      })
      if(meshes.length===0){
        console.warn('模型中没有找到网络部件，无法实现爆炸效果')
        return
      }
      console.log(`找到${meshes.length}个网格部件`)
      //第2步，计算所有网格的世界位置，并临时存储，同时累加计算中心
      const worldPositions = []
      const tempPos = new THREE.Vector3()
      const tempQuat = new THREE.Quaternion()
      const tempScale = new THREE.Vector3();

      meshes.forEach(mesh=>{
        mesh.getWorldPosition(tempPos)
        worldPositions.push(tempPos.clone())

        center.add(tempPos)
      })
      center.divideScalar(meshes.length);
      controls?.target.set(center.x,center.y,center.z)
      camera?.lookAt(center.x,center.y,center.z);
      //第3步，将每个网格从原父级移除，添加到explodeGroup，
      // 并保持世界变幻不变
      meshes.forEach((mesh,index)=>{
        mesh.getWorldPosition(tempPos);
        mesh.getWorldQuaternion(tempQuat)
        mesh.getWorldScale(tempScale)
        if(mesh.parent){
          mesh.parent.remove(mesh)
        }
        explodeGroup.add(mesh)
         // 恢复世界变换 (设置局部位置/旋转/缩放，因为父节点现在是 explodeGroup，且 explodeGroup 位于世界原点无变换)
        // 这样 mesh 就保持原来的世界位置/旋转/缩放
        mesh.position.copy(tempPos);
        mesh.quaternion.copy(tempQuat);
        mesh.scale.copy(tempScale);

        // 确保网格能够投射和接收阴影
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // 计算径向方向 (从中心指向部件原始位置)
        const originalPos = tempPos.clone(); // 已经存储了
        const dir = new THREE.Vector3().subVectors(originalPos, center).normalize();
        
        // 处理中心点上的特殊情况 (方向为零向量)
        if (dir.length() < 0.001) {
            dir.set(0, 1, 0); // 随意给一个向上方向，或者保持不动也可
        }

        // 存入 parts 列表
        parts.value.push({
            id:mesh.name,
            name:mesh.name,
            mesh: mesh,
            originalPos: originalPos.clone(),
            direction: dir,
            offset:new THREE.Vector3(0,0,0),//个体偏移初始化为零
        });

         
      })
      // 初始化滑块值为0，确保模型位置不变
      updateExplode(0);
      // 停止自动旋转稍微等待用户交互，或者保持自动旋转
      // 为了更好体验，当用户滑动滑块时暂停自动旋转，不过这里不强制
        // 使用示例：将名为 "pCube511_BaseBoardM_0" 的部件设为红色，主版
      //   GlassFront_GlassM_0玻璃
      setPartColorByName('pCube1235_Case_BackplateM_0', 0x33FF33);

      // gltf.scene.traverse((child) =>{
      //   console.log('遍历场景',child)
      // })
      // // 计算模型边界并居中
      // const box = new THREE.Box3().setFromObject(model)
      // const center = box.getCenter(new THREE.Vector3())
      // const size = box.getSize(new THREE.Vector3())
      
      // model.position.sub(center)
      
      // // 根据模型大小调整相机位置
      // const maxDim = Math.max(size.x, size.y, size.z)
      // const distance = maxDim * 2
      
      // if (camera) {
      //   camera.position.set(distance, distance, distance)
      //   camera.lookAt(0, 0, 0)
      // }
      
      // // 启用阴影
      // model.traverse((child) => {
      //   if ((child as THREE.Mesh).isMesh) {
      //     const mesh = child as THREE.Mesh
      //     mesh.castShadow = true
      //     mesh.receiveShadow = true
      //   }
      // })
      
      // scene?.add(model)
      loading.value = false
      modelLoaded.value = true
    },
    (progress) => {
      if (progress.lengthComputable) {
        loadingProgress.value = Math.round((progress.loaded / progress.total) * 100)
      }
    },
    (error) => {
      console.error('加载模型失败:', error)
      loading.value = false
    }
  )
}
const updateExplode=(factor)=>{
  parts.value.forEach(item => {
        // 新位置 = 原始位置 + 方向 * 因子 +偏移
        // 注意: 方向是单位向量，因子控制距离
        const globalOffset = item.direction.clone().multiplyScalar(factor);
        const newPos = item.originalPos.clone()
            .add(globalOffset)
            .add(item.offset);
        item.mesh.position.copy(newPos);
    });
    
    // 更新滑块显示值
    // valueSpan.textContent = factor.toFixed(2);
}
const setPartColorByName=(name,color)=>{
  const part = parts.value.find(p => p.id === name);
  if (!part) {
      console.warn(`未找到名为 "${name}" 的部件`);
      return;
  }
  console.log('part',part)
  const colorObj = new THREE.Color(color);
  const mesh = part.mesh;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach(mat => {
      mat.color.copy(colorObj);
      console.log('mat',mat.color)
  });
}
// 渲染循环
const animate = () => {
  animationId = requestAnimationFrame(animate)
  controls?.update()
  renderer?.render(scene!, camera!)
}

// 窗口大小变化处理
const handleResize = () => {
  if (!containerRef.value || !camera || !renderer) return
  
  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight
  
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

// 重置视角
const resetView = () => {
  if (!camera || !controls) return
  camera.position.set(5, 5, 5)
  camera.lookAt(0, 0, 0)
  controls.reset()
}

// 切换自动旋转
const toggleAutoRotate = () => {
  autoRotate.value = !autoRotate.value
  if (controls) {
    controls.autoRotate = autoRotate.value
  }
}

// 切换线框模式
const toggleWireframe = () => {
  wireframe.value = !wireframe.value
  if (model) {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => {
            if (mat instanceof THREE.MeshStandardMaterial) {
              mat.wireframe = wireframe.value
            }
          })
        } else if (mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.wireframe = wireframe.value
        }
      }
    })
  }
}

// 截图
const takeScreenshot = () => {
  if (!renderer) return
  renderer.render(scene!, camera!)
  const dataURL = renderer.domElement.toDataURL('image/png')
  const link = document.createElement('a')
  link.download = 'model-screenshot.png'
  link.href = dataURL
  link.click()
}

// 切换全屏
const toggleFullscreen = () => {
  if (!containerRef.value) return
  
  if (!document.fullscreenElement) {
    containerRef.value.requestFullscreen()
  } else {
    document.exitFullscreen()
  }
}

onMounted(() => {
  initScene()
})

onUnmounted(() => {
  if (animationId) {
    cancelAnimationFrame(animationId)
  }
  window.removeEventListener('resize', handleResize)
  renderer?.dispose()
})
</script>

<template>
  <div class="structure-3d-container">
    <div ref="containerRef" class="canvas-container">
      <!-- 加载提示 -->
      <div v-if="loading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p class="loading-text">加载模型中... {{ loadingProgress }}%</p>
      </div>
    </div>
    <!-- 控制面板 -->
    <div class="control-panel">
      <h3>3D 模型控制</h3>
      <div class="control-buttons">
        <button @click="resetView" :disabled="!modelLoaded" class="control-btn">
          <span class="icon">⟲</span> 重置视角
        </button>
        <button @click="toggleAutoRotate" :disabled="!modelLoaded" class="control-btn" :class="{ active: autoRotate }">
          <span class="icon">↻</span> {{ autoRotate ? '停止旋转' : '自动旋转' }}
        </button>
        <button @click="toggleWireframe" :disabled="!modelLoaded" class="control-btn" :class="{ active: wireframe }">
          <span class="icon">▦</span> {{ wireframe ? '实体模式' : '线框模式' }}
        </button>
        <button @click="takeScreenshot" :disabled="!modelLoaded" class="control-btn">
          <span class="icon">📷</span> 截图
        </button>
        <button @click="toggleFullscreen" class="control-btn">
          <span class="icon">⛶</span> 全屏
        </button>
      </div>
      
      <div class="info-section" v-if="modelLoaded">
        <h4>操作说明</h4>
        <ul>
          <li>🖱️ 左键拖拽：旋转视角</li>
          <li>🖱️ 右键拖拽：平移视角</li>
          <li>🖱️ 滚轮：缩放</li>
          
        </ul>
      </div>
    </div>
    <!-- 爆炸因子 -->
    <div id="controls">
        <label for="explode">💥 爆炸因子</label>
        <input v-model="explodeValue" type="range" id="explode" min="0" max="20" step="0.01" value="0.0">
        <span id="value">{{ explodeValue }}</span>
    </div>
    <div id="note">✨ 模型部件自动提取，基于中心点径向爆炸 | 适用于多部件GLB</div>
  </div>
</template>

<style scoped>
.structure-3d-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  background: #1a1a2e;
}

.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: rgba(0, 0, 0, 0.8);
  z-index: 10;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 4px solid rgba(255, 255, 255, 0.1);
  border-top: 4px solid #00ff88;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.loading-text {
  color: #fff;
  font-size: 16px;
}

.control-panel {
  width: 250px;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.control-panel h3 {
  color: #fff;
  margin: 0;
  font-size: 18px;
  text-align: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 15px;
}

.control-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.control-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: #fff;
  cursor: pointer;
  transition: all 0.3s ease;
  font-size: 14px;
}

.control-btn:hover:not(:disabled) {
  background: rgba(0, 255, 136, 0.2);
  border-color: #00ff88;
}

.control-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.control-btn.active {
  background: rgba(0, 255, 136, 0.3);
  border-color: #00ff88;
}

.icon {
  font-size: 16px;
}

.info-section {
  margin-top: auto;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.info-section h4 {
  color: #fff;
  margin: 0 0 15px 0;
  font-size: 14px;
}

.info-section ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.info-section li {
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  margin-bottom: 8px;
}

     #controls {
            position: absolute;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(30,30,40,0.85);
            color: white;
            padding: 20px 30px;
            border-radius: 60px;
            backdrop-filter: blur(8px);
            border: 1px solid rgba(255,255,255,0.15);
            display: flex;
            gap: 25px;
            align-items: center;
            z-index: 20;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            pointer-events: all;
        }
        #controls label {
            font-size: 16px;
            font-weight: 400;
            letter-spacing: 1px;
            color: #ccc;
        }
        #controls input {
            width: 350px;
            cursor: pointer;
            accent-color: #ff6b6b;
            height: 8px;
            border-radius: 10px;
        }
        #controls span {
            font-size: 18px;
            font-weight: 600;
            min-width: 45px;
            text-align: center;
            color: #ffaa00;
            background: rgba(0,0,0,0.4);
            padding: 6px 12px;
            border-radius: 40px;
            font-family: monospace;
        }
        #note {
            position: absolute;
            bottom: 100px;
            right: 20px;
            background: rgba(0,0,0,0.5);
            color: #aaa;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            z-index: 15;
            border: 1px solid #444;
        }
</style>
