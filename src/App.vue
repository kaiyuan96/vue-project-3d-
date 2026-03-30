<script setup lang="ts">

import { ref } from 'vue';
const check = ref(true)
const switchBody = () => {
  check.value = !check.value
}
</script>

<template>

  <div style="width: 100%;">
    <!-- <button @click="switchBody">切换内容</button> -->
    <RouterLink to="Structure3D">模型</RouterLink> |
    <!-- <RouterLink to="ImageTrajectory">图片轨迹渲染</RouterLink> | -->

    <RouterView />

  </div>
</template>

<style scoped>
* {
  margin: 0;
  padding: 0;
}
</style>
