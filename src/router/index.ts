import { createRouter, createWebHistory } from 'vue-router'
// import ImagePunctuation from '@/view/ImagePunctuation/ImagePunctuation.vue'
// import ImageTrajectory from '@/view/ImageTrajectory/ImageTrajectory.vue'
import Structure3D from '@/view/Structure3D/Structure3D.vue'
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [ 
    {
    path: '/Structure3D',
    name: 'Home',
    component: () => Structure3D
  },
  // {
  //   path: '/ImageTrajectory',
  //   name: 'About',
  //   component: () => ImageTrajectory
  // }

  ]
})

export default router
