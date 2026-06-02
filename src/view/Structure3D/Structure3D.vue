<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { ModeView, type PartInfo } from './ModelView'

const containerRef = ref<HTMLDivElement | null>(null)
const loading = ref(true)
const loadingProgress = ref(0)
const modelLoaded = ref(false)
const autoRotate = ref(false)
const wireframe = ref(false)
const explodeValue = ref(0)
const partsList = ref<{ id: string; name: string }[]>([])
const activePartId = ref<string | null>(null)
const explodedParts = ref<Set<string>>(new Set())

// HDR 环境贴图选项
const hdrOptions = [
  { label: '工作室(小)', value: '/studio_small_01_4k.hdr' },
  { label: '摄影棚(棕)', value: '/brown_photostudio_02_4k.hdr' },
  { label: '海景套房', value: '/relax_inn_seaview_suite_4k.hdr' },
]
const currentHdr = ref(hdrOptions[0].value)
const switchingHdr = ref(false)

// 信息面板（板卡传感器汇总）
const activeInfoPanel = ref<{
  partId: string;
  partName: string;
  sensors: { name: string; value: string; unit: string }[];
  screenX: number;
  screenY: number;
} | null>(null)

// Mesh 点击信息面板（显示被点击物体的名字）
const activeMeshInfo = ref<{
  meshName: string;
  screenX: number;
  screenY: number;
} | null>(null)

// 折叠状态
const collapseControl = ref(false)
const collapseHdr = ref(false)
const collapseParts = ref(false)
const collapseInfo = ref(false)

let modeView: ModeView | null = null

// 同步部件列表
const syncPartsList = () => {
  if (!modeView) return
  const parts = modeView.getParts()
  partsList.value = parts.map(p => ({ id: p.id, name: p.name }))
}

// 点击部件切换爆炸（沿固定方向系数1.8）
const togglePartExplode = (partId: string) => {
  activePartId.value = partId
  if (modeView) {
    const isExploded = modeView.toggleGroupExplode(partId, 1.2)
    if (isExploded) {
      explodedParts.value.add(partId)
    } else {
      explodedParts.value.delete(partId)
    }
    // 触发响应式更新
    explodedParts.value = new Set(explodedParts.value)
    // 下面这块注释不要删
    // 展开板卡后，获取传感器数据并显示信息面板
    // if (isExploded && modeView) {
    //   const data = modeView.getPartInfoData(partId)
    //   if (data) {
    //     activeInfoPanel.value = data
    //   }
    // } else {
    //   activeInfoPanel.value = null
    // }
  }
}

// 关闭信息面板
const closeInfoPanel = () => {
  activeInfoPanel.value = null
}

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
    backgroundColor: 0x0108191,
    ambientLightIntensity: 6.0,//环境光
    directionalLightIntensity: 8.5,//方向光
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
    syncPartsList()
  })

  modeView.setOnError((error) => {
    console.error('加载模型失败:', error)
    loading.value = false
  })

  // 初始化场景
  modeView.init()

  // 设置 Mesh 点击回调（板卡内物体点击 → 显示名字工具提示）
  modeView.onMeshClick = (data) => {
    if (data) {
      activeMeshInfo.value = {
        meshName: data.meshName,
        screenX: data.screenX,
        screenY: data.screenY,
      }
    } else {
      activeMeshInfo.value = null
    }
  }

  // 加载模型
  // modeView.loadModel('/computerModel.glb')
  // modeView.loadModel('/polyModel.glb')
  modeView.loadModel('/jixiangmodel009.glb')


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

