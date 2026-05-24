<script setup lang="ts">

import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()

const check = ref(true)
const switchBody = () => {
  check.value = !check.value
}
</script>

<template>

  <div style="width: 100%;height: 100%;padding: 0;margin: 0;">
    <!-- <RouterLink  v-if="route.path !== '/Structure3D'" to="Structure3D">模型</RouterLink> | -->
    <RouterView />
  </div>
</template>

<style scoped>
* {
  margin: 0;
  padding: 0;
}
</style>
