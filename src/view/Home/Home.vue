<script setup lang="ts">

import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router'

const router = useRouter()
const route = useRoute()

const check = ref(true)
const switchBody = () => {
  check.value = !check.value
}
const touteModel = () =>{
router.push('/Structure3D')
}
</script>

<template>

  <div style="width: 100%;">
    <RouterLink  to="Structure3D">模型</RouterLink> |
   <!-- <span @click="touteModel">模型</span> -->
    <RouterView />
  </div>
</template>

<style scoped>
* {
  margin: 0;
  padding: 0;
}
</style>