// 切换 HDR 环境贴图
const switchHdr = (hdrUrl: string) => {
  if (!modeView || !modelLoaded.value) return
  if (hdrUrl === currentHdr.value) return
  
  currentHdr.value = hdrUrl
  switchingHdr.value = true
  modeView.switchHdrEnvironment(hdrUrl)
  // 给 HDR 加载一点缓冲时间，然后关闭加载提示
  setTimeout(() => {
    switchingHdr.value = false
  }, 1500)
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
      
      <!-- 物体点击信息提示（小标签） -->
      <div
        v-if="activeMeshInfo"
        class="mesh-info-tooltip"
        :style="{
          left: Math.min(activeMeshInfo.screenX, containerRef?.clientWidth ? containerRef.clientWidth - 160 : 200) + 'px',
          top: Math.min(activeMeshInfo.screenY - 30, containerRef?.clientHeight ? containerRef.clientHeight - 60 : 300) + 'px'
        }"
      >
        <div class="mesh-info-name">{{ activeMeshInfo.meshName }}</div>
        <div class="mesh-info-hint">点击其他位置取消</div>
      </div>

      <!-- 板卡信息面板 -->
      <div
        v-if="activeInfoPanel"
        class="info-panel-overlay"
        :style="{
          left: Math.min(activeInfoPanel.screenX, containerRef?.clientWidth ? containerRef.clientWidth - 220 : 300) + 'px',
          top: Math.min(activeInfoPanel.screenY, containerRef?.clientHeight ? containerRef.clientHeight - 260 : 300) + 'px'
        }"
      >
        <div class="info-panel-header">
          <span class="info-panel-title">{{ activeInfoPanel.partName }}</span>
          <button class="info-panel-close" @click="closeInfoPanel">✕</button>
        </div>
        <div class="info-panel-body">
          <div
            v-for="sensor in activeInfoPanel.sensors"
            :key="sensor.name"
            class="sensor-row"
          >
            <span class="sensor-name">{{ sensor.name }}</span>
            <span class="sensor-value">{{ sensor.value }}{{ sensor.unit }}</span>
          </div>
          <div v-if="activeInfoPanel.sensors.length === 0" class="sensor-empty">
            暂无传感器数据
          </div>
        </div>
      </div>
    </div>
    <!-- 控制面板 -->
    <div class="control-panel">
      <h3>3D 模型控制</h3>
      <div class="panel-body">
        <!-- ====== 控制按钮 ====== -->
        <div class="collapse-section">
          <div class="collapse-header" @click="collapseControl = !collapseControl">
            <span class="collapse-arrow">{{ collapseControl ? '▶' : '▼' }}</span>
            <span>🎮 控制</span>
          </div>
          <div class="collapse-content" :class="{ collapsed: collapseControl }">
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
          </div>
        </div>

        <!-- ====== 环境背景 ====== -->
        <div class="collapse-section">
          <div class="collapse-header" @click="collapseHdr = !collapseHdr">
            <span class="collapse-arrow">{{ collapseHdr ? '▶' : '▼' }}</span>
            <span>🌄 环境背景</span>
          </div>
          <div class="collapse-content" :class="{ collapsed: collapseHdr }">
            <div class="hdr-list">
              <button
                v-for="hdr in hdrOptions"
                :key="hdr.value"
                @click="switchHdr(hdr.value)"
                :disabled="!modelLoaded || switchingHdr"
                class="hdr-btn"
                :class="{ active: currentHdr === hdr.value }"
              >
                <span class="hdr-indicator" :class="{ active: currentHdr === hdr.value }"></span>
                <span class="hdr-label">{{ hdr.label }}</span>
                <span v-if="switchingHdr && currentHdr === hdr.value" class="hdr-loading">加载中...</span>
              </button>
            </div>
          </div>
        </div>

        <!-- ====== 板卡列表 ====== -->
        <div class="collapse-section" v-if="partsList.length > 0">
          <div class="collapse-header" @click="collapseParts = !collapseParts">
            <span class="collapse-arrow">{{ collapseParts ? '▶' : '▼' }}</span>
            <span>📦 板卡列表 ({{ partsList.length }})</span>
          </div>
          <div class="collapse-content" :class="{ collapsed: collapseParts }">
            <div class="parts-list">
              <button
                v-for="part in partsList"
                :key="part.id"
                @click="togglePartExplode(part.id)"
                class="part-btn"
                :class="{ 
                  active: activePartId === part.id,
                  exploded: explodedParts.has(part.id)
                }"
              >
                <span class="part-icon">{{ explodedParts.has(part.id) ? '💥' : '🔘' }}</span>
                <span class="part-name">{{ part.name }}</span>
                <span class="part-status">{{ explodedParts.has(part.id) ? '已展开' : '' }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- ====== 操作说明（固定在底部） ====== -->
        <div class="collapse-section info-section-sticky" v-if="modelLoaded">
          <div class="collapse-header" @click="collapseInfo = !collapseInfo">
            <span class="collapse-arrow">{{ collapseInfo ? '▶' : '▼' }}</span>
            <span>💡 操作说明</span>
          </div>
          <div class="collapse-content" :class="{ collapsed: collapseInfo }">
            <ul>
              <li>🖱️ 左键拖拽：旋转视角</li>
              <li>🖱️ 右键拖拽：平移视角</li>
              <li>🖱️ 滚轮：缩放</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
    <!-- 爆炸因子 -->
    <!-- <div id="controls">
        <label for="explode">💥 爆炸因子</label>
        <input v-model="explodeValue" type="range" id="explode" min="0" max="2" step="0.01" value="0.0">
        <span id="value">{{ explodeValue }}</span>
    </div> -->
    <!-- <div id="note">✨ 所有名称包含「group_board」的分组整体爆炸 | 其他部件保持不动</div> -->
  </div>
</template>

<style scoped>
.structure-3d-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  background: #1a1a2e;
  overflow: hidden;
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

/* ========== 物体点击信息提示 ========== */
.mesh-info-tooltip {
  position: absolute;
  z-index: 35;
  background: rgba(255, 170, 0, 0.12);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 170, 0, 0.4);
  border-radius: 8px;
  padding: 6px 12px;
  pointer-events: none;
  animation: meshFadeIn 0.2s ease-out;
  white-space: nowrap;
}

@keyframes meshFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.mesh-info-name {
  color: #ffaa00;
  font-size: 13px;
  font-weight: 600;
}

.mesh-info-hint {
  color: rgba(255, 255, 255, 0.35);
  font-size: 10px;
  margin-top: 2px;
}

