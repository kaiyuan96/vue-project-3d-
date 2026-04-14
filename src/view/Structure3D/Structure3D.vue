<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { ModeView } from './ModelView'

const containerRef = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const loadingProgress = ref(0)
const modelLoaded = ref(false)
const autoRotate = ref(false)
const wireframe = ref(false)
const explodeValue = ref(0)

let modeView: ModeView | null = null

// 监视爆炸值变化
watch(explodeValue, (newValue) => {
  console.log('爆炸系数', newValue)
  if (modeView) {
    modeView.setExplodeValue(newValue)
  }
})

// 初始化场景
const initScene = () => {
  if (!containerRef.value) return

  // 创建 ModeView 实例
  modeView = new ModeView(containerRef.value, {
    backgroundColor: 0x1a1a2e,
    ambientLightIntensity: 0.6,
    directionalLightIntensity: 1,
    enableShadows: true,
    autoRotate: autoRotate.value
  })

  // 设置回调
  modeView.setOnLoadingProgress((progress) => {
    loadingProgress.value = progress
  })

  modeView.setOnModelLoaded(() => {
    loading.value = false
    modelLoaded.value = true
  })

  modeView.setOnError((error) => {
    console.error('加载模型失败:', error)
    loading.value = false
  })

  // 初始化场景
  modeView.init()

  // 加载模型
  modeView.loadModel('/computerModel.glb')
}

// 重置视角
const resetView = () => {
  if (modeView) {
    modeView.resetView()
  }
}

// 切换自动旋转
const toggleAutoRotate = () => {
  autoRotate.value = !autoRotate.value
  if (modeView) {
    modeView.setAutoRotate(autoRotate.value)
  }
}

// 切换线框模式
const toggleWireframe = () => {
  wireframe.value = !wireframe.value
  if (modeView) {
    modeView.toggleWireframe()
  }
}

// 截图
const takeScreenshot = () => {
  if (!modeView) return
  const dataURL = modeView.takeScreenshot()
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

// 设置部件颜色
const setPartColorByName = (name: string, color: number) => {
  if (modeView) {
    modeView.setPartColorByName(name, color)
  }
}

onMounted(() => {
  initScene()
})

onUnmounted(() => {
  if (modeView) {
    modeView.dispose()
    modeView = null
  }
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
  background: rgba(30, 30, 40, 0.85);
  color: white;
  padding: 20px 30px;
  border-radius: 60px;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  display: flex;
  gap: 25px;
  align-items: center;
  z-index: 20;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
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
  background: rgba(0, 0, 0, 0.4);
  padding: 6px 12px;
  border-radius: 40px;
  font-family: monospace;
}

#note {
  position: absolute;
  bottom: 100px;
  right: 20px;
  background: rgba(0, 0, 0, 0.5);
  color: #aaa;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  z-index: 15;
  border: 1px solid #444;
}
</style>
