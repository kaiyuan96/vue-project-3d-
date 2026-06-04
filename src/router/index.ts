import { createRouter, createWebHashHistory } from 'vue-router'
import Structure3D from '@/view/Structure3D/Structure3D.vue'
import Home from '@/view/Home/Home.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [ 
    {
    path: '/Structure3D',
    name: 'Structure3D',
    component: Structure3D
  },
      {
    path: '/',
    name: 'Home',
    component: Home
  },

  ]
})

export default router