/* ========== 信息面板覆盖层 ========== */
.info-panel-overlay {
  position: absolute;
  z-index: 30;
  width: 200px;
  background: rgba(10, 15, 30, 0.92);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(0, 255, 136, 0.3);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  animation: panelFadeIn 0.25s ease-out;
  pointer-events: all;
}

@keyframes panelFadeIn {
  from { opacity: 0; transform: translateY(8px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.info-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: linear-gradient(135deg, rgba(0, 255, 136, 0.15), transparent);
  border-bottom: 1px solid rgba(0, 255, 136, 0.15);
}

.info-panel-title {
  color: #00ff88;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.info-panel-close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  font-size: 14px;
  padding: 0 0 0 8px;
  line-height: 1;
  transition: color 0.2s;
}

.info-panel-close:hover {
  color: #ff6b6b;
}

.info-panel-body {
  padding: 8px 12px;
}

.sensor-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.sensor-row:last-child {
  border-bottom: none;
}

.sensor-name {
  color: rgba(255, 255, 255, 0.6);
  font-size: 11px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sensor-value {
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  font-family: 'Consolas', monospace;
  margin-left: 8px;
  flex-shrink: 0;
}

.sensor-empty {
  color: rgba(255, 255, 255, 0.3);
  font-size: 12px;
  text-align: center;
  padding: 12px 0;
}

/* ========== 控制面板 ========== */
.control-panel {
  width: 250px;
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.control-panel h3 {
  color: #fff;
  margin: 0 0 12px 0;
  font-size: 18px;
  text-align: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 12px;
  flex-shrink: 0;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: calc(100vh - 100px);
  padding-right: 4px;
}

.panel-body::-webkit-scrollbar {
  width: 4px;
}

.panel-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

/* ========== 折叠区域 ========== */
.collapse-section {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding: 4px 0;
}

.collapse-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  color: #fff;
  cursor: pointer;
  user-select: none;
  transition: color 0.2s;
  font-size: 14px;
  font-weight: 500;
  border-radius: 4px;
}

.collapse-header:hover {
  color: #00ff88;
  background: rgba(0, 255, 136, 0.08);
}

.collapse-arrow {
  font-size: 10px;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.5);
  transition: transform 0.2s;
}

.collapse-content {
  overflow: hidden;
  transition: max-height 0.3s ease, opacity 0.3s ease, margin 0.3s ease;
  max-height: 1000px;
  opacity: 1;
  margin-top: 4px;
  margin-bottom: 4px;
}

.collapse-content.collapsed {
  max-height: 0;
  opacity: 0;
  margin-top: 0;
  margin-bottom: 0;
  pointer-events: none;
}

/* ========== 控制按钮 ========== */
.control-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}

.control-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: #ddd;
  cursor: pointer;
  transition: all 0.25s ease;
  font-size: 13px;
}

.control-btn:hover:not(:disabled) {
  background: rgba(0, 255, 136, 0.15);
  border-color: #00ff88;
  color: #fff;
}

.control-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.control-btn.active {
  background: rgba(0, 255, 136, 0.25);
  border-color: #00ff88;
  color: #00ff88;
}

.icon {
  font-size: 15px;
}

/* ========== HDR 列表 ========== */
.hdr-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 4px 0;
}

.hdr-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  color: #bbb;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 12px;
  text-align: left;
}

.hdr-btn:hover:not(:disabled) {
  background: rgba(0, 200, 255, 0.12);
  border-color: #00c8ff;
  color: #fff;
}

.hdr-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hdr-btn.active {
  background: rgba(0, 200, 255, 0.2);
  border-color: #00c8ff;
  color: #00c8ff;
}

.hdr-indicator {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
  transition: all 0.3s ease;
}

.hdr-indicator.active {
  background: #00c8ff;
  box-shadow: 0 0 6px rgba(0, 200, 255, 0.5);
}

.hdr-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hdr-loading {
  margin-left: auto;
  font-size: 10px;
  color: #ffaa00;
  animation: pulse 0.8s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ========== 卡板列表 ========== */
.parts-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 180px;
  overflow-y: auto;
  padding: 4px 0;
}

.parts-list::-webkit-scrollbar {
  width: 3px;
}

.parts-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}

.part-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px;
  color: #bbb;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 12px;
  text-align: left;
}

.part-btn:hover {
  background: rgba(0, 255, 136, 0.12);
  border-color: #00ff88;
  color: #fff;
}

.part-btn.active {
  background: rgba(0, 255, 136, 0.2);
  border-color: #00ff88;
  color: #00ff88;
}

.part-btn.exploded {
  background: rgba(255, 107, 107, 0.2);
  border-color: #ff6b6b;
  color: #ff6b6b;
}

.part-icon {
  font-size: 11px;
  flex-shrink: 0;
}

.part-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.part-status {
  font-size: 10px;
  color: #ff6b6b;
  flex-shrink: 0;
}

/* ========== 操作说明（固定在底部） ========== */
.info-section-sticky {
  margin-top: auto !important;
}

.info-section-sticky .collapse-header {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.collapse-content ul {
  list-style: none;
  padding: 4px 4px 4px 8px;
  margin: 0;
}

.collapse-content li {
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  padding: 3px 0;
}

/* 废弃样式保留避免报错 */
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